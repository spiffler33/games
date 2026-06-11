/* Strike! Bowling — a flick-to-bowl game for kids */
'use strict';

/* ============================== helpers ============================== */
const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

const AVATARS = ['🐯', '🦄', '🐼', '🦖', '🚀', '⚽️', '🐸', '🌈'];
const BALL_COLORS = {
  '🐯': ['#fb923c', '#c2410c'], '🦄': ['#e879f9', '#a21caf'], '🐼': ['#a3a3a3', '#404040'],
  '🦖': ['#4ade80', '#15803d'], '🚀': ['#60a5fa', '#1d4ed8'], '⚽️': ['#f87171', '#b91c1c'],
  '🐸': ['#a3e635', '#4d7c0f'], '🌈': ['#fcd34d', '#b45309'],
};

/* ============================== audio ============================== */
const FX = {
  ctx: null, master: null, noise: null, rollGain: null, rollFilter: null, rollSrc: null,
  muted: false,
  init() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.85;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noise = buf;
    } catch (e) { /* no audio */ }
  },
  resume() { if (this.ctx && this.ctx.state !== 'running') this.ctx.resume(); },
  setMuted(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : 0.85; },
  tone(freq, dur, type, vol, when, endFreq) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + (when || 0);
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t0);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t0 + dur);
    g.gain.setValueAtTime(vol || 0.25, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g); g.connect(this.master);
    o.start(t0); o.stop(t0 + dur + 0.05);
  },
  burst(dur, freq, vol, when) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + (when || 0);
    const s = this.ctx.createBufferSource(); s.buffer = this.noise;
    const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 0.8;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    s.connect(f); f.connect(g); g.connect(this.master);
    s.start(t0); s.stop(t0 + dur + 0.05);
  },
  whoosh() { this.burst(0.35, 900, 0.35, 0); },
  startRoll() {
    if (!this.ctx || this.rollSrc) return;
    const s = this.ctx.createBufferSource(); s.buffer = this.noise; s.loop = true;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 220;
    const g = this.ctx.createGain(); g.gain.value = 0.0;
    s.connect(f); f.connect(g); g.connect(this.master);
    s.start();
    this.rollSrc = s; this.rollGain = g; this.rollFilter = f;
  },
  setRoll(speed01) {
    if (!this.rollGain) return;
    this.rollGain.gain.value = 0.05 + 0.22 * speed01;
    this.rollFilter.frequency.value = 150 + 350 * speed01;
  },
  stopRoll() {
    if (!this.rollSrc) return;
    try { this.rollSrc.stop(); } catch (e) {}
    this.rollSrc = null; this.rollGain = null; this.rollFilter = null;
  },
  crash(n) {
    const k = Math.min(n, 6);
    for (let i = 0; i < k; i++) {
      this.burst(0.22, rand(1500, 3500), 0.4, i * rand(0.02, 0.06));
      this.tone(rand(700, 1300), 0.1, 'square', 0.12, i * 0.04);
    }
    this.burst(0.4, 500, 0.45, 0);
  },
  boing() { this.tone(220, 0.25, 'sine', 0.3, 0, 440); },
  fanfare(big) {
    const notes = big ? [523, 659, 784, 1047, 1319] : [523, 659, 784];
    notes.forEach((f, i) => {
      this.tone(f, 0.22, 'triangle', 0.3, i * 0.09);
      this.tone(f * 2, 0.22, 'sine', 0.12, i * 0.09);
    });
    if (big) this.burst(0.6, 4000, 0.2, 0.3);
  },
  sad() { this.tone(330, 0.3, 'sawtooth', 0.12, 0, 280); this.tone(294, 0.5, 'sawtooth', 0.12, 0.3, 220); },
};

function say(text) {
  if (FX.muted || !('speechSynthesis' in window)) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.05; u.pitch = 1.25; u.volume = 1; u.lang = 'en-US';
    speechSynthesis.speak(u);
  } catch (e) {}
}

/* ============================== lane model ============================== */
/* Lane coords: x in [-0.5, 0.5] across, y from 0 (player) to LEN (back of pin deck) */
const LEN = 3.4, PIN_Y = 2.85;
const BALL_R = 0.102, PIN_R = 0.057;
const PIN_SPOTS = [];
(function () {
  const dx = 0.2892 / 2, dy = 0.25; // pin spacing
  const rows = [[0], [-dx, dx], [-2 * dx, 0, 2 * dx], [-3 * dx, -dx, dx, 3 * dx]];
  rows.forEach((xs, r) => xs.forEach(x => PIN_SPOTS.push({ x, y: PIN_Y + r * dy })));
})();

/* ============================== state ============================== */
const G = {
  scene: 'menu',          // menu | aim | rolling | settling | over
  numPlayers: 1,
  players: [],            // {name, avatar, frames:[[rolls]]}
  cur: 0,                 // player index
  frame: 0,               // 0..9
  pins: [],               // {x,y,vx,vy,down,angle,spin,gone,startX,startY}
  ball: null,             // {x,y,vx,vy,hook,gutter,launched}
  bumpers: true, tilt: false, tiltOn: false,
  tiltGamma: 0,
  throwPower: 0,
  settleTimer: 0, ballDoneAt: 0,
  downBefore: 0,
  confetti: [],
  sweepT: -1,             // pin fade-out animation
  lastTouchX: null,
};

