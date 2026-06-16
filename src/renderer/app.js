'use strict';
/* OptiTrace — interfaz simple. Una búsqueda = una lista clara, agrupada en lenguaje llano. */
const $ = (s) => document.querySelector(s);
let META = {}, MODS = [], busy = false, lastQuery = '';
const nodes = new Map();
let renderQueued = false;

const graph = new TraceGraph($('#graph'), { onSelect: () => {}, onPivot: (n) => search(n.value, false) });
window.addEventListener('resize', () => { if ($('#overlay').classList.contains('show')) graph.resize(); });

/* Secciones en lenguaje sencillo, por orden de importancia. */
const SECTIONS = [
  { key: 'accounts', title: '🔓 Cuentas encontradas', types: ['account'] },
  { key: 'breaches', title: '⚠️ Filtraciones de datos', types: ['breach'] },
  { key: 'identity', title: '🧑 Identidad', types: ['person'] },
  { key: 'places', title: '📍 Ubicaciones', types: ['location'] },
  { key: 'images', title: '🖼️ Imágenes', types: ['image'] },
  { key: 'related', title: '🔗 Datos relacionados (toca para buscarlos)', types: ['username', 'email', 'phone'] },
  { key: 'links', title: '🌐 Enlaces para investigar más', types: ['url'] },
  { key: 'tech', title: '🔧 Detalles técnicos', types: ['domain', 'subdomain', 'ip', 'asn', 'org', 'dns', 'note'], collapsed: true },
];
const SEC_OF = {}; for (const s of SECTIONS) for (const t of s.types) SEC_OF[t] = s.key;

/* ---------- arranque ---------- */
(async function init() {
  const info = await window.opti.init();
  META = info.meta || {}; MODS = info.modules || [];
  document.title = `OptiTrace v${info.version}`;
  buildLegend();
  const s = await window.opti.getSettings();
  $('#k_hibp').value = s.keys.hibp || ''; $('#k_shodan').value = s.keys.shodan || '';
  $('#k_hunter').value = s.keys.hunter || ''; $('#k_vt').value = s.keys.vt || '';
  $('#k_proxy').value = s.proxy || '';
})();

