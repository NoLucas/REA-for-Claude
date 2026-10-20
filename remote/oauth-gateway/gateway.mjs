#!/usr/bin/env node
/*
 * oauth-gateway — a tiny OAuth 2.1 authorization server + bearer-protected
 * reverse proxy that puts real login in front of the REA appliance so it can be
 * added to claude.ai as a custom connector without a path secret.
 *
 * Implements what the MCP authorization spec asks of a remote server:
 *   - RFC 9728 protected-resource metadata  GET /.well-known/oauth-protected-resource[/mcp]
 *   - RFC 8414 auth-server metadata         GET /.well-known/oauth-authorization-server
 *   - RFC 7591 dynamic client registration  POST /register
 *   - Authorization code + PKCE (S256)      GET/POST /authorize, POST /token
 *   - Refresh tokens (rotating)
 *   - 401 + WWW-Authenticate resource_metadata on the MCP endpoint
 *
 * Login is a single operator passphrase (GATEWAY_PASSWORD): this is a personal
 * appliance, not a multi-user IdP. Everything else (tokens, codes, clients) is
 * random, short-lived and kept in memory (optionally persisted to STATE_FILE).
 *
 * Environment:
 *   PUBLIC_URL        https://your-host            (issuer; REQUIRED)
 *   GATEWAY_PASSWORD  passphrase shown to the user (REQUIRED)
 *   UPSTREAM_MCP_URL  http://rea:8765/<secret>/mcp (REQUIRED; where REA listens)
 *   UPSTREAM_API_KEY  optional bearer added to upstream requests (supergateway --apiKey)
 *   PORT              8080
 *   TOKEN_TTL_SECONDS 3600
 *   ALLOWED_REDIRECT_HOSTS  claude.ai,claude.com   ("*" to allow any https redirect)
 *   STATE_FILE        optional path to persist clients/tokens across restarts
 *
 * No dependencies. Node 18+.
 */
import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { URL } from 'node:url';

const env = (k, d) => (process.env[k] && process.env[k].trim()) || d;
const PUBLIC_URL = env('PUBLIC_URL');
const PASSWORD = env('GATEWAY_PASSWORD');
const UPSTREAM = env('UPSTREAM_MCP_URL');
const UPSTREAM_KEY = env('UPSTREAM_API_KEY', '');
const PORT = Number(env('PORT', '8080'));
const TOKEN_TTL = Number(env('TOKEN_TTL_SECONDS', '3600'));
const ALLOWED_HOSTS = env('ALLOWED_REDIRECT_HOSTS', 'claude.ai,claude.com').split(',').map((s) => s.trim()).filter(Boolean);
const STATE_FILE = env('STATE_FILE', '');

for (const [k, v] of [['PUBLIC_URL', PUBLIC_URL], ['GATEWAY_PASSWORD', PASSWORD], ['UPSTREAM_MCP_URL', UPSTREAM]]) {
  if (!v) { console.error(`[gateway] ${k} is required`); process.exit(1); }
}
if (PASSWORD.length < 12) { console.error('[gateway] GATEWAY_PASSWORD must be at least 12 characters'); process.exit(1); }
const issuer = PUBLIC_URL.replace(/\/+$/, '');
const RESOURCE = `${issuer}/mcp`;
const upstream = new URL(UPSTREAM);

/* ----------------------------- state ----------------------------- */
const state = { clients: {}, codes: {}, tokens: {}, refresh: {} };
if (STATE_FILE && fs.existsSync(STATE_FILE)) {
  try { Object.assign(state, JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))); } catch (e) { console.error(`[gateway] state file ignored: ${e.message}`); }
}
let saveTimer = null;
function save() {
  if (!STATE_FILE) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { fs.writeFileSync(STATE_FILE, JSON.stringify(state), { mode: 0o600 }); } catch (e) { console.error(`[gateway] save failed: ${e.message}`); }
  }, 200);
}
const now = () => Math.floor(Date.now() / 1000);
const rand = (n = 32) => crypto.randomBytes(n).toString('base64url');
const sha256b64url = (s) => crypto.createHash('sha256').update(s).digest('base64url');
const safeEq = (a, b) => { const A = Buffer.from(String(a)), B = Buffer.from(String(b)); return A.length === B.length && crypto.timingSafeEqual(A, B); };
function gc() {
  const t = now();
  for (const [k, v] of Object.entries(state.codes)) if (v.exp < t) delete state.codes[k];
  for (const [k, v] of Object.entries(state.tokens)) if (v.exp < t) delete state.tokens[k];
  for (const [k, v] of Object.entries(state.refresh)) if (v.exp < t) delete state.refresh[k];
}
setInterval(gc, 60_000).unref();

