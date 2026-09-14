# rhythm-game

A 4-key rhythm game that runs in the browser. Plain HTML, Canvas and Web Audio —
no framework, no build step, no dependencies, no audio files.

Notes fall down four lanes. Hit `D` `F` `J` `K` as they cross the line.

## Run it

Because the code uses ES modules, opening `index.html` by double-clicking won't
work (browsers block module loading over `file://`). Serve the folder instead:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

Any static server works — `npx serve`, VS Code's Live Server, whatever you have.

## How it works

Three files, each one idea.

### `src/audio.js` — the clock

The rule that makes or breaks a rhythm game: **time comes from the audio
hardware, not the frame loop.** `AudioContext.currentTime` is driven by the same
clock that pushes samples to your speakers, so it can never drift away from what
you hear. `Date.now()` and frame counting both drift, and a few milliseconds of
drift is the whole difference between "tight" and "broken".

Sounds aren't played when it's time — they're *scheduled* ahead of time. A timer
wakes every 25 ms, looks 150 ms into the future, and hands those hits to Web
Audio with an exact start time. Web Audio fires them sample-accurately even if
the main thread stutters. (This is the classic ["A Tale of Two
Clocks"](https://web.dev/articles/audio-scheduling) pattern.)

The kick, snare, hat and lead are tiny synths — an oscillator or a burst of
noise shaped by a gain envelope. Nothing is sacred in there; retune it.

### `src/chart.js` — the song, written as text

Each bar is 16 steps. `x` = hit, `.` = rest:

```js
{ kick: 'x...x...x...x...', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.', lead: '1...3...5...3...' }
```

The `lead` row takes digits `1`–`6` instead of `x` — each digit picks a note from
an A-minor-pentatonic scale, so you write a melody by typing numbers.

One pattern generates **both** the music and the notes you hit. That's on
purpose: a chart derived from the same data as the audio can never disagree with
what you hear. The hi-hat is the exception — heard but never charted, because
it's the pulse, not a note.

`ARRANGEMENT` lists which bar plays when. The first two bars are a count-in: you
hear them, you don't play them.

### `src/game.js` — input, judgment, drawing

A note's position is pure arithmetic, not animation:

```js
y = hitLineY - (note.time - now) * SCROLL_SPEED
```

At `note.time === now` it sits exactly on the line. Nothing is advanced
"per frame" — frames are just when we happen to look.

Judgment windows, in milliseconds either side of the note's true time:

| | window | points | accuracy weight |
|---|---|---|---|
| PERFECT | ±45 ms | 300 | 100% |
| GREAT | ±90 ms | 200 | 75% |
| GOOD | ±135 ms | 100 | 40% |
| MISS | beyond ±135 ms | 0 | 0% |

Pressing a key with no note nearby costs nothing — mashing is allowed, it just
won't score. Notes you never press miss themselves once they're 180 ms past.

## The offset (why your hits feel late)

Every set of speakers and every screen lies about when things happen. Bluetooth
headphones can be 150 ms behind. So the game has a personal offset, nudged with
`[` and `]` and saved in your browser.

The timing bar at the bottom shows your recent hits — left is early, right is
late. **If the ticks cluster to one side, that's the offset telling you what it
wants.** The results screen does the arithmetic for you and suggests a number.

Positive offset = "I hear the music later than the game thinks".

## Things to try next

Roughly in order of effort:

- **Retune the feel.** `SCROLL_SPEED` in `game.js` changes how far ahead you can
  read. Tighten `PERFECT` to 30 ms and see how much harder it gets.
- **Write your own bars.** Add patterns to `BARS` and put them in `ARRANGEMENT`.
  This is the fun part and it costs nothing to get wrong.
- **Hold notes.** Give a note a `duration` and score it for being held. This is
  the first change that touches all three files.
- **Load your own MP3.** Swap the synth for an `<audio>` element or a decoded
  buffer, then chart it by hand. You'll need a song offset — recorded music
  rarely starts exactly on beat one.
- **Touch input.** Four tap zones along the bottom and it works on a phone.

## Licence

MIT — see [LICENSE](LICENSE).
