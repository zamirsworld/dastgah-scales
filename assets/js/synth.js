// Tuning synth: plays a recording's measured scale with WebAudio.
//
// No recording audio is hosted. This is a plain additive "plucked string" voice
// whose pitch comes straight from the measured Hz, so you hear the tuning, not
// the performance. The AudioContext is created on the first click, which is what
// browsers' autoplay rules require.

let ctx = null;
let master = null;
let drone = null;
let timers = [];
let active = [];

const TIMBRE = {
  // partial amplitudes and decay time (s): santur bright and ringing, plucked lutes darker and shorter
  santur: { partials: [1, 0.55, 0.42, 0.25, 0.18, 0.12, 0.08, 0.05], decay: 2.6 },
  setar:  { partials: [1, 0.7, 0.35, 0.3, 0.15, 0.12, 0.06], decay: 1.5 },
  tar:    { partials: [1, 0.75, 0.45, 0.32, 0.2, 0.12, 0.08], decay: 1.7 },
  default:{ partials: [1, 0.5, 0.3, 0.2, 0.1], decay: 1.8 },
};

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

export function pluck(hz, { instrument = "default", when = 0, gain = 0.32 } = {}) {
  const ac = audio();
  const t = TIMBRE[instrument] || TIMBRE.default;
  const t0 = ac.currentTime + 0.02 + when;
  const out = ac.createGain();
  out.gain.setValueAtTime(0, t0);
  out.gain.linearRampToValueAtTime(gain, t0 + 0.004);
  out.gain.exponentialRampToValueAtTime(0.0008, t0 + t.decay);
  out.connect(master);
  const oscs = t.partials.map((amp, i) => {
    const n = i + 1;
    if (hz * n > ac.sampleRate / 2.2) return null;
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.frequency.value = hz * n;
    // higher partials die faster, like a real string
    g.gain.setValueAtTime(amp / t.partials.length, t0);
    g.gain.exponentialRampToValueAtTime(0.0005, t0 + t.decay / (1 + 0.35 * i));
    o.connect(g).connect(out);
    o.start(t0);
    o.stop(t0 + t.decay + 0.05);
    return o;
  }).filter(Boolean);
  active.push(...oscs);
  return t0;
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