/* ============================== scoring ============================== */
function computeCum(frames) {
  const rolls = [], frameStart = [];
  for (let f = 0; f < frames.length; f++) {
    frameStart[f] = rolls.length;
    for (const r of frames[f]) rolls.push(r);
  }
  const cum = []; let total = 0;
  for (let f = 0; f < 10; f++) {
    const fr = frames[f];
    if (!fr || fr.length === 0) { cum[f] = null; break; }
    const i = frameStart[f];
    if (f < 9) {
      if (fr[0] === 10) {
        if (rolls.length >= i + 3) { total += 10 + rolls[i + 1] + rolls[i + 2]; cum[f] = total; }
        else { cum[f] = null; }
      } else if (fr.length >= 2 && fr[0] + fr[1] === 10) {
        if (rolls.length >= i + 3) { total += 10 + rolls[i + 2]; cum[f] = total; }
        else { cum[f] = null; }
      } else if (fr.length >= 2) { total += fr[0] + fr[1]; cum[f] = total; }
      else { cum[f] = null; }
    } else {
      const need = (fr[0] === 10 || (fr.length >= 2 && fr[0] + fr[1] === 10)) ? 3 : 2;
      if (fr.length >= need) { total += fr.reduce((a, b) => a + b, 0); cum[f] = total; }
      else { cum[f] = null; }
    }
    if (cum[f] === null) break;
  }
  return cum;
}

function rollSymbols(fr, fIdx) {
  const out = [];
  for (let i = 0; i < fr.length; i++) {
    const r = fr[i];
    if (i > 0 && fr[i - 1] !== 10 && fr[i - 1] + r === 10) out.push('/');
    else if (r === 10) out.push('X');
    else if (r === 0) out.push('–');
    else out.push(String(r));
  }
  // pad to width for layout
  const width = fIdx === 9 ? 3 : 2;
  while (out.length < width) out.push('');
  return out;
}

function frameDone(fr, fIdx) {
  if (fIdx < 9) return fr[0] === 10 || fr.length >= 2;
  if (fr.length >= 3) return true;
  if (fr.length === 2) return fr[0] !== 10 && fr[0] + fr[1] < 10;
  return false;
}

/* ============================== scoreboard UI ============================== */
function renderScoreboard() {
  const sb = $('scoreboard');
  sb.innerHTML = '';
  G.players.forEach((p, pi) => {
    const cum = computeCum(p.frames);
    const total = [...cum].reverse().find(c => c !== null) || 0;
    const row = document.createElement('div');
    row.className = 'sbPlayer' + (pi === G.cur && G.scene !== 'over' ? ' active' : '');
    let cells = '';
    for (let f = 0; f < 10; f++) {
      const fr = p.frames[f] || [];
      const syms = rollSymbols(fr, f).map(s => s === '' ? '·' : s).join(' ');
      const isCur = pi === G.cur && f === G.frame && G.scene !== 'over';
      cells += `<div class="fr${f === 9 ? ' f10' : ''}${isCur ? ' cur' : ''}">
        <div class="rolls">${fr.length ? syms : '&nbsp;'}</div>
        <div class="cum">${cum[f] !== null && cum[f] !== undefined ? cum[f] : '&nbsp;'}</div></div>`;
    }
    row.innerHTML = `<div class="sbTop"><span>${p.avatar} ${p.name}</span><span class="tot">${total}</span></div>
      <div class="frames">${cells}</div>`;
    sb.appendChild(row);
  });
}

/* ============================== pins & ball ============================== */
function rackPins(fullReset) {
  if (fullReset) {
    G.rackBalls = 0;
    G.pins = PIN_SPOTS.map(s => ({
      x: s.x, y: s.y, startX: s.x, startY: s.y,
      vx: 0, vy: 0, down: false, gone: false, angle: 0, spin: 0,
    }));
  } else {
    // sweep: remove downed pins, keep standing where they are
    G.pins = G.pins.filter(p => !p.down && !p.gone);
    G.pins.forEach(p => { p.vx = 0; p.vy = 0; });
  }
}

function standingCount() { return G.pins.filter(p => !p.down && !p.gone).length; }

function newBall() {
  const startX = G.lastTouchX !== null ? G.lastTouchX : 0;
  G.ball = { x: clamp(startX, -0.38, 0.38), y: 0.22, vx: 0, vy: 0, hook: 0, gutter: false, launched: false, trail: [] };
}

function launchBall(vx, vy, hook, power) {
  const b = G.ball;
  b.vx = vx; b.vy = vy; b.hook = hook; b.launched = true;
  G.rackBalls = (G.rackBalls || 0) + 1;
  G.throwPower = power;
  G.scene = 'rolling';
  G.downBefore = G.pins.filter(p => p.down || p.gone).length;
  G.ballDoneAt = 0; G.settleTimer = 0;
  $('hint').textContent = G.tiltOn ? '📱 Tilt to steer!' : '';
  FX.whoosh(); FX.startRoll();
  if (navigator.vibrate) try { navigator.vibrate(20); } catch (e) {}
}

