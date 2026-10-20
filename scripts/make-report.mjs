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
 *   --format <fmt>      html | md | both            (default: html)
 *   --title <text>      Report title                (default: derived from targets)
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
import path from 'node:path';

const HELP = `make-report.mjs — REA evidence -> HTML/Markdown report
Usage: node scripts/make-report.mjs <file-or-dir>... [--out P] [--format html|md|both] [--title T] [--stdin]`;

function parseArgs(argv) {
  const o = { inputs: [], out: 'rea-reports', format: 'html', title: null, stdin: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') { console.log(HELP); process.exit(0); }
    else if (a === '--out') o.out = argv[++i];
    else if (a === '--format') o.format = argv[++i];
    else if (a === '--title') o.title = argv[++i];
    else if (a === '--stdin') o.stdin = true;
    else if (a.startsWith('--')) { console.error(`Unknown option: ${a}`); process.exit(2); }
    else o.inputs.push(a);
  }
  if (!['html', 'md', 'both'].includes(o.format)) { console.error(`--format must be html|md|both`); process.exit(2); }
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
function toHtml(model, title) {
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
:root{--bg:#fbfbfa;--fg:#1a1a18;--muted:#6b6b66;--card:#fff;--line:#e6e6e2;--accent:#7b4bd8;--code:#f4f3f0;--tag:#efeaf9}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#17171a;--fg:#e9e9ec;--muted:#9a9aa2;--card:#1f1f23;--line:#30303a;--accent:#b79bff;--code:#111114;--tag:#2a2440}}
:root[data-theme=dark]{--bg:#17171a;--fg:#e9e9ec;--muted:#9a9aa2;--card:#1f1f23;--line:#30303a;--accent:#b79bff;--code:#111114;--tag:#2a2440}
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

function main() {
  const o = parseArgs(process.argv.slice(2));
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
  if (o.format === 'html' || o.format === 'both') { const p = `${fileStem}.html`; fs.writeFileSync(p, toHtml(model, title)); written.push(p); }
  if (o.format === 'md' || o.format === 'both') { const p = `${fileStem}.md`; fs.writeFileSync(p, toMarkdown(model, title)); written.push(p); }

  console.log(JSON.stringify({ ok: true, targets: model.length, evidence: evidences.length, written }, null, 2));
}

main();
