// chart.js — the song, written as text.
//
// One pattern feeds BOTH the music and the notes you have to hit. That's on
// purpose: if the chart is generated from the same data as the audio, the notes
// can never disagree with what you hear. (In a bigger game these split apart
// and you author charts by hand — but this is the honest place to start.)
//
// Each bar is 16 steps (16th notes). Read a row left to right:
//   'x' = hit this step,  '.' = rest
// The lead row uses digits 1-6 instead of 'x': the digit picks a note from the
// scale below, so you can write a melody by typing numbers.

import { SEC_PER_STEP, SEC_PER_BAR } from './audio.js';

export const LANE_COUNT = 4;
export const KEYS = ['KeyD', 'KeyF', 'KeyJ', 'KeyK'];
export const KEY_LABELS = ['D', 'F', 'J', 'K'];

// A minor pentatonic. Degrees 1-6 as used in the lead rows.
const SCALE = [220.00, 261.63, 293.66, 329.63, 392.00, 440.00];

// Which lane each instrument falls in.
const LANE = {
  kick: 0,
  leadLow: 1,
  leadHigh: 2,
  snare: 3,
};

// The hi-hat is heard but never charted — it's the pulse, not a note to hit.
const BARS = [
  // 0: intro
  { kick: 'x...x...x...x...', snare: '................', hat: 'x.x.x.x.x.x.x.x.', lead: '................' },
  // 1: basic beat
  { kick: 'x...x...x...x...', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.', lead: '................' },
  // 2: melody enters
  { kick: 'x...x...x...x...', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.', lead: '1...3...5...3...' },
  // 3: fill
  { kick: 'x...x...x..x....', snare: '....x.......x.x.', hat: 'x.x.x.x.x.x.x.x.', lead: '5...4...3...2...' },
  // 4: busy
  { kick: 'x..xx...x..xx...', snare: '....x.......x...', hat: 'xxxxxxxxxxxxxxxx', lead: '1...2...3...5...' },
  // 5: climax
  { kick: 'x...x...x...x...', snare: '....x...x...x.x.', hat: 'xxxxxxxxxxxxxxxx', lead: '6...5...3...1...' },
];

// The arrangement: which bar pattern plays when. 32 bars ≈ 60 seconds at 128 BPM.
const ARRANGEMENT = [
  0, 0, 1, 1,
  2, 2, 3, 3,
  1, 1, 2, 2,
  4, 4, 5, 5,
  2, 2, 3, 3,
  4, 4, 5, 5,
  2, 2, 1, 1,
  0, 0, 1, 3,
];

// The first two bars are a count-in: you hear them, you don't play them.
const COUNT_IN_BARS = 2;

export function buildSong() {
  const audio = [];   // what you hear   -> [{ time, voice, freq? }]
  const notes = [];   // what you play   -> [{ time, lane, judged, result }]

  ARRANGEMENT.forEach((patternIndex, barIndex) => {
    const bar = BARS[patternIndex];
    const barStart = barIndex * SEC_PER_BAR;
    const charted = barIndex >= COUNT_IN_BARS;

    for (let step = 0; step < 16; step++) {
      const t = barStart + step * SEC_PER_STEP;

      if (bar.kick[step] === 'x') {
        audio.push({ time: t, voice: 'kick' });
        if (charted) notes.push(makeNote(t, LANE.kick));
      }
      if (bar.snare[step] === 'x') {
        audio.push({ time: t, voice: 'snare' });
        if (charted) notes.push(makeNote(t, LANE.snare));
      }
      if (bar.hat[step] === 'x') {
        audio.push({ time: t, voice: 'hat' });   // audio only
      }
      const degree = bar.lead[step];
      if (degree >= '1' && degree <= '6') {
        const freq = SCALE[Number(degree) - 1];
        audio.push({ time: t, voice: 'lead', freq });
        if (charted) {
          notes.push(makeNote(t, Number(degree) <= 3 ? LANE.leadLow : LANE.leadHigh));
        }
      }
    }
  });

  audio.sort((a, b) => a.time - b.time);
  notes.sort((a, b) => a.time - b.time);

  const duration = ARRANGEMENT.length * SEC_PER_BAR;
  return { audio, notes, duration };
}

function makeNote(time, lane) {
  return { time, lane, judged: false, result: null };
}
