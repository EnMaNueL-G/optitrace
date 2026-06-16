'use strict';
/*
 * OptiTrace — utilidades de red.
 * fetch con timeout, User-Agent rotatorio y soporte de proxy opcional (privacidad).
 * Node 18+ trae fetch global; aqui le anadimos control de aborto y reintentos suaves.
 */

const UAS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0',
];
let _uaIdx = 0;
function ua() { _uaIdx = (_uaIdx + 1) % UAS.length; return UAS[_uaIdx]; }

let _proxyAgent = null;
/** Configura un proxy (http/https/socks) para TODO el trafico saliente. '' lo desactiva. */
function setProxy(url) {
  _proxyAgent = null;
  if (!url) return;
  try {
    // Soporte nativo de Node via undici ProxyAgent (http/https). SOCKS requeriria dep extra.
    const { ProxyAgent } = require('undici');
    _proxyAgent = new ProxyAgent(url);
  } catch (_) { _proxyAgent = null; }
}

/**
 * fetch endurecido.
 * @param {string} url
 * @param {object} opts {timeout=12000, headers, method, body, json, signal}
 */
async function req(url, opts = {}) {
  const timeout = opts.timeout || 12000;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  // Encadena una senal externa (cancelar toda la investigacion) con la del timeout.
  if (opts.signal) {
    if (opts.signal.aborted) ctrl.abort();
    else opts.signal.addEventListener('abort', () => ctrl.abort(), { once: true });
  }
  try {
    const init = {
      method: opts.method || 'GET',
      headers: { 'User-Agent': ua(), 'Accept': '*/*', ...(opts.headers || {}) },
      redirect: opts.redirect || 'follow',
      signal: ctrl.signal,
    };
    if (opts.body != null) init.body = opts.body;
    if (_proxyAgent) init.dispatcher = _proxyAgent;
    const res = await fetch(url, init);
    return res;
  } finally { clearTimeout(t); }
}

/** GET que devuelve JSON o null si falla/!ok. */
async function getJson(url, opts = {}) {
  try {
    const res = await req(url, { ...opts, headers: { Accept: 'application/json', ...(opts.headers || {}) } });
    if (!res.ok) return null;
    return await res.json();
  } catch (_) { return null; }
}

/** GET que devuelve texto o null. */
async function getText(url, opts = {}) {
  try {
    const res = await req(url, opts);
    if (!res.ok) return null;
    return await res.text();
  } catch (_) { return null; }
}

/** HEAD/GET ligero: devuelve {status, ok, url, headers} sin descargar todo el cuerpo. */
async function probe(url, opts = {}) {
  try {
    const res = await req(url, { ...opts, method: opts.method || 'GET', redirect: 'follow' });
    return { status: res.status, ok: res.ok, url: res.url, headers: res.headers };
  } catch (e) { return { status: 0, ok: false, url, error: e.name === 'AbortError' ? 'timeout' : e.message }; }
}

module.exports = { req, getJson, getText, probe, setProxy, ua };
