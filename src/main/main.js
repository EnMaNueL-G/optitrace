'use strict';
/*
 * OptiTrace — proceso principal (Electron).
 * Ventana segura (contextIsolation, sin nodeIntegration). Toda la logica OSINT corre
 * aqui (motor + modulos); el renderer solo pinta el grafo y dispara investigaciones.
 *
 * Modo headless de verificacion:  electron . --selftest
 */
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { Engine, Graph } = require('./engine');
const { detect, META } = require('./entities');

let win = null;
let store = { keys: {}, proxy: '' };
let STORE_PATH = '';
const engine = new Engine();
let graph = new Graph();

/* ---------------- persistencia ligera (claves BYOK + proxy) ---------------- */
function loadStore() {
  try { if (fs.existsSync(STORE_PATH)) store = { ...store, ...JSON.parse(fs.readFileSync(STORE_PATH, 'utf8')) }; } catch (_) {}
  engine.setKeys(store.keys || {});
  engine.setProxy(store.proxy || '');
}
function saveStore() { try { fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2)); } catch (_) {} }

/* ---------------- puente de eventos motor → renderer ---------------- */
function wireEngine() {
  engine.on('log', (t) => send('trace:log', String(t)));
  engine.on('node', (n) => send('trace:node', n));
  engine.on('edge', (e) => send('trace:edge', e));
  engine.on('progress', (p) => send('trace:progress', p));
}
function send(ch, payload) { if (win && !win.isDestroyed()) win.webContents.send(ch, payload); }

