import { saveManager } from './SaveManager'
import { audioManager } from './AudioManager'

/**
 * Background music, SYNTHESISED like every other sound in the game — no audio
 * file ships (see AudioManager and PreloadScene for the same choice made about
 * sound and art). A loop file good enough for hours of play would be the single
 * largest asset in the bundle; this is a few hundred lines of oscillators.
 *
 * The brief is a puzzle game people play in long sittings, so the failure mode
 * to design against is not "boring" but "grating". Three things follow from it:
 *
 *  - **It never repeats exactly.** A fixed four-chord bed (Cmaj7 – Am7 – Fmaj7 –
 *    G6, ~68 BPM) carries the harmony, while the melody picks from a handful of
 *    written pentatonic motifs, transposed and voiced differently each pass. The
 *    ear hears the same piece; it never hears the same bar twice.
 *  - **It sits UNDER the game.** Everything is soft sine/triangle through a low
 *    -pass, mixed well below the effects, and `duck()` pulls it down further for
 *    a moment so a win or a collect always reads over it.
 *  - **It is sparse.** Long pad notes, a root every bar, and a melody note on
 *    maybe half the beats. Density is what makes loops tiring.
 *
 * Scheduling uses the standard Web Audio look-ahead: a coarse timer wakes up
 * often and schedules notes a short way into the future against the audio
 * clock, so tempo never drifts and a stalled frame cannot make it stutter.
 */

/** Semitones from C, per chord, voiced low-to-high. The bed. */
const PROGRESSION: number[][] = [
  [0, 7, 11, 16], // Cmaj7
  [-3, 4, 9, 12], // Am7
  [-7, 5, 9, 12], // Fmaj7
  [-5, 7, 9, 14], // G6
]

/** C major pentatonic, in semitones, over two octaves. */
const PENT = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21]

/**
 * Melody motifs as INDICES into PENT, with `null` for a rest. Written rather
 * than randomised: pure random pentatonic wanders and stops sounding composed.
 * Variation comes from which motif plays, where it starts, and which octave.
 */
const MOTIFS: Array<Array<number | null>> = [
  [4, null, 5, 4, null, 2, null, null],
  [2, 4, null, 5, null, null, 4, null],
  [5, 4, 2, null, 4, null, null, null],
  [null, 2, 4, 7, null, 5, null, null],
  [7, null, 5, null, 4, 2, null, null],
  [null, null, 4, 5, 7, null, 5, null],
]

const BPM = 68
const BEAT = 60 / BPM
const BEATS_PER_BAR = 4
/** How far ahead of the audio clock we schedule, and how often we wake up. */
const LOOKAHEAD_S = 1.2
const TICK_MS = 300

class MusicManager {
  private ctx?: AudioContext
  private bus?: GainNode
  private timer?: ReturnType<typeof setInterval>
  private nextNoteTime = 0
  private bar = 0
  private beat = 0
  private started = false
  /** Deterministic-ish variation without a seeded RNG dependency. */
  private step = 0

  private get wanted(): boolean {
    return saveManager.get().settings.music
  }

  /**
   * Begin (or resume) the music if the player wants it. Safe to call on every
   * user gesture — the audio context can only be started from one, and this is
   * idempotent.
   */
  start(): void {
    try {
      this.startInner()
    } catch {
      // Same contract as the effects: audio can never break or block play.
      this.started = false
    }
  }

  private startInner(): void {
    if (!this.wanted) return
    const ctx = audioManager.context()
    if (!ctx) return
    // Rebuild the bus if the context changed under us. There is normally one
    // context for the life of the app, but a bus belonging to a dead context is
    // silent while looking perfectly healthy — the worst kind of audio bug.
    if (!this.bus || this.ctx !== ctx) {
      this.bus = ctx.createGain()
      this.bus.gain.value = 0
      // Straight to the destination, NOT through the effects master: music has
      // its own level and must be duckable without touching the effects.
      this.bus.connect(ctx.destination)
    }
    this.ctx = ctx
    if (ctx.state === 'suspended') void ctx.resume()
    this.fadeTo(1, 2.5) // ease in — music that snaps on sounds like a mistake
    if (this.started) return
    this.started = true
    this.nextNoteTime = ctx.currentTime + 0.1
    this.timer = setInterval(() => this.schedule(), TICK_MS)
  }

  /** Fade out and stop scheduling. */
  stop(): void {
    this.fadeTo(0, 0.6)
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    this.started = false
  }

  /** Re-read the setting: start or stop to match it. */
  refresh(): void {
    if (this.wanted) this.start()
    else this.stop()
  }

