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
    for (const mx of (MX || [])) ctx.node('domain', mx.exchange.replace(/\.$/, ''), { rel: `MX ${mx.priority}`, source: 'dns' });
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
    const j = await ctx.http.getJson(`https://rdap.org/domain/${encodeURIComponent(d)}`, { timeout: 12000 });
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
    ctx.node('note', `${d} · WHOIS`, {
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
    const j = await ctx.http.getJson(`https://crt.sh/?q=%25.${encodeURIComponent(d)}&output=json`, { timeout: 20000 });
    if (!Array.isArray(j)) { ctx.log('  crt.sh: sin respuesta'); return; }
    const subs = new Set();
    for (const row of j) {
      for (const name of String(row.name_value || '').split('\n')) {
        const n = name.trim().toLowerCase().replace(/^\*\./, '');
        if (n && n.endsWith(d) && n !== d) subs.add(n);
      }
    }
    const list = [...subs].sort();
    for (const s of list.slice(0, 150)) ctx.node('subdomain', s, { rel: 'subdominio', source: 'crt.sh' });
    ctx.log(`  crt.sh: ${list.length} subdominio(s) únicos${list.length > 150 ? ' (mostrando 150)' : ''}`);
  },
};

module.exports = [dnsModule, rdapModule, crtModule];
