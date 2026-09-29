'use strict';
/*
 * OptiTrace — compilación portable COMPLETA en un solo paso:  npm run build
 *
 *   1. Copia Electron limpio y lo renombra a «OptiTrace.exe» (quita idiomas internos no usados)
 *   2. Empaqueta la app en resources/app.asar: src + data (Maigret) + icono + dependencias de ejecución
 *      (código legible: OptiTrace es GPL-3.0 y su código fuente es público)
 *   3. Icono y datos del .exe (rcedit) → endurecimiento con fuses (si falla, la compilación se detiene)
 *   4. Verifica: contenido del paquete, autotest REAL con el .exe (DNS/RDAP/crt.sh/IP) y que la ventana abre
 *   5. Crea dist/OptiTrace-Portable-v<versión>.zip (+ copia con nombre fijo OptiTrace-Portable.zip)
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync, spawn, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PKG = require(path.join(ROOT, 'package.json'));
const VER = PKG.version;
const NAME = 'OptiTrace';
const DIST = path.join(ROOT, 'dist');
const APP = path.join(DIST, NAME);
const EXE = path.join(APP, `${NAME}.exe`);
const ZIP = path.join(DIST, `${NAME}-Portable-v${VER}.zip`);
const ZIP_FIXED = path.join(DIST, `${NAME}-Portable.zip`);
const STAGE = path.join(DIST, '.stage');
const KEEP_LOCALES = new Set(['en-US.pak', 'en-GB.pak', 'es.pak', 'es-419.pak', 'pt-BR.pak', 'pt-PT.pak']);
const RUNTIME_DEPS = Object.keys(PKG.dependencies || {});

const t0 = Date.now();
let step = 0;
function log(msg) { console.log(`[${++step}] ${msg}`); }
function fail(msg) { console.error(`\n✗ COMPILACIÓN DETENIDA: ${msg}`); process.exit(1); }
function rmrf(p) { fs.rmSync(p, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); }
function sizeOf(p) {
  const st = fs.statSync(p); if (!st.isDirectory()) return st.size;
  return fs.readdirSync(p).reduce((n, f) => n + sizeOf(path.join(p, f)), 0);
}
const MB = (b) => (b / 1048576).toFixed(1) + ' MB';

/** Copia una dependencia de ejecución y, recursivamente, las suyas. */
function copyDep(name, dest, seen = new Set()) {
  if (seen.has(name)) return; seen.add(name);
  const src = path.join(ROOT, 'node_modules', name);
  if (!fs.existsSync(src)) fail(`falta la dependencia ${name}. Ejecuta: npm install`);
  fs.cpSync(src, path.join(dest, 'node_modules', name), { recursive: true });
  const p = require(path.join(src, 'package.json'));
  for (const d of Object.keys(p.dependencies || {})) copyDep(d, dest, seen);
}

