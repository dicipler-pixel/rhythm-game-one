// game.js — input, judgment, and drawing.
//
// The loop is deliberately boring: every frame, ask the Conductor what time it
// is, move everything to where it should be at that time, draw. No state is
// advanced "per frame" — frames are just when we happen to look.

import { Conductor } from './audio.js';
import { buildSong, LANE_COUNT, KEYS, KEY_LABELS } from './chart.js';

// --- tuning knobs ----------------------------------------------------------

// Judgment windows, in milliseconds either side of the note's true time.
// Tightening PERFECT makes the game harder in the most honest way.
const WINDOWS = [
  { name: 'PERFECT', ms: 45,  score: 300, weight: 1.00, color: '#ffd76b' },
  { name: 'GREAT',   ms: 90,  score: 200, weight: 0.75, color: '#7ee0a8' },
  { name: 'GOOD',    ms: 135, score: 100, weight: 0.40, color: '#6fb8ff' },
];
const MISS_MS = 180;          // press this far off and the note is gone
const MISS = { name: 'MISS', ms: MISS_MS, score: 0, weight: 0, color: '#ff6b7d' };

const SCROLL_SPEED = 620;     // pixels per second a note travels
const NOTE_HEIGHT = 20;

const LANE_COLORS = ['#ff8fa3', '#8fd3ff', '#8fd3ff', '#ff8fa3'];

// --- setup -----------------------------------------------------------------

const canvas = document.getElementById('stage');
const ctx2d = canvas.getContext('2d');
const overlay = document.getElementById('overlay');
const overlayBody = document.getElementById('overlay-body');
const hud = document.getElementById('hud');

const conductor = new Conductor();

let state = 'menu';           // 'menu' | 'playing' | 'results'
let song = null;
let notes = [];
let stats = null;
let popups = [];              // floating PERFECT/GREAT/... text
let errors = [];              // recent hit errors in ms, for the timing bar
const laneFlash = new Array(LANE_COUNT).fill(0);
const laneHeld = new Array(LANE_COUNT).fill(false);

// Your personal audio/video offset, in milliseconds. Positive means "I hear the
// music later than the game thinks", i.e. you'll naturally hit late. Every
// rhythm game needs this because every set of speakers and every screen lies
// about when things happen. Adjust with [ and ], it's saved in the browser.
let offsetMs = Number(localStorage.getItem('rg.offset') ?? 0);

resize();
window.addEventListener('resize', resize);
requestAnimationFrame(frame);
showMenu();

// --- layout ----------------------------------------------------------------

function resize() {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function layout() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const fieldW = Math.min(520, w - 32);
  const laneW = fieldW / LANE_COUNT;
  return { w, h, fieldX: (w - fieldW) / 2, fieldW, laneW, hitY: h * 0.80 };
}

// --- screens ---------------------------------------------------------------

function showMenu() {
  state = 'menu';
  hud.hidden = true;
  overlay.hidden = false;
  overlayBody.innerHTML = `
    <h1>rhythm-game</h1>
    <p class="sub">Notes fall. Hit them when they cross the line.</p>
    <div class="keys">
      ${KEY_LABELS.map((k, i) => `<kbd style="--c:${LANE_COLORS[i]}">${k}</kbd>`).join('')}
    </div>
    <button id="play">Play</button>
    <p class="hint">
      Two bars of count-in first — listen, then play.<br>
      <b>[</b> and <b>]</b> nudge your timing offset · <b>Esc</b> quits a run
    </p>`;
  document.getElementById('play').onclick = startGame;
}

function showResults() {
  state = 'results';
  conductor.stop();
  hud.hidden = true;
  overlay.hidden = false;
  const acc = stats.judged ? (stats.weight / stats.judged) * 100 : 0;
  const rows = [...WINDOWS, MISS]
    .map(w => `<tr><td style="color:${w.color}">${w.name}</td><td>${stats.counts[w.name] || 0}</td></tr>`)
    .join('');
  const mean = errors.length
    ? (errors.reduce((a, b) => a + b, 0) / errors.length).toFixed(1)
    : '0.0';
  overlayBody.innerHTML = `
    <h1>${acc >= 95 ? 'Clean.' : acc >= 80 ? 'Solid.' : 'Run it again.'}</h1>
    <p class="sub">${acc.toFixed(2)}% accuracy · ${stats.score.toLocaleString()} points · ${stats.maxCombo}x max combo</p>
    <table class="results">${rows}</table>
    <p class="hint">Average hit error: <b>${mean} ms</b>${
      Math.abs(mean) > 20 ? ` — try setting your offset to ${Math.round(offsetMs + Number(mean))} ms with [ and ]` : ''
    }</p>
    <button id="again">Play again</button>`;
  document.getElementById('again').onclick = startGame;
}

