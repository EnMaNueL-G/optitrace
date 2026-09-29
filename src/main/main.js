'use strict';
/*
 * OptiTrace — proceso principal (Electron).
 * Ventana aislada (contextIsolation + sandbox, sin nodeIntegration, sin navegación). Toda la
 * lógica OSINT corre aquí (motor + módulos); el renderer solo pinta y dispara investigaciones.
 *
 * Modos:  electron . --selftest | --probe "valor" | --shot "valor"
 */
const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const { Engine, Graph } = require('./engine');
const { detect, META } = require('./entities');

const REPO = 'EnMaNueL-G/optitrace';
let win = null;
let STORE_PATH = '';
const engine = new Engine();
let graph = new Graph();
let current = null;          // { ctrl: AbortController } de la búsqueda en curso
let pickedImage = '';        // única ruta local de imagen permitida (elegida en el selector)

/* ---------------- persistencia (claves BYOK cifradas con safeStorage) ---------------- */
const DEFAULT_OPTIONS = { sensitive: false, maigretLimit: 1500, phoneCountry: '', accepted: false, history: true, maigretUpdated: '' };
const BUNDLED_DATA_DATE = '2026-09-25';   // fecha de la base de Maigret incluida en esta versión
const MAIGRET_URL = 'https://raw.githubusercontent.com/soxoj/maigret/main/maigret/resources/data.json';
let HISTORY_PATH = '';
let MAIGRET_USER_FILE = '';
let store = { keys: {}, proxy: '', options: { ...DEFAULT_OPTIONS } };

function enc(v) {
  if (!v) return '';
  try { if (safeStorage.isEncryptionAvailable()) return 'enc:' + safeStorage.encryptString(v).toString('base64'); } catch (_) {}
  return v;
}
function dec(v) {
  if (typeof v !== 'string' || !v) return '';
  if (!v.startsWith('enc:')) return v; // valor antiguo en claro: se re-cifra al guardar
  try { return safeStorage.decryptString(Buffer.from(v.slice(4), 'base64')); } catch (_) { return ''; }
}
function loadStore() {
  try {
    if (fs.existsSync(STORE_PATH)) {
      const raw = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
      store.keys = Object.fromEntries(Object.entries(raw.keys || {}).map(([k, v]) => [k, dec(v)]));
      store.proxy = dec(raw.proxy || '');
      store.options = { ...DEFAULT_OPTIONS, ...(raw.options || {}) };
      // Migración: claves guardadas en claro por la 1.0.0 → se cifran ya, sin esperar a "Guardar".
      const plain = [...Object.values(raw.keys || {}), raw.proxy].some((v) => typeof v === 'string' && v && !v.startsWith('enc:'));
      if (plain) saveStore();
    }
  } catch (_) {}
  engine.setKeys(store.keys);
  engine.setProxy(store.proxy);
}
function saveStore() {
  try {
    const out = {
      keys: Object.fromEntries(Object.entries(store.keys).filter(([, v]) => v).map(([k, v]) => [k, enc(v)])),
      proxy: enc(store.proxy),
      options: store.options,
    };
    fs.writeFileSync(STORE_PATH, JSON.stringify(out, null, 2));
  } catch (_) {}
}

/* ---------------- puente de eventos motor → renderer ---------------- */
function wireEngine() {
  engine.on('log', (t) => send('trace:log', String(t)));
  engine.on('node', (n) => send('trace:node', n));
  engine.on('edge', (e) => send('trace:edge', e));
  engine.on('progress', (p) => send('trace:progress', p));
}
function send(ch, payload) { if (win && !win.isDestroyed()) win.webContents.send(ch, payload); }

