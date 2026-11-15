// A plucked note built from a measured overtone profile (see timbre-setar.js).
//
// Each partial starts at the level measured for it and dies at the rate measured
// for it; partials sit slightly sharp of the harmonic series by the measured
// stiffness of the string; a short burst of filtered noise stands for the nail
// on the string. Nothing here is a recording: the note is computed from the
// numbers. Pure function, no Web Audio, so it also runs under node for checks.

const MAX_SECONDS = 2.6;
const TOP_HZ = 12000;

// Levels and decays for this pitch: the two nearest measured registers, mixed by distance in pitch.
export function partialsAt(profile, hz) {
  const a = profile.anchors;
  let i = 0;
  while (i < a.length - 2 && hz > a[i + 1].hz) i++;
  const lo = a[i], hi = a[Math.min(i + 1, a.length - 1)];
  const w = hi === lo ? 0 : Math.min(1, Math.max(0, Math.log(hz / lo.hz) / Math.log(hi.hz / lo.hz)));
  const n = Math.max(lo.level.length, hi.level.length);
  const at = (arr, k, missing) => (k < arr.length ? arr[k] : missing);
  const out = [];
  for (let k = 0; k < n; k++) {
    out.push({
      level: (1 - w) * at(lo.level, k, -60) + w * at(hi.level, k, -60),
      decay: (1 - w) * at(lo.decay, k, lo.decay[lo.decay.length - 1]) + w * at(hi.decay, k, hi.decay[hi.decay.length - 1]),
    });
  }
  return out;
}

function noiseSource(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 2147483648 - 1;
  };
}

// One note as samples. `noise` is the level of the pluck burst against the strongest partial.
export function renderPluck(profile, hz, sampleRate, { noise = 0.5 } = {}) {
  const parts = partialsAt(profile, hz);
  const B = profile.inharmonicity || 0;
  const slowest = Math.max(...parts.filter((p) => p.level > -12).map((p) => p.decay));   // dB/s, negative
  const seconds = Math.min(MAX_SECONDS, Math.max(0.8, 55 / -slowest));
  const N = Math.round(seconds * sampleRate);
  const out = new Float32Array(N);

  parts.forEach((p, i) => {
    const k = i + 1;
    const f = k * hz * Math.sqrt(1 + B * k * k);
    if (f > TOP_HZ || f > sampleRate * 0.45) return;
    const amp = 10 ** (p.level / 20);
    const r = 10 ** (p.decay / 20 / sampleRate);          // amplitude kept from one sample to the next
    const w = 2 * Math.PI * f / sampleRate;
    // decaying sine by recurrence: s[n] = 2 r cos(w) s[n-1] - r^2 s[n-2]
    const c1 = 2 * r * Math.cos(w), c2 = r * r;
    const last = Math.min(N, Math.ceil(Math.log(1e-4 / amp) / Math.log(r)));   // until 80 dB under the top partial
    let s2 = 0, s1 = amp * r * Math.sin(w);
    if (last > 1) out[1] += s1;
    for (let n = 2; n < last; n++) {
      const s = c1 * s1 - c2 * s2;
      out[n] += s;
      s2 = s1; s1 = s;
    }
  });

  // the pluck: white noise through two gentle low-pass stages, gone in a few hundredths of a second
  if (noise > 0) {
    const rnd = noiseSource(Math.round(hz * 100));
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