function updatePhysics(dt) {
  const b = G.ball;
  let ballActive = false;
  if (b && b.launched) {
    ballActive = b.y < LEN + 0.4 && (Math.abs(b.vx) + b.vy) > 0.05;
    if (ballActive) {
      // hook (spin) + optional tilt steering
      if (!b.gutter) {
        b.vx += b.hook * dt;
        if (G.tiltOn) b.vx += clamp(G.tiltGamma, -30, 30) / 30 * 1.1 * dt;
      }
      b.vy *= (1 - 0.025 * dt);
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.trail.push({ x: b.x, y: b.y });
      if (b.trail.length > 10) b.trail.shift();

      // edges: bumpers bounce or gutter
      const edge = 0.5 - BALL_R * 0.55;
      if (Math.abs(b.x) > edge) {
        if (G.bumpers) {
          b.x = clamp(b.x, -edge, edge);
          b.vx = -b.vx * 0.78;
          FX.boing();
          if (navigator.vibrate) try { navigator.vibrate(15); } catch (e) {}
        } else if (!b.gutter) {
          b.gutter = true;
          b.x = Math.sign(b.x) * 0.56;
          b.vx = 0; b.hook = 0;
          FX.sad();
        }
      }
      FX.setRoll(clamp(b.vy / 4, 0, 1));

      // ball -> pin collisions
      if (!b.gutter) {
        for (const p of G.pins) {
          if (p.gone) continue;
          const dx = p.x - b.x, dy = p.y - b.y;
          const d = Math.hypot(dx, dy), minD = BALL_R + PIN_R;
          if (d < minD && d > 0.0001) {
            const nx = dx / d, ny = dy / d;
            const sp = Math.hypot(b.vx, b.vy);
            p.vx = nx * sp * rand(0.75, 1.0) + b.vx * 0.15 + rand(-0.25, 0.25) * sp * 0.3;
            p.vy = Math.max(0.2, ny * sp * rand(0.75, 1.0) + b.vy * 0.15);
            p.down = true;
            p.spin = rand(-7, 7);
            // push pin out of overlap, deflect & slow ball a touch
            p.x = b.x + nx * minD * 1.01;
            p.y = b.y + ny * minD * 1.01;
            b.vx -= nx * sp * 0.10;
            b.vy *= 0.94;
            FX.crash(1);
            if (navigator.vibrate) try { navigator.vibrate(30); } catch (e) {}
          }
        }
      }
    } else if (!G.ballDoneAt) {
      G.ballDoneAt = performance.now();
      FX.stopRoll();
    }
  }

  // pin <-> pin
  for (let i = 0; i < G.pins.length; i++) {
    const a = G.pins[i];
    if (a.gone) continue;
    const aSp = Math.hypot(a.vx, a.vy);
    if (aSp < 0.02) continue;
    for (let j = 0; j < G.pins.length; j++) {
      if (i === j) continue;
      const c = G.pins[j];
      if (c.gone) continue;
      const dx = c.x - a.x, dy = c.y - a.y;
      const d = Math.hypot(dx, dy), minD = PIN_R * 2.1;
      if (d < minD && d > 0.0001) {
        const nx = dx / d, ny = dy / d;
        const rel = (a.vx - c.vx) * nx + (a.vy - c.vy) * ny;
        if (rel > 0) {
          const imp = rel * 0.85;
          a.vx -= nx * imp * 0.55; a.vy -= ny * imp * 0.55;
          c.vx += nx * imp * 0.75; c.vy += ny * imp * 0.75;
          if (imp > 0.35 && !c.down) { c.down = true; c.spin = rand(-6, 6); FX.crash(1); }
          c.x = a.x + nx * minD; c.y = a.y + ny * minD;
        }
      }
    }
  }

  // pin motion & damping
  let maxPinSp = 0;
  for (const p of G.pins) {
    if (p.gone) continue;
    p.x += p.vx * dt; p.y += p.vy * dt;
    const damp = Math.max(0, 1 - 2.0 * dt);
    p.vx *= damp; p.vy *= damp;
    if (p.down) p.angle += p.spin * dt;
    const sp = Math.hypot(p.vx, p.vy);
    if (sp < 0.04) { p.vx = 0; p.vy = 0; }
    maxPinSp = Math.max(maxPinSp, sp);
    if (Math.abs(p.x) > 0.75 || p.y > LEN + 0.3) { p.gone = true; p.down = true; }
    // displaced pins count as down
    if (!p.down && Math.hypot(p.x - p.startX, p.y - p.startY) > PIN_R * 0.9) p.down = true;
  }

  // settle detection
  if (G.scene === 'rolling' && G.ballDoneAt && maxPinSp < 0.06) {
    if (performance.now() - G.ballDoneAt > 450) {
      G.scene = 'settling';
      G.settleTimer = performance.now();
      setTimeout(endOfThrow, 350);
    }
  }
  // safety: never hang
  if (G.scene === 'rolling' && G.ballDoneAt && performance.now() - G.ballDoneAt > 4000) {
    G.scene = 'settling';
    setTimeout(endOfThrow, 100);
  }
}

