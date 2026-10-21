#!/usr/bin/env node
/*
 * make-report.mjs — turn REA evidence JSON into a shareable report.
 *
 * REA tools return "Evidence" objects (the CLI with --format json, or an MCP
 * tool result). Save each one to a .json file, then:
 *
 *   node scripts/make-report.mjs <file-or-dir>... [options]
 *
 * Options:
 *   --out <path>        Output path or directory (default: ./rea-reports)
 *   --format <fmt>      html | md | json | both (html+md) | all   (default: html)
 *                       json = normalised evidence model for downstream tooling
 *   --theme <name>      HTML theme: violet (default) | ocean | forest | amber | mono | contrast
 *                       (also "report": {"theme": ...} in ~/.rea-plugin.json)
 *   --title <text>      Report title                (default: derived from targets)
 *   --bundle [file]     Also write a portable evidence bundle (*.rea-bundle.json): every
 *                       evidence object + manifest (host, time, digests). A bundle is a valid
 *                       input anywhere a file or directory is accepted, including --diff, so
 *                       two machines can exchange bundles and diff them.
 *   --stdin             Read one evidence JSON object (or array) from stdin
 *   -h, --help
 *
 * No dependencies; Node 18+. The report groups evidence by target (sha256),
 * renders decompiled pseudo-code as code blocks, binary overviews as tables,
 * and always shows provider, confidence and limitations. Unknown operations
 * fall back to pretty-printed JSON, so new REA operations still render.
 *
 * This reads only the JSON you give it; it runs no analysis and reaches no
 * network. It is safe to run on evidence from an untrusted target — but treat
 * the rendered strings (symbol names, paths, decompiled code) as untrusted
 * content, exactly as REA marks them.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const requireCjs = createRequire(import.meta.url);
let pluginConfig = {};
try { pluginConfig = requireCjs('./rea-engines-lib.cjs').readConfig() || {}; } catch { pluginConfig = {}; }
const reportDefaults = (pluginConfig && pluginConfig.report) || {};

/* ------------------------------- themes ------------------------------ */
// Each theme: light + dark variable sets. Diff pages add the add/del colours.
const THEMES = {
  violet:   { light: { bg: '#fbfbfa', fg: '#1a1a18', muted: '#6b6b66', card: '#fff', line: '#e6e6e2', accent: '#7b4bd8', code: '#f4f3f0', tag: '#efeaf9', addbg: '#e6f6ea', delbg: '#fdeaea', add: '#1b7f3b', del: '#b4232c' },
              dark:  { bg: '#17171a', fg: '#e9e9ec', muted: '#9a9aa2', card: '#1f1f23', line: '#30303a', accent: '#b79bff', code: '#111114', tag: '#2a2440', addbg: '#12301c', delbg: '#3a1518', add: '#7fd49a', del: '#ff8a8a' } },
  ocean:    { light: { bg: '#f7fafc', fg: '#14202b', muted: '#5f7384', card: '#fff', line: '#dbe4ec', accent: '#0b6bcb', code: '#eef3f7', tag: '#e3eefb', addbg: '#e4f5ec', delbg: '#fdeaea', add: '#157a45', del: '#b4232c' },
              dark:  { bg: '#0f1720', fg: '#e3ebf2', muted: '#8fa3b4', card: '#17222d', line: '#273645', accent: '#6cb1ff', code: '#0b121a', tag: '#1c2f44', addbg: '#11301f', delbg: '#3a1518', add: '#7fd49a', del: '#ff8a8a' } },
  forest:   { light: { bg: '#f8faf6', fg: '#182018', muted: '#5f6f5f', card: '#fff', line: '#dde5da', accent: '#2f7d3b', code: '#eef3ec', tag: '#e3f1e3', addbg: '#e2f3e5', delbg: '#fdeaea', add: '#1b7f3b', del: '#b4232c' },
              dark:  { bg: '#121712', fg: '#e5ebe4', muted: '#93a292', card: '#1a211a', line: '#2a362a', accent: '#8fd49a', code: '#0d110d', tag: '#1f3322', addbg: '#13301c', delbg: '#3a1518', add: '#7fd49a', del: '#ff8a8a' } },
  amber:    { light: { bg: '#fcfaf5', fg: '#231d12', muted: '#7a6d58', card: '#fff', line: '#ece4d4', accent: '#b4600a', code: '#f6f1e6', tag: '#f8ecd8', addbg: '#e6f6ea', delbg: '#fdeaea', add: '#1b7f3b', del: '#b4232c' },
              dark:  { bg: '#1a160f', fg: '#efe8dc', muted: '#a89a84', card: '#241e14', line: '#3a3124', accent: '#f0a84a', code: '#120f0a', tag: '#3a2c18', addbg: '#12301c', delbg: '#3a1518', add: '#7fd49a', del: '#ff8a8a' } },
  mono:     { light: { bg: '#fafafa', fg: '#111', muted: '#666', card: '#fff', line: '#e2e2e2', accent: '#111', code: '#f2f2f2', tag: '#ececec', addbg: '#ededed', delbg: '#e4e4e4', add: '#111', del: '#555' },
              dark:  { bg: '#121212', fg: '#eaeaea', muted: '#9a9a9a', card: '#1b1b1b', line: '#2e2e2e', accent: '#eaeaea', code: '#0c0c0c', tag: '#262626', addbg: '#232323', delbg: '#1a1a1a', add: '#eaeaea', del: '#9a9a9a' } },
  contrast: { light: { bg: '#fff', fg: '#000', muted: '#333', card: '#fff', line: '#000', accent: '#0000d6', code: '#f0f0f0', tag: '#e0e0ff', addbg: '#d6ffd6', delbg: '#ffd6d6', add: '#005c00', del: '#9b0000' },
              dark:  { bg: '#000', fg: '#fff', muted: '#ddd', card: '#000', line: '#fff', accent: '#8ab4ff', code: '#111', tag: '#1a1a4a', addbg: '#0b3a0b', delbg: '#4a0b0b', add: '#9fff9f', del: '#ff9f9f' } },
};
function themeCss(name) {
  const t = THEMES[name] || THEMES.violet;
  const vars = (o) => Object.entries(o).map(([k, v]) => `--${k}:${v}`).join(';');
  return `:root{${vars(t.light)}}\n@media (prefers-color-scheme:dark){:root:not([data-theme=light]){${vars(t.dark)}}}\n:root[data-theme=dark]{${vars(t.dark)}}`;
}

