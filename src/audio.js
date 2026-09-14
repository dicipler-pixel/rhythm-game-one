// audio.js — the clock and the sound.
//
// The single most important idea in a rhythm game:
//   TIME COMES FROM THE AUDIO HARDWARE, NOT FROM THE FRAME LOOP.
//
// `AudioContext.currentTime` is driven by the same clock that actually pushes
// samples to your speakers, so it can never drift away from what the player
// hears. `Date.now()` and "count the frames" both drift, and a handful of
// milliseconds of drift is exactly the difference between a game that feels
// tight and one that feels broken.
//
// The second idea: we don't *play* sounds when it's time, we *schedule* them
// slightly ahead of time. A timer wakes up every SCHEDULE_TICK ms, looks
// LOOKAHEAD seconds into the future, and hands those notes to Web Audio with an
// exact start time. Web Audio then fires them sample-accurately, even if the
// main thread stutters. (This is the classic "A Tale of Two Clocks" pattern.)

export const BPM = 128;
export const SEC_PER_BEAT = 60 / BPM;
export const SEC_PER_STEP = SEC_PER_BEAT / 4;   // one 16th note
export const SEC_PER_BAR = SEC_PER_BEAT * 4;

const LOOKAHEAD = 0.15;      // seconds of future we schedule
const SCHEDULE_TICK = 25;    // ms between scheduler wake-ups

export class Conductor {
  constructor() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    // 'interactive' asks the browser for the smallest buffer it can manage,
    // which means less delay between "schedule" and "hear".
    this.ctx = new Ctx({ latencyHint: 'interactive' });

    this.master = this.ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(this.ctx.destination);

    this.noise = makeNoiseBuffer(this.ctx);

    this.startedAt = null;   // ctx.currentTime at which song time 0 happens
    this.events = [];
    this.nextEvent = 0;
    this.timer = null;
  }

  // How far the speakers are behind `currentTime`. The player reacts to sound
  // that has actually come OUT, so this is subtracted from song time.
  get outputLatency() {
    return this.ctx.outputLatency || this.ctx.baseLatency || 0;
  }

  // Song time in seconds: 0 = the first beat of the song.
  // Negative before the song starts (we schedule a short run-up).
  get time() {
    if (this.startedAt === null) return 0;
    return this.ctx.currentTime - this.startedAt - this.outputLatency;
  }

  async start(events) {
    // Browsers keep the audio context suspended until a user gesture.
    if (this.ctx.state === 'suspended') await this.ctx.resume();

    clearInterval(this.timer);                     // never leave two schedulers running
    this.events = events;
    this.nextEvent = 0;
    this.startedAt = this.ctx.currentTime + 0.2;   // small run-up
    this.timer = setInterval(() => this._schedule(), SCHEDULE_TICK);
    this._schedule();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    this.startedAt = null;
  }

  _schedule() {
    const horizon = this.ctx.currentTime + LOOKAHEAD;
    while (this.nextEvent < this.events.length) {
      const ev = this.events[this.nextEvent];
      const when = this.startedAt + ev.time;
      if (when > horizon) break;
      this._play(ev, Math.max(when, this.ctx.currentTime));
      this.nextEvent++;
    }
  }

  _play(ev, when) {
    switch (ev.voice) {
      case 'kick':  return this._kick(when);
      case 'snare': return this._snare(when);
      case 'hat':   return this._hat(when);
      case 'lead':  return this._lead(when, ev.freq);
    }
  }

  // --- the instruments -----------------------------------------------------
  // Each one is a tiny synth: an oscillator or a burst of noise, shaped by a
  // gain envelope that falls to silence. Nothing here is sacred — retune it.

  _kick(t) {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    gain.gain.setValueAtTime(1.0, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    osc.connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.3);
  }

  _snare(t) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1900;
    bp.Q.value = 0.7;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.5, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    src.connect(bp).connect(gain).connect(this.master);
    src.start(t);
    src.stop(t + 0.2);

    // a little body under the noise so it reads as a drum, not a hiss
    const osc = this.ctx.createOscillator();
    const og = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(190, t);
    og.gain.setValueAtTime(0.35, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    osc.connect(og).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.12);
  }

  _hat(t) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7500;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.14, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.045);
    src.connect(hp).connect(gain).connect(this.master);
    src.start(t);
    src.stop(t + 0.06);
  }

  _lead(t, freq) {
    const osc = this.ctx.createOscillator();
    const lp = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = freq;
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2600, t);
    lp.frequency.exponentialRampToValueAtTime(700, t + 0.2);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.22, t + 0.008);  // fast attack
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22); // short decay
    osc.connect(lp).connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.25);
  }
}

function makeNoiseBuffer(ctx) {
  const len = Math.floor(ctx.sampleRate * 0.4);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}
