// Tuning synth: plays a recording's measured scale with WebAudio.
//
// No recording audio is hosted. The pitch comes straight from the measured Hz, so
// you hear the tuning, not the performance. Every note is built from the overtones
// measured on a santur (voice.js, timbre-santur.js), whatever instrument the track
// was played on: one sound for the whole library. The AudioContext is created on
// the first click, which is what browsers' autoplay rules require.

import { renderPluck } from "./voice.js?v=18";
import SANTUR from "./timbre-santur.js?v=18";

// The one voice. A setar profile also exists (timbre-setar.js) but is not loaded:
// it did not sound like a setar.
const VOICE = SANTUR;
const GRID_CENTS = 20;       // one rendered note per 20 cents; the exact pitch comes from the playback rate
const MAX_RENDERED = 40;
const rendered = new Map();
let string = null;           // a one-string profile damps the note before; santur courses ring on
let bus = null;              // every measured note passes through here, so Stop can fade them together

let ctx = null;
let master = null;
let drone = null;
let timers = [];
let active = [];

function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) throw new Error("This browser has no Web Audio support.");
    ctx = new AC();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(comp).connect(ctx.destination);
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

function measuredPluck(ac, profile, hz, t0, gain) {
  const step = Math.round(1200 * Math.log2(hz / 440) / GRID_CENTS);
  const gridHz = 440 * 2 ** (step * GRID_CENTS / 1200);
  const key = `${profile.instrument}:${step}`;
  let buf = rendered.get(key);
  if (buf) rendered.delete(key);                       // re-inserted below: the Map keeps the least used first
  else {
    const samples = renderPluck(profile, gridHz, ac.sampleRate);
    buf = ac.createBuffer(1, samples.length, ac.sampleRate);
    buf.getChannelData(0).set(samples);
    if (rendered.size >= MAX_RENDERED) rendered.delete(rendered.keys().next().value);
  }
  rendered.set(key, buf);
  const src = ac.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = hz / gridHz;
  const g = ac.createGain();
  g.gain.setValueAtTime(gain / 0.32, t0);
  if (!bus) { bus = ac.createGain(); bus.connect(master); }
  src.connect(g).connect(bus);
  src.start(t0);
  if (!profile.ring) {
    if (string && string.t0 <= t0) {                   // the finger moves on: the earlier note is damped
      string.g.gain.setTargetAtTime(0, t0, 0.015);
      try { string.src.stop(t0 + 0.2); } catch (_) { /* already stopped */ }
    }
    string = { src, g, t0 };
  }
  active.push(src);
  return t0;
}

// `instrument` is accepted for the callers' sake; every instrument plays with the one voice.
export function pluck(hz, { when = 0, gain = 0.32 } = {}) {
  const ac = audio();
  return measuredPluck(ac, VOICE, hz, ac.currentTime + 0.02 + when, gain);
}

// Play a list of Hz in order. onStep(i) is called as each note sounds; onDone at the end.
export function sequence(hzs, { instrument, step = 0.48, onStep, onDone } = {}) {
  stopSequence();
  audio();
  hzs.forEach((hz, i) => {
    pluck(hz, { instrument, when: i * step });
    if (onStep) timers.push(setTimeout(() => onStep(i), i * step * 1000 + 20));
  });
  timers.push(setTimeout(() => { if (onDone) onDone(); }, hzs.length * step * 1000 + 300));
}

export function stopSequence() {
  timers.forEach(clearTimeout);
  timers = [];
  const now = ctx ? ctx.currentTime : 0;
  active.forEach((o) => { try { o.stop(now + 0.03); } catch (_) { /* already stopped */ } });
  active = [];
  string = null;
  if (bus) { bus.gain.setTargetAtTime(0, now, 0.008); bus = null; }   // fade what is sounding; the next note gets a new bus
}

// A soft sustained drone on the tonic (and its octave below), at the measured Hz.
export function setDrone(hz) {
  const ac = audio();
  if (drone) {
    const d = drone;
    d.gain.gain.setTargetAtTime(0, ac.currentTime, 0.15);
    setTimeout(() => d.oscs.forEach((o) => o.stop()), 900);
    drone = null;
  }
  if (!hz) return false;
  const gain = ac.createGain();
  gain.gain.setValueAtTime(0, ac.currentTime);
  gain.gain.setTargetAtTime(0.09, ac.currentTime, 0.3);
  const lp = ac.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = Math.min(2400, hz * 6);
  gain.connect(lp).connect(master);
  const oscs = [[hz, "triangle", 1], [hz / 2, "sine", 0.8], [hz * 2, "sine", 0.18]].map(([f, type, a]) => {
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = type;
    o.frequency.value = f;
    g.gain.value = a;
    o.connect(g).connect(gain);
    o.start();
    return o;
  });
  drone = { gain, oscs };
  return true;
}

export const droneOn = () => drone !== null;

// ── which Hz to play for each scale degree ─────────────────────────────────

const ET = (cents) => Math.round(cents / 100) * 100;

// Measured Hz of a pitch in the octave that starts at the tonic, if that register was
// played; otherwise the tonic Hz moved by the pitch's measured cents.
export function degreeHz(c, cents, pitchId, { tempered = false } = {}) {
  const base = c.tonic.hz;
  if (tempered) return base * 2 ** (ET(cents) / 1200);
  const p = c.pitches.find((x) => x.id === pitchId);
  const lo = base * 2 ** (-25 / 1200), hi = base * 2 ** (1175 / 1200);
  const reg = p && p.registers.find((r) => r.hz >= lo && r.hz < hi);
  return reg ? reg.hz : base * 2 ** (cents / 1200);
}

// Ascending scale from the tonic to its octave (measured upper tonic if played), then back down.
export function scaleHz(c, opts = {}) {
  const up = c.scale.degrees.map((d) => degreeHz(c, d.cents_from_tonic, d.pitch_id, opts));
  const tonicPitch = c.pitches.find((p) => p.id === c.scale.degrees[0].pitch_id);
  const octTarget = c.tonic.hz * 2;
  const measuredOct = !opts.tempered && tonicPitch &&
    tonicPitch.registers.find((r) => Math.abs(1200 * Math.log2(r.hz / octTarget)) < 30);
  up.push(measuredOct ? measuredOct.hz : octTarget);
  return up;
}