/* ------------------------- login rate limit ------------------------- */
const attempts = new Map(); // ip -> {n, until}
function loginAllowed(ip) { const a = attempts.get(ip); return !(a && a.until > Date.now()); }
function loginFailed(ip) { const a = attempts.get(ip) || { n: 0, until: 0 }; a.n += 1; if (a.n >= 5) { a.until = Date.now() + 60_000; a.n = 0; } attempts.set(ip, a); }
function loginOk(ip) { attempts.delete(ip); }

/* ----------------------------- helpers ----------------------------- */
function send(res, status, body, headers = {}) {
  const isObj = body !== null && typeof body === 'object';
  const data = isObj ? JSON.stringify(body) : String(body ?? '');
  res.writeHead(status, { 'Content-Type': isObj ? 'application/json' : 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(data);
}
const oauthError = (res, status, error, description) => send(res, status, { error, error_description: description });
function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
function parseForm(s) { const o = {}; for (const [k, v] of new URLSearchParams(s)) o[k] = v; return o; }
function redirectAllowed(uri) {
  let u; try { u = new URL(uri); } catch { return false; }
  if (ALLOWED_HOSTS.includes('*')) return u.protocol === 'https:' || u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (u.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(u.hostname)) return false;
  return ALLOWED_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith('.' + h));
}
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function loginPage(q, message = '') {
  const keep = ['response_type', 'client_id', 'redirect_uri', 'code_challenge', 'code_challenge_method', 'state', 'scope', 'resource']
    .filter((k) => q[k] != null).map((k) => `<input type="hidden" name="${k}" value="${esc(q[k])}">`).join('');
  const client = state.clients[q.client_id];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>REA appliance — sign in</title>
<style>body{font:16px/1.5 system-ui,sans-serif;background:#f6f6f4;color:#1a1a18;display:grid;place-items:center;min-height:100vh;margin:0}
form{background:#fff;border:1px solid #e3e3df;border-radius:12px;padding:28px 30px;width:min(420px,92vw)}h1{font-size:20px;margin:0 0 6px}
p{color:#6b6b66;margin:0 0 16px;font-size:14px}input[type=password]{width:100%;font-size:16px;padding:10px;border:1px solid #cfcfca;border-radius:8px}
button{margin-top:14px;width:100%;padding:11px;border:0;border-radius:8px;background:#7b4bd8;color:#fff;font-size:16px;cursor:pointer}
.err{color:#b4232c;font-size:14px;margin:8px 0 0}code{background:#f0efeb;padding:1px 5px;border-radius:4px}</style></head>
<body><form method="post" action="/authorize">${keep}
<h1>REA appliance</h1><p><code>${esc(client?.client_name || q.client_id || 'a client')}</code> wants access to the reverse-engineering tools on this server.</p>
<input type="password" name="password" placeholder="Gateway passphrase" autofocus autocomplete="current-password" required>
${message ? `<div class="err">${esc(message)}</div>` : ''}<button type="submit">Allow</button></form></body></html>`;
}

/* ------------------------------ routes ------------------------------ */
async function handle(req, res) {
  const url = new URL(req.url, issuer);
  const p = url.pathname.replace(/\/+$/, '') || '/';
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '?';

  if (req.method === 'GET' && (p === '/.well-known/oauth-protected-resource' || p === '/.well-known/oauth-protected-resource/mcp')) {
    return send(res, 200, { resource: RESOURCE, authorization_servers: [issuer], bearer_methods_supported: ['header'], scopes_supported: ['mcp'], resource_name: 'REA appliance' });
  }
  if (req.method === 'GET' && (p === '/.well-known/oauth-authorization-server' || p === '/.well-known/openid-configuration')) {
    return send(res, 200, {
      issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, registration_endpoint: `${issuer}/register`,
      response_types_supported: ['code'], response_modes_supported: ['query'], grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
      scopes_supported: ['mcp'], service_documentation: 'https://github.com/NoLucas/REA-for-Claude/tree/main/remote',
    });
  }

  if (p === '/register') {
    if (req.method !== 'POST') return oauthError(res, 405, 'invalid_request', 'POST only');
    let body; try { body = JSON.parse(await readBody(req) || '{}'); } catch { return oauthError(res, 400, 'invalid_client_metadata', 'bad JSON'); }
    const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris.filter((u) => typeof u === 'string') : [];
    if (!uris.length || !uris.every(redirectAllowed)) return oauthError(res, 400, 'invalid_redirect_uri', `redirect_uris must be https and on: ${ALLOWED_HOSTS.join(', ')}`);
    const method = ['none', 'client_secret_post', 'client_secret_basic'].includes(body.token_endpoint_auth_method) ? body.token_endpoint_auth_method : 'none';
    const client_id = rand(16);
    const client = { client_id, client_name: String(body.client_name || '').slice(0, 80), redirect_uris: uris, token_endpoint_auth_method: method,
      grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], client_id_issued_at: now() };
    if (method !== 'none') client.client_secret = rand(32);
    state.clients[client_id] = client; save();
    console.log(`[gateway] registered client ${client_id} (${client.client_name || 'unnamed'})`);
    return send(res, 201, client);
  }

  if (p === '/authorize') {
    const q = req.method === 'POST' ? parseForm(await readBody(req)) : Object.fromEntries(url.searchParams);
    const client = state.clients[q.client_id];
    if (!client) return send(res, 400, '<p>Unknown client_id. Register first.</p>');
    if (!client.redirect_uris.includes(q.redirect_uri)) return send(res, 400, '<p>redirect_uri is not registered for this client.</p>');
    const back = (params) => { const u = new URL(q.redirect_uri); for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, v); res.writeHead(302, { Location: u.toString(), 'Cache-Control': 'no-store' }); res.end(); };
    if (q.response_type !== 'code') return back({ error: 'unsupported_response_type', state: q.state });
    if (!q.code_challenge || (q.code_challenge_method || 'S256') !== 'S256') return back({ error: 'invalid_request', error_description: 'PKCE S256 required', state: q.state });
    if (q.resource && q.resource !== RESOURCE) return back({ error: 'invalid_target', error_description: `resource must be ${RESOURCE}`, state: q.state });
    if (req.method === 'GET') return send(res, 200, loginPage(q));
    if (!loginAllowed(ip)) return send(res, 429, loginPage(q, 'Too many attempts. Wait a minute.'));
    if (!safeEq(q.password || '', PASSWORD)) { loginFailed(ip); console.log(`[gateway] failed login from ${ip}`); return send(res, 401, loginPage(q, 'Wrong passphrase.')); }
    loginOk(ip);
    const code = rand(32);
    state.codes[code] = { client_id: client.client_id, redirect_uri: q.redirect_uri, code_challenge: q.code_challenge, scope: q.scope || 'mcp', exp: now() + 300 };
    save();
    return back({ code, state: q.state });
  }

  if (p === '/token') {
    if (req.method !== 'POST') return oauthError(res, 405, 'invalid_request', 'POST only');
    const f = parseForm(await readBody(req));
    // client auth: none (PKCE) or client_secret_post/basic
    let client_id = f.client_id, secret = f.client_secret;
    const basic = /^Basic (.+)$/.exec(req.headers.authorization || '');
    if (basic) { const [id, sec] = Buffer.from(basic[1], 'base64').toString().split(':'); client_id = decodeURIComponent(id || ''); secret = decodeURIComponent(sec || ''); }
    const client = state.clients[client_id];
    if (!client) return oauthError(res, 401, 'invalid_client', 'unknown client');
    if (client.token_endpoint_auth_method !== 'none' && !(secret && safeEq(secret, client.client_secret))) return oauthError(res, 401, 'invalid_client', 'bad client secret');

    const issue = (scope) => {
      const access_token = rand(32), refresh_token = rand(32), exp = now() + TOKEN_TTL;
      state.tokens[access_token] = { client_id, scope, exp };
      state.refresh[refresh_token] = { client_id, scope, exp: now() + 30 * 86400 };
      save();
      return { access_token, token_type: 'Bearer', expires_in: TOKEN_TTL, refresh_token, scope };
    };
    if (f.grant_type === 'authorization_code') {
      const c = state.codes[f.code]; delete state.codes[f.code];
      if (!c || c.exp < now() || c.client_id !== client_id) return oauthError(res, 400, 'invalid_grant', 'code invalid or expired');
      if (f.redirect_uri && f.redirect_uri !== c.redirect_uri) return oauthError(res, 400, 'invalid_grant', 'redirect_uri mismatch');
      if (!f.code_verifier || sha256b64url(f.code_verifier) !== c.code_challenge) return oauthError(res, 400, 'invalid_grant', 'PKCE verification failed');
      console.log(`[gateway] token issued to ${client_id}`);
      return send(res, 200, issue(c.scope));
    }
    if (f.grant_type === 'refresh_token') {
      const r = state.refresh[f.refresh_token]; delete state.refresh[f.refresh_token];
      if (!r || r.exp < now() || r.client_id !== client_id) return oauthError(res, 400, 'invalid_grant', 'refresh token invalid');
      return send(res, 200, issue(r.scope));
    }
    return oauthError(res, 400, 'unsupported_grant_type', 'use authorization_code or refresh_token');
  }

  if (p === '/healthz') return send(res, 200, { ok: true, clients: Object.keys(state.clients).length });

  /* -------- protected MCP endpoint: bearer check, then stream-proxy upstream -------- */
  if (p === '/mcp') {
    const m = /^Bearer (.+)$/i.exec(req.headers.authorization || '');
    const tok = m && state.tokens[m[1].trim()];
    if (!tok || tok.exp < now()) {
      return send(res, 401, { error: 'invalid_token' }, { 'WWW-Authenticate': `Bearer resource_metadata="${issuer}/.well-known/oauth-protected-resource", scope="mcp"` });
    }
    const headers = { ...req.headers };
    delete headers.host; delete headers.authorization; delete headers['content-length'];
    headers.host = upstream.host;
    if (UPSTREAM_KEY) headers.authorization = `Bearer ${UPSTREAM_KEY}`;
    const lib = upstream.protocol === 'https:' ? https : http;
    const up = lib.request({ hostname: upstream.hostname, port: upstream.port || (upstream.protocol === 'https:' ? 443 : 80), path: upstream.pathname + url.search, method: req.method, headers }, (ur) => {
      res.writeHead(ur.statusCode || 502, ur.headers);
      ur.pipe(res);
    });
    up.on('error', (e) => { console.error(`[gateway] upstream error: ${e.message}`); if (!res.headersSent) send(res, 502, { error: 'upstream_unavailable' }); else res.end(); });
    req.pipe(up);
    // Tear the upstream down only if the client goes away before the response finished
    // (req 'close' fires as soon as the request body is consumed, which would kill SSE).
    res.on('close', () => { if (!res.writableFinished) up.destroy(); });
    return;
  }

  send(res, 404, { error: 'not_found' });
}

http.createServer((req, res) => handle(req, res).catch((e) => { console.error(`[gateway] ${e.message}`); if (!res.headersSent) send(res, 500, { error: 'server_error' }); }))
  .listen(PORT, () => console.log(`[gateway] listening on :${PORT}  issuer=${issuer}  resource=${RESOURCE}  upstream=${UPSTREAM}`));
