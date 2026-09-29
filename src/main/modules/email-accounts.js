'use strict';
/*
 * OptiTrace — descubrimiento de cuentas por EMAIL (técnica tipo Holehe).
 * Comprueba endpoints públicos de registro/login para inferir si un email está dado
 * de alta en cada servicio. NO inicia sesión ni accede a datos privados: solo el
 * booleano existe/no-existe que el propio servicio expone durante el alta.
 *
 * Recetas adaptadas de Holehe (megadose/holehe, GPL-3.0). OptiTrace se distribuye
 * como GPL-3.0 con su código fuente público, así que esta reutilización es conforme a la licencia.
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
      const html = await pre.readText();
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
      let j; try { j = JSON.parse(await r.readText()); } catch (_) { return null; }
      if (j.error === false) return true;                        // Yahoo acepta el usuario → existe
      if (j.render && j.render.error === 'messages.ERROR_INVALID_USERNAME') return false;
      return null;
    },
  },
  {
    name: 'Xvideos', domain: 'xvideos.com', cat: 'adulto',
    async check(email, http) {
      const r = await http.req('https://www.xvideos.com/account/checkemail?email=' + encodeURIComponent(email),
        { timeout: 9000, headers: { 'X-Requested-With': 'XMLHttpRequest', Referer: 'https://www.xvideos.com/', Accept: 'application/json, text/javascript, */*; q=0.01' } });
      const t = await r.readText();
      // "ya en uso O su dueño lo excluyó": no distingue ambos casos → nunca afirmamos "registrado".
      if (/already in use or its owner has excluded/i.test(t)) return { used: true, ambiguous: true };
      try { const j = JSON.parse(t); if (j.result === true) return false; } catch (_) {}
      return null;
    },
  },
  {
    name: 'Xnxx', domain: 'xnxx.com', cat: 'adulto',
    async check(email, http) {
      let cookie = '';
      try { const pre = await http.req('https://www.xnxx.com', { timeout: 8000 }); cookie = jar(pre.headers.get('set-cookie')); pre.done(); } catch (_) {}
      const r = await http.req('https://www.xnxx.com/account/checkemail?email=' + encodeURIComponent(email),
        { timeout: 9000, headers: { 'X-Requested-With': 'XMLHttpRequest', Referer: 'https://www.xnxx.com/', ...(cookie ? { Cookie: cookie } : {}) } });
      const t = await r.readText();
      try { const j = JSON.parse(t); if (j.result === false && j.code === 1 && /utilis|already|in use/i.test(j.message || '')) return true; if (j.result === true) return false; } catch (_) {}
      return /utilis&eacute;|already in use/i.test(t) ? true : null;
    },
  },
  {
    name: 'Pornhub', domain: 'pornhub.com', cat: 'adulto',
    async check(email, http) {
      const page = await http.getText('https://www.pornhub.com/signup', { timeout: 10000 });
      if (!page) return null;
      const tok = (page.match(/name="token"[^>]*value="([^"]+)"/) || page.match(/value="([^"]+)"[^>]*name="token"/) || [])[1];
      if (!tok) return null;
      const r = await http.req('https://www.pornhub.com/user/create_account_check?token=' + encodeURIComponent(tok),
        { method: 'POST', timeout: 10000, headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' }, body: new URLSearchParams({ check_what: 'email', email }).toString() });
      const t = await r.readText();
      try { const j = JSON.parse(t); if (j.error_message === 'Email has been taken.') return true; if ('error_message' in j) return false; return null; } catch (_) { return /Email has been taken/i.test(t) ? true : null; }
    },
  },
  {
    name: 'Redtube', domain: 'redtube.com', cat: 'adulto',
    async check(email, http) {
      const pre = await http.req('https://redtube.com/register', { timeout: 10000 });
      const cookie = jar(pre.headers.get('set-cookie'));
      const page = await pre.readText();
      const tok = (page.match(/id="token"[^>]*value="([^"]+)"/) || page.match(/value="([^"]+)"[^>]*id="token"/) || [])[1];
      if (!tok) return null;
      const r = await http.req('https://www.redtube.com/user/create_account_check?token=' + encodeURIComponent(tok),
        { method: 'POST', timeout: 10000, headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest', Origin: 'https://redtube.com', ...(cookie ? { Cookie: cookie } : {}) }, body: new URLSearchParams({ token: tok, redirect: '', check_what: 'email', email }).toString() });
      const t = await r.readText();
      if (/Email has been taken/i.test(t)) return true;
      try { JSON.parse(t); return false; } catch (_) { return null; }
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
    // Sitios para adultos: revelan datos de vida sexual (dato sensible, RGPD art. 9 / Ley 1581 art. 5).
    // Solo se consultan si el usuario activa "categorías sensibles" en Ajustes.
    const providers = PROVIDERS.filter((p) => (ctx.options && ctx.options.sensitive) || p.cat !== 'adulto');
    ctx.log(`  Comprobando registro por email en ${providers.length} servicios…`);
    let hits = 0;
    await Promise.all(providers.map(async (p) => {
      if (ctx.signal && ctx.signal.aborted) return;
      let r; try { r = await p.check(email, ctx.http); } catch (_) { r = null; }
      const used = (r && typeof r === 'object') ? r.used : r;
      if (used === true) {
        hits++;
        const obj = (r && typeof r === 'object') ? r : {};
        const label = obj.ambiguous ? `${p.name} (registrado o excluido)` : `${p.name} (registrado)`;
        ctx.node('account', obj.profile || `https://${p.domain}`, { rel: p.cat, label, source: 'email', data: { servicio: p.name, registrado: obj.ambiguous ? 'probable (el sitio no distingue registrado de excluido)' : 'sí', perfil: obj.profile || `https://${p.domain}`, ...(p.cat === 'adulto' ? { sensible: true } : {}) } });
        if (obj.login) ctx.node('username', obj.login, { rel: 'usuario GitHub', source: 'github' });
        ctx.log(`   ✓ ${p.name}: registrado`);
      } else { ctx.log(`   · ${p.name}: ${used === false ? 'no' : 'no concluyente'}`); }
    }));
    ctx.node('url', `https://epieos.com/?q=${encodeURIComponent(email)}&t=email`, { rel: 'buscar más', source: 'pivote', label: 'Epieos (email→Google/redes)' });
    ctx.node('url', `https://haveibeenpwned.com/account/${encodeURIComponent(email)}`, { rel: 'buscar más', source: 'pivote', label: 'HaveIBeenPwned (web)' });
    ctx.log(`  Email: ${hits} registro(s) confirmado(s) por correo.`);
  },
};
