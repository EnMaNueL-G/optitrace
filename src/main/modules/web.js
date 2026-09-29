'use strict';
/*
 * OptiTrace — modulo WEB y CORREO del dominio (cero claves).
 *  - Seguridad del correo: SPF y DMARC (¿se puede suplantar el dominio en un correo?).
 *  - Certificado TLS: emisor, validez, días hasta caducar y otros dominios del mismo certificado.
 *  - Cabeceras HTTP: servidor, tecnología, título y cabeceras de seguridad presentes/ausentes.
 *  - URLScan.io (búsqueda pública): análisis previos del sitio con IP, país y captura.
 */
const dns = require('dns').promises;
const tls = require('tls');
const net = require('net');

function hostOf(entity) {
  if (entity.type === 'url') { try { return new URL(entity.value).hostname.toLowerCase(); } catch (_) { return ''; } }
  return entity.value.toLowerCase();
}

const mailSecurity = {
  id: 'mail.security', label: 'Seguridad del correo (SPF/DMARC)', accepts: ['domain'], order: 13,
  async run(entity, ctx) {
    const d = entity.value;
    const flat = (rr) => (rr || []).map((t) => (Array.isArray(t) ? t.join('') : t));
    let txt = [], dmarc = [];
    try { txt = flat(await dns.resolveTxt(d)); } catch (_) {}
    try { dmarc = flat(await dns.resolveTxt('_dmarc.' + d)); } catch (_) {}
    const spf = txt.find((t) => /^v=spf1/i.test(t));
    const dm = dmarc.find((t) => /^v=DMARC1/i.test(t));
    const policy = dm ? ((dm.match(/;\s*p=([a-z]+)/i) || [])[1] || '?').toLowerCase() : null;
    const spfAll = spf ? ((spf.match(/([~?+-])all\b/) || [])[1] || '') : '';
    const spfTxt = !spf ? 'sin SPF' : spfAll === '-' ? 'SPF estricto (-all)' : spfAll === '~' ? 'SPF suave (~all)' : 'SPF permisivo';
    const dmTxt = !dm ? 'sin DMARC' : `DMARC p=${policy}`;
    const spoofable = !dm || policy === 'none' || !spf;
    ctx.node('fact', `${d} · Correo: ${spfTxt} · ${dmTxt}`, {
      rel: 'seguridad del correo', source: 'dns',
      data: { spf: spf || '—', dmarc: dm || '—', riesgo: spoofable ? 'alguien podría enviar correos falsos en nombre de este dominio' : 'protegido contra suplantación' },
    });
    ctx.log(`  Correo: ${spfTxt} · ${dmTxt}${spoofable ? ' · ⚠ suplantable' : ''}`);
  },
};

const tlsCert = {
  id: 'web.tls', label: 'Certificado TLS', accepts: ['domain', 'subdomain', 'url'], order: 15,
  async run(entity, ctx) {
    const host = hostOf(entity);
    if (!host) return;
    // Conexión directa al sitio: con un proxy configurado se omite, para no revelar la IP real.
    const ps = ctx.http.proxyState ? ctx.http.proxyState() : { active: false, error: '' };
    if (ps.active || ps.error) { ctx.log('  TLS: omitido porque hay un proxy configurado (esta consulta no puede ir por el proxy)'); return; }
    if (ctx.signal && ctx.signal.aborted) return;
    const cert = await new Promise((resolve) => {
      let done = false;
      const opts = { host, port: 443, rejectUnauthorized: false, timeout: 8000 };
      if (!net.isIP(host)) opts.servername = host;
      const sock = tls.connect(opts, () => {
        const c = sock.getPeerCertificate(false);
        finish(c && c.valid_to ? { ...c, authorized: sock.authorized, authError: sock.authorizationError } : null);
      });
      const onAbort = () => finish(null);
      function finish(v) {
        if (done) return; done = true;
        sock.destroy();
        if (ctx.signal) ctx.signal.removeEventListener('abort', onAbort);
        resolve(v);
      }
      sock.on('error', () => finish(null));
      sock.on('timeout', () => finish(null));
      if (ctx.signal) ctx.signal.addEventListener('abort', onAbort, { once: true });
    });
    if (!cert) { ctx.log('  TLS: el sitio no responde por HTTPS (puerto 443)'); return; }
    const to = new Date(cert.valid_to);
    const days = Math.round((to - Date.now()) / 86400000);
    const issuer = (cert.issuer && (cert.issuer.O || cert.issuer.CN)) || '?';
    const sans = String(cert.subjectaltname || '').split(',').map((s) => s.trim().replace(/^DNS:/, '').replace(/^\*\./, '').toLowerCase()).filter(Boolean);
    ctx.node('fact', `${host} · Certificado: ${issuer} · caduca en ${days} días`, {
      rel: 'certificado', source: 'tls',
      data: { emisor: issuer, desde: cert.valid_from, hasta: cert.valid_to, valido: cert.authorized ? 'sí' : `no (${cert.authError || 'no confiable'})`, dominios: sans.slice(0, 40).join(', ') },
    });
    const base = host.split('.').slice(-2).join('.');
    for (const s of [...new Set(sans)].filter((s) => s !== host && !s.endsWith('.' + base) && s !== base).slice(0, 25)) {
      ctx.node('domain', s, { rel: 'mismo certificado', source: 'tls' });
    }
    ctx.log(`  TLS: ${issuer} · caduca ${to.toISOString().slice(0, 10)} (${days} días)${cert.authorized ? '' : ' · ⚠ no confiable'}`);
  },
};