const HELP = `make-report.mjs — REA evidence -> HTML/Markdown/JSON report (+ evidence bundles)
Usage: node scripts/make-report.mjs <file-dir-or-bundle>... [--out P] [--format html|md|json|both|all] [--theme T] [--title T] [--bundle [file]] [--stdin]
       node scripts/make-report.mjs --diff <before> <after> [--out P] [--format ...] [--theme T] [--title T]
       (<before>/<after> may be evidence directories or *.rea-bundle.json files from any machine)

--diff compares two evidence sets (e.g. two builds of the same app): per operation it
shows changed overview fields, added/removed procedures, strings and segments, and a
line diff of decompiled pseudo-code. Evidence is matched by operation + procedure/target.`;

function parseArgs(argv) {
  const o = { inputs: [], out: reportDefaults.dir || 'rea-reports', format: reportDefaults.format || 'html', theme: reportDefaults.theme || 'violet', title: null, stdin: false, diff: null, bundle: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') { console.log(HELP); process.exit(0); }
    else if (a === '--out') o.out = argv[++i];
    else if (a === '--format') o.format = argv[++i];
    else if (a === '--title') o.title = argv[++i];
    else if (a === '--theme') o.theme = argv[++i];
    else if (a === '--bundle') { o.bundle = (argv[i + 1] && !argv[i + 1].startsWith('--')) ? argv[++i] : true; }
    else if (a === '--stdin') o.stdin = true;
    else if (a === '--diff') { o.diff = [argv[++i], argv[++i]]; }
    else if (a.startsWith('--')) { console.error(`Unknown option: ${a}`); process.exit(2); }
    else o.inputs.push(a);
  }
  if (!['html', 'md', 'json', 'both', 'all'].includes(o.format)) { console.error(`--format must be html|md|json|both|all`); process.exit(2); }
  if (!THEMES[o.theme]) { console.error(`--theme must be one of ${Object.keys(THEMES).join('|')}`); process.exit(2); }
  if (o.diff && (!o.diff[0] || !o.diff[1])) { console.error('--diff needs <before> <after>'); process.exit(2); }
  return o;
}