function startGame() {
  song = buildSong();
  notes = song.notes;
  stats = { score: 0, combo: 0, maxCombo: 0, judged: 0, weight: 0, counts: {} };
  popups = [];
  errors = [];
  overlay.hidden = true;
  hud.hidden = false;
  state = 'playing';
  conductor.start(song.audio);
}

// --- input -----------------------------------------------------------------

window.addEventListener('keydown', e => {
  if (e.code === 'Escape' && state === 'playing') { conductor.stop(); showMenu(); return; }
  if (e.code === 'BracketLeft')  { setOffset(offsetMs - 5); return; }
  if (e.code === 'BracketRight') { setOffset(offsetMs + 5); return; }
  if (state === 'menu' && (e.code === 'Space' || e.code === 'Enter')) { startGame(); return; }
  if (state !== 'playing' || e.repeat) return;

  const lane = KEYS.indexOf(e.code);
  if (lane === -1) return;
  e.preventDefault();
  laneHeld[lane] = true;
  laneFlash[lane] = 1;
  judgePress(lane);
});

window.addEventListener('keyup', e => {
  const lane = KEYS.indexOf(e.code);
  if (lane !== -1) laneHeld[lane] = false;
});

function setOffset(ms) {
  offsetMs = Math.max(-200, Math.min(200, ms));
  localStorage.setItem('rg.offset', String(offsetMs));
}

// The moment the player believes it is, in song seconds.
function judgeTime() {
  return conductor.time - offsetMs / 1000;
}

function judgePress(lane) {
  const now = judgeTime();
  let best = null;
  let bestErr = Infinity;

  // Find the closest unjudged note in this lane that's still within reach.
  for (const note of notes) {
    if (note.judged || note.lane !== lane) continue;
    const err = (now - note.time) * 1000;         // + = you were late
    if (err < -MISS_MS) break;                    // notes are sorted; rest are further away
    if (Math.abs(err) < Math.abs(bestErr)) { best = note; bestErr = err; }
  }
  if (!best) return;                              // nothing there — a free press, no penalty

  const verdict = WINDOWS.find(w => Math.abs(bestErr) <= w.ms) || MISS;
  applyJudgment(best, verdict, bestErr);
}

function applyJudgment(note, verdict, errMs) {
  note.judged = true;
  note.result = verdict.name;

  stats.judged++;
  stats.weight += verdict.weight;
  stats.counts[verdict.name] = (stats.counts[verdict.name] || 0) + 1;

  if (verdict === MISS) {
    stats.combo = 0;
  } else {
    stats.combo++;
    stats.maxCombo = Math.max(stats.maxCombo, stats.combo);
    // Combo multiplier caps out so a late run can still recover.
    stats.score += Math.round(verdict.score * (1 + Math.min(stats.combo, 100) / 100));
    errors.push(errMs);
    if (errors.length > 50) errors.shift();
  }

  popups.push({ text: verdict.name, color: verdict.color, lane: note.lane, born: performance.now() });
}

// --- the loop --------------------------------------------------------------

function frame() {
  requestAnimationFrame(frame);
  if (state === 'playing') {
    update();
    draw();
  }
}

function update() {
  const now = judgeTime();

  // Notes you never pressed fall out of the window and miss themselves.
  for (const note of notes) {
    if (note.judged) continue;
    if (now - note.time > MISS_MS / 1000) applyJudgment(note, MISS, MISS_MS);
    else break;                                   // sorted: everything after is in the future
  }

  for (let i = 0; i < LANE_COUNT; i++) laneFlash[i] = Math.max(0, laneFlash[i] - 0.08);
  popups = popups.filter(p => performance.now() - p.born < 550);

  // Let the last notes land before rolling credits.
  if (conductor.time > song.duration + 1.5) showResults();
}

