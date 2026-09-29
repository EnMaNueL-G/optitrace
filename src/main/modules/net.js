'use strict';
/*
 * OptiTrace — modulo RED / IP (cero claves, todo por HTTPS).
 *  - Geolocalizacion aproximada + ASN + proveedor via ipwho.is.
 *  - RDAP de la IP (registro oficial del bloque: titular y rango) via rdap.org.
 *  - DNS inverso (PTR) para revelar el hostname asociado.
 *  - Shodan InternetDB (sin clave): puertos abiertos, etiquetas y CVE conocidos del escaneo público.
 */
const dns = require('dns').promises;

const ipGeo = {
  id: 'net.ipwho', label: 'Geo/ASN (ipwho.is)', accepts: ['ip'], order: 10,
  async run(entity, ctx) {
    const j = await ctx.http.getJson(`https://ipwho.is/${encodeURIComponent(entity.value)}`, { timeout: 10000, signal: ctx.signal });
    if (!j || j.success !== true) { ctx.log(`  ipwho.is: ${j && j.message ? j.message : 'sin datos'}`); return; }
    const loc = [j.city, j.region, j.country].filter(Boolean).join(', ');
    if (loc) ctx.node('location', loc, { rel: 'ubicación aproximada', source: 'ipwho.is', data: { lat: j.latitude, lon: j.longitude, cc: j.country_code, nota: 'la geolocalización por IP es aproximada (ciudad o región)' } });
    const c = j.connection || {};
    if (c.asn) ctx.node('asn', `AS${c.asn}`, { rel: 'ASN', source: 'ipwho.is', label: `AS${c.asn} ${c.org || ''}`.trim(), data: { isp: c.isp, org: c.org, dominio: c.domain } });
    if (c.isp && c.isp !== c.org) ctx.node('org', c.isp, { rel: 'proveedor', source: 'ipwho.is' });
    ctx.log(`  ipwho.is: ${[j.city, j.country].filter(Boolean).join(', ')} · ${c.isp || c.org || ''}`);
  },
};

const ipRdap = {
  id: 'net.rdap', label: 'RDAP de la IP (titular del bloque)', accepts: ['ip'], order: 11,
  async run(entity, ctx) {
    const j = await ctx.http.getJson(`https://rdap.org/ip/${encodeURIComponent(entity.value)}`, { timeout: 12000, signal: ctx.signal });
    if (!j) { ctx.log('  RDAP IP: sin datos'); return; }
    let holder = '';
    for (const e of (j.entities || [])) {
      if ((e.roles || []).some((r) => r === 'registrant' || r === 'administrative')) {
        const fn = ((e.vcardArray && e.vcardArray[1]) || []).find((x) => x[0] === 'fn');
        if (fn) { holder = fn[3]; break; }
      }
    }
    if (holder) ctx.node('org', holder, { rel: 'titular del bloque', source: 'rdap' });
    ctx.node('note', `Bloque ${j.startAddress || '?'} – ${j.endAddress || '?'}`, { rel: 'red', source: 'rdap', data: { nombre: j.name, handle: j.handle, titular: holder } });
    ctx.log(`  RDAP IP: ${j.name || ''} ${j.startAddress || ''}–${j.endAddress || ''}${holder ? ' · ' + holder : ''}`);
  },
};

const ipPtr = {
  id: 'net.ptr', label: 'DNS inverso (PTR)', accepts: ['ip'], order: 12,
  async run(entity, ctx) {
    try {
      const names = await dns.reverse(entity.value);
      for (const n of (names || [])) ctx.node('domain', n.replace(/\.$/, ''), { rel: 'PTR', source: 'reverse-dns' });
      if (names && names.length) ctx.log(`  PTR: ${names.join(', ')}`);
    } catch (_) { ctx.log('  PTR: sin registro inverso'); }
  },
};

const ipInternetDb = {
  id: 'net.internetdb', label: 'Puertos y CVE (Shodan InternetDB)', accepts: ['ip'], order: 13,
  async run(entity, ctx) {
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(entity.value)) return; // solo IPv4
    const j = await ctx.http.getJson(`https://internetdb.shodan.io/${entity.value}`, { timeout: 10000, signal: ctx.signal });
    if (!j || !Array.isArray(j.ports)) { ctx.log('  InternetDB: sin datos de escaneo para esta IP'); return; }
    if (j.ports.length) ctx.node('fact', `Puertos abiertos: ${j.ports.join(', ')}`, { rel: 'puertos', source: 'Shodan InternetDB', data: { puertos: j.ports.join(', '), etiquetas: (j.tags || []).join(', ') } });
    for (const h of (j.hostnames || []).slice(0, 20)) ctx.node('domain', h, { rel: 'hostname', source: 'Shodan InternetDB' });
    for (const v of (j.vulns || []).slice(0, 30)) ctx.node('url', `https://nvd.nist.gov/vuln/detail/${v}`, { rel: 'CVE conocido', source: 'Shodan InternetDB', label: v });
    ctx.log(`  InternetDB: ${j.ports.length} puerto(s)${(j.vulns || []).length ? ' · ⚠ ' + j.vulns.length + ' CVE' : ''}${(j.tags || []).length ? ' · ' + j.tags.join(', ') : ''}`);
  },
};

module.exports = [ipGeo, ipRdap, ipPtr, ipInternetDb];
