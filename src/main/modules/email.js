'use strict';
/*
 * OptiTrace — modulo EMAIL.
 *  - Validez de dominio via MX (¿puede recibir correo?).
 *  - Gravatar: avatar + perfil publico (revela nombre, ubicacion, cuentas vinculadas).
 *  - Pivote a username (parte local) para busqueda cruzada en sitios.
 *  - HaveIBeenPwned (brechas) SOLO si hay clave BYOK (modulo aparte mas abajo).
 */
const dns = require('dns').promises;
const crypto = require('crypto');

const emailCore = {
  id: 'email.core', label: 'Email: MX + Gravatar', accepts: ['email'], order: 10,
  async run(entity, ctx) {
    const email = entity.value.toLowerCase();
    const [local, domain] = email.split('@');
    // MX
    let mx = null;
    try { mx = await dns.resolveMx(domain); } catch (_) {}
    if (mx && mx.length) {
      mx.sort((a, b) => a.priority - b.priority);
      ctx.node('domain', domain, { rel: 'dominio', source: 'email' });
      ctx.node('note', `MX de ${domain}`, { rel: 'recibe correo', source: 'mx', data: { servidores: mx.map((m) => `${m.exchange}(${m.priority})`).join(', ') } });
      ctx.log(`  MX: ${domain} → ${mx[0].exchange} (${mx.length} servidor/es) · puede recibir correo`);
    } else { ctx.log(`  MX: ${domain} sin registros — probablemente no recibe correo`); }

    // Gravatar (perfil publico vinculado al hash del email)
    const hash = crypto.createHash('md5').update(email).digest('hex');
    const av = await ctx.http.probe(`https://www.gravatar.com/avatar/${hash}?d=404`, { timeout: 8000 });
    if (av.ok) {
      ctx.node('image', `https://www.gravatar.com/avatar/${hash}?s=256`, { rel: 'avatar Gravatar', source: 'gravatar', label: 'Avatar (Gravatar)' });
      const prof = await ctx.http.getJson(`https://www.gravatar.com/${hash}.json`, { timeout: 8000 });
      const e = prof && prof.entry && prof.entry[0];
      if (e) {
        if (e.displayName || (e.name && e.name.formatted)) ctx.node('person', e.displayName || e.name.formatted, { rel: 'nombre (Gravatar)', source: 'gravatar' });
        if (e.currentLocation) ctx.node('location', e.currentLocation, { rel: 'ubicación (Gravatar)', source: 'gravatar' });
        for (const acc of (e.accounts || [])) if (acc.url) ctx.node('account', acc.url, { rel: acc.shortname || 'cuenta', label: acc.shortname || acc.domain, source: 'gravatar' });
        for (const u of (e.urls || [])) if (u.value) ctx.node('url', u.value, { rel: 'enlace', source: 'gravatar', label: u.title || u.value });
        ctx.log(`  Gravatar: perfil público encontrado${e.displayName ? ' (' + e.displayName + ')' : ''}`);
      } else ctx.log('  Gravatar: avatar existe (sin perfil público detallado)');
    } else ctx.log('  Gravatar: sin avatar asociado');

    // Pivote: parte local como posible usuario
    if (/^[a-z0-9._-]{3,}$/i.test(local)) ctx.node('username', local, { rel: 'posible usuario', source: 'email' });
  },
};

const emailHibp = {
  id: 'email.hibp', label: 'Brechas (HaveIBeenPwned)', accepts: ['email'], order: 12, needsKey: 'hibp',
  async run(entity, ctx) {
    const key = ctx.keys.hibp;
    const j = await ctx.http.getJson(`https://haveibeenpwned.com/api/v3/breachedaccount/${encodeURIComponent(entity.value)}?truncateResponse=false`,
      { timeout: 12000, headers: { 'hibp-api-key': key, 'user-agent': 'OptiTrace' } });
    if (!Array.isArray(j)) { ctx.log('  HIBP: sin brechas conocidas (o clave inválida)'); return; }
    for (const b of j) ctx.node('breach', b.Name, { rel: 'brecha', source: 'HIBP', label: `${b.Name} (${(b.BreachDate || '').slice(0, 4)})`, data: { fecha: b.BreachDate, datos: (b.DataClasses || []).join(', '), cuentas: b.PwnCount } });
    ctx.log(`  HIBP: ⚠ ${j.length} brecha(s) — ${j.map((b) => b.Name).slice(0, 6).join(', ')}`);
  },
};

module.exports = [emailCore, emailHibp];
