'use strict';
/*
 * OptiTrace — utilidades de red.
 * fetch con timeout (cabeceras Y cuerpo), cancelación por búsqueda, User-Agent rotatorio
 * y proxy opcional. Si el proxy no se puede usar, las peticiones FALLAN (nunca salen directas
 * mientras el usuario cree que van por el proxy).
 */

const UAS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0',
];
let _uaIdx = 0;
function ua() { _uaIdx = (_uaIdx + 1) % UAS.length; return UAS[_uaIdx]; }

let _proxyAgent = null;
let _proxyFetch = null;   // fetch de undici (el ProxyAgent debe usarse con su misma versión de fetch)
let _proxyError = '';
/** Configura un proxy http/https para las peticiones web. '' lo desactiva. Devuelve '' o el error. */
function setProxy(url) {
  _proxyAgent = null;
  _proxyFetch = null;
  _proxyError = '';
  if (!url) return '';
  try {
    if (!/^https?:\/\//i.test(url)) throw new Error('solo se admiten proxies http:// o https://');
    const { ProxyAgent, fetch: uFetch } = require('undici');
    _proxyAgent = new ProxyAgent(url);
    _proxyFetch = uFetch;
  } catch (e) { _proxyError = 'Proxy no válido: ' + e.message; }
  return _proxyError;
}
function proxyState() { return { active: !!_proxyAgent, error: _proxyError }; }

/**
 * fetch endurecido. El temporizador sigue activo mientras se lee el cuerpo:
 * usa res.readText() / res.readJson() / res.readBuffer(max) (o res.done() si no lo lees).
 * @param {string} url
 * @param {object} opts {timeout=12000, headers, method, body, signal, redirect}
 */
async function req(url, opts = {}) {
  if (_proxyError) throw new Error(_proxyError);
  const timeout = opts.timeout || 12000;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  const onAbort = () => ctrl.abort();
  if (opts.signal) {
    if (opts.signal.aborted) ctrl.abort();
    else opts.signal.addEventListener('abort', onAbort, { once: true });
  }
  const cleanup = () => { clearTimeout(t); if (opts.signal) opts.signal.removeEventListener('abort', onAbort); };
  try {
    const init = {
      method: opts.method || 'GET',
      headers: { 'User-Agent': ua(), 'Accept': '*/*', 'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8', ...(opts.headers || {}) },
      redirect: opts.redirect || 'follow',
      signal: ctrl.signal,
    };
    if (opts.body != null) init.body = opts.body;
    if (_proxyAgent) init.dispatcher = _proxyAgent;
    const res = await (_proxyFetch || fetch)(url, init);
    res.done = () => { cleanup(); try { res.body && res.body.cancel(); } catch (_) {} };
    res.readText = async () => { try { return await res.text(); } finally { cleanup(); } };
    res.readJson = async () => { try { return await res.json(); } finally { cleanup(); } };
    res.readBuffer = async (max = 30 * 1024 * 1024) => {
      try {
        const len = +res.headers.get('content-length') || 0;
        if (len > max) throw new Error('archivo demasiado grande');
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > max) throw new Error('archivo demasiado grande');
        return buf;
      } finally { cleanup(); }
    };
    return res;
  } catch (e) { cleanup(); throw e; }
}

/** GET que devuelve JSON o null si falla/!ok. */
async function getJson(url, opts = {}) {
  try {
    const res = await req(url, { ...opts, headers: { Accept: 'application/json', ...(opts.headers || {}) } });
    if (!res.ok) { res.done(); return null; }
    return await res.readJson();
  } catch (_) { return null; }
}

/** GET que devuelve texto o null. */
async function getText(url, opts = {}) {
  try {
    const res = await req(url, opts);
    if (!res.ok) { res.done(); return null; }
    return await res.readText();
  } catch (_) { return null; }
}

/** GET ligero: devuelve {status, ok, url, headers} sin descargar el cuerpo. */
async function probe(url, opts = {}) {
  try {
    const res = await req(url, { ...opts, method: opts.method || 'GET', redirect: opts.redirect || 'follow' });
    res.done();
    return { status: res.status, ok: res.ok, url: res.url, headers: res.headers };
  } catch (e) { return { status: 0, ok: false, url, error: e.name === 'AbortError' ? 'timeout' : e.message }; }
}

module.exports = { req, getJson, getText, probe, setProxy, proxyState, ua };
