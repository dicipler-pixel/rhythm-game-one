// game.js — input, judgment, and drawing.
//
// The loop is deliberately boring: every frame, ask the Conductor what time it
// is, put everything where it should be at that time, draw. Nothing is advanced
// "per frame" — frames are just when we happen to look.

import { Conductor, SEC_PER_BEAT } from './audio.js';
import { buildSong, LANE_COUNT, KEYS, KEY_LABELS } from './chart.js';

// --- tuning knobs ----------------------------------------------------------

// Judgment windows, in milliseconds either side of the note's true time.
// Tightening PERFECT makes the game harder in the most honest way there is.
const WINDOWS = [
  { name: 'PERFECT', ms: 45,  score: 300, weight: 1.00, color: '#ffd84d' },
  { name: 'GREAT',   ms: 90,  score: 200, weight: 0.75, color: '#5ce6a0' },
  { name: 'GOOD',    ms: 135, score: 100, weight: 0.40, color: '#3ecfff' },
];
const MISS_MS = 180;          // press this far off and the note is gone
const MISS = { name: 'MISS', ms: MISS_MS, score: 0, weight: 0, color: '#ff4d6d' };

const SCROLL_SPEED = 620;     // pixels a note travels per second
const NOTE_HEIGHT = 20;

const AMBER = '#ffb020';
const CYAN  = '#3ecfff';
const LANE_COLORS = [AMBER, CYAN, CYAN, AMBER];

const DISPLAY_FONT = '"Chakra Petch", system-ui, sans-serif';
const DATA_FONT = '"JetBrains Mono", ui-monospace, monospace';

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// --- setup -----------------------------------------------------------------

const canvas = document.getElementById('stage');
const ctx2d = canvas.getContext('2d');
const overlay = document.getElementById('overlay');
const overlayBody = document.getElementById('overlay-body');
const hud = document.getElementById('hud');

const conductor = new Conductor();

// Built once up front so the menu can show a real chart header.
const CHART = buildSong();

let state = 'menu';           // 'menu' | 'playing' | 'results'
let song = null;
let notes = [];
let stats = null;
let popups = [];              // floating PERFECT / GREAT / ... text
let errors = [];              // recent hit errors in ms, for the timing bar
let errorSum = 0;             // every hit's error, for the results average
let errorCount = 0;
const laneFlash = new Array(LANE_COUNT).fill(0);
const laneHeld = new Array(LANE_COUNT).fill(false);

// Your personal audio/video offset, in milliseconds. Positive means "I hear the
// music later than the game thinks", so you'll naturally hit late. Every rhythm
// game needs this, because every set of speakers and every screen lies about
// when things happen. Adjust with [ and ]; it's saved in the browser.
let offsetMs = readOffset();

function readOffset() {
  // localStorage throws outright when site data is blocked, so never assume it.
  try { return Number(localStorage.getItem('rg.offset')) || 0; } catch { return 0; }
}

resize();
window.addEventListener('resize', resize);
requestAnimationFrame(frame);
showMenu();

// --- layout ----------------------------------------------------------------

function resize() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(canvas.clientWidth * dpr);
  canvas.height = Math.round(canvas.clientHeight * dpr);
  ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function layout() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const fieldW = Math.min(440, w - 32);
  const laneW = fieldW / LANE_COUNT;
  return { w, h, fieldX: (w - fieldW) / 2, fieldW, laneW, hitY: h * 0.80 };
}

// --- screens ---------------------------------------------------------------

