import { saveManager } from './SaveManager'

/**
 * All game sound is SYNTHESISED at runtime with the Web Audio API — no audio
 * files ship, same as the textures (see PreloadScene). That keeps the bundle
 * tiny and lets every sound be soft, warm and consistent: pure sine/triangle
 * tones through a gentle low-pass with smooth envelopes, tuned to a pentatonic
 * scale so nothing is ever harsh. The goal is ASMR-adjacent — a quiet, tactile
 * "plip" as a bee pops free, a sticky "gloop" when one glues into honey.
 *
 * iOS/WKWebView starts the AudioContext suspended until a user gesture, so
 * `unlock()` is called from the first pointer down. Every method no-ops when
 * the context is unavailable or the player muted SFX, so audio can never break
 * or block play.
 */

type Wave = 'sine' | 'triangle'

/** A2..: pentatonic-friendly semitone offsets from a base, for pleasant runs. */
const PENTATONIC = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21]

interface BlipOpts {
  freq: number
  /** Slide to this frequency over the note (portamento); defaults to no slide. */
  freqTo?: number
  durMs: number
  type?: Wave
  gain?: number
  attackMs?: number
  /** Low-pass cutoff for warmth; omit for a fully open tone. */
  cutoff?: number
  /** Cents of detune on a doubled voice, for a subtle chorus shimmer. */
  detune?: number
  delayMs?: number
}

class AudioManager {
  private ctx?: AudioContext
  private master?: GainNode
  private unlocked = false

  private get on(): boolean {
    return saveManager.get().settings.sfx
  }

  /** Resume the context on a user gesture (required on iOS). Safe to call often. */
  unlock(): void {
    if (this.unlocked) return
    try {
      this.ensure()
      void this.ctx?.resume()
      this.unlocked = true
    } catch {
      // No Web Audio (very old webview) — the game simply plays silent.
    }
  }