function openUrlOf(n) {
  if (!n) return null;
  if (/^https?:\/\//i.test(n.value)) return n.value;
  if (n.data && /^https?:\/\//i.test(n.data.url || '')) return n.data.url;
  if (n.data && /^https?:\/\//i.test(n.data.perfil || '')) return n.data.perfil;
  return null;
}
function pivotable(type) { return MODS.some((m) => (m.accepts || []).includes(type)); }
function prettyUrl(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (_) { return u; } }

/* ---------- eventos del motor ---------- */
window.opti.onLog(() => {});
window.opti.onNode((n) => { nodes.set(n.id, n); graph.addNode({ ...n, seed: n.source === 'seed' }); queueRender(); if (busy) liveSummary(); });
window.opti.onEdge((e) => graph.addEdge(e));
window.opti.onProgress(() => {});

/* ---------- búsqueda ---------- */
const q = $('#q');
let detTimer = null;
q.addEventListener('input', () => {
  clearTimeout(detTimer);
  detTimer = setTimeout(async () => {
    const v = q.value.trim(); if (!v) { $('#kind').textContent = '—'; return; }
    const e = await window.opti.detect(v); const m = META[e.type] || {};
    $('#kind').textContent = e ? `${m.icon || ''} ${m.label || e.type}` : '—';
  }, 120);
});
q.addEventListener('keydown', (e) => { if (e.key === 'Enter') search(q.value.trim(), true); });
$('#go').addEventListener('click', () => search(q.value.trim(), true));
$('#examples').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { q.value = b.dataset.v; search(b.dataset.v, true); } });

async function search(value, fresh) {
  if (!value || busy) return;
  q.value = value; lastQuery = value;
  if (fresh) { await window.opti.clear(); nodes.clear(); graph.clear(); $('#list').innerHTML = ''; }
  setBusy(true, value);
  const r = await window.opti.expand(value, false);
  setBusy(false);
  finalSummary(r);
}

$('#img').addEventListener('click', async () => {
  const path = await window.opti.pickImage(); if (!path) return;
  await window.opti.clear(); nodes.clear(); graph.clear(); $('#list').innerHTML = '';
  q.value = '📷 ' + path.split(/[\\/]/).pop(); lastQuery = 'la imagen';
  setBusy(true, 'la imagen'); const r = await window.opti.expand(path, false); setBusy(false); finalSummary(r);
});

function setBusy(b, value) {
  busy = b; $('#go').textContent = b ? '…' : 'Buscar'; $('#go').disabled = b;
  $('#bar').classList.toggle('busy', b);
  $('#welcome').classList.add('hidden');
  $('#summary').classList.remove('hidden');
  if (b) $('#summary').innerHTML = `<span>🔄</span> Buscando <b>${esc(value)}</b>… <span id="live" style="color:var(--muted)"></span>`;
}
function liveSummary() { const el = $('#live'); if (el) el.textContent = `(${countResults()} resultados)`; }
function countResults() { let c = 0; for (const n of nodes.values()) if (n.source !== 'seed') c++; return c; }
function finalSummary(r) {
  const n = countResults();
  if (r && !r.ok) { $('#summary').innerHTML = `<span>⚠️</span> No se pudo buscar: ${esc(r.error || '')}`; return; }
  if (n === 0) { $('#summary').innerHTML = `<span>🔍</span> No se encontró nada público para <b>${esc(lastQuery)}</b>. Prueba otro dato.`; $('#welcome').classList.add('hidden'); return; }
  $('#summary').innerHTML = `<span>✅</span> <b>${n}</b> resultado${n === 1 ? '' : 's'} para <b>${esc(lastQuery)}</b>`;
}

/* ---------- render de la lista ---------- */
function queueRender() { if (renderQueued) return; renderQueued = true; requestAnimationFrame(renderList); }
function renderList() {
  renderQueued = false;
  const buckets = {}; for (const s of SECTIONS) buckets[s.key] = [];
  for (const n of nodes.values()) { if (n.source === 'seed') continue; const k = SEC_OF[n.type] || 'tech'; buckets[k].push(n); }
  let html = '';
  for (const s of SECTIONS) {
    const arr = buckets[s.key]; if (!arr.length) continue;
    const rows = arr.map(rowHtml).join('');
    if (s.collapsed) {
      html += `<details class="section"><summary><span class="caret">▸</span> ${s.title} <span class="count">${arr.length}</span></summary>${rows}</details>`;
    } else {
      html += `<div class="section"><div class="head">${s.title} <span class="count">${arr.length}</span></div>${rows}</div>`;
    }
  }
  $('#list').innerHTML = html;
}
function rowHtml(n) {
  const url = openUrlOf(n);
  const canPivot = !url && pivotable(n.type);
  const clk = (url || canPivot) ? 'clk' : '';
  let sub = '';
  if (n.type === 'account') sub = url ? `Encontrado en ${esc(n.data && n.data.servicio || prettyUrl(url))}` : esc(n.source || '');
  else if (n.type === 'breach') sub = esc((n.data && (n.data.datos || n.data.fecha)) || 'Aparece en una filtración');
  else if (n.type === 'location') sub = esc((n.data && n.data.lat) ? `${n.data.lat}, ${n.data.lon}` : (n.source || ''));
  else if (n.type === 'url') sub = esc(prettyUrl(url || n.value));
  else if (canPivot) sub = 'Toca para buscar este dato';
  else sub = esc((n.data && (n.data.full || n.data.servidores)) || n.source || '');
  const action = url ? `<span class="go">Abrir ↗</span>` : (canPivot ? `<span class="go">Buscar</span>` : '');
  return `<div class="row ${clk}" data-id="${esc(n.id)}"><div class="ico">${n.icon || '•'}</div>
    <div class="meta"><div class="t">${esc(n.label || n.value)}</div><div class="s">${sub}</div></div>${action}</div>`;
}
$('#list').addEventListener('click', (e) => {
  const row = e.target.closest('.row'); if (!row) return;
  const n = nodes.get(row.dataset.id); if (!n) return;
  const url = openUrlOf(n);
  if (url) window.opti.openExternal(url);
  else if (pivotable(n.type)) search(n.value, true);
});

/* ---------- mapa (overlay opcional) ---------- */
$('#map').addEventListener('click', () => {
  if (!nodes.size) { $('#summary').classList.remove('hidden'); $('#summary').innerHTML = '<span>🗺️</span> Primero haz una búsqueda; luego verás el mapa.'; return; }
  $('#overlay').classList.add('show'); graph.resize(); setTimeout(() => graph.fit(), 60);
});
$('#mapClose').addEventListener('click', () => $('#overlay').classList.remove('show'));

/* ---------- ajustes / acciones ---------- */
$('#settings').addEventListener('click', () => $('#mset').classList.add('show'));
$('#setSave').addEventListener('click', async () => {
  await window.opti.setSettings({ keys: { hibp: $('#k_hibp').value.trim(), shodan: $('#k_shodan').value.trim(), hunter: $('#k_hunter').value.trim(), vt: $('#k_vt').value.trim() }, proxy: $('#k_proxy').value.trim() });
  const info = await window.opti.init(); MODS = info.modules || []; $('#mset').classList.remove('show');
});
$('#mClear').addEventListener('click', async () => {
  await window.opti.clear(); nodes.clear(); graph.clear(); $('#list').innerHTML = '';
  $('#summary').classList.add('hidden'); $('#welcome').classList.remove('hidden'); $('#mset').classList.remove('show');
});
$('#mExport').addEventListener('click', async () => {
  const g = await window.opti.graph(); if (!g.nodes.length) return;
  const seed = (g.nodes.find((n) => n.source === 'seed') || {}).value || 'investigacion';
  const r = await window.opti.saveReport(buildReport(g), `optitrace-${seed}`.replace(/[^\w.-]+/g, '_'));
  if (r.ok) { $('#mset').classList.remove('show'); $('#summary').classList.remove('hidden'); $('#summary').innerHTML = `<span>📄</span> Informe guardado: ${esc(r.path)}`; }
});

/* ---------- mapa: leyenda ---------- */
function buildLegend() {
  const used = ['username', 'email', 'account', 'domain', 'ip', 'phone', 'location', 'image', 'breach'];
  $('#legend').innerHTML = '<b>Tipos</b>' + used.map((t) => { const m = META[t] || {}; return `<div class="lr"><span class="dot" style="background:${m.color || '#888'}"></span>${m.label || t}</div>`; }).join('');
}

/* ---------- informe ---------- */
function buildReport(g) {
  const by = {}; for (const n of g.nodes) (by[n.type] = by[n.type] || []).push(n);
  const order = Object.keys(by).sort((a, b) => by[b].length - by[a].length);
  const seed = g.nodes.find((n) => n.source === 'seed');
  const sec = order.map((t) => {
    const m = META[t] || {};
    const rows = by[t].map((n) => { const ex = Object.entries(n.data || {}).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}: ${String(v).slice(0, 120)}`).join(' · ');
      return `<tr><td>${esc(n.label || n.value)}</td><td class="src">${esc(n.source || '')}</td><td>${esc(ex)}</td></tr>`; }).join('');
    return `<h2><span style="color:${m.color}">${m.icon || ''}</span> ${m.label || t} <small>(${by[t].length})</small></h2><table><thead><tr><th>Valor</th><th>Origen</th><th>Detalles</th></tr></thead><tbody>${rows}</tbody></table>`;
  }).join('');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>OptiTrace — ${esc(seed ? seed.value : '')}</title>
  <style>body{font:14px/1.5 Segoe UI,sans-serif;background:#0b1020;color:#eaf0ff;max-width:980px;margin:0 auto;padding:30px}
  h1 small{color:#9aa7c7;font-weight:400;font-size:13px;display:block;margin-top:4px}
  h2{font-size:16px;margin-top:26px;border-bottom:1px solid #243056;padding-bottom:6px}h2 small{color:#9aa7c7;font-weight:400}
  table{width:100%;border-collapse:collapse;margin-top:8px;font-size:13px}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #1a2240;vertical-align:top}
  th{color:#9aa7c7}.src{color:#22d3ee}</style></head>
  <body><h1>🔎 OptiTrace — Informe<small>Objetivo: <b>${esc(seed ? seed.value : '—')}</b> · ${new Date().toLocaleString('es-ES')} · ${g.nodes.length} entidades</small></h1>
  ${sec}<div style="margin-top:30px;color:#9aa7c7;font-size:12px;border-top:1px solid #243056;padding-top:12px">Generado con OptiTrace (OptiSuite). Fuentes abiertas. Uso conforme a la ley. https://optisuite.app</div></body></html>`;
}
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
