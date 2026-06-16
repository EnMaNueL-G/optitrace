'use strict';
/*
 * OptiTrace — descubrimiento de cuentas por EMAIL (técnica tipo Holehe).
 * Comprueba endpoints públicos de registro/login para inferir si un email está dado
 * de alta en cada servicio. NO inicia sesión ni accede a datos privados: solo el
 * booleano existe/no-existe que el propio servicio expone durante el alta.
 *
 * Recetas adaptadas de Holehe (megadose/holehe, GPL-3.0). OptiTrace se distribuye
 * como GPL-3.0, por lo que esta reutilización es conforme a la licencia.
 *
 * Cada proveedor devuelve true (registrado), false (no), o null (no concluyente).
 */

function jar(setCookie) {
  if (!setCookie) return '';
  return setCookie.split(/,(?=[^;]+=)/).map((c) => c.split(';')[0].trim()).join('; ');
}

const PROVIDERS = [
  {
    name: 'Yahoo', domain: 'yahoo.com', cat: 'correo',
    async check(email, http) {
      const pre = await http.req('https://login.yahoo.com', { timeout: 10000 });
      const html = await pre.text();
      const acrumb = (html.split('name="acrumb" value="')[1] || '').split('"')[0];
      const sessionIndex = (html.split('name="sessionIndex" value="')[1] || '').split('"')[0];
      if (!acrumb) return null;
      const cookie = jar(pre.headers.get('set-cookie'));
      const body = new URLSearchParams({ acrumb, sessionIndex, username: email, passwd: '', signin: 'Next', persistent: 'y' }).toString();
      const r = await http.req('https://login.yahoo.com/?.src=fpctx&.intl=ca&.lang=en-CA&.done=https%3A%2F%2Fca.yahoo.com', {
        method: 'POST', timeout: 11000,
        headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest', Origin: 'https://login.yahoo.com', Cookie: cookie },
        body,
      });
      let j; try { j = JSON.parse(await r.text()); } catch (_) { return null; }
      if ('error' in j) return !j.error;                       // error falsy → existe
      if (j.render && j.render.error === 'messages.ERROR_INVALID_USERNAME') return false;
      return null;
    },
  },
  {
    name: 'Xvideos', domain: 'xvideos.com', cat: 'adulto',
    async check(email, http) {
      const r = await http.req('https://www.xvideos.com/account/checkemail?email=' + encodeURIComponent(email),
        { timeout: 9000, headers: { 'X-Requested-With': 'XMLHttpRequest', Referer: 'https://www.xvideos.com/', Accept: 'application/json, text/javascript, */*; q=0.01' } });
      const t = await r.text();
      if (/already in use or its owner has excluded/i.test(t)) return true;
      try { const j = JSON.parse(t); if (j.result === true) return false; } catch (_) {}
      return false;
    },
  },
  {
    name: 'Xnxx', domain: 'xnxx.com', cat: 'adulto',
    async check(email, http) {
      let cookie = '';
      try { const pre = await http.req('https://www.xnxx.com', { timeout: 8000 }); cookie = jar(pre.headers.get('set-cookie')); } catch (_) {}
      const r = await http.req('https://www.xnxx.com/account/checkemail?email=' + encodeURIComponent(email),
        { timeout: 9000, headers: { 'X-Requested-With': 'XMLHttpRequest', Referer: 'https://www.xnxx.com/', ...(cookie ? { Cookie: cookie } : {}) } });
      const t = await r.text();
      try { const j = JSON.parse(t); if (j.result === false && j.code === 1 && /utilis|already|in use/i.test(j.message || '')) return true; if (j.result === true) return false; } catch (_) {}
      return /utilis&eacute;|already in use/i.test(t) ? true : false;
    },
  },
  {
    name: 'Spotify', domain: 'spotify.com', cat: 'música',
    async check(email, http) {
      const t = await http.getText('https://spclient.wg.spotify.com/signup/public/v1/account?validate=1&email=' + encodeURIComponent(email), { timeout: 9000 });
      if (t == null) return null;
      if (/"status"\s*:\s*20/.test(t)) return true;
      if (/"status"\s*:\s*1\b/.test(t)) return false;
      return null;
    },
  },
  {
    name: 'Twitter / X', domain: 'twitter.com', cat: 'social',
    async check(email, http) {
      const j = await http.getJson('https://api.twitter.com/i/users/email_available.json?email=' + encodeURIComponent(email),
        { timeout: 9000, headers: { Referer: 'https://twitter.com/' } });
      if (!j || typeof j.taken === 'undefined') return null;
      return j.taken === true;
    },
  },
  {
    name: 'Duolingo', domain: 'duolingo.com', cat: 'educación',
    async check(email, http) {
      const j = await http.getJson('https://www.duolingo.com/2017-06-30/users?email=' + encodeURIComponent(email), { timeout: 8000 });
      if (!j) return null;
      return Array.isArray(j.users) ? j.users.length > 0 : null;
    },
  },
  {
    name: 'GitHub', domain: 'github.com', cat: 'código',
    async check(email, http) {
      const j = await http.getJson('https://api.github.com/search/users?q=' + encodeURIComponent(email) + '+in:email', { timeout: 8000, headers: { Accept: 'application/vnd.github+json' } });
      if (!j || typeof j.total_count !== 'number') return null;
      if (j.total_count > 0 && j.items && j.items[0]) return { used: true, profile: j.items[0].html_url, login: j.items[0].login };
      return false;
    },
  },
];

module.exports = {
  id: 'email.accounts', label: 'Cuentas por email (tipo Holehe)', accepts: ['email'], order: 11,
  async run(entity, ctx) {
    const email = entity.value.toLowerCase();
    ctx.log(`  Comprobando registro por email en ${PROVIDERS.length} servicios…`);
    let hits = 0;
    await Promise.all(PROVIDERS.map(async (p) => {
      if (ctx.signal && ctx.signal.aborted) return;
      let r; try { r = await p.check(email, ctx.http); } catch (_) { r = null; }
      const used = (r && typeof r === 'object') ? r.used : r;
      if (used === true) {
        hits++;
        const obj = (r && typeof r === 'object') ? r : {};
        ctx.node('account', obj.profile || `https://${p.domain}`, { rel: p.cat, label: `${p.name} (registrado)`, source: 'email', data: { servicio: p.name, registrado: 'sí', perfil: obj.profile || `https://${p.domain}` } });
        if (obj.login) ctx.node('username', obj.login, { rel: 'usuario GitHub', source: 'github' });
        ctx.log(`   ✓ ${p.name}: registrado`);
      } else { ctx.log(`   · ${p.name}: ${used === false ? 'no' : 'no concluyente'}`); }
    }));
    ctx.node('url', `https://epieos.com/?q=${encodeURIComponent(email)}&t=email`, { rel: 'buscar más', source: 'pivote', label: 'Epieos (email→Google/redes)' });
    ctx.node('url', `https://haveibeenpwned.com/account/${encodeURIComponent(email)}`, { rel: 'buscar más', source: 'pivote', label: 'HaveIBeenPwned (web)' });
    ctx.log(`  Email: ${hits} registro(s) confirmado(s) por correo.`);
  },
};