/* ============================== game flow ============================== */
function startGame() {
  G.players = [];
  const names = [($('name1').value || 'Player 1').trim() || 'Player 1',
                 ($('name2').value || 'Player 2').trim() || 'Player 2'];
  for (let i = 0; i < G.numPlayers; i++) {
    G.players.push({ name: names[i], avatar: $(i === 0 ? 'av1' : 'av2').textContent, frames: Array.from({ length: 10 }, () => []) });
  }
  try {
    localStorage.setItem('bowlNames', JSON.stringify({ n1: names[0], n2: names[1], a1: $('av1').textContent, a2: $('av2').textContent }));
  } catch (e) {}
  G.cur = 0; G.frame = 0; G.confetti = [];
  G.lastTouchX = null;
  rackPins(true);
  newBall();
  $('menu').classList.add('hidden');
  $('over').classList.add('hidden');
  $('game').classList.remove('hidden');
  G.scene = 'aim';
  renderScoreboard();
  setHint();
  keepAwake();
  say(`${G.players[0].name}, you're up!`);
}

function setHint() {
  const p = G.players[G.cur];
  const throwNum = (p.frames[G.frame] || []).length + 1;
  $('hint').textContent = `${p.avatar} ${p.name} — Frame ${G.frame + 1} · Ball ${throwNum} — Swipe up to bowl! 👆`;
}

function showBanner(text, sub, color) {
  const b = $('banner');
  b.style.color = color || '#ffd166';
  b.innerHTML = text + (sub ? `<small>${sub}</small>` : '');
  b.classList.remove('pop');
  void b.offsetWidth; // restart animation
  b.classList.add('pop');
}

function spawnConfetti(n) {
  const W = cv.clientWidth;
  for (let i = 0; i < n; i++) {
    G.confetti.push({
      x: rand(0, W), y: rand(-60, -10),
      vx: rand(-40, 40), vy: rand(120, 320),
      w: rand(5, 10), h: rand(8, 16), rot: rand(0, 6.3), vr: rand(-6, 6),
      color: pick(['#e4572e', '#f5b82e', '#1e91a8', '#2bc4d9', '#faf1e3', '#d94f70']),
      life: rand(2, 3.6),
    });
  }
}

function endOfThrow() {
  if (G.scene !== 'settling') return;
  FX.stopRoll();
  const knocked = G.pins.filter(p => p.down || p.gone).length;
  const p = G.players[G.cur];
  const fr = p.frames[G.frame];
  // pins knocked THIS throw = downs in rack minus downs at start of throw
  const thisThrow = clamp(knocked - G.downBefore, 0, 10);
  fr.push(thisThrow);

  // a strike is clearing a fresh rack with its first ball; otherwise clearing the rack is a spare
  const isStrike = thisThrow === 10 && G.rackBalls === 1;
  const isSpare = !isStrike && standingCount() === 0 && thisThrow > 0;

  if (isStrike) {
    showBanner('STRIKE! 💥', pick(['INCREDIBLE!', 'BOOM!', 'SUPERSTAR!', 'UNSTOPPABLE!']), '#fb923c');
    FX.fanfare(true); spawnConfetti(120);
    say(pick(['STRIKE! Amazing!', 'BOOM! Strike!', 'Incredible! Strike!', 'Wow! Strike!']));
    if (navigator.vibrate) try { navigator.vibrate([60, 40, 60]); } catch (e) {}
  } else if (isSpare) {
    showBanner('SPARE! ⭐', pick(['NICE PICKUP!', 'CLEANED UP!', 'GREAT JOB!']), '#2bc4d9');
    FX.fanfare(false); spawnConfetti(60);
    say(pick(['Spare! Nice one!', 'You got the spare!', 'Spare! Great job!']));
  } else if (G.ball && G.ball.gutter && thisThrow === 0) {
    showBanner('GUTTER 😅', pick(['SO CLOSE!', 'YOU GOT THIS!', 'TRY AGAIN!']), '#94a3b8');
    say(pick(['Oh no, gutter ball!', 'Whoops! Try again!']));
  } else if (thisThrow > 0) {
    showBanner(`+${thisThrow} 🎳`, thisThrow >= 7 ? 'GREAT THROW!' : '', '#34d399');
    if (thisThrow >= 7) say('Great throw!');
  } else {
    showBanner('+0', 'NEXT TIME!', '#94a3b8');
  }

  renderScoreboard();
  setTimeout(() => advanceTurn(), 1600);
}

