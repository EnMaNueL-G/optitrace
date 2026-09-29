'use strict';
/*
 * OptiTrace — modulo USERNAME basado en el dataset de MAIGRET (MIT).
 * Atribución: Maigret — https://github.com/soxoj/maigret (licencia MIT, ver data/MAIGRET-LICENSE.txt).
 *
 * Implementa el algoritmo de comprobación de Maigret:
 *  - checkType status_code  → existe si HTTP 2xx.
 *  - checkType message      → existe si aparecen presenseStrs y NO absenceStrs.
 *  - checkType response_url → existe si responde 2xx SIN redirigir (Maigret no sigue redirecciones).
 *  - engines (foros XenForo/phpBB/vBulletin/Discourse/…) → heredan su checkType y cadenas.
 *  - errors (Cloudflare, login obligatorio, captcha…) → resultado "no concluyente", nunca "sí".
 *  - regexCheck valida el formato del usuario antes de pedir (precisión + eficiencia).
 * Ordena por alexaRank (los sitios populares primero → los hallazgos importantes salen antes).
 */
const fs = require('fs');
const path = require('path');

/** Etiquetas que revelan datos sensibles (vida sexual, citas). Solo se consultan si el usuario lo activa. */
const SENSITIVE_TAGS = new Set(['porn', 'dating', 'webcam', 'adult', 'erotic', 'escort', 'sex']);

let DATA = null;
function load() {
  if (DATA) return DATA;
  const cands = [
    path.join(__dirname, '..', '..', '..', 'data', 'maigret-data.json'),
    process.resourcesPath ? path.join(process.resourcesPath, 'data', 'maigret-data.json') : null,
    path.join(process.cwd(), 'data', 'maigret-data.json'),
  ].filter(Boolean);
  for (const c of cands) { try { if (fs.existsSync(c)) { DATA = JSON.parse(fs.readFileSync(c, 'utf8')); break; } } catch (_) {} }
  if (!DATA) { DATA = { sites: {}, engines: {}, _list: [] }; return DATA; }
  const engines = DATA.engines || {};
  const list = [];
  for (const [name, raw] of Object.entries(DATA.sites || {})) {
    if (raw.disabled) continue;
    const eng = raw.engine && engines[raw.engine] ? (engines[raw.engine].site || {}) : {};
    const cfg = { ...eng, ...raw };
    const main = String(cfg.urlMain || '').replace(/\/+$/, '');
    const fill = (u) => String(u || '').replace(/\{urlMain\}/g, main).replace(/\{urlSubpath\}/g, cfg.urlSubpath || '');
    const url = fill(cfg.urlProbe || cfg.url);
    if (!url || !/\{username\}/.test(url) || !/^https?:\/\//i.test(url)) continue;
    const tags = raw.tags || [];
    list.push({
      name,
      url,
      checkType: cfg.checkType || 'status_code',
      presence: cfg.presenseStrs || [],
      absence: cfg.absenceStrs || [],
      errors: Object.keys(cfg.errors || {}),
      ignore403: !!cfg.ignore403,
      headers: cfg.headers || null,
      regex: cfg.regexCheck ? safeRe(cfg.regexCheck) : null,
      rank: typeof raw.alexaRank === 'number' ? raw.alexaRank : 9e9,
      tags,
      sensitive: tags.some((t) => SENSITIVE_TAGS.has(t)),
      profileUrl: fill(cfg.url),
    });
  }
  list.sort((a, b) => a.rank - b.rank);
  DATA._list = list;
  return DATA;
}
function safeRe(s) { try { return new RegExp(s); } catch (_) { return null; } }

/** @returns {{state:'yes'|'no'|'unknown'|'skip', profile?:string}} */
async function check(site, user, http, signal) {
  if (site.regex && !site.regex.test(user)) return { state: 'skip' };
  const enc = encodeURIComponent(user);
  const url = site.url.replace(/\{username\}/g, enc);
  const profile = site.profileUrl.replace(/\{username\}/g, enc);
  try {
    const manual = site.checkType === 'response_url';
    const res = await http.req(url, { timeout: 8000, signal, redirect: manual ? 'manual' : 'follow', headers: site.headers || {} });
    const status = res.status;
    if (status === 429 || status === 503 || (status === 403 && !site.ignore403)) { res.done(); return { state: 'unknown' }; }
    if (site.checkType === 'status_code') {
      res.done();
      return { state: status >= 200 && status < 300 ? 'yes' : 'no', profile };
    }
    if (site.checkType === 'response_url') {
      res.done();
      return { state: status >= 200 && status < 300 ? 'yes' : 'no', profile };
    }
    // message
    let body = '';
    try { body = await res.readText(); } catch (_) { return { state: 'unknown' }; }
    if (!body) return { state: 'unknown' };
    if (site.errors.some((s) => body.includes(s))) return { state: 'unknown' };
    const presOk = site.presence.length === 0 ? (status >= 200 && status < 300) : site.presence.some((s) => body.includes(s));
    const absPresent = site.absence.some((s) => body.includes(s));
    return { state: presOk && !absPresent ? 'yes' : 'no', profile };
  } catch (_) { return { state: 'unknown' }; }
}

module.exports = {
  id: 'user.maigret', label: 'Cuentas en sitios (Maigret)', accepts: ['username'], order: 10,
  SENSITIVE_TAGS,
  count() { return (load()._list || []).length; },
  async run(entity, ctx) {
    const user = entity.value;
    const opt = ctx.options || {};
    const sites = (load()._list || []).filter((s) => opt.sensitive || !s.sensitive);
    if (!sites.length) { ctx.log('  Maigret: dataset no encontrado (data/maigret-data.json)'); return; }
    // Por defecto los 1500 sitios más populares (lo relevante en ~1 min). Ajustes → "Todos".
    const env = process.env.OPTITRACE_MAIGRET_LIMIT;
    const cap = env != null ? parseInt(env, 10) : (typeof opt.maigretLimit === 'number' ? opt.maigretLimit : 1500);
    const list = cap > 0 ? sites.slice(0, cap) : sites;
    const alias = !!entity.alias;
    ctx.log(`  Buscando "${user}" en ${list.length} sitios (Maigret)${opt.sensitive ? '' : ' · sin categorías sensibles'}…`);
    let i = 0, hits = 0, unknown = 0, done = 0;
    const CONC = 50;
    const worker = async () => {
      while (i < list.length) {
        if (ctx.signal && ctx.signal.aborted) return;
        const site = list[i++];
        const r = await check(site, user, ctx.http, ctx.signal);
        if (ctx.signal && ctx.signal.aborted) return; // cancelada: no contar lo que quedó a medias
        done++;
        if (r.state === 'unknown') unknown++;
        if (done % 250 === 0) ctx.progress && ctx.progress(done, list.length);
        if (r.state === 'yes') {
          hits++;
          ctx.node('account', r.profile, {
            rel: alias ? 'mismo alias (posible)' : (site.tags[0] || 'cuenta'),
            label: site.name, source: 'Maigret',
            data: { servicio: site.name, categoria: (site.tags || []).join(', '), url: r.profile, ...(alias ? { alias: true } : {}), ...(site.sensitive ? { sensible: true } : {}) },
          });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONC, list.length) }, worker));
    ctx.progress && ctx.progress(done, list.length, { unknown, final: true });
    ctx.log(`  Maigret: ${hits} cuenta(s) en ${done} sitios · ${unknown} no concluyentes (bloqueo/antibot/red).`);
  },
};
