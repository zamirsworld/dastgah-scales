// A plucked or struck note built from a measured overtone profile (timbre-*.js).
//
// Each partial starts at the level measured for it and dies at the rate measured
// for it; partials sit slightly sharp of the harmonic series by the measured
// stiffness of the string; a short burst of filtered noise stands for the nail or
// the hammer. An instrument with several strings to a note (santur) gets that many
// copies of every partial, a few cents apart: they start together and drift out of
// step, which is the shimmer of a real course, plus a quieter part that rings on.
// Nothing here is a recording: the note is computed from the numbers. Pure
// function, no Web Audio, so it also runs under node for checks.

const TOP_HZ = 12000;

function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 2147483648 - 1;      // -1 to 1
  };
}

// Levels, decays and stiffness for this pitch: the two nearest measured notes, mixed by distance in pitch.
export function partialsAt(profile, hz) {
  const a = profile.anchors;
  let i = 0;
  while (i < a.length - 2 && hz > a[i + 1].hz) i++;
  const lo = a[i], hi = a[Math.min(i + 1, a.length - 1)];
  const w = hi === lo ? 0 : Math.min(1, Math.max(0, Math.log(hz / lo.hz) / Math.log(hi.hz / lo.hz)));
  const mix = (x, y) => (1 - w) * x + w * y;
  const at = (arr, k, missing) => (k < arr.length ? arr[k] : missing);
  const B = lo.stiffness !== undefined ? mix(lo.stiffness, hi.stiffness) : (profile.inharmonicity || 0);
  const n = Math.max(lo.level.length, hi.level.length);
  const out = [];
  for (let k = 0; k < n; k++) {
    const f = (k + 1) * hz * Math.sqrt(1 + B * (k + 1) * (k + 1));
    out.push({
      hz: f,
      level: mix(at(lo.level, k, -60), at(hi.level, k, -60)),
      decay: lo.decay
        ? mix(at(lo.decay, k, lo.decay[lo.decay.length - 1]), at(hi.decay, k, hi.decay[hi.decay.length - 1]))
        : profile.decay[0] + profile.decay[1] * f / 1000,
    });
  }
  return out;
}

// Adds amp * 10^(decay * t / 20) * sin(2 pi f t) to out, by recurrence: s[n] = 2 r cos(w) s[n-1] - r^2 s[n-2].
function addPartial(out, amp, f, decay, sampleRate) {
  const r = 10 ** (decay / 20 / sampleRate);              // amplitude kept from one sample to the next
  const w = 2 * Math.PI * f / sampleRate;
  const c1 = 2 * r * Math.cos(w), c2 = r * r;
  const last = Math.min(out.length, Math.ceil(Math.log(3e-5 / amp) / Math.log(r)));   // until 90 dB under the top partial
  let s2 = 0, s1 = amp * r * Math.sin(w);
  if (last > 1) out[1] += s1;
  for (let n = 2; n < last; n++) {
    const s = c1 * s1 - c2 * s2;
    out[n] += s;
    s2 = s1; s1 = s;
  }
}

// One note as samples. Options override the profile's own settings (used when tuning the voice).
export function renderPluck(profile, hz, sampleRate, opts = {}) {
  const p = { ...profile, ...opts };
  const parts = partialsAt(p, hz);
  const strings = p.strings || 1;
  const rnd = seeded(Math.round(hz * 100));
  let seconds = p.seconds;
  if (!seconds) {
    const slowest = Math.max(...parts.filter((q) => q.level > -12).map((q) => q.decay));   // dB/s, negative
    seconds = Math.min(2.6, Math.max(0.8, 55 / -slowest));
  }
  const N = Math.round(seconds * sampleRate);
  const out = new Float32Array(N);

  // how far each string of the course is from the note, in cents (they average to zero)
  const offsets = Array.from({ length: strings }, () => rnd());
  const mean = offsets.reduce((a, b) => a + b, 0) / strings;
  const detune = offsets.map((u) => 2 ** ((u - mean) * (p.cents || 0) / 1200));

  for (const q of parts) {
    if (q.hz > TOP_HZ || q.hz > sampleRate * 0.45 || q.level < -55) continue;
    const amp = 10 ** (q.level / 20);
    for (let j = 0; j < strings; j++) {
      const rate = strings > 1 ? q.decay * (1 + 0.2 * rnd()) : q.decay;
      addPartial(out, amp / strings, q.hz * detune[j], rate, sampleRate);
    }
    if (p.aftersound) {
      const slow = p.aftersound.decay[0] + p.aftersound.decay[1] * q.hz / 1000;
      addPartial(out, amp * 10 ** (p.aftersound.db / 20), q.hz * 2 ** (0.4 * rnd() / 1200), slow, sampleRate);
    }
  }

  // the nail or the hammer: white noise through two gentle low-pass stages, gone in a few hundredths of a second
  const noise = p.strike === undefined ? 0.5 : p.strike;
  if (noise > 0) {
    const a1 = 1 - Math.exp(-2 * Math.PI * 500 / sampleRate);
    const a2 = 1 - Math.exp(-2 * Math.PI * 3500 / sampleRate);
    const fall = Math.exp(-1 / (0.012 * sampleRate));
    let y1 = 0, y2 = 0, env = noise * 6;
    const len = Math.min(N, Math.round(0.09 * sampleRate));
    for (let n = 0; n < len; n++) {
      y1 += a1 * (rnd() - y1);
      y2 += a2 * (y1 - y2);
      out[n] += env * y2;
      env *= fall;
    }
  }

  // even loudness from note to note (RMS of the first quarter second), and a short fade at the end
  const head = Math.min(N, Math.round(0.25 * sampleRate));
  let sum = 0;
  for (let n = 0; n < head; n++) sum += out[n] * out[n];
  const g = 0.16 / Math.sqrt(sum / head || 1);
  const fade = Math.round(0.08 * sampleRate);
  for (let n = 0; n < N; n++) out[n] *= g * (n > N - fade ? (N - n) / fade : 1);
  return out;
}
