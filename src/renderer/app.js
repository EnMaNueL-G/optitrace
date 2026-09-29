'use strict';
/* OptiTrace — interfaz simple. Una búsqueda = una lista clara, agrupada en lenguaje llano. */
const $ = (s) => document.querySelector(s);
let META = {}, MODS = [], busy = false, lastQuery = '', SETTINGS = null;
const nodes = new Map();
let renderQueued = false;

const graph = new TraceGraph($('#graph'), {
  onSelect: () => {},
  // Doble clic en el mapa: solo datos pivotables (nunca rutas locales ni tipos sin módulos).
  onPivot: (n) => { if (canSearch(n)) { $('#overlay').classList.remove('show'); graph.setActive(false); search(n.value, true); } },
});
window.addEventListener('resize', () => { if ($('#overlay').classList.contains('show')) graph.resize(); });

/* Secciones en lenguaje sencillo, por orden de importancia. */
const SECTIONS = [
  { key: 'accounts', title: '🔓 Cuentas encontradas', types: ['account'] },
  { key: 'alias', title: '🔎 Posibles cuentas con el mismo alias (no confirmadas con el correo)', types: [] },
  { key: 'breaches', title: '⚠️ Filtraciones de datos', types: ['breach'] },
  { key: 'identity', title: '🧑 Identidad', types: ['person'] },
  { key: 'places', title: '📍 Ubicaciones', types: ['location'] },
  { key: 'images', title: '🖼️ Imágenes', types: ['image'] },
  { key: 'related', title: '🔗 Datos relacionados (toca para buscarlos)', types: ['username', 'email', 'phone'] },
  { key: 'links', title: '🌐 Enlaces para investigar más', types: ['url'] },
  { key: 'tech', title: '🔧 Detalles técnicos', types: ['domain', 'subdomain', 'ip', 'asn', 'org', 'dns', 'note'], collapsed: true },
];
const SEC_OF = {}; for (const s of SECTIONS) for (const t of s.types) SEC_OF[t] = s.key;
const sectionOf = (n) => (n.type === 'account' && n.data && n.data.alias) ? 'alias' : (SEC_OF[n.type] || 'tech');

/* ---------- arranque ---------- */
(async function init() {
  const info = await window.opti.init();
  META = info.meta || {}; MODS = info.modules || [];
  document.title = `OptiTrace v${info.version}`;
  $('#ver').textContent = 'v' + info.version;
  buildLegend();
  applySettings(info);
  if (!info.options.accepted) $('#mterms').classList.add('show');
  window.opti.checkUpdate().then((u) => {
    if (!u) return;
    $('#update').innerHTML = `🆕 Hay una versión nueva de OptiTrace (<b>v${esc(u.version)}</b>). <button class="btn" id="updGo">Descargar</button>`;
    $('#update').classList.remove('hidden');
    $('#updGo').addEventListener('click', () => window.opti.openExternal(u.url));
  });
})();

function applySettings(s) {
  SETTINGS = s;
  $('#k_hibp').value = '';
  $('#k_hibp').placeholder = s.keys.hibp ? '•••••• guardada (escribe otra para cambiarla, o "borrar")' : 'pega tu clave';
  $('#k_proxy').value = s.proxy || '';
  $('#o_limit').value = String(s.options.maigretLimit === 0 ? 0 : 1500);
  $('#o_country').value = s.options.phoneCountry || '';
  $('#o_sensitive').checked = !!s.options.sensitive;
  $('#proxyNote').textContent = s.proxyError
    ? '⚠️ ' + s.proxyError + ' — las búsquedas web fallarán hasta que lo corrijas o lo borres.'
    : 'Las consultas DNS (registros y DNS inverso) no pasan por el proxy.';
}

$('#termsYes').addEventListener('click', async () => { await window.opti.setSettings({ options: { accepted: true } }); $('#mterms').classList.remove('show'); });
$('#termsNo').addEventListener('click', () => window.close());

