'use strict';
/*
 * OptiTrace — grafo force-directed en canvas (sin dependencias).
 * Simulacion de fuerzas: repulsion (Coulomb), atraccion por aristas (Hooke) y
 * gravedad al centro. Soporta arrastrar nodos, zoom con rueda, paneo y clic para
 * pivotar. Disenado para miles de nodos con rendimiento fluido (requestAnimationFrame).
 */
class TraceGraph {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.nodes = new Map();   // id -> {id,type,label,icon,color,x,y,vx,vy,fixed,r}
    this.edges = [];          // {from,to,label}
    this.scale = 1; this.ox = 0; this.oy = 0;
    this.dragging = null; this.panning = false; this.hover = null;
    this.onSelect = opts.onSelect || (() => {});
    this.onPivot = opts.onPivot || (() => {});
    this._bind();
    this._loop = this._loop.bind(this);
    this.active = false;
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const r = this.canvas.getBoundingClientRect();
    this.canvas.width = r.width * dpr; this.canvas.height = r.height * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.W = r.width; this.H = r.height;
    if (this.ox === 0 && this.oy === 0) { this.ox = this.W / 2; this.oy = this.H / 2; }
  }

  clear() { this.nodes.clear(); this.edges = []; }

  addNode(n) {
    if (this.nodes.has(n.id)) { const e = this.nodes.get(n.id); e.label = n.label || e.label; return e; }
    const ang = Math.random() * Math.PI * 2, rad = 30 + Math.random() * 120;
    const node = { ...n, x: Math.cos(ang) * rad, y: Math.sin(ang) * rad, vx: 0, vy: 0, fixed: false, r: n.seed ? 14 : 9 };
    this.nodes.set(n.id, node);
    return node;
  }
  addEdge(e) {
    if (this.edges.some((x) => x.from === e.from && x.to === e.to && x.label === e.label)) return;
    this.edges.push({ from: e.from, to: e.to, label: e.label || '' });
  }
  setData(g) {
    this.clear();
    for (const n of g.nodes) this.addNode({ ...n, seed: n.source === 'seed' });
    for (const e of g.edges) this.addEdge(e);
  }

  /* ---------- fisica ---------- */
  _tick() {
    const ns = [...this.nodes.values()];
    const K_REP = 1600, K_SPR = 0.02, LEN = 90, GRAV = 0.012, DAMP = 0.85;
    for (let i = 0; i < ns.length; i++) {
      const a = ns[i];
      for (let j = i + 1; j < ns.length; j++) {
        const b = ns[j];
        let dx = a.x - b.x, dy = a.y - b.y; let d2 = dx * dx + dy * dy || 0.01;
        const d = Math.sqrt(d2); const f = K_REP / d2;
        const fx = (dx / d) * f, fy = (dy / d) * f;
        a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
      }
    }
    for (const e of this.edges) {
      const a = this.nodes.get(e.from), b = this.nodes.get(e.to);
      if (!a || !b) continue;
      const dx = b.x - a.x, dy = b.y - a.y; const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const f = (d - LEN) * K_SPR;
      const fx = (dx / d) * f, fy = (dy / d) * f;
      a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
    }
    for (const n of ns) {
      n.vx -= n.x * GRAV; n.vy -= n.y * GRAV;
      if (n === this.dragging || n.fixed) { n.vx = 0; n.vy = 0; continue; }
      n.vx *= DAMP; n.vy *= DAMP;
      n.x += n.vx; n.y += n.vy;
    }
  }

  /* ---------- render ---------- */
  _toScreen(n) { return { x: n.x * this.scale + this.ox, y: n.y * this.scale + this.oy }; }
  _fromScreen(px, py) { return { x: (px - this.ox) / this.scale, y: (py - this.oy) / this.scale }; }

  /** Pausa el cálculo mientras el mapa está oculto (el bucle O(n²) no debe gastar CPU en segundo plano). */
  setActive(on) {
    const was = this.active;
    this.active = !!on;
    if (this.active && !was) requestAnimationFrame(this._loop);
  }

  _loop() {
    if (!this.active) return;
    this._tick();
    const c = this.ctx;
    c.clearRect(0, 0, this.W, this.H);
    // aristas
    c.lineWidth = 1; c.strokeStyle = 'rgba(124,140,180,0.22)';
    c.beginPath();
    for (const e of this.edges) {
      const a = this.nodes.get(e.from), b = this.nodes.get(e.to);
      if (!a || !b) continue;
      const pa = this._toScreen(a), pb = this._toScreen(b);
      c.moveTo(pa.x, pa.y); c.lineTo(pb.x, pb.y);
    }
    c.stroke();
    // nodos
    for (const n of this.nodes.values()) {
      const p = this._toScreen(n); const r = n.r * Math.max(0.7, this.scale);
      c.beginPath(); c.arc(p.x, p.y, r, 0, Math.PI * 2);
      c.fillStyle = n.color || '#7c5cff'; c.globalAlpha = n === this.hover ? 1 : 0.92; c.fill();
      c.globalAlpha = 1;
      if (n === this.hover || n.seed) { c.lineWidth = 2; c.strokeStyle = '#fff'; c.stroke(); }
      if (this.scale > 0.55) {
        c.font = `${Math.round(11 * Math.max(0.8, this.scale))}px Segoe UI, sans-serif`;
        c.fillStyle = '#dfe6f5'; c.textAlign = 'center';
        const lbl = (n.label || n.value || '').slice(0, 26);
        c.fillText(`${n.icon || ''} ${lbl}`.trim(), p.x, p.y + r + 12);
      }
    }
    requestAnimationFrame(this._loop);
  }

  _nodeAt(px, py) {
    for (const n of [...this.nodes.values()].reverse()) {
      const p = this._toScreen(n); const r = (n.r + 4) * Math.max(0.7, this.scale);
      if ((px - p.x) ** 2 + (py - p.y) ** 2 <= r * r) return n;
    }
    return null;
  }

  _bind() {
    const cv = this.canvas;
    let lastX = 0, lastY = 0, downX = 0, downY = 0, moved = false;
    const pos = (ev) => { const r = cv.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; };
    cv.addEventListener('mousedown', (ev) => {
      const p = pos(ev); downX = p.x; downY = p.y; moved = false;
      const n = this._nodeAt(p.x, p.y);
      if (n) { this.dragging = n; n.fixed = true; } else { this.panning = true; }
      lastX = p.x; lastY = p.y;
    });
    window.addEventListener('mousemove', (ev) => {
      const p = pos(ev);
      if (Math.abs(p.x - downX) + Math.abs(p.y - downY) > 4) moved = true;
      if (this.dragging) { const w = this._fromScreen(p.x, p.y); this.dragging.x = w.x; this.dragging.y = w.y; }
      else if (this.panning) { this.ox += p.x - lastX; this.oy += p.y - lastY; }
      else { this.hover = this._nodeAt(p.x, p.y); cv.style.cursor = this.hover ? 'pointer' : 'default'; }
      lastX = p.x; lastY = p.y;
    });
    window.addEventListener('mouseup', (ev) => {
      const p = pos(ev); const n = this._nodeAt(p.x, p.y);
      if (this.dragging) { this.dragging.fixed = false; }
      if (!moved && n) this.onSelect(n);
      this.dragging = null; this.panning = false;
    });
    cv.addEventListener('dblclick', (ev) => { const p = pos(ev); const n = this._nodeAt(p.x, p.y); if (n) this.onPivot(n); });
    cv.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      const p = pos(ev); const before = this._fromScreen(p.x, p.y);
      this.scale *= ev.deltaY < 0 ? 1.1 : 0.9; this.scale = Math.min(3, Math.max(0.2, this.scale));
      const after = this._fromScreen(p.x, p.y);
      this.ox += (after.x - before.x) * this.scale; this.oy += (after.y - before.y) * this.scale;
    }, { passive: false });
  }

  fit() {
    const ns = [...this.nodes.values()]; if (!ns.length) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of ns) { minX = Math.min(minX, n.x); minY = Math.min(minY, n.y); maxX = Math.max(maxX, n.x); maxY = Math.max(maxY, n.y); }
    const w = maxX - minX || 1, h = maxY - minY || 1;
    this.scale = Math.min(2, 0.85 * Math.min(this.W / w, this.H / h));
    this.ox = this.W / 2 - ((minX + maxX) / 2) * this.scale;
    this.oy = this.H / 2 - ((minY + maxY) / 2) * this.scale;
  }
}
window.TraceGraph = TraceGraph;
