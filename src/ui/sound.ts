import { useSyncExternalStore } from 'react'
import type { BattleFx } from './fx'

/**
 * The battle, heard.
 *
 * Every sound is synthesised — no files to load, nothing to license, and a
 * few hundred bytes of code instead of a megabyte of samples. The Web Audio
 * graph is built per voice and torn down when it finishes, so an idle battle
 * costs nothing.
 *
 * The design brief was "never annoying", which turns out to be mostly a list
 * of things not to do:
 *
 *  - Nothing starts or stops at a non-zero gain. Every envelope ramps, so
 *    there are no clicks — the single most fatiguing artefact in synthesised
 *    audio.
 *  - Everything goes through a gentle master low-pass. Raw oscillators are
 *    harsh in the top octaves, and harshness is what makes game audio tiring
 *    long before loudness does.
 *  - A broadside is eight mounts firing. Eight identical blasts at full gain
 *    is a machine gun, so simultaneous voices are counted and progressively
 *    attenuated, and each is detuned a little: the volley reads as one ragged
 *    salvo rather than a burst of clones.
 *  - Nothing plays while the tab is hidden, and the whole thing is off until
 *    the player asks for it.
 *
 * Sound is decoration: it never touches game state, is never journaled, and
 * uses Math.random freely — unlike the engine, which may not.
 */

const MUTE_KEY = 'sfc.sound-muted.v1'
const VOLUME_KEY = 'sfc.sound-volume.v1'

/** Quiet enough to leave on while doing something else. */
const DEFAULT_VOLUME = 0.55

function readStored(): { muted: boolean; volume: number } {
  try {
    const muted = localStorage.getItem(MUTE_KEY)
    const volume = Number(localStorage.getItem(VOLUME_KEY))
    return {
      // Off until asked for: a game that starts making noise is a bad guest.
      muted: muted === null ? true : muted === '1',
      volume: Number.isFinite(volume) && volume > 0 ? Math.min(1, volume) : DEFAULT_VOLUME,
    }
  } catch {
    return { muted: true, volume: DEFAULT_VOLUME }
  }
}

let state = readStored()

let version = 0
const listeners = new Set<() => void>()
function emit(): void {
  version += 1
  for (const l of listeners) l()
}

export interface SoundState {
  muted: boolean
  volume: number
}

export function useSound(): SoundState {
  useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => version,
    () => version,
  )
  return state
}

export function setMuted(muted: boolean): void {
  state = { ...state, muted }
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0')
  } catch {
    // Only the preference is lost.
  }
  if (muted) stopAll()
  emit()
}

export function setVolume(volume: number): void {
  const clamped = Math.max(0, Math.min(1, volume))
  state = { ...state, volume: clamped }
  try {
    localStorage.setItem(VOLUME_KEY, String(clamped))
  } catch {
    // Only the preference is lost.
  }
  if (master && ctx) master.gain.setTargetAtTime(masterGain(), ctx.currentTime, 0.02)
  emit()
}

// ---------------------------------------------------------------------------
// The audio graph
// ---------------------------------------------------------------------------

let ctx: AudioContext | null = null
let master: GainNode | null = null
let noise: AudioBuffer | null = null
let live: AudioScheduledSourceNode[] = []

/**
 * The ceiling, measured rather than guessed. Rendered offline: a hull hit
 * peaks at 0.30 with the slider where it starts and 0.44 wide open, an
 * eight-mount broadside at 0.35 — quieter than the single hit, which is the
 * crowding rule working — and thirty-two voices in the same instant at 0.71
 * without a clipped sample, which is the limiter working. Audible on laptop
 * speakers, with headroom left over.
 */
function masterGain(): number {
  return 0.7 * state.volume
}

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (ctx) {
    // Browsers suspend the context until a gesture; a click got us here.
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  }
  const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  ctx = new Ctor()
  master = ctx.createGain()
  master.gain.value = masterGain()
  // Takes the glare off every voice at once.
  const tame = ctx.createBiquadFilter()
  tame.type = 'lowpass'
  tame.frequency.value = 7200
  /**
   * A safety limiter, and it earns its place: attenuating crowded voices is
   * not enough on its own, because the floor that keeps a big salvo audible
   * still sums past full scale when a dozen impacts resolve in the same
   * instant. Measured before this existed, sixteen at once peaked at 1.05 and
   * clipped — the harshest noise a synth can make. The compressor catches
   * those pileups and glues the mix instead.
   */
  const limiter = ctx.createDynamicsCompressor()
  limiter.threshold.value = -14
  limiter.knee.value = 6
  limiter.ratio.value = 14
  limiter.attack.value = 0.003
  limiter.release.value = 0.22
  master.connect(tame).connect(limiter).connect(ctx.destination)

  // One second of white noise, reused by every explosive voice.
  noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
  const data = noise.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  return ctx
}

function stopAll(): void {
  for (const node of live) {
    try {
      node.stop()
    } catch {
      // Already finished.
    }
  }
  live = []
}

/** Track a source so a mute mid-battle silences it, and forget it when done. */
function track(node: AudioScheduledSourceNode): void {
  live.push(node)
  node.onended = () => {
    live = live.filter((n) => n !== node)
  }
}

/**
 * Simultaneous voices, attenuated. A volley's mounts land within a few tens
 * of milliseconds of each other; without this they sum into a wall.
 */