  /**
   * Pull the music down for a moment so a celebration reads over it, then bring
   * it back. Used by the win fanfare — a chord competing with a pad at equal
   * level sounds like neither.
   */
  duck(seconds = 2.2, to = 0.28): void {
    const ctx = this.ctx
    const bus = this.bus
    if (!ctx || !bus || !this.started) return
    const now = ctx.currentTime
    bus.gain.cancelScheduledValues(now)
    bus.gain.setValueAtTime(Math.max(bus.gain.value, 0.0001), now)
    bus.gain.linearRampToValueAtTime(MusicManager.LEVEL * to, now + 0.12)
    bus.gain.setValueAtTime(MusicManager.LEVEL * to, now + seconds * 0.6)
    bus.gain.linearRampToValueAtTime(MusicManager.LEVEL, now + seconds)
  }

  /** Music level relative to the effects. Deliberately low: this is a bed. */
  private static readonly LEVEL = 0.34

  private fadeTo(mult: number, seconds: number): void {
    const ctx = this.ctx
    const bus = this.bus
    if (!ctx || !bus) return
    const now = ctx.currentTime
    bus.gain.cancelScheduledValues(now)
    bus.gain.setValueAtTime(Math.max(bus.gain.value, 0.0001), now)
    bus.gain.linearRampToValueAtTime(MusicManager.LEVEL * mult, now + seconds)
  }

  /** Schedule every beat that falls inside the look-ahead window. */
  private schedule(): void {
    const ctx = this.ctx
    if (!ctx || !this.started) return
    if (!this.wanted) {
      this.stop()
      return
    }
    // Bounded catch-up. A suspended or stalled context can leave `currentTime`
    // far ahead of where we scheduled to; replaying every missed beat would
    // dump hundreds of voices into one frame. Skip the gap instead.
    if (ctx.currentTime - this.nextNoteTime > 2) this.nextNoteTime = ctx.currentTime + 0.05
    while (this.nextNoteTime < ctx.currentTime + LOOKAHEAD_S) {
      this.playBeat(this.nextNoteTime)
      this.nextNoteTime += BEAT
      this.beat++
      if (this.beat >= BEATS_PER_BAR) {
        this.beat = 0
        this.bar++
        this.step++
      }
    }
  }

  private playBeat(t: number): void {
    const chord = PROGRESSION[this.bar % PROGRESSION.length]

    if (this.beat === 0) {
      // Pad: the chord held across the whole bar, quiet and very soft-edged.
      for (const s of chord) {
        this.voice(t, this.hz(s, 261.63), BEAT * BEATS_PER_BAR * 0.98, {
          type: 'sine',
          gain: 0.035,
          attack: 0.9,
          cutoff: 1100,
          detune: 4,
        })
      }
      // Root an octave down — the floor the rest of it stands on.
      this.voice(t, this.hz(chord[0] - 12, 261.63), BEAT * 2.4, {
        type: 'sine',
        gain: 0.05,
        attack: 0.12,
        cutoff: 420,
      })
    }

    // Melody: one motif per bar, re-voiced each pass. Half its slots are rests.
    const motif = MOTIFS[(this.bar + Math.floor(this.step / 4)) % MOTIFS.length]
    // Two melody slots per beat gives an eighth-note grid without ever filling it.
    for (const half of [0, 1]) {
      const idx = motif[this.beat * 2 + half]
      if (idx === null || idx === undefined) continue
      const octave = (this.bar + this.step) % 3 === 0 ? 12 : 0
      const semis = PENT[Math.min(idx, PENT.length - 1)] + octave
      this.voice(t + half * BEAT * 0.5, this.hz(semis, 523.25), BEAT * 0.9, {
        type: 'triangle',
        gain: 0.028,
        attack: 0.02,
        cutoff: 2200,
        detune: 6,
      })
    }
  }

  private hz(semitones: number, base: number): number {
    return base * Math.pow(2, semitones / 12)
  }

  private voice(
    t: number,
    freq: number,
    dur: number,
    o: { type: OscillatorType; gain: number; attack: number; cutoff: number; detune?: number },
  ): void {
    const ctx = this.ctx
    const bus = this.bus
    if (!ctx || !bus) return

    const env = ctx.createGain()
    env.gain.setValueAtTime(0.0001, t)
    env.gain.exponentialRampToValueAtTime(o.gain, t + Math.min(o.attack, dur * 0.5))
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur)

    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = o.cutoff
    env.connect(lp)
    lp.connect(bus)

    for (const cents of o.detune ? [-o.detune, o.detune] : [0]) {
      const osc = ctx.createOscillator()
      osc.type = o.type
      osc.frequency.setValueAtTime(freq, t)
      osc.detune.value = cents
      osc.connect(env)
      osc.start(t)
      osc.stop(t + dur + 0.05)
    }
  }
}

export const musicManager = new MusicManager()

// Backgrounding must silence it. iOS throttles the page but the audio graph can
// keep running, and music leaking out of a game the player has left is the kind
// of thing that gets an app deleted.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) musicManager.stop()
    else musicManager.refresh()
  })
}
