'use strict';
/*
 * OptiTrace — modulo DOMINIO (cero claves).
 *  - DNS completo (A/AAAA/MX/NS/TXT/SOA/CNAME) via resolver del sistema.
 *  - RDAP (WHOIS moderno en JSON) via rdap.org — registrador, fechas, estados.
 *  - Subdominios via crt.sh (transparencia de certificados) — fuente potentisima y gratis.
 */
const dns = require('dns').promises;

async function rrec(fn) { try { return await fn(); } catch (_) { return null; } }

const dnsModule = {
  id: 'domain.dns', label: 'DNS (A/MX/NS/TXT/SOA)', accepts: ['domain', 'subdomain'], order: 10,
  async run(entity, ctx) {
    const d = entity.value;
    const A = await rrec(() => dns.resolve4(d));
    const AAAA = await rrec(() => dns.resolve6(d));
    const MX = await rrec(() => dns.resolveMx(d));
    const NS = await rrec(() => dns.resolveNs(d));
    const TXT = await rrec(() => dns.resolveTxt(d));
    const CNAME = await rrec(() => dns.resolveCname(d));
    const SOA = await rrec(() => dns.resolveSoa(d));
    for (const ip of (A || [])) ctx.node('ip', ip, { rel: 'A', source: 'dns' });
    for (const ip of (AAAA || [])) ctx.node('ip', ip, { rel: 'AAAA', source: 'dns' });
    for (const mx of (MX || [])) if (mx.exchange && mx.exchange !== '.') ctx.node('domain', mx.exchange.replace(/\.$/, ''), { rel: `MX ${mx.priority}`, source: 'dns' });
    for (const ns of (NS || [])) ctx.node('domain', ns.replace(/\.$/, ''), { rel: 'NS', source: 'dns' });
    for (const c of (CNAME || [])) ctx.node('domain', c.replace(/\.$/, ''), { rel: 'CNAME', source: 'dns' });
    const txtFlat = (TXT || []).map((t) => Array.isArray(t) ? t.join('') : t);
    for (const t of txtFlat) {
      ctx.node('dns', t.slice(0, 80), { rel: 'TXT', source: 'dns', data: { full: t } });
      const m = t.match(/include:([a-z0-9._-]+)/ig); // SPF revela infra de correo
      if (m) for (const inc of m) ctx.node('domain', inc.split(':')[1], { rel: 'SPF include', source: 'spf' });
    }
    if (SOA && SOA.nsname) ctx.log(`  SOA: ${SOA.nsname} (admin: ${SOA.hostmaster})`);
    const total = (A || []).length + (AAAA || []).length + (MX || []).length + (NS || []).length;
    ctx.log(`  DNS: ${total} registro(s) resueltos`);
  },
};

const rdapModule = {
  id: 'domain.rdap', label: 'RDAP / WHOIS', accepts: ['domain'], order: 12,
  async run(entity, ctx) {
    const d = entity.value;
    const j = await ctx.http.getJson(`https://rdap.org/domain/${encodeURIComponent(d)}`, { timeout: 12000, signal: ctx.signal });
    if (!j) { ctx.log('  RDAP: sin datos (TLD no soportado o sin registro)'); return; }
    const events = {};
    for (const e of (j.events || [])) events[e.eventAction] = e.eventDate;
    let registrar = '';
    for (const e of (j.entities || [])) {
      if ((e.roles || []).includes('registrar')) {
        const v = (e.vcardArray && e.vcardArray[1]) || [];
        const fn = v.find((x) => x[0] === 'fn'); if (fn) registrar = fn[3];
      }
    }
    if (registrar) ctx.node('org', registrar, { rel: 'registrador', source: 'rdap' });
    const status = (j.status || []).join(', ');
    ctx.node('fact', `${d} · WHOIS`, {
      rel: 'whois', source: 'rdap',
      data: { registrar, status, registered: events.registration, expires: events.expiration, updated: events.lastChanged },
    });
    if (events.registration) ctx.log(`  RDAP: alta ${String(events.registration).slice(0, 10)} · caduca ${String(events.expiration || '?').slice(0, 10)} · ${registrar || 'registrador n/d'}`);
  },
};

const crtModule = {
  id: 'domain.crt', label: 'Subdominios (crt.sh)', accepts: ['domain'], order: 14,
  async run(entity, ctx) {
    const d = entity.value;
    const j = await ctx.http.getJson(`https://crt.sh/?q=%25.${encodeURIComponent(d)}&output=json`, { timeout: 25000, signal: ctx.signal });
    if (!Array.isArray(j)) { ctx.log('  crt.sh: sin respuesta'); return; }
    const subs = new Set();
    for (const row of j) {
      for (const name of String(row.name_value || '').split('\n')) {
        const n = name.trim().toLowerCase().replace(/^\*\./, '');
        if (n && n.endsWith('.' + d)) subs.add(n);
      }
    }
    const list = [...subs].sort();
    for (const s of list.slice(0, 150)) ctx.node('subdomain', s, { rel: 'subdominio', source: 'crt.sh' });
    ctx.log(`  crt.sh: ${list.length} subdominio(s) únicos${list.length > 150 ? ' (mostrando 150)' : ''}`);
  },
};

const waybackModule = {
  id: 'web.wayback', label: 'Historial web (Wayback Machine)', accepts: ['domain', 'url'], order: 16,
  async run(entity, ctx) {
    const target = entity.value.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    // API "available": la captura más cercana a 1990 (= la primera) y a hoy (= la última). Rápida y estable.
    const api = 'https://archive.org/wayback/available?url=' + encodeURIComponent(target);
    const pick = (j) => (j && j.archived_snapshots && j.archived_snapshots.closest && j.archived_snapshots.closest.available ? j.archived_snapshots.closest : null);
    const [f, l] = await Promise.all([
      ctx.http.getJson(api + '&timestamp=19900101', { timeout: 15000, signal: ctx.signal }).then(pick),
      ctx.http.getJson(api, { timeout: 15000, signal: ctx.signal }).then(pick),
    ]);
    if (!f && !l) { ctx.log('  Wayback: sin capturas archivadas'); return; }
    const fmt = (ts) => `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}`;
    const https = (u) => u.replace(/^http:\/\/web\.archive\.org/, 'https://web.archive.org');
    if (f) ctx.node('url', https(f.url), { rel: 'primera captura', source: 'Wayback', label: `Wayback: primera captura ${fmt(f.timestamp)}` });
    if (l && (!f || l.timestamp !== f.timestamp)) ctx.node('url', https(l.url), { rel: 'última captura', source: 'Wayback', label: `Wayback: última captura ${fmt(l.timestamp)}` });
    ctx.node('url', `https://web.archive.org/web/*/${target}*`, { rel: 'historial', source: 'Wayback', label: 'Wayback: ver todas las capturas' });
    ctx.log(`  Wayback: archivado${f ? ' desde ' + fmt(f.timestamp) : ''}${l ? ' hasta ' + fmt(l.timestamp) : ''}`);
  },
};

/** URL → su dominio (para pivotar al análisis del dominio). */
const urlDomainModule = {
  id: 'url.domain', label: 'Dominio de la URL', accepts: ['url'], order: 5,
  async run(entity, ctx) {
    try {
      const host = new URL(entity.value).hostname.toLowerCase();
      if (host) ctx.node('domain', host, { rel: 'dominio', source: 'url' });
    } catch (_) {}
  },
};

module.exports = [dnsModule, rdapModule, crtModule, waybackModule, urlDomainModule];
