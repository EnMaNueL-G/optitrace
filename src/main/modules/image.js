'use strict';
/*
 * OptiTrace — modulo IMAGEN.
 *  - EXIF local con exifr: cámara, software, fecha y GPS (sin subir nada a terceros).
 *  - Si hay GPS → nodo ubicación + enlaces a mapas (Pic2Map, Google/OSM).
 *  - Búsqueda inversa: TinEye, Google Lens, Yandex (mejor para rostros), Bing.
 *    Para URLs se generan enlaces directos; para archivos locales, enlaces a subir.
 */
const fs = require('fs');
let exifr = null;
try { exifr = require('exifr'); } catch (_) {}

async function loadInput(value, http, signal) {
  if (/^https?:\/\//i.test(value)) {
    const res = await http.req(value, { timeout: 20000, signal });
    if (!res.ok) { res.done(); return null; }
    try { return await res.readBuffer(30 * 1024 * 1024); } catch (_) { return null; }
  }
  // Solo archivos locales elegidos en el selector (el proceso principal lo garantiza).
  // Nunca rutas de red UNC (\\servidor\...): Windows enviaría credenciales NTLM a ese servidor.
  if (/^[\\/]{2}/.test(value) || !/^[a-z]:[\\/]/i.test(value)) return null;
  try { return fs.readFileSync(value); } catch (_) { return null; }
}

module.exports = {
  id: 'image.exif', label: 'Imagen: EXIF/GPS + búsqueda inversa', accepts: ['image'], order: 10,
  async run(entity, ctx) {
    const value = entity.value;
    const isUrl = /^https?:\/\//i.test(value);

    // --- EXIF ---
    if (exifr) {
      const buf = await loadInput(value, ctx.http, ctx.signal);
      if (buf) {
        let data = null;
        try { data = await exifr.parse(buf, { gps: true, tiff: true, ifd0: true, exif: true }); } catch (_) {}
        if (data) {
          const cam = [data.Make, data.Model].filter(Boolean).join(' ').trim();
          if (cam) ctx.node('fact', `Cámara: ${cam}`, { rel: 'cámara', source: 'exif', data: { lente: data.LensModel || '', software: data.Software || '' } });
          if (data.Software) ctx.node('note', `Software: ${data.Software}`, { rel: 'software', source: 'exif' });
          const when = data.DateTimeOriginal || data.CreateDate || data.ModifyDate;
          if (when) ctx.node('fact', `Fecha de captura: ${new Date(when).toLocaleString('es-ES')}`, { rel: 'fecha', source: 'exif' });
          if (typeof data.latitude === 'number' && typeof data.longitude === 'number') {
            const lat = data.latitude.toFixed(6), lon = data.longitude.toFixed(6);
            ctx.node('location', `${lat}, ${lon}`, { rel: 'GPS de la foto', source: 'exif', data: { lat, lon } });
            ctx.node('url', `https://www.google.com/maps?q=${lat},${lon}`, { rel: 'ver en mapa', source: 'exif', label: 'Google Maps (GPS)' });
            ctx.node('url', `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=17/${lat}/${lon}`, { rel: 'ver en mapa', source: 'exif', label: 'OpenStreetMap (GPS)' });
            ctx.log(`  EXIF: 📍 GPS ${lat}, ${lon} — coordenadas extraídas`);
          }
          ctx.log(`  EXIF: ${cam || 'sin marca'}${when ? ' · ' + new Date(when).toLocaleDateString('es-ES') : ''}`);
        } else ctx.log('  EXIF: la imagen no contiene metadatos (probablemente reprocesada/redes sociales)');
      } else ctx.log('  EXIF: no se pudo leer la imagen');
    }

    // --- Búsqueda inversa ---
    if (isUrl) {
      const u = encodeURIComponent(value);
      ctx.node('url', `https://lens.google.com/uploadbyurl?url=${u}`, { rel: 'reversa', source: 'reverse', label: 'Google Lens' });
      ctx.node('url', `https://yandex.com/images/search?rpt=imageview&url=${u}`, { rel: 'reversa', source: 'reverse', label: 'Yandex (mejor rostros)' });
      ctx.node('url', `https://www.bing.com/images/search?view=detailv2&iss=sbi&q=imgurl:${u}`, { rel: 'reversa', source: 'reverse', label: 'Bing Visual' });
      ctx.node('url', `https://tineye.com/search?url=${u}`, { rel: 'reversa', source: 'reverse', label: 'TinEye' });
      ctx.node('url', `https://pic2map.com/`, { rel: 'GPS de foto', source: 'reverse', label: 'Pic2Map (subir)' });
      ctx.log('  Inversa: enlaces a Google Lens, Yandex, Bing y TinEye generados.');
    } else {
      ctx.node('url', `https://lens.google.com/`, { rel: 'reversa', source: 'reverse', label: 'Google Lens (subir archivo)' });
      ctx.node('url', `https://yandex.com/images/`, { rel: 'reversa', source: 'reverse', label: 'Yandex Images (subir)' });
      ctx.node('url', `https://tineye.com/`, { rel: 'reversa', source: 'reverse', label: 'TinEye (subir)' });
      ctx.log('  Inversa: archivo local — usa los enlaces para subir la imagen al motor.');
    }
  },
};
