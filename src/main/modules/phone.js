'use strict';
/*
 * OptiTrace — modulo TELEFONO (100% offline, cero red).
 * Usa libphonenumber-js para extraer pais, tipo de linea y formato internacional (no la operadora:
 * la portabilidad hace que el prefijo no la determine).
 * No expone al titular: solo metadatos publicos del numbering plan + dorks de busqueda.
 */
let lib = null;
try { lib = require('libphonenumber-js/max'); } catch (_) {}

const TYPE_ES = {
  MOBILE: 'Móvil', FIXED_LINE: 'Fijo', FIXED_LINE_OR_MOBILE: 'Fijo o móvil',
  PREMIUM_RATE: 'Tarifa premium', TOLL_FREE: 'Gratuito (toll-free)', VOIP: 'VoIP',
  PERSONAL_NUMBER: 'Personal', PAGER: 'Buscapersonas', UAN: 'UAN', SHARED_COST: 'Coste compartido',
};

module.exports = {
  id: 'phone.parse', label: 'Análisis de teléfono (offline)', accepts: ['phone'], order: 10,
  async run(entity, ctx) {
    if (!lib) { ctx.log('  libphonenumber no disponible'); return; }
    const raw = entity.value;
    // Sin "+": se interpreta como número nacional del país elegido en Ajustes (p. ej. 3001234567 → Colombia).
    const def = ((ctx.options && ctx.options.phoneCountry) || '').toUpperCase() || undefined;
    let pn = null;
    try { pn = raw.startsWith('+') ? lib.parsePhoneNumberFromString(raw) : lib.parsePhoneNumberFromString(raw, def); } catch (_) {}
    if ((!pn || !pn.isValid()) && !raw.startsWith('+')) {
      try { const alt = lib.parsePhoneNumberFromString('+' + raw); if (alt && alt.isValid()) pn = alt; } catch (_) {}
    }
    if (!pn) { ctx.log('  Teléfono: no se pudo interpretar. Escríbelo con prefijo (+57…) o elige tu país en Ajustes.'); return; }
    const country = pn.country || '??';
    const valid = pn.isValid();
    const type = pn.getType ? pn.getType() : null;
    ctx.node('location', country, { rel: 'país', source: 'libphonenumber', data: { prefijo: '+' + pn.countryCallingCode, valido: valid } });
    ctx.node('note', `${pn.formatInternational()} · ${TYPE_ES[type] || type || 'tipo n/d'}`, {
      rel: 'teléfono', source: 'libphonenumber',
      data: { internacional: pn.formatInternational(), nacional: pn.formatNational(), e164: pn.number, tipo: TYPE_ES[type] || type || 'n/d', valido: valid ? 'sí' : 'no', pais: country },
    });
    // Pivotes de busqueda manual (el numero suele filtrarse en anuncios, perfiles, leaks).
    const e164 = pn.number, natl = pn.formatNational().replace(/\s/g, '');
    for (const eng of [['Google', 'https://www.google.com/search?q='], ['Bing', 'https://www.bing.com/search?q=']]) {
      ctx.node('url', `${eng[1]}%22${encodeURIComponent(e164)}%22`, { rel: `buscar (${eng[0]})`, source: 'dork', label: `${eng[0]}: "${e164}"` });
    }
    ctx.log(`  Teléfono: ${pn.formatInternational()} · ${country} · ${TYPE_ES[type] || type || 'tipo n/d'} · ${valid ? 'válido' : 'NO válido'}`);
  },
};