const scheduled: number[] = []
function crowdingAt(when: number): number {
  const cutoff = when - 3
  while (scheduled.length > 0 && scheduled[0] < cutoff) scheduled.shift()
  const near = scheduled.filter((t) => Math.abs(t - when) < 0.09).length
  scheduled.push(when)
  return Math.max(0.22, 1 / (1 + near * 0.8))
}

/** A gain node with a ramped envelope — never a click. */
function envelope(at: number, peak: number, attack: number, hold: number, release: number): GainNode {
  const c = ctx!
  const gain = c.createGain()
  gain.gain.setValueAtTime(0.0001, at)
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), at + attack)
  gain.gain.setValueAtTime(Math.max(0.0002, peak), at + attack + hold)
  gain.gain.exponentialRampToValueAtTime(0.0001, at + attack + hold + release)
  return gain
}

function tone(
  at: number,
  type: OscillatorType,
  from: number,
  to: number,
  duration: number,
  peak: number,
  filter?: { type: BiquadFilterType; frequency: number; q?: number },
): void {
  const c = ctx!
  const osc = c.createOscillator()
  osc.type = type
  osc.frequency.setValueAtTime(from, at)
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), at + duration)
  const gain = envelope(at, peak, 0.008, duration * 0.25, duration * 0.75)
  let node: AudioNode = osc
  if (filter) {
    const biquad = c.createBiquadFilter()
    biquad.type = filter.type
    biquad.frequency.value = filter.frequency
    if (filter.q !== undefined) biquad.Q.value = filter.q
    node = osc.connect(biquad)
  }
  node.connect(gain).connect(master!)
  osc.start(at)
  osc.stop(at + duration + 0.08)
  track(osc)
}

function hiss(
  at: number,
  duration: number,
  peak: number,
  filter: { type: BiquadFilterType; from: number; to: number; q?: number },
): void {
  const c = ctx!
  const source = c.createBufferSource()
  source.buffer = noise!
  source.loop = true
  const biquad = c.createBiquadFilter()
  biquad.type = filter.type
  biquad.frequency.setValueAtTime(filter.from, at)
  biquad.frequency.exponentialRampToValueAtTime(Math.max(40, filter.to), at + duration)
  if (filter.q !== undefined) biquad.Q.value = filter.q
  const gain = envelope(at, peak, 0.006, duration * 0.2, duration * 0.8)
  source.connect(biquad).connect(gain).connect(master!)
  source.start(at)
  source.stop(at + duration + 0.08)
  track(source)
}

/** A little variation, so a broadside is a salvo and not a copy machine. */
function wobble(spread = 0.08): number {
  return 1 + (Math.random() * 2 - 1) * spread
}

// ---------------------------------------------------------------------------
// The voices
// ---------------------------------------------------------------------------

type Voice = 'phaser' | 'disruptor' | 'torpedo' | 'shield' | 'hull'

function play(voice: Voice, at: number, level: number): void {
  switch (voice) {
    // A bright bolt, falling fast. Short enough to fire five of in a row.
    case 'phaser':
      tone(at, 'triangle', 1500 * wobble(), 420 * wobble(), 0.16, 0.32 * level, {
        type: 'bandpass',
        frequency: 1300,
        q: 1.4,
      })
      return
    // Heavier and dirtier: a saw through a low filter, with grit under it.
    case 'disruptor':
      tone(at, 'sawtooth', 760 * wobble(), 150 * wobble(), 0.2, 0.24 * level, {
        type: 'lowpass',
        frequency: 1500,
        q: 3,
      })
      hiss(at, 0.14, 0.07 * level, { type: 'bandpass', from: 900, to: 300, q: 1.2 })
      return
    // A launch, not a shot: a soft thump and the seeker running away.
    case 'torpedo':
      tone(at, 'sine', 150 * wobble(0.05), 58, 0.28, 0.34 * level)
      hiss(at + 0.02, 0.42, 0.09 * level, { type: 'lowpass', from: 420, to: 1800 })
      return
    // Absorbed: a filtered shimmer, rising as it dissipates.
    case 'shield':
      hiss(at, 0.3, 0.1 * level, { type: 'bandpass', from: 700, to: 2100, q: 2.2 })
      tone(at, 'sine', 640 * wobble(0.06), 880, 0.26, 0.11 * level)
      return
    // Through the shields: a low hit with debris in it.
    case 'hull':
      tone(at, 'sine', 190 * wobble(0.06), 46, 0.34, 0.4 * level)
      hiss(at + 0.01, 0.3, 0.13 * level, { type: 'lowpass', from: 1600, to: 220 })
      return
  }
}

// ---------------------------------------------------------------------------
// What the battle sounds like
// ---------------------------------------------------------------------------

const VOICE_FOR_WEAPON: Record<string, Voice> = {
  phaser: 'phaser',
  disruptor: 'disruptor',
  torpedo: 'torpedo',
  generic: 'phaser',
}

/**
 * Sound a batch of battle effects, using the delays the visuals already
 * carry — so the noise lands with the flash rather than beside it.
 */
export function soundFx(batch: BattleFx[]): void {
  if (state.muted || batch.length === 0) return
  if (typeof document !== 'undefined' && document.hidden) return
  const c = audio()
  if (!c || !master) return

  const now = c.currentTime + 0.02
  for (const fx of batch) {
    const at = now + fx.delay / 1000
    const level = crowdingAt(at)
    if (fx.kind === 'shot') play(VOICE_FOR_WEAPON[fx.weapon] ?? 'phaser', at, level)
    else play(fx.impact === 'shield' ? 'shield' : 'hull', at, level)
  }
}
