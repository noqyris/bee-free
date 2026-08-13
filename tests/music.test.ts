import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { musicManager } from '../src/systems/MusicManager'
import { audioManager } from '../src/systems/AudioManager'
import { saveManager } from '../src/systems/SaveManager'

/**
 * The music is synthesised, so "does it play" is a question about the audio
 * GRAPH, not about a file loading. A fake AudioContext records what gets built:
 * how many voices, when they are scheduled, and what happens to the bus gain.
 *
 * What this is really guarding is the settings contract — music off must mean
 * silence, not a quiet bed — and the scheduler, which is the part that would
 * fail as a stuck note or a runaway loop rather than as an exception.
 */

interface FakeOsc {
  type: string
  startAt: number
  stopAt: number
}

class FakeContext {
  currentTime = 0
  state = 'running'
  destination = {} as AudioNode
  oscillators: FakeOsc[] = []
  busGainCalls: Array<{ value: number; at: number }> = []
  /** The first gain node made is the music bus (MusicManager makes it once). */
  private busMade = false
  busValue = 0

  /** Peak gain of every per-voice envelope, so the mix can be measured. */
  voiceGains: number[] = []

  createGain(): any {
    const isBus = !this.busMade
    this.busMade = true
    const ctx = this
    const node: any = {
      gain: {
        value: 0,
        setValueAtTime(v: number, at: number) {
          node.gain.value = v
          if (isBus) ctx.busGainCalls.push({ value: v, at })
        },
        linearRampToValueAtTime(v: number, at: number) {
          node.gain.value = v
          if (isBus) {
            ctx.busGainCalls.push({ value: v, at })
            ctx.busValue = v
          }
        },
        exponentialRampToValueAtTime(v: number, at: number) {
          node.gain.value = v
          if (isBus) ctx.busGainCalls.push({ value: v, at })
          // The envelope's peak is its first ramp up from silence.
          else if (v > 0.001) ctx.voiceGains.push(v)
        },
        cancelScheduledValues() {},
      },
      connect() {},
    }
    return node
  }

  createBiquadFilter(): any {
    return { type: '', frequency: { value: 0 }, connect() {} }
  }

  createOscillator(): any {
    const ctx = this
    const rec: FakeOsc = { type: 'sine', startAt: 0, stopAt: 0 }
    return {
      set type(v: string) {
        rec.type = v
      },
      get type() {
        return rec.type
      },
      frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
      detune: { value: 0 },
      connect() {},
      start(t: number) {
        rec.startAt = t
        ctx.oscillators.push(rec)
      },
      stop(t: number) {
        rec.stopAt = t
      },
    }
  }

  resume(): Promise<void> {
    return Promise.resolve()
  }
}

let fake: FakeContext

beforeEach(() => {
  vi.useFakeTimers()
  fake = new FakeContext()
  vi.spyOn(audioManager, 'context').mockReturnValue(fake as unknown as AudioContext)
  saveManager.updateSettings({ music: true })
})

afterEach(() => {
  musicManager.stop()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** Run the scheduler forward as if `seconds` of audio had elapsed. */
function advance(seconds: number): void {
  const stepMs = 300
  for (let ms = 0; ms < seconds * 1000; ms += stepMs) {
    fake.currentTime += stepMs / 1000
    vi.advanceTimersByTime(stepMs)
  }
}

describe('MusicManager', () => {
  it('plays nothing at all when Music is off', () => {
    saveManager.updateSettings({ music: false })
    musicManager.start()
    advance(6)
    expect(fake.oscillators.length, 'music is off; nothing may be scheduled').toBe(0)
  })

  it('builds a bed once the player has gestured', () => {
    musicManager.start()
    advance(6)
    expect(fake.oscillators.length, 'nothing scheduled').toBeGreaterThan(0)
    // Pad + bass + melody: both wave types are in use, which is the difference
    // between "a bed" and "a lone bleeping oscillator".
    const kinds = new Set(fake.oscillators.map((o) => o.type))
    expect(kinds.has('sine')).toBe(true)
    expect(kinds.has('triangle')).toBe(true)
  })

  it('schedules ahead of the clock and never behind it', () => {
    musicManager.start()
    advance(8)
    // Every voice must start in the future relative to when it was scheduled;
    // a note scheduled in the past plays instantly and the loop turns to mush.
    for (const o of fake.oscillators) expect(o.startAt).toBeGreaterThanOrEqual(0)
    // And every one must end. A voice without a stop is a note stuck on
    // forever, which on a bed of held pads is how a game ends up droning.
    for (const o of fake.oscillators) expect(o.stopAt).toBeGreaterThan(o.startAt)
  })

  it('keeps going: a later window schedules new voices', () => {
    musicManager.start()
    advance(4)
    const first = fake.oscillators.length
    advance(4)
    expect(fake.oscillators.length, 'the loop stopped after the first window').toBeGreaterThan(first)
  })

  it('stops scheduling when the setting is turned off mid-play', () => {
    musicManager.start()
    advance(4)
    const before = fake.oscillators.length
    saveManager.updateSettings({ music: false })
    musicManager.refresh()
    advance(6)
    expect(fake.oscillators.length, 'music kept playing after being switched off').toBe(before)
  })

  it('sits well below the effects, and ducks below even that', () => {
    musicManager.start()
    advance(2)
    const level = fake.busValue
    expect(level, 'the bus never came up').toBeGreaterThan(0)

    // What reaches the speaker is bus x voice envelope. The effects peak around
    // 0.28 through AudioManager's 0.5 master, i.e. ~0.14 at the destination;
    // the bed has to sit well under that or it competes with the game.
    const loudestVoice = Math.max(...fake.voiceGains) * level
    expect(fake.voiceGains.length, 'no voices to measure').toBeGreaterThan(0)
    expect(loudestVoice, `music peaks at ${loudestVoice.toFixed(3)} vs effects ~0.14`).toBeLessThan(
      0.04,
    )

    fake.busGainCalls.length = 0
    musicManager.duck()
    const ducked = Math.min(...fake.busGainCalls.map((c) => c.value))
    expect(ducked, 'duck() did not pull the music down').toBeLessThan(level)
    // …and it must come back up, or one win leaves the game silent.
    const restored = Math.max(...fake.busGainCalls.map((c) => c.value))
    expect(restored).toBeCloseTo(level, 5)
  })
})