function openUrlOf(n) {
  if (!n) return null;
  if (/^https?:\/\//i.test(n.value)) return n.value;
  if (n.data && /^https?:\/\//i.test(n.data.url || '')) return n.data.url;
  if (n.data && /^https?:\/\//i.test(n.data.perfil || '')) return n.data.perfil;
  return null;
}
function pivotable(type) { return MODS.some((m) => (m.accepts || []).includes(type)); }
function canSearch(n) { return n && n.type !== 'image' && pivotable(n.type); }
function prettyUrl(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (_) { return u; } }

/* ---------- eventos del motor ---------- */
window.opti.onLog(() => {});
window.opti.onNode((n) => { nodes.set(n.id, n); graph.addNode({ ...n, seed: n.source === 'seed' }); queueRender(); if (busy) liveSummary(); });
window.opti.onEdge((e) => graph.addEdge(e));
const progress = { total: 0, done: 0, unknown: 0 };
window.opti.onProgress((p) => {
  if (p.total) { progress.total = p.total; progress.done = p.done; }
  if (p.final && typeof p.unknown === 'number') progress.unknown += p.unknown;
  if (busy) liveSummary();
});

/* ---------- búsqueda ---------- */
const q = $('#q');
let detTimer = null;
q.addEventListener('input', () => {
  clearTimeout(detTimer);
  detTimer = setTimeout(async () => {
    const v = q.value.trim(); if (!v) { $('#kind').textContent = '—'; return; }
    const e = await window.opti.detect(v); const m = (e && META[e.type]) || {};
    $('#kind').textContent = e ? `${m.icon || ''} ${m.label || e.type}` : '—';
  }, 120);
});
q.addEventListener('keydown', (e) => { if (e.key === 'Enter') search(q.value.trim(), true); });
$('#go').addEventListener('click', () => { if (busy) window.opti.cancel(); else search(q.value.trim(), true); });
$('#examples').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { q.value = b.dataset.v; search(b.dataset.v, true); } });

async function resetResults() { await window.opti.clear(); nodes.clear(); graph.clear(); $('#list').innerHTML = ''; }

async function search(value, fresh, fromPicker) {
  if (!value || busy) return;
  if (!fromPicker) q.value = value;
  window.opti.detect(value).then((e) => { const m = (e && META[e.type]) || {}; $('#kind').textContent = fromPicker ? '🖼️ Imagen' : (e ? `${m.icon || ''} ${m.label || e.type}` : '—'); });
  lastQuery = fromPicker ? 'la imagen' : value;
  if (fresh) await resetResults();
  progress.total = 0; progress.done = 0; progress.unknown = 0;
  setBusy(true, lastQuery);
  let r;
  try { r = await window.opti.expand(value, false, !!fromPicker); }
  catch (e) { r = { ok: false, error: e.message }; }
  finally { setBusy(false); }
  finalSummary(r);
}
window.__shot = (v) => { $('#mterms').classList.remove('show'); search(v, true); };

$('#img').addEventListener('click', async () => {
  if (busy) return;
  const path = await window.opti.pickImage(); if (!path) return;
  q.value = '📷 ' + path.split(/[\\/]/).pop();
  search(path, true, true);
});

function setBusy(b, value) {
  busy = b;
  $('#go').textContent = b ? 'Cancelar' : 'Buscar';
  $('#go').classList.toggle('primary', !b);
  $('#bar').classList.toggle('busy', b && !progress.total);
  $('#fill').style.width = '0';
  $('#welcome').classList.add('hidden');
  $('#summary').classList.remove('hidden');
  if (b) $('#summary').innerHTML = `<span>🔄</span> Buscando <b>${esc(value)}</b>… <span id="live" style="color:var(--muted)"></span>`;
}
function liveSummary() {
  const el = $('#live'); if (!el) return;
  const pct = progress.total ? Math.min(100, Math.round(progress.done / progress.total * 100)) : 0;
  el.textContent = `(${countResults()} resultados${progress.total ? ` · sitios revisados ${progress.done}/${progress.total}` : ''})`;
  if (progress.total) { $('#bar').classList.remove('busy'); $('#fill').style.width = pct + '%'; }
}
function countResults() { let c = 0; for (const n of nodes.values()) if (n.source !== 'seed') c++; return c; }
function finalSummary(r) {
  $('#fill').style.width = '0';
  const n = countResults();
  if (r && !r.ok) { $('#summary').innerHTML = `<span>⚠️</span> ${esc(r.error || 'No se pudo buscar')}`; return; }
  if (r && r.unsupported) {
    const m = META[r.entity.type] || {};
    $('#summary').innerHTML = `<span>ℹ️</span> OptiTrace aún no analiza datos de tipo <b>${esc(m.label || r.entity.type)}</b>. Prueba con un usuario, correo, dominio, web, IP, teléfono o imagen.`;
    return;
  }
  const stop = r && r.cancelled ? ' (búsqueda cancelada)' : '';
  if (n === 0) { $('#summary').innerHTML = `<span>🔍</span> No se encontró nada público para <b>${esc(lastQuery)}</b>${stop}.`; return; }
  const unk = progress.unknown ? ` <span style="color:var(--muted)" title="Sitios que bloquearon la consulta (antibot/captcha), tardaron demasiado o ya no existen. No se cuentan ni como «sí» ni como «no».">· ${progress.unknown} sitios sin respuesta clara</span>` : '';
  $('#summary').innerHTML = `<span>${stop ? '⏹️' : '✅'}</span> <b>${n}</b> resultado${n === 1 ? '' : 's'} para <b>${esc(lastQuery)}</b>${stop}${unk}`;
}

/* ---------- render de la lista ---------- */
function queueRender() { if (renderQueued) return; renderQueued = true; requestAnimationFrame(renderList); }
function renderList() {
  renderQueued = false;
  const buckets = {}; for (const s of SECTIONS) buckets[s.key] = [];
  for (const n of nodes.values()) { if (n.source === 'seed') continue; buckets[sectionOf(n)].push(n); }
  let html = '';
  for (const s of SECTIONS) {
    const arr = buckets[s.key]; if (!arr.length) continue;
    const rows = arr.map(rowHtml).join('');
    if (s.collapsed) html += `<details class="section"><summary><span class="caret">▸</span> ${s.title} <span class="count">${arr.length}</span></summary>${rows}</details>`;
    else html += `<div class="section"><div class="head">${s.title} <span class="count">${arr.length}</span></div>${rows}</div>`;
  }
  $('#list').innerHTML = html;
}
function rowHtml(n) {
  const url = openUrlOf(n);
  const canPivot = !url && canSearch(n);
  const clk = (url || canPivot) ? 'clk' : '';
  let sub = '';
  if (n.type === 'account') sub = url ? `Encontrado en ${esc(n.data && n.data.servicio || prettyUrl(url))}` : esc(n.source || '');
  else if (n.type === 'breach') sub = esc((n.data && (n.data.datos || n.data.fecha)) || 'Aparece en una filtración');
  else if (n.type === 'location') sub = esc((n.data && n.data.nota) || ((n.data && n.data.lat) ? `${n.data.lat}, ${n.data.lon}` : (n.source || '')));
  else if (n.type === 'url') sub = esc(prettyUrl(url || n.value));
  else if (canPivot) sub = 'Toca para buscar este dato';
  else sub = esc((n.data && (n.data.full || n.data.servidores || n.data.puertos)) || n.source || '');
  const sens = n.data && n.data.sensible ? '<span class="tag-sens">sensible</span>' : '';
  const action = url ? `<span class="go">Abrir ↗</span>` : (canPivot ? `<span class="go">Buscar</span>` : '');
  return `<div class="row ${clk}" data-id="${esc(n.id)}"><div class="ico">${esc(n.icon || '•')}</div>
    <div class="meta"><div class="t">${esc(n.label || n.value)}${sens}</div><div class="s">${sub}</div></div>${action}</div>`;
}
$('#list').addEventListener('click', (e) => {
  const row = e.target.closest('.row'); if (!row) return;
  const n = nodes.get(row.dataset.id); if (!n) return;
  const url = openUrlOf(n);
  if (url) window.opti.openExternal(url);
  else if (canSearch(n)) search(n.value, true);
});

/* ---------- mapa (overlay opcional) ---------- */
$('#map').addEventListener('click', () => {
  if (!nodes.size) { $('#summary').classList.remove('hidden'); $('#summary').innerHTML = '<span>🗺️</span> Primero haz una búsqueda; luego verás el mapa.'; return; }
  $('#overlay').classList.add('show'); graph.setActive(true); graph.resize(); setTimeout(() => graph.fit(), 60);
});
$('#mapClose').addEventListener('click', () => { $('#overlay').classList.remove('show'); graph.setActive(false); });

/* ---------- acerca de ---------- */
$('#about').addEventListener('click', () => $('#mabout').classList.add('show'));
$('#aboutClose').addEventListener('click', () => $('#mabout').classList.remove('show'));
document.querySelectorAll('#mabout [data-url]').forEach((b) => b.addEventListener('click', () => window.opti.openExternal(b.getAttribute('data-url'))));

/* ---------- ajustes ---------- */
$('#settings').addEventListener('click', async () => { applySettings(await window.opti.getSettings()); $('#mset').classList.add('show'); });
$('#o_sensitive').addEventListener('change', (e) => {
  if (e.target.checked && !confirm('Vas a incluir sitios para adultos y de citas.\n\nEsos resultados revelan datos sobre la vida sexual de una persona, especialmente protegidos por la ley, y pueden causar daño grave si se exponen.\n\n¿Tienes una base legal clara para consultarlos (por ejemplo, investigar tu propio correo)?')) e.target.checked = false;
});
$('#setSave').addEventListener('click', async () => {
  const hibp = $('#k_hibp').value.trim();
  const keys = {};
  if (hibp) keys.hibp = /^borrar$/i.test(hibp) ? '' : hibp;
  const r = await window.opti.setSettings({
    keys,
    proxy: $('#k_proxy').value.trim(),
    options: { sensitive: $('#o_sensitive').checked, maigretLimit: parseInt($('#o_limit').value, 10), phoneCountry: $('#o_country').value },
  });
  applySettings(r);
  const info = await window.opti.init(); MODS = info.modules || [];
  if (r.ok) $('#mset').classList.remove('show');
});
$('#mClear').addEventListener('click', async () => {
  await resetResults();
  $('#summary').classList.add('hidden'); $('#welcome').classList.remove('hidden'); $('#mset').classList.remove('show');
});
document.querySelectorAll('.modal-bg').forEach((m) => m.addEventListener('click', (e) => { if (e.target === m && m.id !== 'mterms') m.classList.remove('show'); }));

/* ---------- exportar ---------- */
$('#export').addEventListener('click', async () => {
  const g = await window.opti.graph();
  if (!g.nodes.length) { $('#summary').classList.remove('hidden'); $('#summary').innerHTML = '<span>📄</span> Primero haz una búsqueda; luego podrás exportar el informe.'; return; }
  $('#e_sensitive').checked = false;
  $('#mexp').classList.add('show');
});
$('#expCancel').addEventListener('click', () => $('#mexp').classList.remove('show'));
$('#expHtml').addEventListener('click', () => doExport(false));
$('#expPdf').addEventListener('click', () => doExport(true));
async function doExport(pdf) {
  const g = await window.opti.graph();
  const withSens = $('#e_sensitive').checked;
  const nodesOut = g.nodes.filter((n) => withSens || !(n.data && n.data.sensible));
  const seed = (g.nodes.find((n) => n.source === 'seed') || {}).value || 'investigacion';
  const r = await window.opti.saveReport(buildReport({ nodes: nodesOut }, g.nodes.length - nodesOut.length), `optitrace-${seed}`.replace(/[^\w.-]+/g, '_'), pdf);
  $('#mexp').classList.remove('show');
  if (r.ok) { $('#summary').classList.remove('hidden'); $('#summary').innerHTML = `<span>📄</span> Informe guardado: ${esc(r.path)}`; }
  else if (r.error) { $('#summary').classList.remove('hidden'); $('#summary').innerHTML = `<span>⚠️</span> No se pudo guardar: ${esc(r.error)}`; }
}

/* ---------- mapa: leyenda ---------- */
function buildLegend() {
  const used = ['username', 'email', 'account', 'domain', 'ip', 'phone', 'location', 'image', 'breach'];
  $('#legend').innerHTML = '<b>Tipos</b>' + used.map((t) => { const m = META[t] || {}; return `<div class="lr"><span class="dot" style="background:${esc(m.color || '#888')}"></span>${esc(m.label || t)}</div>`; }).join('');
}

/* ---------- informe ---------- */
function buildReport(g, omitted) {
  const by = {}; for (const n of g.nodes) (by[n.type] = by[n.type] || []).push(n);
  const order = Object.keys(by).sort((a, b) => by[b].length - by[a].length);
  const seed = g.nodes.find((n) => n.source === 'seed');
  // Imagen local: solo el nombre del archivo (no la ruta con el usuario de Windows).
  const target = seed ? (seed.type === 'image' && !/^https?:/i.test(seed.value) ? seed.value.split(/[\\/]/).pop() : seed.value) : '—';
  const sec = order.map((t) => {
    const m = META[t] || {};
    const rows = by[t].map((n) => {
      const ex = Object.entries(n.data || {}).filter(([k, v]) => v != null && v !== '' && k !== 'sensible' && k !== 'alias').map(([k, v]) => `${k}: ${String(v).slice(0, 160)}`).join(' · ');
      const tag = n.data && n.data.alias ? ' (mismo alias, no confirmado)' : '';
      return `<tr><td>${esc(n.label || n.value)}${tag}</td><td class="src">${esc(n.source || '')}</td><td>${esc(ex)}</td></tr>`;
    }).join('');
    return `<h2>${esc(m.icon || '')} ${esc(m.label || t)} <small>(${by[t].length})</small></h2><table><thead><tr><th>Valor</th><th>Origen</th><th>Detalles</th></tr></thead><tbody>${rows}</tbody></table>`;
  }).join('');
  const omit = omitted ? `<p class="omit">Se omitieron ${omitted} resultado(s) de categorías sensibles.</p>` : '';
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>OptiTrace — ${esc(target)}</title>
  <style>body{font:14px/1.5 Segoe UI,sans-serif;background:#fff;color:#111;max-width:980px;margin:0 auto;padding:30px}
  h1 small{color:#555;font-weight:400;font-size:13px;display:block;margin-top:4px}
  h2{font-size:16px;margin-top:26px;border-bottom:1px solid #ccd;padding-bottom:6px}h2 small{color:#666;font-weight:400}
  table{width:100%;border-collapse:collapse;margin-top:8px;font-size:12.5px}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #e3e6ef;vertical-align:top;word-break:break-word}
  th{color:#555}.src{color:#0b7285}.omit{color:#a61e4d}</style></head>
  <body><h1>🔎 OptiTrace — Informe<small>Objetivo: <b>${esc(target)}</b> · ${esc(new Date().toLocaleString('es-ES'))} · ${g.nodes.length} entidades</small></h1>
  ${omit}${sec}<div style="margin-top:30px;color:#666;font-size:12px;border-top:1px solid #ccd;padding-top:12px">Generado con OptiTrace (OptiSuite) a partir de fuentes abiertas. Las coincidencias por nombre de usuario no prueban que la cuenta pertenezca a la misma persona. Uso conforme a la ley. https://optisuite.app</div></body></html>`;
}
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