function advanceTurn() {
  const p = G.players[G.cur];
  const fr = p.frames[G.frame];
  const done = frameDone(fr, G.frame);

  if (done) {
    // next player / frame
    if (G.cur < G.players.length - 1) {
      G.cur++;
    } else {
      G.cur = 0;
      G.frame++;
      if (G.frame >= 10) { gameOver(); return; }
    }
    rackPins(true);
    const np = G.players[G.cur];
    if (G.players.length > 1) say(`${np.name}, you're up!`);
  } else {
    // same player, next ball: reset rack if everything is down (10th frame), else sweep
    if (standingCount() === 0) rackPins(true);
    else rackPins(false);
  }
  newBall();
  G.scene = 'aim';
  renderScoreboard();
  setHint();
}

function gameOver() {
  G.scene = 'over';
  FX.stopRoll();
  renderScoreboard();
  const results = G.players.map(p => {
    const cum = computeCum(p.frames);
    return { name: p.name, avatar: p.avatar, score: [...cum].reverse().find(c => c !== null) || 0 };
  });
  results.sort((a, b) => b.score - a.score);
  let html = results.map((r, i) => `${i === 0 ? '🥇' : '🥈'} ${r.avatar} ${r.name}: <b style="color:#ffd166">${r.score}</b>`).join('<br>');
  if (results.length > 1 && results[0].score === results[1].score) {
    html = `🤝 It's a TIE!<br>` + html;
    say("It's a tie! Amazing game!");
  } else {
    say(`${results[0].name} wins with ${results[0].score} points! ${results[0].score >= 100 ? 'Incredible!' : 'Great game!'}`);
  }
  $('overResult').innerHTML = html;

  // high score
  let highMsg = '';
  try {
    const prev = JSON.parse(localStorage.getItem('bowlHigh') || 'null');
    if (!prev || results[0].score > prev.score) {
      localStorage.setItem('bowlHigh', JSON.stringify({ name: results[0].name, score: results[0].score }));
      if (results[0].score > 0) highMsg = `🌟 NEW HIGH SCORE! 🌟`;
    }
  } catch (e) {}
  $('overHigh').textContent = highMsg;

  spawnConfetti(200);
  FX.fanfare(true);
  setTimeout(() => $('over').classList.remove('hidden'), 900);
}

/* ============================== rendering ============================== */
const cv = $('lane');
const cx2d = cv.getContext('2d');
let W = 0, H = 0, DPR = 1;

function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 3);
  W = cv.clientWidth; H = cv.clientHeight;
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  cx2d.setTransform(DPR, 0, 0, DPR, 0, 0);
}
window.addEventListener('resize', () => setTimeout(resize, 50));

const PERSP_N = 0.85;
function proj(x, y) {
  const t = clamp(y / LEN, 0, 1.05);
  const By = H - 14, Ty = H * 0.13;
  const sy = By + (Ty - By) * ((1 + PERSP_N) * t / (PERSP_N + t));
  const s = PERSP_N / (PERSP_N + t);
  const halfBottom = W * 0.46;
  return { x: W / 2 + (x / 0.5) * halfBottom * s, y: sy, s, halfW: halfBottom * s };
}

function drawLane() {
  // backdrop
  const bg = cx2d.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#100c07'); bg.addColorStop(0.4, '#2b2114'); bg.addColorStop(1, '#1c1610');
  cx2d.fillStyle = bg; cx2d.fillRect(0, 0, W, H);

  const bl = proj(-0.5, 0), br = proj(0.5, 0), tl = proj(-0.5, LEN), tr = proj(0.5, LEN);
  // gutters / bumpers
  const gl = proj(-0.62, 0), gr = proj(0.62, 0), gtl = proj(-0.62, LEN), gtr = proj(0.62, LEN);
  cx2d.fillStyle = G.bumpers ? '#11444d' : '#0d0a06';
  cx2d.beginPath(); cx2d.moveTo(gl.x, gl.y); cx2d.lineTo(bl.x, bl.y); cx2d.lineTo(tl.x, tl.y); cx2d.lineTo(gtl.x, gtl.y); cx2d.closePath(); cx2d.fill();
  cx2d.beginPath(); cx2d.moveTo(gr.x, gr.y); cx2d.lineTo(br.x, br.y); cx2d.lineTo(tr.x, tr.y); cx2d.lineTo(gtr.x, gtr.y); cx2d.closePath(); cx2d.fill();
  if (G.bumpers) {
    cx2d.strokeStyle = '#2bc4d9'; cx2d.lineWidth = 3; cx2d.shadowColor = '#2bc4d9'; cx2d.shadowBlur = 10;
    cx2d.beginPath(); cx2d.moveTo(bl.x, bl.y); cx2d.lineTo(tl.x, tl.y); cx2d.stroke();
    cx2d.beginPath(); cx2d.moveTo(br.x, br.y); cx2d.lineTo(tr.x, tr.y); cx2d.stroke();
    cx2d.shadowBlur = 0;
  }

  // lane wood
  const wood = cx2d.createLinearGradient(0, bl.y, 0, tl.y);
  wood.addColorStop(0, '#d9a05b'); wood.addColorStop(0.6, '#c08442'); wood.addColorStop(1, '#9a6630');
  cx2d.fillStyle = wood;
  cx2d.beginPath(); cx2d.moveTo(bl.x, bl.y); cx2d.lineTo(br.x, br.y); cx2d.lineTo(tr.x, tr.y); cx2d.lineTo(tl.x, tl.y); cx2d.closePath(); cx2d.fill();

  // boards
  cx2d.strokeStyle = '#00000018'; cx2d.lineWidth = 1;
  for (let i = 1; i < 8; i++) {
    const x = -0.5 + i / 8;
    const a = proj(x, 0), b = proj(x, LEN);
    cx2d.beginPath(); cx2d.moveTo(a.x, a.y); cx2d.lineTo(b.x, b.y); cx2d.stroke();
  }

  // arrows
  cx2d.fillStyle = '#e4572e55';
  for (let i = -3; i <= 3; i++) {
    const pos = proj(i * 0.125, 1.1 + Math.abs(i) * 0.12);
    const s = 7 * pos.s;
    cx2d.beginPath();
    cx2d.moveTo(pos.x, pos.y - s * 1.6);
    cx2d.lineTo(pos.x - s, pos.y);
    cx2d.lineTo(pos.x + s, pos.y);
    cx2d.closePath(); cx2d.fill();
  }

  // pin deck shading
  const pd = proj(0, PIN_Y - 0.18);
  cx2d.fillStyle = '#00000022';
  cx2d.beginPath();
  const pdl = proj(-0.5, PIN_Y - 0.18), pdr = proj(0.5, PIN_Y - 0.18);
  cx2d.moveTo(pdl.x, pdl.y); cx2d.lineTo(pdr.x, pdr.y); cx2d.lineTo(tr.x, tr.y); cx2d.lineTo(tl.x, tl.y);
  cx2d.closePath(); cx2d.fill();
}

