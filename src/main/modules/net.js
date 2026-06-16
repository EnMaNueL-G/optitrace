'use strict';
/*
 * OptiTrace — modulo RED / IP (cero claves).
 *  - Geolocalizacion + ASN + organizacion via ip-api.com (gratis, sin clave).
 *  - DNS inverso (PTR) para revelar el hostname asociado.
 */
const dns = require('dns').promises;

const ipGeo = {
  id: 'net.ipapi', label: 'Geo/ASN (ip-api)', accepts: ['ip'], order: 10,
  async run(entity, ctx) {
    const ip = entity.value;
    const fields = 'status,message,country,countryCode,regionName,city,zip,lat,lon,isp,org,as,asname,reverse,mobile,proxy,hosting,query';
    const j = await ctx.http.getJson(`http://ip-api.com/json/${encodeURIComponent(ip)}?fields=${fields}`, { timeout: 10000 });
    if (!j || j.status !== 'success') { ctx.log(`  ip-api: ${j && j.message ? j.message : 'sin datos'}`); return; }
    if (j.country) {
      const loc = [j.city, j.regionName, j.country].filter(Boolean).join(', ');
      ctx.node('location', loc, { rel: 'ubicación', source: 'ip-api', data: { lat: j.lat, lon: j.lon, zip: j.zip, cc: j.countryCode } });
    }
    if (j.as) {
      const asNum = (j.as.match(/AS\d+/) || [])[0] || j.as;
      ctx.node('asn', asNum, { rel: 'ASN', source: 'ip-api', label: `${asNum} ${j.asname || ''}`.trim(), data: { isp: j.isp, org: j.org } });
    }
    if (j.org && j.org !== j.isp) ctx.node('org', j.org, { rel: 'organización', source: 'ip-api' });
    const flags = [];
    if (j.proxy) flags.push('proxy/VPN');
    if (j.hosting) flags.push('hosting/datacenter');
    if (j.mobile) flags.push('red móvil');
    ctx.log(`  ip-api: ${[j.city, j.country].filter(Boolean).join(', ')} · ${j.isp || ''}${flags.length ? ' · ⚠ ' + flags.join(', ') : ''}`);
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

module.exports = [ipGeo, ipPtr];
