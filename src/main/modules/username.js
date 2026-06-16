'use strict';
/*
 * OptiTrace — modulo USERNAME basado en el dataset de MAIGRET (MIT, ~3161 sitios).
 * Atribución: Maigret — https://github.com/soxoj/maigret (licencia MIT).
 *
 * Implementa el algoritmo de comprobación de Maigret:
 *  - checkType status_code  → existe si HTTP 200.
 *  - checkType message      → existe si aparecen presenseStrs y NO absenceStrs.
 *  - checkType response_url → existe si no redirige a la página de error.
 *  - engines (foros XenForo/phpBB/vBulletin/Discourse/…) → se resuelven a uno de los anteriores.
 *  - regexCheck valida el formato del usuario antes de pedir (precisión + eficiencia).
 * Ordena por alexaRank (los sitios populares primero → los hallazgos importantes salen antes).
 */
const fs = require('fs');
const path = require('path');

let DATA = null;
function load() {
  if (DATA) return DATA;
  const cands = [
    path.join(__dirname, '..', '..', '..', 'data', 'maigret-data.json'),
    process.resourcesPath ? path.join(process.resourcesPath, 'data', 'maigret-data.json') : null,
    path.join(process.cwd(), 'data', 'maigret-data.json'),
  ].filter(Boolean);
  for (const c of cands) { try { if (fs.existsSync(c)) { DATA = JSON.parse(fs.readFileSync(c, 'utf8')); break; } } catch (_) {} }
  if (!DATA) { DATA = { sites: {}, engines: {} }; return DATA; }
  // Pre-compone la lista ordenada por popularidad, ya resuelta.
  const engines = DATA.engines || {};
  const engCT = (name) => {
    if (/redirect/i.test(name)) return 'response_url';
    if (/404get|^engine404$/i.test(name)) return 'status_code';
    return 'message'; // 404message + software de foros (presence/absence)
  };
  const list = [];
  for (const [name, raw] of Object.entries(DATA.sites || {})) {
    if (raw.disabled) continue;
    const eng = raw.engine && engines[raw.engine] ? (engines[raw.engine].site || {}) : {};
    const cfg = { ...eng, ...raw };
    const url = cfg.urlProbe || cfg.url;
    if (!url || !/\{username\}/.test(url)) continue;
    list.push({
      name,
      url,
      checkType: raw.checkType || (raw.engine ? engCT(raw.engine) : 'status_code'),
      presence: cfg.presenseStrs || [],
      absence: cfg.absenceStrs || [],
      headers: cfg.headers || null,
      regex: cfg.regexCheck ? safeRe(cfg.regexCheck) : null,
      rank: typeof raw.alexaRank === 'number' ? raw.alexaRank : 9e9,
      tags: raw.tags || [],
      profileUrl: cfg.url,
    });
  }
  list.sort((a, b) => a.rank - b.rank);
  DATA._list = list;
  return DATA;
}
function safeRe(s) { try { return new RegExp(s); } catch (_) { return null; } }

async function check(site, user, http, signal) {
  if (site.regex && !site.regex.test(user)) return { hit: false, skip: true };
  const url = site.url.replace(/\{username\}/g, encodeURIComponent(user));
  const profile = (site.profileUrl || site.url).replace(/\{username\}/g, encodeURIComponent(user));
  try {
    const res = await http.req(url, { timeout: 8000, signal, redirect: 'follow', headers: site.headers || {} });
    const status = res.status;
    if (site.checkType === 'status_code') return { hit: status >= 200 && status < 300, profile };
    if (site.checkType === 'response_url') {
      const ok = status >= 200 && status < 300 && (!res.redirected || (res.url || '').toLowerCase().includes(user.toLowerCase()));
      return { hit: ok, profile };
    }
    // message
    let body = '';
    try { body = await res.text(); } catch (_) { body = ''; }
    if (!body) return { hit: false, profile };
    const presOk = site.presence.length === 0 ? (status >= 200 && status < 300) : site.presence.some((s) => body.includes(s));
    const absPresent = site.absence.some((s) => body.includes(s));
    return { hit: presOk && !absPresent, profile };
  } catch (_) { return { hit: false, profile }; }
}

module.exports = {
  id: 'user.maigret', label: 'Cuentas en sitios (Maigret 3000+)', accepts: ['username'], order: 10,
  async run(entity, ctx) {
    const user = entity.value;
    const data = load();
    const sites = data._list || [];
    if (!sites.length) { ctx.log('  Maigret: dataset no encontrado (data/maigret-data.json)'); return; }
    // Por defecto, los 1500 sitios más populares (cubre todo lo relevante en ~60s con streaming).
    // El resto son foros muy nicho. Override con OPTITRACE_MAIGRET_LIMIT (0 = todos).
    const env = process.env.OPTITRACE_MAIGRET_LIMIT;
    const cap = env != null ? parseInt(env, 10) : 1500;
    const list = cap > 0 ? sites.slice(0, cap) : sites;
    ctx.log(`  Buscando "${user}" en ${list.length} sitios (Maigret)…`);
    let i = 0, hits = 0, done = 0;
    const CONC = 50;
    const worker = async () => {
      while (i < list.length) {
        if (ctx.signal && ctx.signal.aborted) return;
        const site = list[i++];
        const r = await check(site, user, ctx.http, ctx.signal);
        done++;
        if (done % 200 === 0) ctx.log(`   …${done}/${list.length} (${hits} encontrados)`);
        if (r.hit) {
          hits++;
          ctx.node('account', r.profile, { rel: (site.tags[0] || 'cuenta'), label: site.name, source: 'Maigret', data: { servicio: site.name, categoria: (site.tags || []).join(', '), url: r.profile } });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONC, list.length) }, worker));
    ctx.log(`  Maigret: ${hits} cuenta(s) de ${list.length} sitios.`);
  },
};