function drawPin(p) {
  const pr = proj(p.x, p.y);
  const h = 64 * pr.s;            // pin height in px
  const w = h * 0.36;
  cx2d.save();
  cx2d.translate(pr.x, pr.y);
  if (p.down) {
    cx2d.rotate(0.9 * Math.sign(p.spin || 1) + (p.angle || 0) * 0.15);
    cx2d.globalAlpha = G.sweepT >= 0 ? Math.max(0, 1 - G.sweepT) : 0.9;
    cx2d.scale(1, 0.55);
  }
  // shadow
  cx2d.fillStyle = '#00000033';
  cx2d.beginPath(); cx2d.ellipse(0, 2, w * 0.8, w * 0.3, 0, 0, 7); cx2d.fill();
  // body
  const bodyGrad = cx2d.createLinearGradient(-w / 2, 0, w / 2, 0);
  bodyGrad.addColorStop(0, '#d8d8e2'); bodyGrad.addColorStop(0.35, '#ffffff'); bodyGrad.addColorStop(1, '#b8b8c8');
  cx2d.fillStyle = bodyGrad;
  cx2d.beginPath(); cx2d.ellipse(0, -h * 0.26, w * 0.5, h * 0.36, 0, 0, 7); cx2d.fill();      // belly
  cx2d.beginPath(); cx2d.ellipse(0, -h * 0.62, w * 0.30, h * 0.26, 0, 0, 7); cx2d.fill();     // neck
  cx2d.beginPath(); cx2d.arc(0, -h * 0.84, w * 0.26, 0, 7); cx2d.fill();                       // head
  // stripes
  cx2d.fillStyle = '#ef4444';
  cx2d.fillRect(-w * 0.30, -h * 0.66, w * 0.60, h * 0.055);
  cx2d.fillRect(-w * 0.28, -h * 0.57, w * 0.56, h * 0.055);
  cx2d.restore();
}

function drawBall() {
  const b = G.ball;
  if (!b) return;
  const colors = BALL_COLORS[G.players[G.cur].avatar] || ['#fb923c', '#c2410c'];
  // trail
  if (b.launched && b.trail.length > 1) {
    for (let i = 0; i < b.trail.length - 1; i++) {
      const t = b.trail[i], pr = proj(t.x, t.y);
      cx2d.globalAlpha = (i / b.trail.length) * 0.25;
      cx2d.fillStyle = colors[0];
      cx2d.beginPath(); cx2d.arc(pr.x, pr.y - 8 * pr.s, (BALL_R / 0.5) * W * 0.46 * pr.s * 0.9, 0, 7); cx2d.fill();
    }
    cx2d.globalAlpha = 1;
  }
  const pr = proj(b.x, b.y);
  const r = (BALL_R / 0.5) * W * 0.46 * pr.s;
  // shadow
  cx2d.fillStyle = '#00000044';
  cx2d.beginPath(); cx2d.ellipse(pr.x, pr.y + r * 0.15, r * 0.95, r * 0.3, 0, 0, 7); cx2d.fill();
  // sphere
  const g = cx2d.createRadialGradient(pr.x - r * 0.35, pr.y - r * 0.45 - r * 0.5, r * 0.1, pr.x, pr.y - r * 0.5, r * 1.15);
  g.addColorStop(0, '#ffffff'); g.addColorStop(0.25, colors[0]); g.addColorStop(1, colors[1]);
  cx2d.fillStyle = g;
  cx2d.beginPath(); cx2d.arc(pr.x, pr.y - r * 0.5, r, 0, 7); cx2d.fill();
  // finger holes
  cx2d.fillStyle = '#00000055';
  const hy = pr.y - r * 0.75;
  [[-0.22, 0], [0.22, 0], [0, -0.28]].forEach(([ox, oy]) => {
    cx2d.beginPath(); cx2d.arc(pr.x + ox * r, hy + oy * r, r * 0.1, 0, 7); cx2d.fill();
  });
}