function collectFiles(inputs) {
  const files = [];
  for (const input of inputs) {
    let st;
    try { st = fs.statSync(input); } catch { console.error(`skip (not found): ${input}`); continue; }
    if (st.isDirectory()) {
      for (const name of fs.readdirSync(input).sort())
        if (name.endsWith('.json')) files.push(path.join(input, name));
    } else files.push(input);
  }
  return files;
}

// A file may hold one evidence object, an array, or REA's {result:{...}} / tool {content:[{text}]} wrappers.
function* evidenceFrom(raw, origin) {
  let data;
  try { data = JSON.parse(raw); } catch (e) { console.error(`skip (bad JSON): ${origin}: ${e.message}`); return; }
  const unwrap = (d) => (d && typeof d === 'object' && d.result && !d.evidence_id && !d.subject) ? d.result : d;
  // Evidence bundle written by --bundle: { rea_bundle: {...manifest}, evidence: [...] }
  if (data && typeof data === 'object' && data.rea_bundle && Array.isArray(data.evidence)) data = data.evidence;
  const items = Array.isArray(data) ? data : [data];
  for (let item of items) {
    item = unwrap(item);
    // MCP tool result: { content: [{ type:"text", text:"<json>" }] }
    if (item && Array.isArray(item.content)) {
      for (const c of item.content) {
        if (c && c.type === 'text' && typeof c.text === 'string') {
          try { yield unwrap(JSON.parse(c.text)); continue; } catch { /* plain text */ }
        }
      }
      continue;
    }
    if (item && typeof item === 'object') yield item;
  }
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const short = (s, n = 16) => (typeof s === 'string' && s.length > n ? s.slice(0, n) + '…' : s);

function targetKey(ev) {
  const sub = ev.subject || {};
  return (sub.digest && (sub.digest.sha256 || sub.digest.sha1)) || sub.local_path || sub.name || 'unknown-target';
}

function asList(x) { return x == null ? [] : Array.isArray(x) ? x : [x]; }

// Render one evidence's normalized_result to { kind, text|rows|json }
function renderResult(ev) {
  const nr = ev.normalized_result;
  const op = ev.operation || ev.predicate_type || '';
  if (typeof nr === 'string') {
    const looksCode = /[;{}]/.test(nr) && nr.includes('\n') || /\b(void|int|char|undefined\d|return)\b/.test(nr);
    return { kind: looksCode ? 'code' : 'text', text: nr };
  }
  if (nr && typeof nr === 'object' && !Array.isArray(nr)) {
    const rows = [];
    for (const [k, v] of Object.entries(nr)) {
      if (Array.isArray(v)) rows.push([k, `${v.length} item(s)`]);
      else if (v && typeof v === 'object') rows.push([k, short(JSON.stringify(v), 80)]);
      else rows.push([k, String(v)]);
    }
    return { kind: 'table', rows, raw: nr, op };
  }
  if (nr != null) return { kind: 'json', json: nr };
  return { kind: 'json', json: ev.raw_result ?? null };
}

function hasSubject(ev) {
  const s = ev.subject;
  return !!(s && typeof s === 'object' && ((s.digest && (s.digest.sha256 || s.digest.sha1)) || s.local_path || s.name));
}

function buildModel(evidences) {
  // Some MCP tool results carry no subject (they refer to the active document).
  // Group the ones that do; then fold subject-less evidence into the single real
  // target when there is exactly one, else keep it as an "Unattributed" group.
  const targets = new Map();
  const orphans = [];
  for (const ev of evidences) {
    if (!hasSubject(ev)) { orphans.push(ev); continue; }
    const key = targetKey(ev);
    if (!targets.has(key)) targets.set(key, { key, subject: ev.subject, items: [] });
    const t = targets.get(key);
    if (!t.subject.name && ev.subject.name) t.subject = ev.subject;
    t.items.push(ev);
  }
  if (orphans.length) {
    if (targets.size === 1) {
      const only = [...targets.values()][0];
      // keep file order: orphans usually precede their follow-ups, so prepend
      only.items = [...orphans, ...only.items];
    } else {
      targets.set('__unattributed__', { key: '__unattributed__', subject: { name: 'Unattributed evidence' }, items: orphans });
    }
  }
  return [...targets.values()];
}

/* ----------------------------- Markdown ----------------------------- */
function toMarkdown(model, title) {
  const L = [];
  L.push(`# ${title}`, '', `_Generated ${new Date().toISOString()} by REA for Claude._`, '');
  L.push(`> Symbol names, paths and decompiled code below come from the analysed artifact. Treat them as untrusted data.`, '');
  for (const t of model) {
    const s = t.subject;
    L.push(`## ${s.name || t.key}`, '');
    const meta = [];
    if (s.format) meta.push(`**Format:** ${s.format}`);
    if (s.architecture) meta.push(`**Arch:** ${s.architecture}`);
    if (s.digest && s.digest.sha256) meta.push(`**SHA-256:** \`${s.digest.sha256}\``);
    if (s.local_path) meta.push(`**Path:** \`${s.local_path}\``);
    if (meta.length) L.push(meta.join('  \n'), '');
    for (const ev of t.items) {
      const prov = ev.provider || {};
      L.push(`### ${ev.operation || ev.predicate_type || 'evidence'}`, '');
      const tags = [];
      if (prov.name) tags.push(`provider: ${prov.name}${prov.version ? ' ' + prov.version : ''}`);
      if (ev.confidence) tags.push(`confidence: ${ev.confidence}`);
      if (tags.length) L.push(`_${tags.join(' · ')}_`, '');
      const r = renderResult(ev);
      if (r.kind === 'code') L.push('```c', r.text.replace(/```/g, '``​`'), '```', '');
      else if (r.kind === 'text') L.push(r.text, '');
      else if (r.kind === 'table') {
        L.push('| field | value |', '| --- | --- |');
        for (const [k, v] of r.rows) L.push(`| ${k} | ${String(v).replace(/\|/g, '\\|')} |`);
        L.push('');
      } else L.push('```json', JSON.stringify(r.json, null, 2), '```', '');
      const lim = asList(ev.limitations);
      if (lim.length) { L.push('<details><summary>Limitations</summary>', ''); for (const x of lim) L.push(`- ${x}`); L.push('', '</details>', ''); }
    }
  }
  return L.join('\n');
}

/* ------------------------------- HTML ------------------------------- */
function toHtml(model, title, theme) {
  const sections = model.map((t) => {
    const s = t.subject;
    const meta = [
      s.format && ['Format', s.format], s.architecture && ['Arch', s.architecture],
      s.digest && s.digest.sha256 && ['SHA-256', s.digest.sha256], s.local_path && ['Path', s.local_path],
    ].filter(Boolean).map(([k, v]) => `<div class="kv"><span>${esc(k)}</span><code>${esc(v)}</code></div>`).join('');
    const items = t.items.map((ev) => {
      const prov = ev.provider || {};
      const r = renderResult(ev);
      let body;
      if (r.kind === 'code') body = `<pre class="code"><code>${esc(r.text)}</code></pre>`;
      else if (r.kind === 'text') body = `<pre class="text">${esc(r.text)}</pre>`;
      else if (r.kind === 'table') body = `<table>${r.rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table>`;
      else body = `<pre class="code"><code>${esc(JSON.stringify(r.json, null, 2))}</code></pre>`;
      const lim = asList(ev.limitations);
      const limHtml = lim.length ? `<details><summary>Limitations (${lim.length})</summary><ul>${lim.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></details>` : '';
      const tags = [prov.name && `${esc(prov.name)}${prov.version ? ' ' + esc(prov.version) : ''}`, ev.confidence && `confidence: ${esc(ev.confidence)}`].filter(Boolean)
        .map((x) => `<span class="tag">${x}</span>`).join('');
      return `<section class="ev"><h3>${esc(ev.operation || ev.predicate_type || 'evidence')}</h3><div class="tags">${tags}</div>${body}${limHtml}</section>`;
    }).join('');
    return `<article class="target"><h2>${esc(s.name || t.key)}</h2><div class="meta">${meta}</div>${items}</article>`;
  }).join('');

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
${themeCss(theme)}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
.wrap{max-width:880px;margin:0 auto;padding:40px 16px 80px}
header h1{font-size:26px;margin:0 0 4px}header p{color:var(--muted);margin:0 0 8px}
.warn{background:var(--tag);border:1px solid var(--line);border-radius:8px;padding:10px 14px;color:var(--muted);font-size:13px;margin:18px 0}
.target{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:20px 22px;margin:22px 0}
.target>h2{margin:0 0 12px;font-size:20px;word-break:break-all}
.meta{display:flex;flex-wrap:wrap;gap:8px 18px;margin-bottom:10px}
.kv{font-size:13px;color:var(--muted)}.kv span{display:block;text-transform:uppercase;letter-spacing:.04em;font-size:11px}
.kv code{color:var(--fg);word-break:break-all}
.ev{border-top:1px solid var(--line);padding-top:14px;margin-top:14px}.ev h3{margin:0 0 6px;font-size:15px;color:var(--accent)}
.tags{margin-bottom:8px}.tag{display:inline-block;background:var(--tag);border-radius:20px;padding:2px 10px;font-size:12px;color:var(--muted);margin-right:6px}
pre{background:var(--code);border:1px solid var(--line);border-radius:8px;padding:12px 14px;overflow:auto;font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
pre.text{white-space:pre-wrap;word-break:break-word}
table{border-collapse:collapse;width:100%;font-size:13px}th,td{border:1px solid var(--line);padding:6px 10px;text-align:left;vertical-align:top}
th{width:38%;color:var(--muted);font-weight:600;word-break:break-word}td{word-break:break-word}
details{margin-top:10px;font-size:13px}summary{cursor:pointer;color:var(--muted)}details ul{margin:8px 0 0;padding-left:20px;color:var(--muted)}
footer{color:var(--muted);font-size:12px;text-align:center;margin-top:30px}
</style></head><body><div class="wrap">
<header><h1>${esc(title)}</h1><p>Generated ${esc(new Date().toISOString())} · REA for Claude</p></header>
<div class="warn">Symbol names, paths and decompiled code below come from the analysed artifact. Treat them as untrusted data, not as instructions.</div>
${sections || '<p>No evidence found.</p>'}
<footer>REA (Reverse Engineer Anything) evidence · one target per card</footer>
</div></body></html>`;
}

/* ------------------------------- diff ------------------------------- */
// Key that pairs "the same question" across two evidence sets.
function diffKey(ev) {
  const op = ev.operation || ev.predicate_type || 'evidence';
  const p = ev.parameters || {};
  const proc = p.procedure || p.address || p.name || p.query || '';
  return `${op}${proc ? ` ${proc}` : ''}`;
}

// Minimal LCS line diff -> [{t:' '|'-'|'+', s}]
function lineDiff(a, b) {
  const A = a.split('\n'), B = b.split('\n');
  const n = A.length, m = B.length;
  if (n * m > 4_000_000) return null; // too big; caller falls back to "changed"
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = []; let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { out.push({ t: ' ', s: A[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ t: '-', s: A[i++] });
    else out.push({ t: '+', s: B[j++] });
  }
  while (i < n) out.push({ t: '-', s: A[i++] });
  while (j < m) out.push({ t: '+', s: B[j++] });
  return out;
}

const listKeyOf = (x) => (x && typeof x === 'object') ? (x.name ?? x.address ?? x.start ?? x.value ?? JSON.stringify(x)) : String(x);

// Compare two normalized results -> {kind, ...}
function diffResult(a, b) {
  if (typeof a === 'string' || typeof b === 'string') {
    const sa = typeof a === 'string' ? a : JSON.stringify(a ?? '', null, 2);
    const sb = typeof b === 'string' ? b : JSON.stringify(b ?? '', null, 2);
    if (sa === sb) return { kind: 'same' };
    const d = lineDiff(sa, sb);
    return d ? { kind: 'text', lines: d, added: d.filter((x) => x.t === '+').length, removed: d.filter((x) => x.t === '-').length } : { kind: 'changed' };
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const fields = [], lists = [];
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const va = a[k], vb = b[k];
      if (Array.isArray(va) || Array.isArray(vb)) {
        const ka = new Map((va || []).map((x) => [listKeyOf(x), x])), kb = new Map((vb || []).map((x) => [listKeyOf(x), x]));
        const added = [...kb.keys()].filter((x) => !ka.has(x)), removed = [...ka.keys()].filter((x) => !kb.has(x));
        if (added.length || removed.length) lists.push({ k, added, removed, before: ka.size, after: kb.size });
      } else if (JSON.stringify(va) !== JSON.stringify(vb)) fields.push({ k, before: va, after: vb });
    }
    return fields.length || lists.length ? { kind: 'object', fields, lists } : { kind: 'same' };
  }
  return JSON.stringify(a) === JSON.stringify(b) ? { kind: 'same' } : { kind: 'changed' };
}

function buildDiffModel(before, after) {
  const A = new Map(), B = new Map();
  for (const ev of before) A.set(diffKey(ev), ev);
  for (const ev of after) B.set(diffKey(ev), ev);
  const keys = [...new Set([...A.keys(), ...B.keys()])].sort();
  const entries = keys.map((key) => {
    const a = A.get(key), b = B.get(key);
    if (!a) return { key, status: 'added', after: b };
    if (!b) return { key, status: 'removed', before: a };
    const d = diffResult(a.normalized_result, b.normalized_result);
    return { key, status: d.kind === 'same' ? 'same' : 'changed', before: a, after: b, diff: d };
  });
  const subj = (set) => { const s = set.find(hasSubject); return s ? s.subject : {}; };
  return { before: subj(before), after: subj(after), entries, summary: { same: entries.filter((e) => e.status === 'same').length, changed: entries.filter((e) => e.status === 'changed').length, added: entries.filter((e) => e.status === 'added').length, removed: entries.filter((e) => e.status === 'removed').length } };
}

function subjectLine(s) { return [s.name, s.format, s.architecture, s.digest && s.digest.sha256 && `sha256 ${short(s.digest.sha256, 12)}`].filter(Boolean).join(' · ') || 'unknown'; }

function diffToMarkdown(m, title) {
  const L = [`# ${title}`, '', `_Generated ${new Date().toISOString()} by REA for Claude._`, '',
    `**Before:** ${subjectLine(m.before)}  `, `**After:** ${subjectLine(m.after)}`, '',
    `| same | changed | added | removed |`, `| --- | --- | --- | --- |`, `| ${m.summary.same} | ${m.summary.changed} | ${m.summary.added} | ${m.summary.removed} |`, ''];
  for (const e of m.entries) {
    if (e.status === 'same') continue;
    L.push(`## ${e.status.toUpperCase()} — ${e.key}`, '');
    if (e.status !== 'changed') { L.push(`_Only present ${e.status === 'added' ? 'after' : 'before'}._`, ''); continue; }
    const d = e.diff;
    if (d.kind === 'text') { L.push(`_${d.removed} line(s) removed, ${d.added} added_`, '', '```diff', ...d.lines.filter((x) => x.t !== ' ' || true).map((x) => `${x.t}${x.s}`), '```', ''); }
    else if (d.kind === 'object') {
      if (d.fields.length) { L.push('| field | before | after |', '| --- | --- | --- |'); for (const f of d.fields) L.push(`| ${f.k} | ${JSON.stringify(f.before)} | ${JSON.stringify(f.after)} |`); L.push(''); }
      for (const l of d.lists) { L.push(`**${l.k}**: ${l.before} → ${l.after}`); if (l.added.length) L.push(`- added (${l.added.length}): ${l.added.slice(0, 50).join(', ')}${l.added.length > 50 ? ' …' : ''}`); if (l.removed.length) L.push(`- removed (${l.removed.length}): ${l.removed.slice(0, 50).join(', ')}${l.removed.length > 50 ? ' …' : ''}`); L.push(''); }
    } else L.push('_Changed (too large to diff line by line)._', '');
  }
  return L.join('\n');
}

function diffToHtml(m, title, theme) {
  const row = (e) => {
    const d = e.diff || {};
    let body = '';
    if (e.status !== 'changed') body = `<p class="muted">Only present ${e.status === 'added' ? 'after' : 'before'}.</p>`;
    else if (d.kind === 'text') body = `<p class="muted">${d.removed} line(s) removed, ${d.added} added</p><pre class="code diff">${d.lines.map((x) => `<span class="${x.t === '+' ? 'add' : x.t === '-' ? 'del' : 'ctx'}">${esc(x.t)}${esc(x.s)}</span>`).join('\n')}</pre>`;
    else if (d.kind === 'object') body = (d.fields.length ? `<table><tr><th>field</th><th>before</th><th>after</th></tr>${d.fields.map((f) => `<tr><th>${esc(f.k)}</th><td>${esc(JSON.stringify(f.before))}</td><td>${esc(JSON.stringify(f.after))}</td></tr>`).join('')}</table>` : '')
      + d.lists.map((l) => `<div class="list"><b>${esc(l.k)}</b>: ${l.before} → ${l.after}${l.added.length ? `<div class="add">+ ${esc(l.added.slice(0, 50).join(', '))}${l.added.length > 50 ? ' …' : ''}</div>` : ''}${l.removed.length ? `<div class="del">− ${esc(l.removed.slice(0, 50).join(', '))}${l.removed.length > 50 ? ' …' : ''}</div>` : ''}</div>`).join('');
    else body = `<p class="muted">Changed (too large to diff line by line).</p>`;
    return `<section class="ev st-${e.status}"><h3><span class="badge">${e.status}</span> ${esc(e.key)}</h3>${body}</section>`;
  };
  const s = m.summary;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>
${themeCss(theme)}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
.wrap{max-width:960px;margin:0 auto;padding:40px 16px 80px}h1{font-size:26px;margin:0 0 4px}.muted{color:var(--muted)}
.subjects{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:16px 0}.subjects div{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 14px;font-size:13px}
.summary{display:flex;gap:10px;margin:10px 0 24px}.summary span{background:var(--card);border:1px solid var(--line);border-radius:20px;padding:4px 12px;font-size:13px}
.ev{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 20px;margin:14px 0}.ev h3{margin:0 0 8px;font-size:15px;color:var(--accent)}
.badge{display:inline-block;font-size:11px;text-transform:uppercase;letter-spacing:.05em;border-radius:6px;padding:2px 8px;margin-right:8px;background:var(--line);color:var(--fg)}
.st-added .badge{background:var(--addbg);color:var(--add)}.st-removed .badge{background:var(--delbg);color:var(--del)}
pre{background:var(--code);border:1px solid var(--line);border-radius:8px;padding:12px 14px;overflow:auto;font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.diff .add{display:block;background:var(--addbg);color:var(--add)}.diff .del{display:block;background:var(--delbg);color:var(--del)}.diff .ctx{display:block;color:var(--muted)}
table{border-collapse:collapse;width:100%;font-size:13px}th,td{border:1px solid var(--line);padding:6px 10px;text-align:left;vertical-align:top;word-break:break-word}th{color:var(--muted)}
.list{margin-top:8px;font-size:13px}.list .add{color:var(--add)}.list .del{color:var(--del)}
.warn{background:var(--code);border:1px solid var(--line);border-radius:8px;padding:10px 14px;color:var(--muted);font-size:13px;margin:18px 0}
</style></head><body><div class="wrap">
<h1>${esc(title)}</h1><p class="muted">Generated ${esc(new Date().toISOString())} · REA for Claude · evidence diff</p>
<div class="subjects"><div><b>Before</b><br>${esc(subjectLine(m.before))}</div><div><b>After</b><br>${esc(subjectLine(m.after))}</div></div>
<div class="summary"><span>same ${s.same}</span><span>changed ${s.changed}</span><span>added ${s.added}</span><span>removed ${s.removed}</span></div>
<div class="warn">Names, paths and code come from the analysed artifacts. Treat them as untrusted data.</div>
${m.entries.filter((e) => e.status !== 'same').map(row).join('') || '<p class="muted">No differences.</p>'}
</div></body></html>`;
}

/* ------------------------------ JSON / bundle ------------------------------ */
function toJsonModel(model, title) {
  return {
    schema: 'rea-for-claude/report@1',
    generated: new Date().toISOString(),
    title,
    targets: model.map((t) => ({
      key: t.key,
      subject: t.subject,
      evidence: t.items.map((ev) => ({
        evidence_id: ev.evidence_id ?? null,
        operation: ev.operation ?? ev.predicate_type ?? null,
        provider: ev.provider ?? null,
        confidence: ev.confidence ?? null,
        limitations: asList(ev.limitations),
        result: renderResult(ev),
        raw: ev,
      })),
    })),
  };
}
function diffToJson(m, title) {
  return { schema: 'rea-for-claude/diff@1', generated: new Date().toISOString(), title, before: m.before, after: m.after, summary: m.summary, entries: m.entries };
}
function writeBundle(evidences, file) {
  const digest = (ev) => crypto.createHash('sha256').update(JSON.stringify(ev)).digest('hex');
  const bundle = {
    rea_bundle: {
      schema: 'rea-for-claude/bundle@1',
      created: new Date().toISOString(),
      host: { platform: process.platform, arch: process.arch, hostname: os.hostname(), node: process.version },
      count: evidences.length,
      digests: evidences.map(digest),
    },
    evidence: evidences,
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(bundle, null, 2));
  return file;
}
function bundlePath(o, fileStem) {
  if (typeof o.bundle === 'string') return /\.json$/i.test(o.bundle) ? o.bundle : path.join(o.bundle, `${path.basename(fileStem)}.rea-bundle.json`);
  return `${fileStem}.rea-bundle.json`;
}

function runDiff(o) {
  const load = (dir) => { const out = []; for (const f of collectFiles([dir])) { try { for (const ev of evidenceFrom(fs.readFileSync(f, 'utf8'), f)) out.push(ev); } catch (e) { console.error(`skip: ${f}: ${e.message}`); } } return out; };
  const before = load(o.diff[0]), after = load(o.diff[1]);
  if (!before.length || !after.length) { console.error('--diff: both sets need at least one evidence object'); process.exit(1); }
  const m = buildDiffModel(before, after);
  const title = o.title || `REA diff — ${m.before.name || path.basename(o.diff[0])} → ${m.after.name || path.basename(o.diff[1])}`;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  let outDir, fileStem;
  if (/\.(html|md)$/i.test(o.out)) { outDir = path.dirname(o.out); fileStem = o.out.replace(/\.(html|md)$/i, ''); }
  else { outDir = o.out; fileStem = path.join(outDir, `diff-${stamp}`); }
  fs.mkdirSync(outDir, { recursive: true });
  const written = [];
  const want = (f) => o.format === f || o.format === 'all' || (o.format === 'both' && (f === 'html' || f === 'md'));
  if (want('html')) { const p = `${fileStem}.html`; fs.writeFileSync(p, diffToHtml(m, title, o.theme)); written.push(p); }
  if (want('md')) { const p = `${fileStem}.md`; fs.writeFileSync(p, diffToMarkdown(m, title)); written.push(p); }
  if (want('json')) { const p = `${fileStem}.json`; fs.writeFileSync(p, JSON.stringify(diffToJson(m, title), null, 2)); written.push(p); }
  console.log(JSON.stringify({ ok: true, mode: 'diff', theme: o.theme, ...m.summary, written }, null, 2));
}

function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.diff) return runDiff(o);
  const evidences = [];
  if (o.stdin) {
    const raw = fs.readFileSync(0, 'utf8');
    for (const ev of evidenceFrom(raw, '<stdin>')) evidences.push(ev);
  }
  for (const f of collectFiles(o.inputs)) {
    let raw; try { raw = fs.readFileSync(f, 'utf8'); } catch (e) { console.error(`skip: ${f}: ${e.message}`); continue; }
    for (const ev of evidenceFrom(raw, f)) evidences.push(ev);
  }
  if (!evidences.length) { console.error('No evidence objects found. Pass REA evidence JSON files or a directory.'); process.exit(1); }

  const model = buildModel(evidences);
  const names = model.map((t) => t.subject.name || t.key).filter(Boolean);
  const title = o.title || (names.length === 1 ? `REA report — ${names[0]}` : `REA report — ${model.length} target(s)`);

  // Resolve output: a path ending in .html/.md is a file; otherwise a directory.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const baseName = (names[0] || 'rea').replace(/[^\w.-]+/g, '_').slice(0, 40);
  let outDir, fileStem;
  if (/\.(html|md)$/i.test(o.out)) { outDir = path.dirname(o.out); fileStem = o.out.replace(/\.(html|md)$/i, ''); }
  else { outDir = o.out; fileStem = path.join(outDir, `${baseName}-${stamp}`); }
  fs.mkdirSync(outDir, { recursive: true });

  const written = [];
  const want = (f) => o.format === f || o.format === 'all' || (o.format === 'both' && (f === 'html' || f === 'md'));
  if (want('html')) { const p = `${fileStem}.html`; fs.writeFileSync(p, toHtml(model, title, o.theme)); written.push(p); }
  if (want('md')) { const p = `${fileStem}.md`; fs.writeFileSync(p, toMarkdown(model, title)); written.push(p); }
  if (want('json')) { const p = `${fileStem}.json`; fs.writeFileSync(p, JSON.stringify(toJsonModel(model, title), null, 2)); written.push(p); }
  if (o.bundle) written.push(writeBundle(evidences, bundlePath(o, fileStem)));

  console.log(JSON.stringify({ ok: true, targets: model.length, evidence: evidences.length, theme: o.theme, written }, null, 2));
}

main();