  private ensure(): void {
    if (this.ctx) return
    const Ctor =
      (globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
        .AudioContext ??
      (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    this.ctx = new Ctor()
    this.master = this.ctx.createGain()
    this.master.gain.value = 0.5
    this.master.connect(this.ctx.destination)
  }

  /** One enveloped voice (optionally doubled + detuned) through a soft low-pass. */
  private blip(o: BlipOpts): void {
    if (!this.on) return
    this.ensure()
    const ctx = this.ctx
    const master = this.master
    if (!ctx || !master) return
    if (ctx.state === 'suspended') void ctx.resume()

    const t0 = ctx.currentTime + (o.delayMs ?? 0) / 1000
    const dur = o.durMs / 1000
    const attack = Math.min((o.attackMs ?? 8) / 1000, dur * 0.5)
    const peak = o.gain ?? 0.3

    const env = ctx.createGain()
    env.gain.setValueAtTime(0.0001, t0)
    env.gain.exponentialRampToValueAtTime(peak, t0 + attack)
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)

    let out: AudioNode = env
    if (o.cutoff) {
      const lp = ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = o.cutoff
      env.connect(lp)
      out = lp
    }
    out.connect(master)

    const voices = o.detune ? [-o.detune, o.detune] : [0]
    for (const cents of voices) {
      const osc = ctx.createOscillator()
      osc.type = o.type ?? 'sine'
      osc.frequency.setValueAtTime(o.freq, t0)
      if (o.freqTo) osc.frequency.exponentialRampToValueAtTime(o.freqTo, t0 + dur)
      osc.detune.value = cents
      osc.connect(env)
      osc.start(t0)
      osc.stop(t0 + dur + 0.02)
    }
  }

  private note(semitones: number, base = 440): number {
    return base * Math.pow(2, semitones / 12)
  }

  // ── Game events ────────────────────────────────────────────────────────────

  /** Bee pops free — a soft rising "plip"; climbs the scale as a combo builds. */
  escape(combo = 1): void {
    const step = PENTATONIC[Math.min(combo - 1, PENTATONIC.length - 1)]
    const f = this.note(step, 523.25) // C5 base
    this.blip({ freq: f, freqTo: f * 1.5, durMs: 180, type: 'sine', gain: 0.28, attackMs: 4, cutoff: 3500, detune: 5 })
  }

  /** Honey collected on landing — a bright rising two-note "ding". */
  collect(): void {
    this.blip({ freq: this.note(7, 659), durMs: 120, type: 'sine', gain: 0.2, attackMs: 3, cutoff: 5200, detune: 5 })
    this.blip({ freq: this.note(12, 659), durMs: 170, type: 'sine', gain: 0.18, attackMs: 3, cutoff: 5200, detune: 5, delayMs: 70 })
  }

  /** Bee glues into fresh honey — a sticky descending "gloop". */
  stuck(): void {
    this.blip({ freq: 320, freqTo: 150, durMs: 240, type: 'triangle', gain: 0.3, attackMs: 6, cutoff: 900, detune: 8 })
    this.blip({ freq: 160, freqTo: 90, durMs: 260, type: 'sine', gain: 0.16, attackMs: 10, cutoff: 500, delayMs: 20 })
  }

  /** Bee bumps a wall and bounces back — a soft muted thud. */
  bump(): void {
    this.blip({ freq: 180, freqTo: 120, durMs: 120, type: 'triangle', gain: 0.24, attackMs: 3, cutoff: 700 })
  }

  /** Level cleared — a warm ascending arpeggio. */
  win(): void {
    const chord = [0, 4, 7, 12, 16] // major, spanning an octave+
    chord.forEach((s, i) => {
      this.blip({
        freq: this.note(s, 523.25),
        durMs: 520 - i * 40,
        type: 'sine',
        gain: 0.22,
        attackMs: 10,
        cutoff: 4000,
        detune: 4,
        delayMs: i * 90,
      })
    })
  }

  /** Out of moves — a gentle descending sigh, never harsh. */
  fail(): void {
    this.blip({ freq: this.note(3, 392), durMs: 260, type: 'sine', gain: 0.22, attackMs: 12, cutoff: 2000 })
    this.blip({ freq: this.note(-2, 392), durMs: 420, type: 'sine', gain: 0.2, attackMs: 14, cutoff: 1600, delayMs: 150 })
  }

  /** A star slams in — a bright little sparkle, pitched up per star. */
  star(index: number): void {
    this.blip({ freq: this.note(index * 4, 880), durMs: 220, type: 'sine', gain: 0.2, attackMs: 3, cutoff: 6000, detune: 6 })
  }

  /** Soft UI click for buttons and menu taps. */
  tap(): void {
    this.blip({ freq: 660, freqTo: 520, durMs: 60, type: 'sine', gain: 0.14, attackMs: 2, cutoff: 3000 })
  }

  /** Pressing a bee to aim — a barely-there upward tick, softer than tap(). */
  press(): void {
    this.blip({ freq: 520, freqTo: 580, durMs: 45, type: 'sine', gain: 0.08, attackMs: 2, cutoff: 2400 })
  }

  /** Tapping an immovable wall — a short dull thud: "that does not move". */
  deny(): void {
    this.blip({ freq: 110, freqTo: 90, durMs: 110, type: 'triangle', gain: 0.14, attackMs: 3, cutoff: 420 })
  }

  /** The queen escaped early — a stern descending minor two-note, not a chime. */
  queenFail(): void {
    this.blip({ freq: this.note(0, 392), durMs: 200, type: 'triangle', gain: 0.26, attackMs: 4, cutoff: 1400 })
    this.blip({ freq: this.note(-6, 392), durMs: 380, type: 'triangle', gain: 0.24, attackMs: 6, cutoff: 1000, delayMs: 140 })
  }

  /** Undo — a quick reverse-whoosh: down-then-up, reads as "step back". */
  undo(): void {
    this.blip({ freq: 500, freqTo: 300, durMs: 90, type: 'sine', gain: 0.16, attackMs: 3, cutoff: 2000 })
    this.blip({ freq: 300, freqTo: 460, durMs: 110, type: 'sine', gain: 0.14, attackMs: 4, cutoff: 2000, delayMs: 80 })
  }

  /** The moves counter dropped below what the bees need — a single alert. */
  warning(): void {
    this.blip({ freq: 740, freqTo: 700, durMs: 160, type: 'triangle', gain: 0.2, attackMs: 3, cutoff: 2600 })
    this.blip({ freq: 740, freqTo: 700, durMs: 160, type: 'triangle', gain: 0.16, attackMs: 3, cutoff: 2600, delayMs: 190 })
  }
}

export const audioManager = new AudioManager()