(async () => {
  try { rmrf(APP); } catch (_) { fail(`cierra OptiTrace abierto desde ${path.relative(ROOT, APP)} y vuelve a compilar.`); }

  // 1) Electron limpio
  const ELECTRON_DIST = path.join(ROOT, 'node_modules', 'electron', 'dist');
  if (!fs.existsSync(path.join(ELECTRON_DIST, 'electron.exe'))) fail('falta Electron. Ejecuta: npm install');
  const eVer = require(path.join(ROOT, 'node_modules', 'electron', 'package.json')).version;
  log(`Copiando Electron ${eVer}…`);
  rmrf(STAGE);
  fs.cpSync(ELECTRON_DIST, APP, { recursive: true });
  fs.renameSync(path.join(APP, 'electron.exe'), EXE);
  rmrf(path.join(APP, 'resources', 'default_app.asar'));
  const locDir = path.join(APP, 'locales');
  for (const f of fs.readdirSync(locDir)) if (!KEEP_LOCALES.has(f)) fs.unlinkSync(path.join(locDir, f));

  // 2) app.asar
  log('Empaquetando la aplicación (app.asar)…');
  fs.mkdirSync(STAGE, { recursive: true });
  fs.cpSync(path.join(ROOT, 'src'), path.join(STAGE, 'src'), { recursive: true });
  fs.cpSync(path.join(ROOT, 'data'), path.join(STAGE, 'data'), { recursive: true });
  fs.mkdirSync(path.join(STAGE, 'build'));
  fs.copyFileSync(path.join(ROOT, 'build', 'icon.ico'), path.join(STAGE, 'build', 'icon.ico'));
  for (const d of RUNTIME_DEPS) copyDep(d, STAGE);
  const runtimePkg = { name: PKG.name, productName: NAME, version: VER, description: PKG.description, author: PKG.author, license: PKG.license, main: PKG.main };
  fs.writeFileSync(path.join(STAGE, 'package.json'), JSON.stringify(runtimePkg, null, 2));
  const asar = require('@electron/asar');
  const asarPath = path.join(APP, 'resources', 'app.asar');
  await asar.createPackage(STAGE, asarPath);
  rmrf(STAGE);

  // 3) Icono + datos del .exe, y endurecimiento
  log('Icono y datos del ejecutable…');
  const rc = path.join(ROOT, 'node_modules', 'rcedit', 'bin', 'rcedit-x64.exe');
  if (!fs.existsSync(rc)) fail('falta rcedit. Ejecuta: npm install');
  execFileSync(rc, [EXE,
    '--set-icon', path.join(ROOT, 'build', 'icon.ico'),
    '--set-file-version', VER, '--set-product-version', VER,
    '--set-version-string', 'ProductName', NAME,
    '--set-version-string', 'FileDescription', 'OptiTrace — búsqueda de información pública (OSINT)',
    '--set-version-string', 'CompanyName', 'OptiSuite',
    '--set-version-string', 'LegalCopyright', 'Copyright (c) 2026 Enmanuel Gil · OptiSuite · GPL-3.0',
    '--set-version-string', 'OriginalFilename', `${NAME}.exe`,
    '--set-version-string', 'InternalName', NAME,
  ], { windowsHide: true });
  log('Endureciendo el ejecutable (fuses)…');
  const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');
  await flipFuses(EXE, {
    version: FuseVersion.V1,
    resetAdHocDarwinSignature: false,
    [FuseV1Options.RunAsNode]: false,                              // no se puede usar como Node suelto
    [FuseV1Options.EnableNodeCliInspectArguments]: false,          // sin depurador adjunto
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,   // sin inyectar flags
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
  });

  // 4) Verificación
  log('Verificando el paquete…');
  const files = asar.listPackage(asarPath).map((f) => f.replace(/\\/g, '/'));
  for (const need of ['/src/main/main.js', '/src/main/engine.js', '/src/preload/preload.js', '/src/renderer/index.html', '/src/renderer/app.js',
    '/data/maigret-data.json', '/data/MAIGRET-LICENSE.txt', '/build/icon.ico', '/package.json', ...RUNTIME_DEPS.map((d) => `/node_modules/${d}/package.json`)])
    if (!files.includes(need)) fail(`falta ${need} dentro de app.asar.`);
  const smokeData = fs.mkdtempSync(path.join(os.tmpdir(), 'optitrace-smoke-'));
  const st = spawnSync(EXE, ['--selftest', `--user-data-dir=${smokeData}`], { cwd: APP, encoding: 'utf8', timeout: 180000, windowsHide: true });
  const outTxt = (st.stdout || '') + (st.stderr || '');
  if (!/RESULTADO: OK/.test(outTxt)) fail('el autotest del .exe empaquetado falló:\n' + outTxt.slice(-1500));
  console.log(outTxt.split(/\r?\n/).filter((l) => /Módulos cargados|Sitios Maigret|Grafo total|RESULTADO/.test(l)).map((l) => '    ' + l.trim()).join('\n'));
  const child = spawn(EXE, [`--user-data-dir=${smokeData}`], { cwd: APP, stdio: 'ignore', windowsHide: false });
  let exited = null; child.on('exit', (c) => { exited = c; });
  await new Promise((r) => setTimeout(r, 7000));
  if (exited !== null) fail(`el .exe se cerró solo al arrancar (código ${exited}).`);
  let title = '';
  try {
    title = execFileSync('powershell', ['-NoProfile', '-Command', `(Get-Process -Id ${child.pid} -ErrorAction SilentlyContinue).MainWindowTitle`], { windowsHide: true }).toString().trim();
  } catch (_) {}
  try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (_) {}
  if (!/OptiTrace/i.test(title)) fail(`el .exe arrancó pero no mostró su ventana (título: «${title}»).`);
  console.log(`    el .exe abre la ventana «${title}» ✓`);
  await new Promise((r) => setTimeout(r, 2000));
  rmrf(smokeData);

  // 5) ZIP
  fs.writeFileSync(path.join(APP, 'LÉEME.txt'),
    `OptiTrace v${VER} — búsqueda de información pública (Windows 10/11, 64 bits)\r\n\r\n` +
    '1. Clic derecho en el ZIP → «Extraer todo…» (no lo abras sin extraer).\r\n' +
    '2. Abre «OptiTrace.exe» dentro de la carpeta OptiTrace. No hace falta instalar nada.\r\n' +
    '3. Si Windows muestra «Windows protegió su PC»: «Más información» → «Ejecutar de todas formas».\r\n\r\n' +
    'Úsalo solo con una finalidad legítima y conforme a la ley de protección de datos.\r\n' +
    'Software libre GPL-3.0 — código fuente: https://github.com/EnMaNueL-G/optitrace\r\n' +
    'Incluye datos de Maigret (MIT) y recetas de Holehe (GPL-3.0): ver carpeta «licencias».\r\n\r\n' +
    'Web y soporte: https://optisuite.app · Enmanuel Gil · OptiSuite\r\n');
  const lic = path.join(APP, 'licencias');
  fs.mkdirSync(lic, { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'LICENSE'), path.join(lic, 'OptiTrace-GPL-3.0.txt'));
  fs.copyFileSync(path.join(ROOT, 'data', 'MAIGRET-LICENSE.txt'), path.join(lic, 'Maigret-MIT.txt'));
  log('Comprimiendo el ZIP…');
  rmrf(ZIP); rmrf(ZIP_FIXED);
  const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  execFileSync(tar, ['-a', '-c', '-f', ZIP, '-C', DIST, NAME], { windowsHide: true, stdio: 'inherit' });
  fs.copyFileSync(ZIP, ZIP_FIXED);
  const zipSize = fs.statSync(ZIP).size;
  console.log(`\n✓ LISTO en ${((Date.now() - t0) / 1000).toFixed(0)} s → ${path.relative(ROOT, ZIP)}  (${MB(zipSize)}, ${zipSize} bytes)`);
  console.log(`  Electron ${eVer} · carpeta: ${MB(sizeOf(APP))}`);
})().catch((e) => fail(e && e.stack || e));