/* ---------------- ventana ---------------- */
function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 1000, minHeight: 640,
    backgroundColor: '#0a0e1a',
    title: 'OptiTrace',
    icon: path.join(__dirname, '..', '..', 'build', 'icon.ico'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

/* ---------------- IPC ---------------- */
ipcMain.handle('app:init', async () => ({
  version: app.getVersion(),
  modules: engine.modules.map((m) => ({ id: m.id, label: m.label, accepts: m.accepts, needsKey: m.needsKey || null })),
  meta: META,
  keys: Object.fromEntries(Object.keys(store.keys || {}).map((k) => [k, !!store.keys[k]])),
  proxy: store.proxy || '',
}));

ipcMain.handle('trace:expand', async (_e, { value, fresh }) => {
  const ent = detect(value);
  if (!ent) return { ok: false, error: 'entrada vacía' };
  try {
    const r = await engine.expand(ent, graph, { fresh: !!fresh });
    // Email: además de los checks por correo, barre los ~3000 sitios con la parte local
    // (muchas cuentas usan el mismo handle que el email → cobertura tipo Maigret/Holehe).
    if (ent.type === 'email') {
      const local = ent.value.split('@')[0];
      if (/^[a-z0-9._-]{3,}$/i.test(local)) {
        const r2 = await engine.expand({ type: 'username', value: local }, graph, {});
        r.found += r2.found;
      }
    }
    return { ok: true, entity: ent, ...r, graph: graph.toJSON() };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('trace:detect', async (_e, value) => detect(value));
ipcMain.handle('image:pick', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Imágenes', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'tif', 'tiff', 'heic', 'bmp'] }] });
  if (r.canceled || !r.filePaths.length) return null;
  return r.filePaths[0];
});
ipcMain.handle('trace:graph', async () => graph.toJSON());
ipcMain.handle('trace:clear', async () => { graph = new Graph(); engine.cache.clear(); return { ok: true }; });

ipcMain.handle('settings:get', async () => ({ keys: store.keys || {}, proxy: store.proxy || '' }));
ipcMain.handle('settings:set', async (_e, s) => {
  if (s && typeof s === 'object') {
    if (s.keys) store.keys = { ...store.keys, ...s.keys };
    if (typeof s.proxy === 'string') store.proxy = s.proxy;
    engine.setKeys(store.keys); engine.setProxy(store.proxy); saveStore();
  }
  return { ok: true };
});

ipcMain.handle('report:save', async (_e, { html, name }) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: (name || 'optitrace-informe') + '.html', filters: [{ name: 'HTML', extensions: ['html'] }] });
  if (r.canceled || !r.filePath) return { ok: false };
  try { fs.writeFileSync(r.filePath, html, 'utf8'); shell.showItemInFolder(r.filePath); return { ok: true, path: r.filePath }; }
  catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('app:openExternal', async (_e, url) => {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) { shell.openExternal(url); return { ok: true }; }
  return { ok: false };
});

/* ---------------- autotest headless ---------------- */
async function selftest() {
  const out = (s) => process.stdout.write(s + '\n');
  out('OptiTrace selftest ─────────────────────────────');
  engine.loadModules();
  out(`Módulos cargados: ${engine.modules.length}`);
  for (const m of engine.modules) out(`  · ${m.id}  [${(m.accepts || []).join(',')}]${m.needsKey ? ' (BYOK:' + m.needsKey + ')' : ''}`);

  // Deteccion de entidades
  const samples = ['example.com', '8.8.8.8', 'john.doe@gmail.com', '+34666777888', 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080', 'octocat'];
  out('\nDetección:');
  for (const s of samples) { const e = detect(s); out(`  ${s.padEnd(48)} → ${e ? e.type : 'null'}`); }

  // Expansion real contra dominio e IP (requiere red)
  let okNet = true;
  try {
    out('\nExpandiendo domain:example.com …');
    const g = new Graph();
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

  out('\nRESULTADO: ' + (engine.modules.length >= 3 && okNet ? 'OK ✓' : 'REVISAR ✗'));
  app.exit(engine.modules.length >= 3 && okNet ? 0 : 1);
}

/* Modo prueba dirigida:  electron . --probe "valor"  → expande una entidad y vuelca el grafo. */
async function probe(value) {
  const out = (s) => process.stdout.write(s + '\n');
  const ent = detect(value);
  out(`OptiTrace probe → "${value}"  (tipo: ${ent ? ent.type : 'null'})`);
  const g = new Graph();
  engine.on('progress', (p) => { if (p.state === 'done' && p.found) out(`  ✓ ${p.label}: +${p.found} (${p.ms} ms)`); if (p.state === 'error') out(`  ✗ ${p.label}: ${p.error}`); });
  const r = await engine.expand(ent, g);
  const j = g.toJSON();
  out(`\nResultado: ${r.found} hallazgos · ${j.nodes.length} nodos totales`);
  const by = {};
  for (const n of j.nodes) (by[n.type] = by[n.type] || []).push(n.label || n.value);
  for (const [t, arr] of Object.entries(by)) { out(`\n[${t}] (${arr.length}):`); for (const v of arr.slice(0, 40)) out('   · ' + v); }
  app.exit(0);
}

/* Modo captura:  electron . --shot [query]  → renderiza la UI real, busca y guarda un PNG. */
async function shot(query) {
  loadStore(); wireEngine(); createWindow();
  const file = path.join(process.cwd(), '..', '..', 'Salidas-Logs', 'optitrace-shot.png');
  win.webContents.setBackgroundThrottling(false);
  win.webContents.once('did-finish-load', async () => {
    win.show(); win.focusOnWebView();
    await new Promise((r) => setTimeout(r, 1500));
    try {
      await win.webContents.executeJavaScript(`(function(){const q=document.querySelector('#q');q.value=${JSON.stringify(query)};document.querySelector('#go').click();})()`);
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 17000)); // dar tiempo a poblar resultados
    try {
      const img = await win.webContents.capturePage();
      const sz = img.getSize();
      const png = img.toPNG();
      fs.writeFileSync(file, png);
      process.stdout.write(`SHOT_OK ${sz.width}x${sz.height} ${png.length}b ${file}\n`);
    } catch (e) { process.stdout.write('SHOT_ERR ' + e.message + '\n'); }
    app.exit(0);
  });
}

/* ---------------- ciclo de vida ---------------- */
const isSelftest = process.argv.includes('--selftest');
const probeIdx = process.argv.indexOf('--probe');
const shotIdx = process.argv.indexOf('--shot');
app.whenReady().then(() => {
  STORE_PATH = path.join(app.getPath('userData'), 'optitrace-store.json');
  engine.loadModules();
  if (shotIdx >= 0) { shot(process.argv[shotIdx + 1] || 'github'); return; }
  if (probeIdx >= 0) { loadStore(); probe(process.argv[probeIdx + 1] || ''); return; }
  if (isSelftest) { selftest(); return; }
  loadStore();
  wireEngine();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
const gotLock = (isSelftest || shotIdx >= 0 || probeIdx >= 0) ? true : app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
