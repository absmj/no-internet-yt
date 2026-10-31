/*
 * dino.js — "No internet" dino runner that plays itself.
 * Game logic is original; sprites come from https://github.com/dhhruv/Chrome-Dino-Runner (MIT)
 * (re-coloured to clean dark silhouettes, see assets/dino/).
 *
 *   const game = new DinoGame(canvas, { base: 'assets/dino/', mistakeRate: 0.006 });
 *   game.start();
 *
 * Options
 *   base         folder with the sprite PNGs
 *   mistakeRate  chance (0..1) per obstacle that the auto-player mistimes it (→ GAME OVER, then restarts)
 *   auto         true = plays itself; false = Space / ArrowUp jump, ArrowDown duck
 *   rng          custom random function (tests)
 */
(function (root) {
  'use strict';

  // Logical units are half sprite pixels (the canvas is drawn at 2x).
  var W = 600, H = 150, GROUND = 128, SCALE = 2;
  var GRAVITY = 0.6, JUMP_V = 10.5;
  var JUMP_CENTER = JUMP_V / GRAVITY;
  var DINO_X = 30, DINO_W = 44, DINO_H = 47, DUCK_W = 55, DUCK_H = 26;

  var NAMES = ['run1', 'run2', 'jump', 'dead', 'duck1', 'duck2', 'bird1', 'bird2',
    'cactus-s1', 'cactus-s2', 'cactus-s3', 'cactus-l1', 'cactus-l2', 'cactus-l3', 'gameover', 'reset', 'track'];

  function DinoGame(canvas, opts) {
    this.cv = canvas || null;
    this.ctx = canvas && canvas.getContext ? canvas.getContext('2d') : null;
    this.o = Object.assign({ base: 'assets/dino/', mistakeRate: 0.006, auto: true, rng: Math.random }, opts || {});
    this.rng = this.o.rng;
    this.hi = 0; this.overs = 0; this.raf = 0;
    this.img = {}; this.ready = false;
    this.size = {};
    // sprite sizes are known up-front so logic (and the headless test) works without loading images
    var S = { 'cactus-s1': [30, 66], 'cactus-s2': [64, 66], 'cactus-s3': [98, 66], 'cactus-l1': [46, 91], 'cactus-l2': [94, 91], 'cactus-l3': [98, 91], bird1: [84, 60], bird2: [84, 52] };
    for (var k in S) this.size[k] = S[k];
    this.reset();
    if (canvas) { canvas.width = W * SCALE; canvas.height = H * SCALE; }
  }
  DinoGame.W = W; DinoGame.H = H;
  var P = DinoGame.prototype;

  P.load = function () {
    var self = this, left = NAMES.length;
    return new Promise(function (res) {
      NAMES.forEach(function (n) {
        var im = new Image();
        im.onload = im.onerror = function () { if (--left === 0) { self.ready = true; res(); } };
        im.src = self.o.base + n + '.png';
        self.img[n] = im;
      });
    });
  };

  P.rand = function (a, b) { return a + this.rng() * (b - a); };

  P.reset = function () {
    this.state = 'run'; this.frame = 0; this.speed = 6; this.score = 0; this.blink = 0; this.overTimer = 0;
    this.dino = { x: DINO_X, y: 0, vy: 0, air: false, duck: false };
    this.obs = []; this.clearUntil = 130; this.plan = null; this.dist = 0;
  };

  // ---------- obstacles ----------
  P.makeObstacle = function () {
    var r = this.rng(), o;
    if (this.score > 120 && r < 0.26) {
      var t = this.rng(), lift = t < 0.3 ? 4 : (t < 0.7 ? 32 : 66);
      o = { kind: 'bird', lift: lift, extra: this.rand(0.4, 1.2), x: W + 10 };
      o.w = 42; o.h = 28;
    } else {
      var big = this.rng() < 0.4, n = 1 + Math.floor(this.rng() * (this.speed < 8 ? 2 : 3));
      var key = 'cactus-' + (big ? 'l' : 's') + n, s = this.size[key];
      o = { kind: 'cactus', key: key, lift: 0, extra: 0, x: W + 10, w: s[0] / 2, h: s[1] / 2 };
    }
    var minGap = Math.round(this.speed * 37 + 40);
    o.gap = this.rand(minGap, minGap * 1.5);
    if (o.kind === 'bird') o.gap += 200;
    return o;
  };

  P.needsJump = function (o) { return o.lift < DUCK_H - 2; };
  P.needsDuck = function (o) { return o.kind === 'bird' && o.lift >= DUCK_H - 2 && o.lift < DINO_H - 4; };

  P.hit = function (o) {
    var d = this.dino, w = d.duck ? DUCK_W : DINO_W, h = d.duck ? DUCK_H : DINO_H;
    var dl = d.x + 8, dr = d.x + w - 6, db = d.y, dt = d.y + h - 4;
    var ol = o.x + 3, or = o.x + o.w - 3, ob = o.lift + 2, ot = o.lift + o.h - 3;
    return dl < or && dr > ol && db < ot && dt > ob;
  };

  // ---------- the player ----------
  P.autoPilot = function () {
    var d = this.dino, next = null, i;
    for (i = 0; i < this.obs.length; i++) {
      if (this.obs[i].x + this.obs[i].w > d.x + 6) { next = this.obs[i]; break; }
    }
    if (!next) { d.duck = false; return; }
    if (!this.plan || this.plan.ob !== next) {
      var off = this.rand(-2, 2), bad = this.rng() < this.o.mistakeRate;
      if (bad) off = (this.rng() < 0.5 ? 1 : -1) * this.rand(11, 15);
      this.plan = { ob: next, off: off, bad: bad };
    }
    var rel = this.speed + next.extra;
    if (this.needsJump(next)) {
      d.duck = false;
      if (d.air) return;
      var f = ((next.x + next.w / 2) - (d.x + 24)) / rel;
      if (f <= JUMP_CENTER + this.plan.off) this.jump();
    } else if (this.needsDuck(next) && !d.air) {
      var near = next.x < d.x + DUCK_W + 16 * rel + this.plan.off;
      d.duck = near && !this.plan.bad;
    } else {
      d.duck = false;
    }
  };

  P.jump = function () {
    if (this.dino.air || this.state !== 'run') return;
    this.dino.air = true; this.dino.duck = false; this.dino.vy = JUMP_V;
  };

  P.step = function () {
    this.frame++;
    if (this.state === 'over') { if (++this.overTimer > 120) this.reset(); return; }
    var d = this.dino, i;
    if (this.o.auto) this.autoPilot();
    if (d.air) {
      d.y += d.vy; d.vy -= GRAVITY;
      if (this.manualDuck) d.vy -= 1.2;
      if (d.y <= 0) { d.y = 0; d.vy = 0; d.air = false; }
    }
    this.speed = Math.min(13, this.speed + 0.0014);
    this.score += this.speed * 0.025;
    this.dist += this.speed;

    for (i = 0; i < this.obs.length; i++) this.obs[i].x -= this.speed + this.obs[i].extra;
    while (this.obs.length && this.obs[0].x + this.obs[0].w < -20) this.obs.shift();
    var last = this.obs[this.obs.length - 1];
    if (this.frame > this.clearUntil && (!last || last.x + last.w + last.gap < W)) this.obs.push(this.makeObstacle());

    for (i = 0; i < this.obs.length; i++) {
      if (this.hit(this.obs[i])) {
        this.state = 'over'; this.overTimer = 0; this.overs++;
        this.hi = Math.max(this.hi, Math.floor(this.score));
        d.duck = false;
        return;
      }
    }
    if (Math.floor(this.score / 100) > Math.floor((this.score - this.speed * 0.025) / 100) && this.score > 50) this.blink = 40;
    if (this.blink > 0) this.blink--;
  };

  // ---------- rendering ----------
  function pad5(n) { n = String(Math.floor(n)); while (n.length < 5) n = '0' + n; return n; }

  P.sprite = function (ctx, name, x, bottomY) {
    var im = this.img[name]; if (!im || !im.naturalWidth) return;
    var w = im.naturalWidth / 2, h = im.naturalHeight / 2;
    ctx.drawImage(im, Math.round(x), Math.round(bottomY - h), w, h);
  };

  P.render = function () {
    var ctx = this.ctx; if (!ctx || !this.ready) return;
    ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = true;
    var i;

    // ground track (scrolls)
    var tr = this.img.track;
    if (tr && tr.naturalWidth) {
      var tw = tr.naturalWidth / 2, off = -(this.dist % tw);
      ctx.drawImage(tr, off, GROUND - 1, tw, tr.naturalHeight / 2);
      ctx.drawImage(tr, off + tw, GROUND - 1, tw, tr.naturalHeight / 2);
    }

    for (i = 0; i < this.obs.length; i++) {
      var o = this.obs[i];
      if (o.kind === 'cactus') this.sprite(ctx, o.key, o.x, GROUND);
      else this.sprite(ctx, (Math.floor(this.frame / 9) % 2) ? 'bird1' : 'bird2', o.x, GROUND - o.lift);
    }

    var d = this.dino, name;
    if (this.state === 'over') name = 'dead';
    else if (d.air) name = 'jump';
    else if (d.duck) name = (Math.floor(this.frame / 6) % 2) ? 'duck1' : 'duck2';
    else name = (Math.floor(this.frame / 6) % 2) ? 'run1' : 'run2';
    this.sprite(ctx, name, d.x, GROUND - d.y + 1);

    ctx.font = 'bold 13px "Courier New", ui-monospace, monospace';
    ctx.textBaseline = 'top'; ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(40,40,40,.55)';
    if (this.hi) ctx.fillText('HI ' + pad5(this.hi), W - 92, 10);
    if (!(this.blink > 0 && Math.floor(this.blink / 6) % 2)) { ctx.fillStyle = '#1c1c1c'; ctx.fillText(pad5(this.score), W - 12, 10); }

    if (this.state === 'over') {
      var g = this.img.gameover, r = this.img.reset;
      if (g && g.naturalWidth) ctx.drawImage(g, W / 2 - g.naturalWidth / 4, 38, g.naturalWidth / 2, g.naturalHeight / 2);
      if (r && r.naturalWidth) ctx.drawImage(r, W / 2 - r.naturalWidth / 4, 66, r.naturalWidth / 2, r.naturalHeight / 2);
    }
  };

  // ---------- loop ----------
  P.start = function () {
    var self = this, last = 0, acc = 0, STEP = 1000 / 60;
    if (typeof requestAnimationFrame === 'undefined') return;
    function loop(t) {
      self.raf = requestAnimationFrame(loop);
      if (!last) last = t;
      acc += Math.min(100, t - last); last = t;
      while (acc >= STEP) { self.step(); acc -= STEP; }
      self.render();
    }
    this.load().then(function () { self.raf = requestAnimationFrame(loop); });
    if (!this.o.auto && typeof window !== 'undefined') {
      window.addEventListener('keydown', function (e) {
        if (e.code === 'Space' || e.code === 'ArrowUp') { e.preventDefault(); self.jump(); }
        if (e.code === 'ArrowDown') { self.dino.duck = !self.dino.air; self.manualDuck = self.dino.air; }
      });
      window.addEventListener('keyup', function (e) { if (e.code === 'ArrowDown') { self.dino.duck = false; self.manualDuck = false; } });
      if (this.cv) this.cv.addEventListener('pointerdown', function () { self.jump(); });
    }
  };
  P.stop = function () { if (this.raf && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(this.raf); };

  if (typeof module !== 'undefined' && module.exports) module.exports = { DinoGame: DinoGame };
  root.DinoGame = DinoGame;
})(typeof window !== 'undefined' ? window : globalThis);