const SEC_HEADERS = [
  ['strict-transport-security', 'HSTS'], ['content-security-policy', 'CSP'], ['x-frame-options', 'X-Frame-Options'],
  ['x-content-type-options', 'X-Content-Type-Options'], ['referrer-policy', 'Referrer-Policy'], ['permissions-policy', 'Permissions-Policy'],
];

const httpHeaders = {
  id: 'web.headers', label: 'Web: cabeceras y tecnología', accepts: ['domain', 'subdomain', 'url'], order: 16,
  async run(entity, ctx) {
    const url = entity.type === 'url' ? entity.value : `https://${entity.value}/`;
    let res;
    try { res = await ctx.http.req(url, { timeout: 12000, headers: { Accept: 'text/html,*/*' } }); } catch (_) { ctx.log('  Web: no responde'); return; }
    let html = '';
    try { html = (await res.readText()).slice(0, 400000); } catch (_) {}
    const h = res.headers;
    const title = ((html.match(/<title[^>]*>([^<]{1,200})<\/title>/i) || [])[1] || '').replace(/\s+/g, ' ').trim();
    const gen = (html.match(/<meta[^>]+name=["']generator["'][^>]+content=["']([^"']{1,80})/i) || [])[1] || '';
    const present = SEC_HEADERS.filter(([k]) => h.get(k)).map(([, n]) => n);
    const missing = SEC_HEADERS.filter(([k]) => !h.get(k)).map(([, n]) => n);
    const tech = [h.get('server'), h.get('x-powered-by'), gen].filter(Boolean).join(' · ');
    ctx.node('fact', `${(() => { try { return new URL(url).hostname; } catch (_) { return url; } })()} · Web: ${title || '(sin título)'}`, {
      rel: 'página web', source: 'http',
      data: {
        estado: res.status, url_final: res.url, tecnologia: tech || '—',
        cabeceras_seguridad: present.join(', ') || 'ninguna', faltan: missing.join(', ') || 'ninguna',
      },
    });
    if (res.url && res.url !== url) {
      try { const fh = new URL(res.url).hostname.toLowerCase(); if (fh && fh !== new URL(url).hostname.toLowerCase()) ctx.node('domain', fh, { rel: 'redirige a', source: 'http' }); } catch (_) {}
    }
    ctx.log(`  Web: HTTP ${res.status}${tech ? ' · ' + tech : ''} · seguridad ${present.length}/${SEC_HEADERS.length}`);
  },
};

const urlscan = {
  id: 'web.urlscan', label: 'Análisis previos (URLScan.io)', accepts: ['domain'], order: 17,
  async run(entity, ctx) {
    const j = await ctx.http.getJson(`https://urlscan.io/api/v1/search/?q=page.domain:${encodeURIComponent(entity.value)}&size=8`, { timeout: 15000 });
    const rs = (j && Array.isArray(j.results)) ? j.results : [];
    if (!rs.length) { ctx.log('  URLScan: sin análisis públicos'); return; }
    const ips = new Set();
    for (const r of rs) {
      const p = r.page || {};
      if (p.ip) ips.add(p.ip);
      ctx.node('url', `https://urlscan.io/result/${r._id}/`, {
        rel: 'análisis URLScan', source: 'URLScan',
        label: `URLScan ${String((r.task && r.task.time) || '').slice(0, 10)}: ${p.url || p.domain || ''}`.slice(0, 120),
        data: { ip: p.ip, pais: p.country, servidor: p.server, captura: r.screenshot },
      });
    }
    for (const ip of [...ips].slice(0, 5)) ctx.node('ip', ip, { rel: 'IP vista en URLScan', source: 'URLScan' });
    ctx.log(`  URLScan: ${j.total || rs.length} análisis públicos (mostrando ${rs.length})`);
  },
};

module.exports = [mailSecurity, tlsCert, httpHeaders, urlscan];
