'use strict';
/*
 * OptiSuite Toolkit — pipeline de protección.
 * Ofusca TODO el JavaScript (main, preload, renderer) hacia build-obf/, que es lo único
 * que se empaqueta. El código fuente legible (src/) NUNCA se distribuye.
 * Capas: ofuscación fuerte (string array cifrado, control-flow flattening, self-defending,
 * dead code, nombres hex) + asar + electronFuses (ver package.json) + integridad asar.
 */
const fs = require('fs');
const path = require('path');
const JO = require('javascript-obfuscator');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const OUT = path.join(ROOT, 'build-obf');

const OPTS = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.6,
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.3,
  numbersToExpressions: true,
  simplify: true,
  stringArray: true,
  stringArrayEncoding: ['base64'],
  stringArrayThreshold: 0.85,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  splitStrings: true,
  splitStringsChunkLength: 8,
  transformObjectKeys: true,
  identifierNamesGenerator: 'hexadecimal',
  selfDefending: true,
  target: 'node',
};

function rmrf(p) { try { fs.rmSync(p, { recursive: true, force: true }); } catch (_) {} }
function walk(dir, cb) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, cb);
    else cb(full);
  }
}

rmrf(OUT);
let nJs = 0, nCopy = 0;
walk(SRC, (file) => {
  const rel = path.relative(SRC, file);
  const dst = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  if (file.endsWith('.js')) {
    const code = fs.readFileSync(file, 'utf8');
    // El preload se ofusca con target 'browser' (corre en contexto de renderer/aislado).
    const isPreload = rel.replace(/\\/g, '/').startsWith('preload/');
    const isRenderer = rel.replace(/\\/g, '/').startsWith('renderer/');
    const opts = { ...OPTS, target: (isPreload || isRenderer) ? 'browser' : 'node' };
    const out = JO.obfuscate(code, opts).getObfuscatedCode();
    fs.writeFileSync(dst, out);
    nJs++;
  } else {
    fs.copyFileSync(file, dst);
    nCopy++;
  }
});
console.log(`Protección lista → build-obf/  (${nJs} JS ofuscados, ${nCopy} copiados)`);