function drawAimGuide() {
  if (G.scene !== 'aim' || !drag) return;
  const b = G.ball;
  const from = proj(b.x, b.y);
  const last = drag.pts[drag.pts.length - 1];
  const dx = last.x - drag.pts[0].x, dy = drag.pts[0].y - last.y;
  if (dy < 10) return;
  const len = clamp(Math.hypot(dx, dy) * 1.5, 40, H * 0.5);
  const ang = Math.atan2(-(dy), dx * 0.6);
  cx2d.save();
  cx2d.translate(from.x, from.y - 14);
  cx2d.rotate(ang + Math.PI / 2 + Math.PI);
  cx2d.strokeStyle = '#ffd166cc'; cx2d.lineWidth = 5; cx2d.setLineDash([10, 10]);
  cx2d.beginPath(); cx2d.moveTo(0, 0); cx2d.lineTo(0, -len); cx2d.stroke();
  cx2d.setLineDash([]);
  cx2d.fillStyle = '#ffd166cc';
  cx2d.beginPath(); cx2d.moveTo(0, -len - 14); cx2d.lineTo(-11, -len + 2); cx2d.lineTo(11, -len + 2); cx2d.closePath(); cx2d.fill();
  cx2d.restore();
}

function drawConfetti(dt) {
  for (let i = G.confetti.length - 1; i >= 0; i--) {
    const c = G.confetti[i];
    c.life -= dt;
    if (c.life <= 0 || c.y > H + 30) { G.confetti.splice(i, 1); continue; }
    c.x += c.vx * dt; c.y += c.vy * dt; c.rot += c.vr * dt;
    cx2d.save();
    cx2d.translate(c.x, c.y); cx2d.rotate(c.rot);
    cx2d.fillStyle = c.color;
    cx2d.globalAlpha = clamp(c.life, 0, 1);
    cx2d.fillRect(-c.w / 2, -c.h / 2, c.w, c.h);
    cx2d.restore();
  }
  cx2d.globalAlpha = 1;
}

let lastT = 0;
function loop(t) {
  requestAnimationFrame(loop);
  const dt = clamp((t - lastT) / 1000, 0, 1 / 30);
  lastT = t;
  if (G.scene === 'menu') return;
  if (W !== cv.clientWidth || H !== cv.clientHeight) resize();

  if (G.scene === 'rolling' || G.scene === 'settling') updatePhysics(dt);

  drawLane();
  // pins back-to-front (larger y first = farther)
  [...G.pins].sort((a, b) => b.y - a.y).forEach(drawPin);
  drawBall();
  drawAimGuide();
  drawConfetti(dt);
}

/* ============================== input ============================== */
let drag = null;

function touchPos(e) {
  const t = e.touches && e.touches.length ? e.touches[0] : (e.changedTouches ? e.changedTouches[0] : e);
  const r = cv.getBoundingClientRect();
  return { x: t.clientX - r.left, y: t.clientY - r.top, t: performance.now() };
}

function screenToLaneX(px) {
  const halfBottom = W * 0.46;
  return clamp((px - W / 2) / halfBottom * 0.5, -0.38, 0.38);
}

function onStart(e) {
  FX.init(); FX.resume();
  if (G.scene !== 'aim') return;
  e.preventDefault();
  const p = touchPos(e);
  drag = { pts: [p] };
}

function onMove(e) {
  if (!drag || G.scene !== 'aim') return;
  e.preventDefault();
  const p = touchPos(e);
  drag.pts.push(p);
  if (drag.pts.length > 80) drag.pts.shift();
  // let the player slide the ball sideways before flicking
  const dy = drag.pts[0].y - p.y;
  if (dy < 24) {
    G.ball.x = screenToLaneX(p.x);
    G.lastTouchX = G.ball.x;
  }
}