function draw() {
  const { w, h, fieldX, fieldW, laneW, hitY } = layout();
  // Notes are drawn against the SAME clock we judge with, so "press when it
  // touches the line" is literally true no matter what your offset is.
  const t = judgeTime();

  ctx2d.clearRect(0, 0, w, h);

  // playfield
  ctx2d.fillStyle = 'rgba(10, 12, 20, 0.85)';
  ctx2d.fillRect(fieldX, 0, fieldW, h);

  for (let i = 1; i < LANE_COUNT; i++) {
    ctx2d.fillStyle = 'rgba(255,255,255,0.06)';
    ctx2d.fillRect(fieldX + i * laneW - 0.5, 0, 1, h);
  }

  // key press glow
  for (let i = 0; i < LANE_COUNT; i++) {
    const a = Math.max(laneFlash[i], laneHeld[i] ? 0.35 : 0);
    if (a <= 0) continue;
    const g = ctx2d.createLinearGradient(0, hitY - 180, 0, hitY);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(1, hexToRgba(LANE_COLORS[i], 0.28 * a));
    ctx2d.fillStyle = g;
    ctx2d.fillRect(fieldX + i * laneW, hitY - 180, laneW, 180);
  }

  // the hit line
  ctx2d.fillStyle = 'rgba(255,255,255,0.75)';
  ctx2d.fillRect(fieldX, hitY - 1.5, fieldW, 3);

  // notes: a note's distance above the line is just (its time - now) x speed
  for (const note of notes) {
    if (note.judged) continue;
    const dt = note.time - t;
    const y = hitY - dt * SCROLL_SPEED;
    if (y < -NOTE_HEIGHT || y > h + NOTE_HEIGHT) continue;
    const x = fieldX + note.lane * laneW + 6;
    ctx2d.fillStyle = LANE_COLORS[note.lane];
    ctx2d.beginPath();
    ctx2d.roundRect(x, y - NOTE_HEIGHT / 2, laneW - 12, NOTE_HEIGHT, 5);
    ctx2d.fill();
  }

  // key labels under the line
  ctx2d.font = '600 13px ui-monospace, monospace';
  ctx2d.textAlign = 'center';
  for (let i = 0; i < LANE_COUNT; i++) {
    ctx2d.fillStyle = 'rgba(255,255,255,0.35)';
    ctx2d.fillText(KEY_LABELS[i], fieldX + (i + 0.5) * laneW, hitY + 26);
  }

  drawPopups(fieldX, laneW, hitY);
  drawTimingBar(w, h);
  drawHud();
}

function drawPopups(fieldX, laneW, hitY) {
  ctx2d.textAlign = 'center';
  ctx2d.font = '700 14px system-ui, sans-serif';
  for (const p of popups) {
    const age = (performance.now() - p.born) / 550;
    ctx2d.globalAlpha = 1 - age;
    ctx2d.fillStyle = p.color;
    ctx2d.fillText(p.text, fieldX + (p.lane + 0.5) * laneW, hitY - 42 - age * 26);
  }
  ctx2d.globalAlpha = 1;
}

// A tick for each recent hit: left of centre = early, right = late. If your
// ticks cluster to one side, that's your offset telling you what it wants.
function drawTimingBar(w, h) {
  const barW = 200, x = (w - barW) / 2, y = h - 26;
  ctx2d.fillStyle = 'rgba(255,255,255,0.08)';
  ctx2d.fillRect(x, y, barW, 6);
  ctx2d.fillStyle = 'rgba(255,255,255,0.4)';
  ctx2d.fillRect(x + barW / 2 - 0.5, y - 3, 1, 12);
  for (let i = 0; i < errors.length; i++) {
    const err = Math.max(-MISS_MS, Math.min(MISS_MS, errors[i]));
    ctx2d.globalAlpha = 0.25 + 0.75 * (i / errors.length);
    ctx2d.fillStyle = (WINDOWS.find(wd => Math.abs(err) <= wd.ms) || MISS).color;
    ctx2d.fillRect(x + barW / 2 + (err / MISS_MS) * (barW / 2) - 1, y - 2, 2, 10);
  }
  ctx2d.globalAlpha = 1;
  ctx2d.font = '10px ui-monospace, monospace';
  ctx2d.fillStyle = 'rgba(255,255,255,0.3)';
  ctx2d.textAlign = 'center';
  ctx2d.fillText('early — late', w / 2, y - 8);
}

function drawHud() {
  const acc = stats.judged ? (stats.weight / stats.judged) * 100 : 100;
  hud.innerHTML = `
    <div class="score">${stats.score.toLocaleString()}</div>
    <div class="acc">${acc.toFixed(2)}%</div>
    <div class="combo ${stats.combo > 0 ? 'on' : ''}">${stats.combo > 1 ? stats.combo + 'x' : ''}</div>
    <div class="offset">offset ${offsetMs > 0 ? '+' : ''}${offsetMs} ms</div>`;
}

function hexToRgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