/* ---------------- ventana ---------------- */
const isHttp = (u) => typeof u === 'string' && /^https?:\/\//i.test(u);
function createWindow(show = true) {
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 1000, minHeight: 640, show,
    backgroundColor: '#0a0e1a',
    title: 'OptiTrace',
    icon: path.join(__dirname, '..', '..', 'build', 'icon.ico'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      webSecurity: true, spellcheck: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  // Enlaces: solo http(s) y siempre en el navegador del sistema. La ventana nunca navega.
  win.webContents.setWindowOpenHandler(({ url }) => { if (isHttp(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.on('will-attach-webview', (e) => e.preventDefault());
}

/* ---------------- IPC (solo desde nuestra propia página) ---------------- */
const INDEX_PATH = path.join(__dirname, '..', 'renderer', 'index.html').toLowerCase();
function trusted(e) {
  try {
    const url = (e.senderFrame && e.senderFrame.url) || '';
    return path.normalize(require('url').fileURLToPath(url)).toLowerCase() === INDEX_PATH;
  } catch (_) { return false; }
}
function handle(ch, fn) {
  ipcMain.handle(ch, (e, ...a) => { if (!trusted(e)) throw new Error('origen no autorizado'); return fn(e, ...a); });
}

function maigretInfo() {
  const um = engine.modules.find((m) => m.id === 'user.maigret');
  const i = um ? um.info() : { sites: 0, source: 'incluida' };
  return { ...i, date: i.source === 'actualizada' ? (store.options.maigretUpdated || '').slice(0, 10) : BUNDLED_DATA_DATE };
}

/* ---------------- historial local (solo en este equipo) ---------------- */
function readHistory() { try { return JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8')); } catch (_) { return []; } }
function addHistory(entry) {
  if (!store.options.history) return;
  const list = readHistory().filter((h) => h.q !== entry.q);
  list.unshift(entry);
  try { fs.writeFileSync(HISTORY_PATH + '.tmp', JSON.stringify(list.slice(0, 100), null, 1)); fs.renameSync(HISTORY_PATH + '.tmp', HISTORY_PATH); } catch (_) {}
}

function publicSettings() {
  return {
    keys: Object.fromEntries(Object.entries(store.keys).map(([k, v]) => [k, !!v])),
    proxy: store.proxy ? store.proxy.replace(/\/\/[^@/]*@/, '//***@') : '',
    proxyError: engine.proxyError || '',
    options: store.options,
    maigret: maigretInfo(),
  };
}

handle('app:init', async () => ({
  version: app.getVersion(),
  modules: engine.modules.map((m) => ({ id: m.id, label: m.label, accepts: m.accepts, needsKey: m.needsKey || null })),
  sites: (engine.modules.find((m) => m.id === 'user.maigret') || { count: () => 0 }).count(),
  meta: META,
  ...publicSettings(),
}));

handle('trace:expand', async (_e, { value, fresh, fromPicker }) => {
  const ent = detect(value);
  if (!ent) return { ok: false, error: 'entrada vacía' };
  if (ent.type === 'image' && !isHttp(ent.value) && !(fromPicker && ent.value === pickedImage)) {
    return { ok: false, error: 'Para analizar una imagen de tu equipo usa el botón 📷.' };
  }
  const supported = engine.applicable(ent.type).length > 0;
  if (!supported) return { ok: true, entity: ent, found: 0, unsupported: true, graph: graph.toJSON() };
  if (current) current.ctrl.abort();
  const ctrl = new AbortController();
  require('events').setMaxListeners(0, ctrl.signal); // 50 consultas en paralelo escuchan la misma señal
  const me = { ctrl };
  current = me;
  const options = store.options;
  try {
    const r = await engine.expand(ent, graph, { fresh: !!fresh, signal: ctrl.signal, options });
    // Email: además, busca la parte local como alias en los sitios de Maigret.
    // Son coincidencias de NOMBRE, no del correo: se marcan como "mismo alias (posible)".
    if (ent.type === 'email' && !ctrl.signal.aborted) {
      const local = ent.value.split('@')[0];
      const generic = /^(info|admin|contact|contacto|ventas|sales|support|soporte|hello|hola|office|mail|noreply|no-reply)$/i;
      if (/^[a-z0-9._-]{4,}$/i.test(local) && !generic.test(local)) {
        const r2 = await engine.expand({ type: 'username', value: local, alias: true }, graph, { signal: ctrl.signal, options });
        r.found += r2.found;
      }
    }
    const g = graph.toJSON();
    addHistory({
      q: ent.type === 'image' && !isHttp(ent.value) ? '📷 ' + path.basename(ent.value) : ent.value,
      type: ent.type, ts: Date.now(), results: r.found, cancelled: ctrl.signal.aborted,
      search: !(ent.type === 'image' && !isHttp(ent.value)),
    });
    return { ok: true, entity: ent, ...r, cancelled: ctrl.signal.aborted, graph: g };
  } catch (e) { return { ok: false, error: e.message }; }
  finally { if (current === me) current = null; }
});

handle('trace:cancel', async () => { if (current) current.ctrl.abort(); return { ok: true }; });
handle('trace:detect', async (_e, value) => detect(value));
handle('image:pick', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Imágenes', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'tif', 'tiff', 'heic', 'bmp'] }] });
  if (r.canceled || !r.filePaths.length) return null;
  pickedImage = r.filePaths[0];
  return pickedImage;
});
handle('trace:graph', async () => graph.toJSON());
handle('trace:clear', async () => {
  if (current) current.ctrl.abort();
  graph = new Graph(); engine.cache.clear();
  return { ok: true };
});

handle('settings:get', async () => publicSettings());
handle('settings:set', async (_e, s) => {
  if (s && typeof s === 'object') {
    if (s.keys && typeof s.keys === 'object') {
      for (const [k, v] of Object.entries(s.keys)) if (typeof v === 'string') store.keys[k] = v.trim(); // '' = borrar
    }
    if (typeof s.proxy === 'string') {
      const masked = publicSettings().proxy;
      if (!s.proxy.includes('***')) store.proxy = s.proxy.trim();
      else if (s.proxy.trim() !== masked) return { ok: false, ...publicSettings(), proxyError: 'Para cambiar el proxy vuelve a escribirlo completo, con usuario y contraseña.' };
    }
    if (s.options && typeof s.options === 'object') {
      const o = s.options;
      if (typeof o.sensitive === 'boolean') store.options.sensitive = o.sensitive;
      if (typeof o.accepted === 'boolean') store.options.accepted = o.accepted;
      if (Number.isInteger(o.maigretLimit) && o.maigretLimit >= 0) store.options.maigretLimit = o.maigretLimit;
      if (typeof o.phoneCountry === 'string' && /^([A-Z]{2})?$/.test(o.phoneCountry)) store.options.phoneCountry = o.phoneCountry;
      if (typeof o.history === 'boolean') {
        store.options.history = o.history;
        if (!o.history) { try { fs.unlinkSync(HISTORY_PATH); } catch (_) {} } // desactivar = borrar lo guardado
      }
    }
    engine.setKeys(store.keys);
    engine.proxyError = engine.setProxy(store.proxy);
    saveStore();
  }
  return { ok: !engine.proxyError, ...publicSettings() };
});

handle('report:save', async (_e, { html, name, pdf }) => {
  const ext = pdf ? 'pdf' : 'html';
  const r = await dialog.showSaveDialog(win, { defaultPath: (name || 'optitrace-informe').replace(/[\\/:*?"<>|]/g, '_') + '.' + ext, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
  if (r.canceled || !r.filePath) return { ok: false };
  try {
    if (pdf) {
      // Se imprime en una ventana oculta sin preload ni JavaScript: solo HTML estático del informe.
      // (archivo temporal: un data: URL de varios MB superaría el límite de Chromium)
      const tmp = path.join(app.getPath('temp'), `optitrace-informe-${process.pid}-${Date.now()}.html`);
      const w = new BrowserWindow({ show: false, webPreferences: { javascript: false, sandbox: true } });
      try {
        fs.writeFileSync(tmp, html, 'utf8');
        await w.loadFile(tmp);
        const buf = await w.webContents.printToPDF({ printBackground: true, pageSize: 'A4', margins: { marginType: 'default' } });
        fs.writeFileSync(r.filePath, buf);
      } finally {
        w.destroy();
        try { fs.unlinkSync(tmp); } catch (_) {}
      }
    } else fs.writeFileSync(r.filePath, html, 'utf8');
    shell.showItemInFolder(r.filePath);
    return { ok: true, path: r.filePath };
  } catch (e) { return { ok: false, error: e.message }; }
});

handle('history:list', async () => (store.options.history ? readHistory() : []));
handle('history:clear', async () => { try { fs.unlinkSync(HISTORY_PATH); } catch (_) {} return { ok: true }; });

/** Descarga la base de sitios más reciente de Maigret (MIT) a la carpeta de datos del usuario. */
handle('maigret:update', async () => {
  const um = engine.modules.find((m) => m.id === 'user.maigret');
  if (!um) return { ok: false, error: 'módulo de usuarios no disponible' };
  const httpu = require('./util/http');
  const ps = httpu.proxyState();
  if (ps.error) return { ok: false, error: ps.error + ' (corrígelo en el campo Proxy).', maigret: maigretInfo() };
  const res = await httpu.getText(MAIGRET_URL, { timeout: 120000 });
  if (!res) return { ok: false, error: 'No se pudo descargar la base (sin conexión o GitHub no responde).', maigret: maigretInfo() };
  let json;
  try { json = JSON.parse(res); } catch (_) { return { ok: false, error: 'La descarga llegó incompleta.', maigret: maigretInfo() }; }
  if (!um.validate(json)) return { ok: false, error: 'La base descargada no tiene el formato esperado; se mantiene la actual.', maigret: maigretInfo() };
  try {
    const tmp = MAIGRET_USER_FILE + '.tmp';
    fs.writeFileSync(tmp, res);
    fs.renameSync(tmp, MAIGRET_USER_FILE);
  } catch (e) { return { ok: false, error: 'No se pudo guardar la base: ' + e.message, maigret: maigretInfo() }; }
  store.options.maigretUpdated = new Date().toISOString();
  saveStore();
  um.setUserDataFile(MAIGRET_USER_FILE);
  return { ok: true, maigret: maigretInfo() };
});

handle('app:openExternal', async (_e, url) => {
  if (isHttp(url)) { shell.openExternal(url); return { ok: true }; }
  return { ok: false };
});

/** Aviso de versión nueva (una consulta a la API pública de GitHub; sin telemetría). */
handle('app:checkUpdate', async () => {
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'OptiTrace' }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const j = await r.json();
    const latest = String(j.tag_name || '').replace(/^v/, '');
    const newer = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
    return latest && newer(latest, app.getVersion()) ? { version: latest, url: j.html_url } : null;
  } catch (_) { return null; }
});

/* ---------------- autotest headless ---------------- */
async function selftest() {
  const out = (s) => process.stdout.write(s + '\n');
  out('OptiTrace selftest ─────────────────────────────');
  out(`Módulos cargados: ${engine.modules.length}`);
  for (const m of engine.modules) out(`  · ${m.id}  [${(m.accepts || []).join(',')}]${m.needsKey ? ' (BYOK:' + m.needsKey + ')' : ''}`);
  const um = engine.modules.find((m) => m.id === 'user.maigret');
  out(`Sitios Maigret activos: ${um ? um.count() : 0}`);

  const samples = ['example.com', '8.8.8.8', 'john.doe@gmail.com', '+34666777888', 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080', 'octocat', 'https://example.com/a'];
  out('\nDetección:');
  for (const s of samples) { const e = detect(s); out(`  ${s.padEnd(48)} → ${e ? e.type : 'null'}`); }

  let okNet = true;
  try {
    const g = new Graph();
    out('\nExpandiendo domain:example.com …');
    const r1 = await engine.expand(detect('example.com'), g);
    out(`  → ${r1.found} nodos nuevos (${r1.ran} módulos)`);
    out('Expandiendo ip:8.8.8.8 …');
    const r2 = await engine.expand(detect('8.8.8.8'), g);
    out(`  → ${r2.found} nodos nuevos (${r2.ran} módulos)`);
    const j = g.toJSON();
    out(`\nGrafo total: ${j.nodes.length} nodos, ${j.edges.length} aristas`);
    const byType = {};
    for (const n of j.nodes) byType[n.type] = (byType[n.type] || 0) + 1;
    out('Por tipo: ' + Object.entries(byType).map(([k, v]) => `${k}=${v}`).join(' '));
    okNet = j.nodes.length >= 3;
  } catch (e) { out('  [x] error de red: ' + e.message); okNet = false; }

  const ok = engine.modules.length >= 3 && okNet;
  out('\nRESULTADO: ' + (ok ? 'OK ✓' : 'REVISAR ✗'));
  app.exit(ok ? 0 : 1);
}

/* electron . --probe "valor" [--sensitive]  → expande una entidad y vuelca el grafo. */
async function probe(value) {
  const out = (s) => process.stdout.write(s + '\n');
  const ent = detect(value);
  out(`OptiTrace probe → "${value}"  (tipo: ${ent ? ent.type : 'null'})`);
  const g = new Graph();
  engine.on('log', (t) => out(t));
  engine.on('progress', (p) => { if (p.state === 'done' && p.found) out(`  ✓ ${p.label}: +${p.found} (${p.ms} ms)`); if (p.state === 'error') out(`  ✗ ${p.label}: ${p.error}`); });
  const r = await engine.expand(ent, g, { options: { ...store.options, sensitive: process.argv.includes('--sensitive') } });
  const j = g.toJSON();
  out(`\nResultado: ${r.found} hallazgos · ${j.nodes.length} nodos totales`);
  const by = {};
  for (const n of j.nodes) (by[n.type] = by[n.type] || []).push(n.label || n.value);
  for (const [t, arr] of Object.entries(by)) { out(`\n[${t}] (${arr.length}):`); for (const v of arr.slice(0, 40)) out('   · ' + v); }
  app.exit(0);
}

/* electron . --shot "valor"  → renderiza la UI real, busca y guarda un PNG en la carpeta de datos. */
async function shot(query) {
  loadStore(); wireEngine(); createWindow(true); // visible: una ventana oculta no ejecuta transiciones CSS
  const file = path.join(app.getPath('userData'), 'optitrace-shot.png');
  win.webContents.setBackgroundThrottling(false);
  win.webContents.on('console-message', (e) => process.stdout.write(`[renderer] ${e.message || ''}\n`));
  win.webContents.once('did-finish-load', async () => {
    await new Promise((r) => setTimeout(r, 1500));
    try { await win.webContents.executeJavaScript(`window.__shot && window.__shot(${JSON.stringify(query)})`); } catch (_) {}
    const cancelAt = +(process.env.OPTITRACE_SHOT_CANCEL || 0); // prueba del botón Cancelar
    if (cancelAt) { await new Promise((r) => setTimeout(r, cancelAt)); await win.webContents.executeJavaScript(`document.querySelector('#go').click()`); }
    await new Promise((r) => setTimeout(r, +(process.env.OPTITRACE_SHOT_WAIT || 20000)));
    if (process.env.OPTITRACE_SHOT_CLICK) { // p. ej. "#settings": abrir un panel antes de capturar
      for (const sel of process.env.OPTITRACE_SHOT_CLICK.split(',')) { // varios clics seguidos: "#settings,#dbUpdate"
        try { await win.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(sel.trim())}).click()`); } catch (_) {}
        await new Promise((r) => setTimeout(r, +(process.env.OPTITRACE_SHOT_STEP || 1200)));
      }
      try { process.stdout.write('SHOT_STATE ' + await win.webContents.executeJavaScript(`[...document.querySelectorAll('.modal-bg.show')].map(m=>m.id).join(',') || 'ninguno'`) + '\n'); } catch (e) { process.stdout.write('SHOT_STATE_ERR ' + e.message + '\n'); }
    }
    try {
      win.webContents.invalidate(); // la ventana oculta no repinta sola: forzar un fotograma nuevo
      await new Promise((r) => setTimeout(r, 600));
      const img = await win.webContents.capturePage();
      fs.writeFileSync(file, img.toPNG());
      process.stdout.write(`SHOT_OK ${img.getSize().width}x${img.getSize().height} ${file}\n`);
    } catch (e) { process.stdout.write('SHOT_ERR ' + e.message + '\n'); }
    app.exit(0);
  });
}

/* ---------------- ciclo de vida ---------------- */
const isSelftest = process.argv.includes('--selftest');
const probeIdx = process.argv.indexOf('--probe');
const shotIdx = process.argv.indexOf('--shot');
const headless = isSelftest || shotIdx >= 0 || probeIdx >= 0;
const gotLock = headless ? true : app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

app.whenReady().then(() => {
  STORE_PATH = path.join(app.getPath('userData'), 'optitrace-store.json');
  HISTORY_PATH = path.join(app.getPath('userData'), 'optitrace-history.json');
  MAIGRET_USER_FILE = path.join(app.getPath('userData'), 'maigret-data.json');
  engine.loadModules();
  loadStore();
  // La base descargada solo manda si es más reciente que la incluida en esta versión de la app.
  const um = engine.modules.find((m) => m.id === 'user.maigret');
  if (um && (store.options.maigretUpdated || '').slice(0, 10) >= BUNDLED_DATA_DATE) um.setUserDataFile(MAIGRET_USER_FILE);
  if (shotIdx >= 0) { shot(process.argv[shotIdx + 1] || 'github'); return; }
  if (probeIdx >= 0) { loadStore(); probe(process.argv[probeIdx + 1] || ''); return; }
  if (isSelftest) { selftest(); return; }
  loadStore();
  engine.proxyError = engine.setProxy(store.proxy);
  wireEngine();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (current) current.ctrl.abort(); if (process.platform !== 'darwin') app.quit(); });