function onEnd(e) {
  if (!drag || G.scene !== 'aim') { drag = null; return; }
  e.preventDefault();
  const pts = drag.pts;
  drag = null;
  if (pts.length < 3) return;
  const end = pts[pts.length - 1];
  // velocity from the last ~140ms of the gesture
  let i0 = pts.length - 1;
  while (i0 > 0 && end.t - pts[i0 - 1].t < 140) i0--;
  const start = pts[i0];
  const dtms = Math.max(end.t - start.t, 16);
  const dy = start.y - end.y;            // up is positive
  const dx = end.x - start.x;
  const vyPx = dy / dtms * 1000;
  if (vyPx < 320) return;                // too slow: not a throw

  const power = clamp((vyPx - 320) / 2800, 0.12, 1);
  const vy = 1.8 + 2.3 * power;
  const lateral = clamp(dx / Math.max(dy, 1), -0.6, 0.6);
  const vx = lateral * vy * 0.42;

  // hook from path curvature: compare early vs late direction
  let hook = 0;
  if (pts.length >= 6) {
    const a0 = pts[0], a1 = pts[Math.floor(pts.length / 2)], a2 = end;
    const d1x = a1.x - a0.x, d1y = a0.y - a1.y;
    const d2x = a2.x - a1.x, d2y = a1.y - a2.y;
    const ang1 = Math.atan2(d1x, d1y), ang2 = Math.atan2(d2x, d2y);
    let diff = ang2 - ang1;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    hook = clamp(diff * 0.9, -0.55, 0.55);
  }
  launchBall(vx, vy, hook, power);
}

cv.addEventListener('touchstart', onStart, { passive: false });
cv.addEventListener('touchmove', onMove, { passive: false });
cv.addEventListener('touchend', onEnd, { passive: false });
// mouse fallback for desktop testing
cv.addEventListener('mousedown', onStart);
cv.addEventListener('mousemove', e => { if (drag) onMove(e); });
cv.addEventListener('mouseup', onEnd);

document.addEventListener('touchmove', e => e.preventDefault(), { passive: false });

/* ============================== tilt / wake lock ============================== */
async function enableTilt() {
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      const r = await DeviceOrientationEvent.requestPermission();
      if (r !== 'granted') return false;
    }
    window.addEventListener('deviceorientation', e => { G.tiltGamma = e.gamma || 0; });
    return true;
  } catch (e) { return false; }
}

let wakeLock = null;
async function keepAwake() {
  try { wakeLock = await navigator.wakeLock.request('screen'); } catch (e) {}
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && G.scene !== 'menu') keepAwake();
});

/* ============================== menu wiring ============================== */
function refreshHighline() {
  try {
    const h = JSON.parse(localStorage.getItem('bowlHigh') || 'null');
    $('highline').textContent = h ? `🏆 High score: ${h.name} — ${h.score}` : '🏆 Set the first high score!';
  } catch (e) {}
}

$('playerSeg').addEventListener('click', e => {
  const btn = e.target.closest('button');
  if (!btn) return;
  G.numPlayers = +btn.dataset.n;
  [...$('playerSeg').children].forEach(b => b.classList.toggle('on', b === btn));
  $('p2row').classList.toggle('hidden', G.numPlayers < 2);
});

function cycleAvatar(btn, other) {
  let i = (AVATARS.indexOf(btn.textContent) + 1) % AVATARS.length;
  if (AVATARS[i] === other.textContent) i = (i + 1) % AVATARS.length;
  btn.textContent = AVATARS[i];
}
$('av1').addEventListener('click', () => cycleAvatar($('av1'), $('av2')));
$('av2').addEventListener('click', () => cycleAvatar($('av2'), $('av1')));

$('togBumpers').addEventListener('click', function () {
  G.bumpers = !G.bumpers; this.classList.toggle('on', G.bumpers);
});
$('togSound').addEventListener('click', function () {
  this.classList.toggle('on');
  FX.setMuted(!this.classList.contains('on'));
  $('muteBtn').textContent = FX.muted ? '🔇' : '🔊';
});
$('togTilt').addEventListener('click', async function () {
  if (!this.classList.contains('on')) {
    FX.init(); FX.resume();
    const ok = await enableTilt();
    if (ok) { G.tiltOn = true; this.classList.add('on'); }
    else { this.classList.remove('on'); G.tiltOn = false; }
  } else {
    G.tiltOn = false; this.classList.remove('on');
  }
});

$('playBtn').addEventListener('click', () => { FX.init(); FX.resume(); startGame(); });
$('againBtn').addEventListener('click', () => { startGame(); });
$('homeBtn').addEventListener('click', () => {
  G.scene = 'menu'; FX.stopRoll();
  $('game').classList.add('hidden'); $('menu').classList.remove('hidden');
  refreshHighline();
});
$('homeBtn2').addEventListener('click', () => {
  G.scene = 'menu';
  $('over').classList.add('hidden'); $('game').classList.add('hidden'); $('menu').classList.remove('hidden');
  refreshHighline();
});
$('muteBtn').addEventListener('click', function () {
  FX.setMuted(!FX.muted);
  this.textContent = FX.muted ? '🔇' : '🔊';
  $('togSound').classList.toggle('on', !FX.muted);
});

/* restore saved names */
try {
  const saved = JSON.parse(localStorage.getItem('bowlNames') || 'null');
  if (saved) {
    $('name1').value = saved.n1 === 'Player 1' ? '' : saved.n1;
    $('name2').value = saved.n2 === 'Player 2' ? '' : saved.n2;
    if (AVATARS.includes(saved.a1)) $('av1').textContent = saved.a1;
    if (AVATARS.includes(saved.a2)) $('av2').textContent = saved.a2;
  }
} catch (e) {}
refreshHighline();

/* service worker for offline play */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

resize();
requestAnimationFrame(loop);
