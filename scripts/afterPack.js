'use strict';
/*
 * Hook afterPack — endurece el binario de Electron con @electron/fuses.
 * Desactiva las vías típicas para volcar/leer el código de una app Electron:
 *   - RunAsNode (ELECTRON_RUN_AS_NODE) → no se puede ejecutar como Node para extraer.
 *   - NodeCliInspect (--inspect) → no se puede adjuntar un depurador para volcar memoria.
 *   - NodeOptions (NODE_OPTIONS) → no se pueden inyectar flags.
 *   - EnableCookieEncryption → cifra datos locales sensibles.
 */
const path = require('path');
const fs = require('fs');

module.exports = async function afterPack(context) {
  let flipFuses, FuseVersion, FuseV1Options;
  try { ({ flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses')); }
  catch (_) { console.log('  [fuses] @electron/fuses no disponible — se omite el endurecimiento.'); return; }

  const exe = context.electronPlatformName === 'win32' ? `${context.packager.appInfo.productFilename}.exe` : context.packager.appInfo.productFilename;
  const electronBinary = path.join(context.appOutDir, exe);
  if (!fs.existsSync(electronBinary)) { console.log('  [fuses] no se encontró el binario:', electronBinary); return; }

  try {
    await flipFuses(electronBinary, {
      version: FuseVersion.V1,
      resetAdHocDarwinSignature: false,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    });
    console.log('  [fuses] binario endurecido ✓');
  } catch (e) {
    console.log('  [fuses] aviso:', e.message);
  }

  // Incrustar el ICONO con rcedit independiente. El rcedit de electron-builder falla
  // en este equipo (extrae winCodeSign con symlinks y no hay privilegio), dejando el
  // icono por defecto de Electron; este lo aplica sin esa dependencia.
  if (context.electronPlatformName === 'win32') {
    try {
      const { execFileSync } = require('child_process');
      const ico = path.join(process.cwd(), 'build', 'icon.ico');
      const rcBin = path.join(process.cwd(), 'node_modules', 'rcedit', 'bin', 'rcedit-x64.exe');
      if (fs.existsSync(ico) && fs.existsSync(rcBin)) {
        execFileSync(rcBin, [electronBinary, '--set-icon', ico], { windowsHide: true });
        console.log('  [icon] icono incrustado ✓');
      } else console.log('  [icon] rcedit-x64.exe o icon.ico no encontrados');
    } catch (e) { console.log('  [icon] aviso:', e.message); }
  }
};
