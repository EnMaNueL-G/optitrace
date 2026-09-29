'use strict';
/*
 * OptiTrace — motor de correlacion (el corazon de la herramienta).
 *
 * Modelo: cada MODULO es un "transform" que acepta uno o varios tipos de entidad y
 * produce nodos + aristas. Los hallazgos se integran en un GRAFO deduplicado, y
 * cualquier nodo puede volver a usarse como punto de partida (pivoteo) — eso es lo
 * que convierte una lista plana en una investigacion real estilo Maltego/SpiderFoot.
 *
 * El motor: descubre modulos, ejecuta los aplicables con un POOL de concurrencia,
 * emite eventos en vivo (logs, nodos, aristas, progreso) y cachea por entidad.
 */
const fs = require('fs');
const path = require('path');
const { nodeId, META } = require('./entities');
const http = require('./util/http');

class Graph {
  constructor() { this.nodes = new Map(); this.edges = new Map(); }
  addNode(type, value, extra = {}) {
    const id = nodeId(type, value);
    const prev = this.nodes.get(id);
    if (prev) { prev.data = { ...prev.data, ...(extra.data || {}) }; if (extra.label) prev.label = extra.label; return prev; }
    const m = META[type] || META.note;
    const n = { id, type, value, label: extra.label || value, icon: m.icon, color: m.color, data: extra.data || {}, source: extra.source || '', ts: Date.now() };
    this.nodes.set(id, n);
    return n;
  }
  addEdge(fromId, toId, label = '') {
    if (!fromId || !toId || fromId === toId) return;
    const key = `${fromId}->${toId}:${label}`;
    if (!this.edges.has(key)) this.edges.set(key, { from: fromId, to: toId, label });
  }
  toJSON() { return { nodes: [...this.nodes.values()], edges: [...this.edges.values()] }; }
}

class Engine {
  constructor() {
    this.modules = [];
    this.keys = {};       // claves BYOK (shodan, hibp, ...)
    this.cache = new Map();
    this._listeners = {};
  }

  loadModules(dir = path.join(__dirname, 'modules')) {
    this.modules = [];
    let files = [];
    try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.js')); } catch (_) {}
    for (const f of files) {
      try {
        const mod = require(path.join(dir, f));
        const arr = Array.isArray(mod) ? mod : [mod];
        for (const m of arr) if (m && m.id && typeof m.run === 'function') this.modules.push(m);
      } catch (e) { this.emit('log', `[!] módulo ${f} no cargó: ${e.message}`); }
    }
    this.modules.sort((a, b) => (a.order || 50) - (b.order || 50));
    return this.modules;
  }

  setKeys(k) { this.keys = k || {}; }
  setProxy(url) { return http.setProxy(url || ''); }

  on(ev, cb) { (this._listeners[ev] = this._listeners[ev] || []).push(cb); }
  emit(ev, payload) { for (const cb of (this._listeners[ev] || [])) { try { cb(payload); } catch (_) {} } }

  /** Modulos aplicables a una entidad, respetando si requieren clave BYOK. */
  applicable(type) {
    return this.modules.filter((m) => {
      const acc = m.accepts || [];
      if (!acc.includes(type) && !acc.includes('*')) return false;
      if (m.needsKey && !this.keys[m.needsKey]) return false;
      return true;
    });
  }

  /** ctx que recibe cada modulo. */
  _ctx(graph, originId, signal, options, mod) {
    const self = this;
    // Cliente HTTP con la señal de cancelación ya puesta: ningún módulo puede olvidarla.
    const withSig = (fn) => (url, o = {}) => fn(url, { ...o, signal: o.signal || signal });
    const shttp = signal ? { ...http, req: withSig(http.req), getJson: withSig(http.getJson), getText: withSig(http.getText), probe: withSig(http.probe) } : http;
    return {
      http: shttp,
      keys: this.keys,
      signal,
      options: options || {},
      progress: (done, total, extra) => self.emit('progress', { module: mod && mod.id, label: mod && mod.label, state: 'run', done, total, ...(extra || {}) }),
      log: (t) => self.emit('log', t),
      added: 0,
      node(type, value, extra = {}) {
        if (signal && signal.aborted) return null; // cancelada o limpiada: no pintar resultados tardíos
        if (value == null || String(value).trim() === '') return null;
        const before = graph.nodes.size;
        const n = graph.addNode(type, value, extra);
        if (graph.nodes.size > before) this.added++;
        self.emit('node', n);
        if (originId) { graph.addEdge(originId, n.id, extra.rel || ''); self.emit('edge', { from: originId, to: n.id, label: extra.rel || '' }); }
        return n;
      },
      edge(fromId, toId, label = '') { graph.addEdge(fromId, toId, label); self.emit('edge', { from: fromId, to: toId, label }); },
    };
  }

  /**
   * Ejecuta TODOS los transforms aplicables a una entidad (un paso de pivoteo).
   * @returns {Promise<{ran:number, found:number}>}
   */
  async expand(entity, graph, opts = {}) {
    const signal = opts.signal;
    const origin = graph.addNode(entity.type, entity.value, { source: 'seed', label: entity.value });
    this.emit('node', origin);
    const mods = this.applicable(entity.type);
    this.emit('log', `▸ ${entity.type}:${entity.value} — ${mods.length} módulo(s) aplicables`);
    let found = 0;
    // Pool de concurrencia: no saturar destinos ni la red.
    const limit = opts.concurrency || 6;
    let i = 0;
    const runOne = async () => {
      while (i < mods.length) {
        if (signal && signal.aborted) return;
        const m = mods[i++];
        const cacheKey = `${m.id}|${entity.type}:${entity.value}`;
        if (this.cache.has(cacheKey) && !opts.fresh) { this.emit('log', `  · ${m.label} (caché)`); continue; }
        const t0 = Date.now();
        try {
          this.emit('progress', { module: m.id, label: m.label, state: 'run' });
          const mctx = this._ctx(graph, origin.id, signal, opts.options, m);
          await m.run(entity, mctx);
          const delta = mctx.added;
          found += delta;
          if (signal && signal.aborted) return; // cancelada: no cachear un resultado incompleto
          this.cache.set(cacheKey, true);
          this.emit('progress', { module: m.id, label: m.label, state: 'done', ms: Date.now() - t0, found: delta });
        } catch (e) {
          this.emit('progress', { module: m.id, label: m.label, state: 'error', error: e.message });
          this.emit('log', `  [x] ${m.label}: ${e.message}`);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(limit, mods.length) }, runOne));
    return { ran: mods.length, found };
  }
}

module.exports = { Engine, Graph };