function showMenu() {
  state = 'menu';
  hud.hidden = true;
  overlay.hidden = false;
  const mins = Math.floor(CHART.duration / 60);
  const secs = Math.round(CHART.duration % 60).toString().padStart(2, '0');
  overlayBody.innerHTML = `
    <h1>rhythm-game</h1>
    <p class="sub">Notes fall. Hit them as they cross the line.</p>
    <dl class="chart-info">
      <div><dt>BPM</dt><dd>128</dd></div>
      <div><dt>Keys</dt><dd>4</dd></div>
      <div><dt>Notes</dt><dd>${CHART.notes.length}</dd></div>
      <div><dt>Length</dt><dd>${mins}:${secs}</dd></div>
    </dl>
    <div class="keys">
      ${KEY_LABELS.map((k, i) => `<kbd style="--c:${LANE_COLORS[i]}">${k}</kbd>`).join('')}
    </div>
    <button id="play">Play</button>
    <p class="hint">
      Two bars of count-in first — listen, then play.<br>
      <b>[</b> <b>]</b> nudge your timing offset
      (now <b>${offsetMs > 0 ? '+' : ''}${offsetMs} ms</b>) · <b>Esc</b> quits a run
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
  const mean = errorCount ? errorSum / errorCount : 0;
  const drifting = Math.abs(mean) > 20;

  overlayBody.innerHTML = `
    <h1>${acc >= 95 ? 'Clean.' : acc >= 80 ? 'Solid.' : 'Run it again.'}</h1>
    <p class="sub">
      ${acc.toFixed(2)}% accuracy · ${stats.score.toLocaleString()} points
      · ${stats.maxCombo}&times; max combo
    </p>
    <table class="results">${rows}</table>
    <p class="hint">
      Average hit error <b>${mean > 0 ? '+' : ''}${mean.toFixed(1)} ms</b>
      ${mean > 0 ? '(late)' : mean < 0 ? '(early)' : ''}
      ${drifting ? `<br>Try an offset of <b>${Math.round(offsetMs + mean)} ms</b>` : ''}
    </p>
    <button id="again">Play again</button>`;
  document.getElementById('again').onclick = startGame;
}

function startGame() {
  song = buildSong();          // a fresh copy, so no note is still marked judged
  notes = song.notes;
  stats = { score: 0, combo: 0, maxCombo: 0, judged: 0, weight: 0, counts: {} };
  popups = [];
  errors = [];
  errorSum = 0;
  errorCount = 0;
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
  if (state === 'menu' && (e.code === 'Space' || e.code === 'Enter')) {
    // A focused button already starts the game on Enter/Space via its click.
    if (!(e.target instanceof HTMLButtonElement)) startGame();
    return;
  }
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
  try { localStorage.setItem('rg.offset', String(offsetMs)); } catch { /* not fatal */ }
  if (state === 'menu') showMenu();   // the menu is the only place it's otherwise invisible
}

// The moment the player believes it is, in song seconds.
function judgeTime() {
  return conductor.time - offsetMs / 1000;
}

function judgePress(lane) {
  const now = judgeTime();
  let best = null;
  let bestErr = Infinity;

  // The closest unjudged note in this lane that's still within reach.
  for (const note of notes) {
    if (note.judged || note.lane !== lane) continue;
    const err = (now - note.time) * 1000;      // positive = you were late
    if (err < -MISS_MS) break;                 // sorted, so the rest are further away
    if (Math.abs(err) < Math.abs(bestErr)) { best = note; bestErr = err; }
  }
  if (!best) return;                           // nothing there — a free press, no penalty

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
    // The multiplier caps, so a bad opening doesn't sink the whole run.
    stats.score += Math.round(verdict.score * (1 + Math.min(stats.combo, 100) / 100));
    errors.push(errMs);
    if (errors.length > 50) errors.shift();
    errorSum += errMs;
    errorCount++;
  }

  popups.push({ text: verdict.name, color: verdict.color, lane: note.lane, born: performance.now() });
}

// --- the loop --------------------------------------------------------------

function frame() {
  requestAnimationFrame(frame);
  if (state === 'playing') { update(); draw(); }
}

function update() {
  const now = judgeTime();

  // Notes you never pressed fall out of the window and miss themselves.
  for (const note of notes) {
    if (note.judged) continue;
    if (now - note.time > MISS_MS / 1000) applyJudgment(note, MISS, MISS_MS);
    else break;                                 // sorted: everything after is still ahead
  }

  for (let i = 0; i < LANE_COUNT; i++) laneFlash[i] = Math.max(0, laneFlash[i] - 0.08);
  popups = popups.filter(p => performance.now() - p.born < 550);

  // Let the last notes land before rolling the results.
  if (conductor.time > song.duration + 1.5) showResults();
}

function draw() {
  const { w, h, fieldX, fieldW, laneW, hitY } = layout();
  // Notes are drawn against the SAME clock we judge with, so "press when it
  // touches the line" stays literally true whatever your offset is.
  const t = judgeTime();

  ctx2d.clearRect(0, 0, w, h);

  // the playfield: a lit column on a dark ground
  const field = ctx2d.createLinearGradient(0, 0, 0, h);
  field.addColorStop(0, 'rgba(18, 15, 29, 0.35)');
  field.addColorStop(0.78, 'rgba(24, 19, 40, 0.92)');
  field.addColorStop(1, 'rgba(14, 11, 24, 0.92)');
  ctx2d.fillStyle = field;
  ctx2d.fillRect(fieldX, 0, fieldW, h);

  ctx2d.fillStyle = 'rgba(255, 255, 255, 0.05)';
  for (let i = 1; i < LANE_COUNT; i++) ctx2d.fillRect(fieldX + i * laneW - 0.5, 0, 1, h);
  ctx2d.fillRect(fieldX - 0.5, 0, 1, h);
  ctx2d.fillRect(fieldX + fieldW - 0.5, 0, 1, h);

  // key-press glow, rising off the hit line
  for (let i = 0; i < LANE_COUNT; i++) {
    const a = Math.max(laneFlash[i], laneHeld[i] ? 0.3 : 0);
    if (a <= 0) continue;
    const g = ctx2d.createLinearGradient(0, hitY - 190, 0, hitY);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(1, hexToRgba(LANE_COLORS[i], 0.3 * a));
    ctx2d.fillStyle = g;
    ctx2d.fillRect(fieldX + i * laneW, hitY - 190, laneW, 190);
  }

  // The hit line breathes on the beat — the one piece of motion here, and it's
  // the thing the whole game is about.
  const beat = reducedMotion ? 0 : Math.max(0, 1 - ((t / SEC_PER_BEAT) % 1) * 3.5);
  ctx2d.fillStyle = `rgba(242, 236, 247, ${0.55 + 0.35 * beat})`;
  ctx2d.fillRect(fieldX, hitY - 1.5, fieldW, 3);
  if (beat > 0.01) {
    ctx2d.fillStyle = hexToRgba(AMBER, 0.16 * beat);
    ctx2d.fillRect(fieldX, hitY - 9, fieldW, 18);
  }

  // Notes: distance above the line is just (time until it lands) x speed.
  for (const note of notes) {
    if (note.judged) continue;
    const y = hitY - (note.time - t) * SCROLL_SPEED;
    if (y < -NOTE_HEIGHT || y > h + NOTE_HEIGHT) continue;
    ctx2d.fillStyle = LANE_COLORS[note.lane];
    ctx2d.beginPath();
    ctx2d.roundRect(fieldX + note.lane * laneW + 5, y - NOTE_HEIGHT / 2, laneW - 10, NOTE_HEIGHT, 4);
    ctx2d.fill();
  }

  // key labels below the line
  ctx2d.font = `500 12px ${DATA_FONT}`;
  ctx2d.textAlign = 'center';
  for (let i = 0; i < LANE_COUNT; i++) {
    ctx2d.fillStyle = laneHeld[i] ? LANE_COLORS[i] : '#4d4760';
    ctx2d.fillText(KEY_LABELS[i], fieldX + (i + 0.5) * laneW, hitY + 28);
  }

  drawPopups(fieldX, laneW, hitY);
  drawTimingBar(w, h);
  drawHud();
}

function drawPopups(fieldX, laneW, hitY) {
  ctx2d.textAlign = 'center';
  ctx2d.font = `700 13px ${DISPLAY_FONT}`;
  for (const p of popups) {
    const age = (performance.now() - p.born) / 550;
    ctx2d.globalAlpha = 1 - age;
    ctx2d.fillStyle = p.color;
    ctx2d.fillText(p.text, fieldX + (p.lane + 0.5) * laneW, hitY - 44 - age * 24);
  }
  ctx2d.globalAlpha = 1;
}

// One tick per recent hit: left of centre is early, right is late. If your
// ticks cluster to one side, that's your offset telling you what it wants.
function drawTimingBar(w, h) {
  const barW = 196, x = (w - barW) / 2, y = h - 30;

  ctx2d.fillStyle = 'rgba(255, 255, 255, 0.06)';
  ctx2d.fillRect(x, y, barW, 5);
  ctx2d.fillStyle = 'rgba(242, 236, 247, 0.35)';
  ctx2d.fillRect(x + barW / 2 - 0.5, y - 3, 1, 11);

  for (let i = 0; i < errors.length; i++) {
    const err = Math.max(-MISS_MS, Math.min(MISS_MS, errors[i]));
    ctx2d.globalAlpha = 0.2 + 0.8 * (i / errors.length);
    ctx2d.fillStyle = (WINDOWS.find(wd => Math.abs(err) <= wd.ms) || MISS).color;
    ctx2d.fillRect(x + barW / 2 + (err / MISS_MS) * (barW / 2) - 1, y - 2, 2, 9);
  }
  ctx2d.globalAlpha = 1;

  ctx2d.font = `400 9px ${DATA_FONT}`;
  ctx2d.fillStyle = '#4d4760';
  ctx2d.textAlign = 'left';
  ctx2d.fillText('EARLY', x, y - 8);
  ctx2d.textAlign = 'right';
  ctx2d.fillText('LATE', x + barW, y - 8);
}

let lastHud = '';
function drawHud() {
  const acc = stats.judged ? (stats.weight / stats.judged) * 100 : 100;
  const html = `
    <div class="score">${stats.score.toLocaleString()}</div>
    <div class="acc">${acc.toFixed(2)}%</div>
    <div class="combo ${stats.combo > 1 ? 'on' : ''}">${stats.combo > 1 ? stats.combo + '×' : ''}</div>
    <div class="offset">OFFSET ${offsetMs > 0 ? '+' : ''}${offsetMs} ms</div>`;
  if (html !== lastHud) { hud.innerHTML = html; lastHud = html; }
}

function hexToRgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
