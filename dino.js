/*
 * dino.js — "No internet" dino runner, auto-playing.
 * Original implementation (own pixel art + own physics); inspired by the Chrome offline game.
 *
 *   const game = new DinoGame(canvas, { mistakeRate: 0.04 });
 *   game.start();
 *
 * Options
 *   mistakeRate  probability (0..1) that the auto-player mistimes a jump (→ "game over", then auto-restart)
 *   auto         true = plays itself; false = Space / ArrowUp / click to jump
 *   color        main sprite colour
 *   rng          custom random function (for tests)
 */
(function (root) {
  'use strict';

  var W = 600, H = 150, GROUND = 128;
  var GRAVITY = 0.6, JUMP_V = 10.5;
  var JUMP_CENTER = JUMP_V / GRAVITY;     // frames from take-off to apex (jump is symmetric)
  var DINO_X = 30, DINO_PX = 2;

  // ---------- pixel art (own design) ----------
  var BODY = [
    '..........#########',
    '.........###########',
    '.........##.########',
    '.........###########',
    '.........###########',
    '.........#########',
    '.........########',
    '#........######',
    '#.......#######..#',
    '##.....########.##',
    '###...###########',
    '.###.############.',
    '.################.',
    '..###############.',
    '...##############.',
    '....############..',
    '.....##########...',
    '......########....'
  ];
  var LEGS = {
    stand: ['.....###..###.....', '.....###..###.....', '.....##...##......', '.....###..###.....'],
    runL:  ['.....###..###.....', '.....###...##.....', '.....##...........', '.....###..........'],
    runR:  ['.....###..###.....', '.....##...###.....', '..........##......', '..........###.....']
  };
  var DINO_W = 22 * DINO_PX;
  var DINO_H = (BODY.length + 4) * DINO_PX;

  function drawRows(ctx, rows, x, y, px) {
    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      for (var c = 0; c < row.length; c++) {
        if (row.charCodeAt(c) === 35) ctx.fillRect(x + c * px, y + r * px, px, px);
      }
    }
  }

  function drawDino(ctx, x, y, px, color, pose, dead) {
    ctx.fillStyle = color;
    drawRows(ctx, BODY, x, y, px);
    drawRows(ctx, LEGS[pose || 'stand'], x, y + BODY.length * px, px);
    if (dead) { // little "x" eye cut-out
      ctx.clearRect(x + 11 * px, y + 1 * px, 2 * px, 2 * px);
      ctx.fillStyle = color;
      ctx.fillRect(x + 11 * px, y + 1 * px, px, px);
      ctx.fillRect(x + 12 * px, y + 2 * px, px, px);
    }
  }

  // ---------- game ----------
  function DinoGame(canvas, opts) {
    this.cv = canvas || null;
    this.ctx = canvas && canvas.getContext ? canvas.getContext('2d') : null;
    this.o = Object.assign({ mistakeRate: 0.006, auto: true, color: '#535353', rng: Math.random }, opts || {});
    this.rng = this.o.rng;
    this.hi = 0;
    this.overs = 0;
    this.raf = 0;
    this.reset();
    if (canvas) { canvas.width = W; canvas.height = H; }
  }

  DinoGame.W = W; DinoGame.H = H; DinoGame.drawDino = drawDino;
  DinoGame.DINO = { w: DINO_W, h: DINO_H };

  var P = DinoGame.prototype;

  P.rand = function (a, b) { return a + this.rng() * (b - a); };

  P.reset = function () {
    this.state = 'run';
    this.frame = 0;
    this.speed = 6;
    this.score = 0;
    this.blink = 0;
    this.overTimer = 0;
    this.dino = { x: DINO_X, y: 0, vy: 0, air: false };
    this.obs = [];
    this.clearUntil = 150;
    this.plan = null;
    this.clouds = [];
    this.bumps = [];
    for (var i = 0; i < 4; i++) this.clouds.push({ x: this.rand(0, W), y: this.rand(14, 60) });
    for (var j = 0; j < 40; j++) this.bumps.push({ x: this.rand(0, W), y: GROUND + 3 + Math.floor(this.rand(0, 8)), w: 1 + Math.floor(this.rand(1, 6)) });
  };

  P.makeObstacle = function () {
    var r = this.rng(), o;
    if (this.score > 150 && r < 0.22) {
      var high = this.rng() < 0.4;
      o = { kind: 'bird', w: 40, h: 28, lift: high ? 62 : 4, extra: this.rand(0.4, 1.2), x: W + 10 };
    } else {
      var big = this.rng() < 0.4;
      var max = this.speed < 8 ? 2 : 3;
      var n = 1 + Math.floor(this.rng() * max);
      var cw = big ? 25 : 17, ch = big ? 50 : 35;
      o = { kind: 'cactus', big: big, n: n, cw: cw, w: n * cw + (n - 1) * 3, h: ch, lift: 0, extra: 0, x: W + 10 };
    }
    var minGap = Math.round(o.w * this.speed + 150);
    o.gap = this.rand(minGap, minGap * 1.5);
    if (o.kind === 'bird') o.gap += 200; // keep the air clear after a bird
    return o;
  };

  P.needsJump = function (o) {
    return (o.lift + 0) < DINO_H - 8; // bottom of obstacle lower than the dino's head
  };

  P.hit = function (o) {
    var d = this.dino;
    var dl = d.x + 8, dr = d.x + DINO_W - 4, db = d.y, dt = d.y + DINO_H - 4; // heights above ground
    var ol = o.x + 3, or = o.x + o.w - 3, ob = o.lift + 2, ot = o.lift + o.h - 3;
    return dl < or && dr > ol && db < ot && dt > ob;
  };

  P.autoPilot = function () {
    var d = this.dino;
    if (d.air) return;
    var next = null;
    for (var i = 0; i < this.obs.length; i++) {
      if (this.obs[i].x + this.obs[i].w > d.x + 10) { next = this.obs[i]; break; }
    }
    if (!next) return;
    if (!this.needsJump(next)) return;
    if (!this.plan || this.plan.ob !== next) {
      var off = this.rand(-2, 2);
      if (this.rng() < this.o.mistakeRate) off = (this.rng() < 0.5 ? 1 : -1) * this.rand(11, 15);
      this.plan = { ob: next, off: off };
    }
    var rel = this.speed + next.extra;
    var framesToCenter = ((next.x + next.w / 2) - (d.x + 24)) / rel;
    if (framesToCenter <= JUMP_CENTER + this.plan.off) this.jump();
  };

  P.jump = function () {
    if (this.dino.air || this.state !== 'run') return;
    this.dino.air = true;
    this.dino.vy = JUMP_V;
  };

  P.step = function () {
    this.frame++;
    if (this.state === 'over') {
      if (++this.overTimer > 110) this.reset();
      return;
    }
    var d = this.dino, i;
    if (this.o.auto) this.autoPilot();

    // dino physics
    if (d.air) {
      d.y += d.vy; d.vy -= GRAVITY;
      if (d.y <= 0) { d.y = 0; d.vy = 0; d.air = false; }
    }
    this.speed = Math.min(13, this.speed + 0.0014);
    this.score += this.speed * 0.025;

    // obstacles
    for (i = 0; i < this.obs.length; i++) this.obs[i].x -= this.speed + this.obs[i].extra;
    while (this.obs.length && this.obs[0].x + this.obs[0].w < -20) this.obs.shift();
    var last = this.obs[this.obs.length - 1];
    if (this.frame > this.clearUntil && (!last || last.x + last.w + last.gap < W)) this.obs.push(this.makeObstacle());

    // scenery
    for (i = 0; i < this.clouds.length; i++) {
      var c = this.clouds[i]; c.x -= 0.35;
      if (c.x < -50) { c.x = W + this.rand(20, 200); c.y = this.rand(14, 60); }
    }
    for (i = 0; i < this.bumps.length; i++) {
      var b = this.bumps[i]; b.x -= this.speed;
      if (b.x < -10) { b.x = W + this.rand(0, 40); b.y = GROUND + 3 + Math.floor(this.rand(0, 8)); b.w = 1 + Math.floor(this.rand(1, 6)); }
    }

    // collision
    for (i = 0; i < this.obs.length; i++) {
      if (this.hit(this.obs[i])) {
        this.state = 'over'; this.overTimer = 0; this.overs++;
        this.hi = Math.max(this.hi, Math.floor(this.score));
        return;
      }
    }
    if (Math.floor(this.score / 100) > Math.floor((this.score - this.speed * 0.025) / 100) && this.score > 50) this.blink = 40;
    if (this.blink > 0) this.blink--;
  };

  // ---------- rendering ----------
  function pad5(n) { n = String(Math.floor(n)); while (n.length < 5) n = '0' + n; return n; }

  P.drawCactus = function (ctx, o) {
    var ch = o.h, cw = o.cw, base = GROUND;
    for (var k = 0; k < o.n; k++) {
      var x = o.x + k * (cw + 3);
      var tw = Math.round(cw * 0.32), tx = x + Math.round((cw - tw) / 2);
      ctx.fillRect(tx, base - ch + 2, tw, ch - 2);          // trunk
      ctx.fillRect(tx + 1, base - ch, tw - 2, 2);            // rounded top
      var armW = Math.round(cw * 0.3), armT = base - Math.round(ch * 0.68), armH = Math.round(ch * 0.3);
      ctx.fillRect(x, armT, tx - x + 1, 3);                  // left arm
      ctx.fillRect(x, armT - armH + 3, armW - 1, armH);
      ctx.fillRect(tx + tw - 1, armT + 8, x + cw - (tx + tw) + 1, 3); // right arm
      ctx.fillRect(x + cw - armW + 1, armT + 8 - armH + 3, armW - 1, armH);
    }
  };

  P.drawBird = function (ctx, o) {
    var x = Math.round(o.x), y = GROUND - o.lift - o.h;
    var up = Math.floor(this.frame / 9) % 2 === 0;
    ctx.fillRect(x + 8, y + 12, 26, 8);        // body
    ctx.fillRect(x + 2, y + 12, 8, 4);         // beak
    ctx.fillRect(x, y + 13, 4, 2);
    ctx.fillRect(x + 30, y + 14, 8, 4);        // tail
    ctx.fillRect(x + 36, y + 12, 4, 3);
    ctx.fillRect(x + 6, y + 10, 6, 3);         // head bump
    if (up) {
      ctx.fillRect(x + 16, y + 6, 10, 6); ctx.fillRect(x + 20, y + 2, 8, 5); ctx.fillRect(x + 24, y, 6, 3);
    } else {
      ctx.fillRect(x + 16, y + 20, 10, 5); ctx.fillRect(x + 20, y + 24, 8, 4); ctx.fillRect(x + 24, y + 26, 6, 2);
    }
    ctx.clearRect(x + 10, y + 13, 2, 2);       // eye
  };

  P.render = function () {
    var ctx = this.ctx; if (!ctx) return;
    var col = this.o.color, i;
    ctx.clearRect(0, 0, W, H);

    ctx.fillStyle = '#dcdcdc';
    for (i = 0; i < this.clouds.length; i++) {
      var c = this.clouds[i], cx = Math.round(c.x), cy = Math.round(c.y);
      ctx.fillRect(cx + 10, cy, 26, 4); ctx.fillRect(cx + 4, cy + 4, 38, 4);
      ctx.fillRect(cx, cy + 8, 46, 5); ctx.fillRect(cx + 16, cy - 4, 12, 5);
    }

    ctx.fillStyle = col;
    ctx.fillRect(0, GROUND + 1, W, 1);
    ctx.fillStyle = '#8a8a8a';
    for (i = 0; i < this.bumps.length; i++) ctx.fillRect(Math.round(this.bumps[i].x), this.bumps[i].y, this.bumps[i].w, 1);

    ctx.fillStyle = col;
    for (i = 0; i < this.obs.length; i++) {
      var o = this.obs[i];
      if (o.kind === 'cactus') this.drawCactus(ctx, o); else this.drawBird(ctx, o);
    }

    var d = this.dino, pose = 'stand';
    if (!d.air && this.state === 'run') pose = Math.floor(this.frame / 6) % 2 ? 'runL' : 'runR';
    drawDino(ctx, d.x, Math.round(GROUND - DINO_H - d.y) + 1, DINO_PX, col, pose, this.state === 'over');

    // score
    ctx.font = 'bold 12px "Courier New", ui-monospace, monospace';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'right';
    ctx.fillStyle = '#8a8a8a';
    if (this.hi) ctx.fillText('HI ' + pad5(this.hi), W - 82, 6);
    var show = !(this.blink > 0 && Math.floor(this.blink / 6) % 2);
    if (show) { ctx.fillStyle = col; ctx.fillText(pad5(this.score), W - 8, 6); }

    if (this.state === 'over') {
      ctx.textAlign = 'center';
      ctx.fillStyle = col;
      ctx.font = 'bold 16px "Courier New", ui-monospace, monospace';
      ctx.fillText('G A M E   O V E R', W / 2, 40);
      // restart glyph
      var rx = W / 2, ry = 82;
      ctx.strokeStyle = col; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(rx, ry, 11, 0.5, 5.6); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(rx + 12, ry - 12); ctx.lineTo(rx + 13, ry - 2); ctx.lineTo(rx + 3, ry - 5); ctx.closePath(); ctx.fill();
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
    this.raf = requestAnimationFrame(loop);
    if (!this.o.auto && typeof window !== 'undefined') {
      window.addEventListener('keydown', function (e) { if (e.code === 'Space' || e.code === 'ArrowUp') { e.preventDefault(); self.jump(); } });
      if (this.cv) this.cv.addEventListener('pointerdown', function () { self.jump(); });
    }
  };

  P.stop = function () { if (this.raf && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(this.raf); };

  if (typeof module !== 'undefined' && module.exports) module.exports = { DinoGame: DinoGame };
  root.DinoGame = DinoGame;
})(typeof window !== 'undefined' ? window : globalThis);
