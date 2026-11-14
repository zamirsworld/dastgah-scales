// Scale explorer: a scale's steps and its starting note, for up to three pooled tunings.
//
// A tuning here is one master's recordings of one dastgah pooled into a pitch set
// (data/tunings.json, built by `tunelib export`): each note has a share, the fraction of
// the recordings that use it. Row A is the reference.
//
// Views of one state:
//   ring   the reference tuning as a playable ring (after Leimma and Interval): the octave
//          is a circle, the starting note is at the top, each step is a wedge. Clicking a
//          note starts the scale from it; the home-row keys play it, and two or three held
//          keys show the intervals between them.
//   tape   steps as bars on a shared cents axis, one row per tuning. Position on a common
//          scale is the most accurate way to read a size. A's notes are ghosted above the
//          other rows, so a shifted note shows as a gap.
//   table  every starting note of the reference tuning, with its step pattern and the
//          library tuning it most resembles. It is also the exact, screen-readable view.
// Two line-ups: "as sounding" (rows placed by sounding pitch, from A's starting note) and
// "starting notes together" (each row from its own start, shapes only).
// "Hear as" switches the sound between the measured tuning and a tempered grid laid from
// the tonic, and marks the grid on the ring, so the difference is both heard and seen.
// Every tuning names its source (the pooled recordings) and exports as a Scala file.
// Step shades follow Farhat's interval classes, for reference only; note letters on the
// sounding axis are 12-TET at A4 = 440 Hz, for reference only.

import { pluck, sequence, stopSequence } from "./synth.js?v=14";
import { FARHAT } from "./track.js?v=14";
import { filterLibrary } from "./browse.js?v=14";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const mod = (x) => ((x % 1200) + 1200) % 1200;
const cdist = (a, b) => { const d = Math.abs(a - b) % 1200; return Math.min(d, 1200 - d); };
const avg = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const nice = (n) => String(n).replace(/^([A-G])k$/, "$1 koron").replace(/^([A-G])s$/, "$1 sori").replace(/^([A-G])b$/, "$1♭");
const sgn = (x) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x)}`;
const NAT = [["C", 0], ["D", 200], ["E", 400], ["F", 500], ["G", 700], ["A", 900], ["B", 1100]];
const ORD = ["tonic", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th", "10th", "11th", "12th"];
const KEYS = ["a", "s", "d", "f", "g", "h", "j", "k", "l", ";", "'"];
const GRID = { measured: 0, "12": 100, "24": 50 };
const GRID_NAME = { "12": "12-TET", "24": "24-TET (Vaziri's quarter tones)" };
const store = {
  get(k) { try { return window.sessionStorage.getItem(k); } catch (_) { return null; } },
  set(k, v) { try { window.sessionStorage.setItem(k, v); } catch (_) { /* storage blocked: fine */ } },
};

let TUN = [], byId = {}, CLS = [], TOL = 24, src = null, cat = null;
const state = { rows: [], start: [], align: "sounding", hear: "measured" };

function prepare(catalog, data) {
  if (src === data) return;
  src = data; cat = catalog;
  TOL = (data.rules && data.rules.class_tolerance_cents) || 24;
  CLS = (data.step_classes || []).map((c) => ({ id: c.id, cents: c.cents, letter: (FARHAT[c.id] || [c.id])[0], text: (FARHAT[c.id] || [0, c.id])[1] }));
  TUN = data.tunings.map((t) => {
    const m = catalog.masters.find((x) => x.id === t.master) || { id: t.master, name: t.master, albums: [] };
    const d = catalog.dastgahs.find((x) => x.id === t.dastgah) || { id: t.dastgah, name: t.dastgah };
    return { id: t.id, m, d, inst: t.instrument, n: t.n, N: t.n_total, hz: t.tonic.hz, pc: t.tonic.pc_cents, label: t.tonic.label,
      tracks: t.tracks || [], p: t.pitches.map((x) => ({ c: x.cents, share: x.share, name: x.label, main: x.main })) };
  });
  byId = Object.fromEntries(TUN.map((t) => [t.id, t]));
}

const cls = (size) => { let b = null; CLS.forEach((c, k) => { const d = Math.abs(size - c.cents); if (d <= TOL && (!b || d < b.d)) b = { k, d, c }; }); return b; };
const tonicIndex = (t) => { let b = 0; t.p.forEach((p, i) => { if (Math.abs(p.c) < Math.abs(t.p[b].c)) b = i; }); return b; };
function setRows(ids, starts) {
  state.rows = ids.filter((id) => byId[id]).slice(0, 3);
  state.start = state.rows.map((id, r) => {
    const t = byId[id], s = starts && starts[r];
    return Number.isInteger(s) && t.p[s] && t.p[s].main ? s : tonicIndex(t);
  });
}
// Cents of a note above the tuning's tonic note, 0 ≤ x < 1200 (the pooled tonic can sit a fraction of a cent off 0).
const above = (t, c) => { const x = mod(c - t.p[tonicIndex(t)].c); return x > 1199.5 ? 0 : x; };
const startAbs = (r) => { const t = byId[state.rows[r]]; return t.pc + t.p[state.start[r]].c; };
// The same note on the tempered grid laid from the tonic (or unchanged when hearing the measured tuning).
const heard = (t, c) => { const g = GRID[state.hear], a = above(t, c); return g ? Math.round(a / g) * g : a; };

// Where every note of row r falls, in cents from the origin of the current line-up.
function layout(r, own) {
  const t = byId[state.rows[r]], ti = tonicIndex(t);
  const origin = own || state.align === "tonic" ? startAbs(r) : startAbs(0);
  const pts = t.p.map((p, i) => { let x = mod(t.pc + p.c - origin); if (x > 1199.5) x = 0;
    return { ...p, i, x, tonic: i === ti, start: i === state.start[r] }; }).sort((a, b) => a.x - b.x);
  const main = pts.filter((p) => p.main);
  const steps = main.map((p, k) => ({ from: p.x, size: mod(main[(k + 1) % main.length].x - p.x) || 1200 }));
  return { t, pts, main, steps };
}

// Nearest-partner distances both ways, so a note missing from either side counts.
function sim(xs, ys) {
  const a = xs.map((x) => Math.min(...ys.map((y) => cdist(x, y)))), b = ys.map((y) => Math.min(...xs.map((x) => cdist(x, y))));
  const all = a.concat(b);
  return { mean: avg(all), max: Math.max(...all), within: a.filter((d) => d <= 15).length, of: xs.length };
}
// Which other tunings, read from their own tonic, are closest in shape to t started from note si?
function closest(t, si, limit) {
  const xs = t.p.filter((p) => p.main).map((p) => mod(p.c - t.p[si].c));
  return TUN.filter((u) => u.id !== t.id && u.n >= 2).map((u) => {
    const base = u.p[tonicIndex(u)].c;
    return { u, s: sim(xs, u.p.filter((p) => p.main).map((p) => mod(p.c - base))) };
  }).sort((a, b) => a.s.mean - b.s.mean).slice(0, limit);
}
function degreeName(t, i) {
  const main = t.p.map((p, k) => ({ k, c: above(t, p.c), m: p.main })).filter((p) => p.m).sort((a, b) => a.c - b.c);
  const k = main.findIndex((p) => p.k === i);
  return k < 0 ? "" : ORD[k] || `${k + 1}th`;
}

// ── sound ──────────────────────────────────────────────────────────────────

// Hz of the scale of row r, ascending from its starting note to that note an octave up,
// in the tuning chosen under "Hear as". The start is placed between 130 and 260 Hz.
function scaleHz(r) {
  const L = layout(r, true), t = L.t, s0 = heard(t, t.p[state.start[r]].c);
  let base = t.hz * 2 ** (s0 / 1200);
  while (base >= 260) base /= 2;
  while (base < 130) base *= 2;
  const notes = L.main.map((p) => ({ i: p.i, hz: base * 2 ** (mod(heard(t, p.c) - s0) / 1200), x: p.x }));
  notes.push({ i: state.start[r], hz: base * 2, x: 1200, octave: true });
  return notes;
}
function sound(hz, inst) { try { pluck(hz, { instrument: inst }); } catch (_) { /* no Web Audio: stay silent */ } }

// ── ring (reference tuning) ────────────────────────────────────────────────

const RING = { S: 440, R: 142, band: 30 };
const ringXY = (c, r) => { const a = (c / 1200) * 2 * Math.PI, C = RING.S / 2; return [C + r * Math.sin(a), C - r * Math.cos(a)]; };

function ringHTML() {
  const { S, R, band } = RING, C = S / 2, L = layout(0, true), t = L.t, g = GRID[state.hear];
  let s = "";
  if (g) {            // the tempered grid, laid from the tonic
    const off = mod(-above(t, t.p[state.start[0]].c));
    for (let c = 0; c < 1200; c += g) { const [x1, y1] = ringXY(c + off, R + band / 2 + 3), [x2, y2] = ringXY(c + off, R + band / 2 + (c % 100 === 0 ? 11 : 7)); s += `<line class="sc-grid" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`; }
  }
  L.steps.forEach((st) => {
    const c = cls(st.size), a0 = st.from + 3, a1 = st.from + st.size - 3;
    if (a1 > a0) { const [x0, y0] = ringXY(a0, R), [x1, y1] = ringXY(a1, R);
      s += `<path class="${c ? `sc-arc${c.k}` : "sc-arcx"}" d="M${x0},${y0} A${R},${R} 0 ${a1 - a0 > 600 ? 1 : 0} 1 ${x1},${y1}" fill="none" stroke-width="${band}"><title>${st.size.toFixed(0)} ¢${c ? ` · ${c.c.text}` : ""}</title></path>`; }
    const [tx, ty] = ringXY(st.from + st.size / 2, R - band / 2 - 15);
    if (st.size > 60) s += `<text x="${tx}" y="${ty + 4}" text-anchor="middle">${st.size.toFixed(0)}${c ? ` ${c.c.letter}` : ""}</text>`;
  });
  s += `<g id="sc-chords"></g>`;
  L.pts.forEach((p) => {
    const [x, y] = ringXY(p.x, R);
    if (!p.main) { s += `<circle class="sc-beado" cx="${x}" cy="${y}" r="4"><title>${esc(nice(p.name))} · in ${Math.round(p.share * 100)} % of the recordings</title></circle>`; return; }
    const dev = g ? Math.round(above(t, p.c) - heard(t, p.c)) : 0;
    s += `<circle class="sc-bead${p.tonic ? " sc-beadt" : ""}" cx="${x}" cy="${y}" r="${p.start ? 10 : 7.5}" data-r="0" data-i="${p.i}" tabindex="0" role="button"
      aria-label="Start from ${esc(nice(p.name))}"><title>${esc(nice(p.name))} · click to start from it</title></circle>`;
    const [tx, ty] = ringXY(p.x, R + band / 2 + 26);
    s += `<text class="sc-nm" x="${tx}" y="${ty + 4}" text-anchor="middle">${esc(p.name)}${g && dev ? `<tspan class="sc-dev" dx="3">${sgn(dev)}</tspan>` : ""}</text>`;
  });
  s += `<text class="sc-nm sc-mid" x="${C}" y="${C - 6}" text-anchor="middle">${esc(t.d.name)}</text>
    <text id="sc-midsub" x="${C}" y="${C + 13}" text-anchor="middle">from ${esc(nice(t.p[state.start[0]].name))}</text>`;
  return `<svg viewBox="0 0 ${S} ${S}" role="img" aria-label="${esc(t.m.name)}, ${esc(t.d.name)} as a ring of notes, the starting note at the top. The table below has every value.">${s}</svg>`;
}
function keysHTML() {
  const t = byId[state.rows[0]], notes = scaleHz(0).slice(0, KEYS.length);
  return `<div class="sc-keys" role="group" aria-label="Play the reference scale">${notes.map((n, k) =>
    `<button type="button" class="sc-key" data-k="${k}" aria-label="Play ${esc(nice(t.p[n.i].name))}${n.octave ? ", an octave up" : ""}"><kbd>${esc(KEYS[k].toUpperCase())}</kbd><span>${esc(t.p[n.i].name)}${n.octave ? "′" : ""}</span></button>`).join("")}</div>
    <p class="muted sc-hint">Play with these keys or tap them. Hold two or three to read the intervals between them. Clicking a note on the ring starts the scale from it.</p>`;
}

// ── tape ───────────────────────────────────────────────────────────────────

function tapeHTML(W) {
  const pad = 14, pw = W - pad * 2, X = (c) => pad + (c / 1200) * pw;
  const ref = layout(0), H = 86;
  let guides = "";
  if (state.align === "sounding") { const o = startAbs(0);
    NAT.forEach(([n, c]) => { const x = X(mod(c - o)); guides += `<line class="sc-gd" x1="${x}" x2="${x}" y1="14" y2="66"/><text x="${x}" y="10" text-anchor="middle">${n}</text>`; });
  } else for (let c = 0; c <= 1200; c += 100) { const x = X(c);
    guides += `<line class="sc-gd" x1="${x}" x2="${x}" y1="14" y2="66"/>` + (c % 200 === 0 || W > 700 ? `<text x="${x}" y="10" text-anchor="middle">${c}</text>` : ""); }
  return state.rows.map((id, r) => {
    const L = layout(r);
    let s = guides;
    L.steps.forEach((st) => {
      const c = cls(st.size), parts = st.from + st.size > 1200.5 ? [[st.from, 1200], [0, st.from + st.size - 1200]] : [[st.from, st.from + st.size]];
      parts.forEach(([a, b]) => { const x0 = X(a), x1 = X(b);
        if (x1 - x0 > 2) s += `<rect class="${c ? `sc-st${c.k}` : "sc-stx"}" x="${x0 + 1}" y="26" width="${x1 - x0 - 2}" height="20" rx="2"><title>${st.size.toFixed(0)} ¢${c ? ` · ${c.c.text}` : ""}</title></rect>`; });
      const big = parts.sort((p, q) => (q[1] - q[0]) - (p[1] - p[0]))[0], w = X(big[1]) - X(big[0]);
      if (w > 30) s += `<text x="${(X(big[0]) + X(big[1])) / 2}" y="60" text-anchor="middle">${st.size.toFixed(0)}${c && w > 46 ? ` ${c.c.letter}` : ""}</text>`;
    });
    if (r > 0) ref.main.forEach((p) => { s += `<line class="sc-ghost" x1="${X(p.x)}" x2="${X(p.x)}" y1="15" y2="24"/>`; });
    let last = -99;
    L.pts.forEach((p) => {
      const x = X(p.x);
      s += p.main ? `<line class="sc-tk" x1="${x}" x2="${x}" y1="22" y2="50"/>` : `<line class="sc-tko" x1="${x}" x2="${x}" y1="28" y2="44"/>`;
      if (p.tonic) s += `<path class="sc-tonic" d="M${x},50 l6,9 h-12 z"/>`;
      if (p.start) s += `<circle class="sc-start" cx="${x}" cy="19" r="4.5"/>`;
      if (p.main && x - last > 26) { s += `<text class="sc-nm" x="${x}" y="80" text-anchor="middle">${esc(p.name)}</text>`; last = x; }
      if (p.main) s += `<rect class="sc-hit" x="${x - 11}" y="14" width="22" height="70" data-r="${r}" data-i="${p.i}" tabindex="0" role="button"
        aria-label="${esc(L.t.d.name)}: start from ${esc(nice(p.name))}"><title>${esc(nice(p.name))} · in ${Math.round(p.share * 100)} % of the recordings · click to start from it</title></rect>`;
    });
    return `<div class="sc-rowhead"><span class="sc-letter sc-r${r}">${"ABC"[r]}</span>
        <a href="#/master/${esc(L.t.m.id)}">${esc(L.t.m.name)}</a> · <a href="#/dastgah/${esc(L.t.d.id)}">${esc(L.t.d.name)}</a>
        <span class="muted">${L.t.n} recording${L.t.n > 1 ? "s" : ""}${L.t.N > L.t.n ? ` of ${L.t.N}` : ""}, ${esc(L.t.inst)}</span></div>
      <svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(L.t.m.name)}, ${esc(L.t.d.name)}: steps from ${esc(nice(L.t.p[state.start[r]].name))}. The table below has every value.">${s}</svg>`;
  }).join("");
}

// ── mode table (reference tuning) ──────────────────────────────────────────

function tableHTML() {
  const t = byId[state.rows[0]], ti = tonicIndex(t);
  const main = t.p.map((p, i) => ({ i, c: above(t, p.c), name: p.name, m: p.main })).filter((p) => p.m).sort((a, b) => a.c - b.c);
  const n = main.length;
  const head = `<tr><th>Start from</th>${main.slice(1).map((_, k) => `<th class="num">${ORD[k + 1]}</th>`).join("")}<th>Steps</th><th>Closest tuning in the library, from its tonic</th></tr>`;
  const body = main.map((p, k) => {
    const vals = main.map((q) => mod(q.c - p.c)).sort((a, b) => a - b), steps = vals.map((v, j) => (j + 1 < n ? vals[j + 1] : 1200) - v);
    const best = closest(t, p.i, 1)[0];
    return `<tr class="${p.i === state.start[0] ? "sc-cur" : ""}" data-r="0" data-i="${p.i}" tabindex="0" aria-label="Start from ${esc(nice(p.name))}">
      <td><b>${esc(nice(p.name))}</b> <span class="muted">${p.i === ti ? "tonic" : `${ORD[k]} above`}</span></td>
      ${vals.slice(1).map((v) => `<td class="num">${v.toFixed(0)}</td>`).join("")}
      <td class="sc-pat">${steps.map((v) => { const c = cls(v); return c ? c.c.letter : "·"; }).join(" ")}</td>
      <td>${best ? `${esc(best.u.m.name)} · ${esc(best.u.d.name)} <span class="muted">${best.s.mean.toFixed(0)} ¢ off on average</span>` : ""}</td></tr>`;
  }).join("");
  return `<div class="table-wrap"><table class="sc-table"><thead>${head}</thead><tbody>${body}</tbody></table></div>
    <p class="muted">Cents above the starting note. Step letters: ${CLS.map((c) => `${c.letter} ${c.text}`).join(" · ")}; a dot is a step more than ${TOL} ¢ from every class.</p>`;
}

// ── sources and export ─────────────────────────────────────────────────────

function sourcesHTML() {
  return state.rows.map((id, r) => {
    const t = byId[id], keys = new Set(t.tracks);
    const albums = (t.m.albums || []).map((a) => ({ a, n: a.tracks.filter((x) => keys.has(x.key)).length })).filter((x) => x.n);
    return `<div class="sc-src"><span class="sc-letter sc-r${r}">${"ABC"[r]}</span><div>
      <b>${esc(t.m.name)} · ${esc(t.d.name)}</b>, tonic ${esc(nice(t.label))} at ${t.hz.toFixed(1)} Hz, ${esc(t.inst)}.
      Pooled from ${t.n} recording${t.n > 1 ? "s" : ""}${t.N > t.n ? ` (${t.N - t.n} more sit on another tonic and are left out)` : ""}:
      ${albums.map(({ a, n }) => `<a href="#/album/${esc(t.m.id)}/${esc(a.id)}">${esc(a.title)}</a>${a.release_date ? ` (${esc(a.release_date.slice(0, 4))})` : ""}, ${n}`).join("; ") || "recordings not listed"}.
      <span class="sc-nw"><button type="button" class="btn" data-list="${r}">List the recordings</button>
      <button type="button" class="btn" data-scl="${r}">Download as Scala (.scl)</button></span></div></div>`;
  }).join("") + `<p class="muted">A pooled tuning is measured, not prescribed: each note is the median of where the recordings play it, and its share says how many of them do.
    <a href="#/method">How the measurements are made</a>.</p>`;
}
// Scala scale file of row r from its current starting note: the measured notes of the scale, in cents.
function scalaFile(r) {
  const L = layout(r, true), t = L.t, from = t.p[state.start[r]].name;
  const lines = L.main.filter((p) => p.x > 0.5).map((p) => ` ${p.x.toFixed(1)}`);
  return [`! ${t.id}.scl`, "!",
    `${t.m.name}, ${t.d.name}, from ${from}: measured, pooled from ${t.n} recording(s). Dastgah Scales.`,
    ` ${lines.length + 1}`, "!", ...lines, " 2/1", ""].join("\n");
}

// ── controls and readout ───────────────────────────────────────────────────

function optionsHTML(cur, none) {
  const by = new Map();
  TUN.forEach((t) => { if (!by.has(t.m.id)) by.set(t.m.id, []); by.get(t.m.id).push(t); });
  const groups = [...by.values()].sort((a, b) => b.reduce((s, t) => s + t.n, 0) - a.reduce((s, t) => s + t.n, 0));
  return (none ? '<option value="">none</option>' : "") + groups.map((ts) => `<optgroup label="${esc(ts[0].m.name)}">${ts.map((t) =>
    `<option value="${esc(t.id)}"${t.id === cur ? " selected" : ""}>${esc(t.d.name)} on ${esc(nice(t.label))} (${t.n})</option>`).join("")}</optgroup>`).join("");
}
function rowsHTML() {
  const ids = state.rows.concat(state.rows.length < 3 ? [""] : []);
  return ids.map((id, r) => {
    const t = byId[id];
    let from = "add another tuning to compare";
    if (t) { const p = t.p[state.start[r]], dn = degreeName(t, state.start[r]);
      from = `from <b>${esc(nice(p.name))}</b>, ${dn === "tonic" ? "its tonic" : `the ${dn} above its tonic ${esc(nice(t.p[tonicIndex(t)].name))}`}`; }
    return `<div class="sc-rowctl"><span class="sc-letter sc-r${r}">${"ABC"[r]}</span>
      <select data-r="${r}" id="sc-sel${r}" aria-label="Tuning ${"ABC"[r]}">${optionsHTML(id, r > 0)}</select><span class="sc-from">${from}</span>
      <span>${t ? `<button type="button" class="btn" data-play="${r}">▶ Play</button> <button type="button" class="btn" data-reset="${r}">Tonic</button>` : ""}</span></div>`;
  }).join("");
}
function readHTML() {
  const a = byId[state.rows[0]], xs = layout(0).main.map((p) => p.x), g = GRID[state.hear];
  const pairs = state.rows.slice(1).map((id, k) => {
    const ys = layout(k + 1).main.map((p) => p.x);
    let off = 0, note = "";
    if (state.align === "sounding") {           // the recordings may sit at slightly different pitch overall: measure it, then remove it
      const d = xs.map((x) => ys.map((y) => ((y - x + 1800) % 1200) - 600).sort((p, q) => Math.abs(p) - Math.abs(q))[0]).filter((v) => Math.abs(v) < 60).sort((p, q) => p - q);
      if (d.length) off = d[Math.floor(d.length / 2)];
      note = Math.abs(off) >= 3 ? `sits ${Math.abs(off).toFixed(0)} ¢ ${off > 0 ? "above" : "below"} A overall; with that removed, ` : "";
    }
    const s = sim(xs, ys.map((y) => y - off));
    return `<li><span><span class="sc-letter sc-r${k + 1} sc-sm">${"BC"[k]}</span> ${note}${s.within} of ${s.of} of A's notes have a partner within 15 ¢</span>
      <span class="muted sc-nw">largest gap ${s.max.toFixed(0)} ¢</span></li>`; }).join("");
  const near = closest(a, state.start[0], 5).map((m) => `<li><span>${esc(m.u.m.name)} · ${esc(m.u.d.name)} <span class="muted">from its tonic ${esc(nice(m.u.label))}</span></span>
    <span class="sc-nw"><span class="muted">${m.s.mean.toFixed(0)} ¢</span> <button type="button" class="btn" data-cmp="${esc(m.u.id)}">Compare</button></span></li>`).join("");
  const devs = g ? a.p.filter((p) => p.main).sort((p, q) => above(a, p.c) - above(a, q.c)).map((p) => {
    const d = Math.round(above(a, p.c) - heard(a, p.c));
    return `<span class="sc-nw">${esc(p.name)} <b>${d ? sgn(d) : "0"}</b></span>`; }).join(" · ") : "";
  return `<div><h3>How close, in this line-up</h3><ul>${pairs || '<li class="muted">Add a second tuning to compare.</li>'}</ul>
      ${state.rows.length > 1 ? '<p><button type="button" class="btn" id="sc-fit">Find the start of A that best fits B</button></p>' : ""}
      ${g ? `<h3>A against ${GRID_NAME[state.hear]}, in cents</h3><p class="sc-devs">${devs}</p>
        <p class="muted">The grid is laid from the tonic. Plus means the master plays the note above the grid. You are hearing the grid now; switch to Measured to hear the difference.</p>` : ""}</div>
    <div><h3>${esc(a.d.name)} from ${esc(nice(a.p[state.start[0]].name))} is closest in shape to</h3><ul>${near || '<li class="muted">No other tuning with two or more recordings.</li>'}</ul></div>`;
}

const EXAMPLES = [
  ["One setar, three starting notes", ["hossein-alizadeh.shur", "hossein-alizadeh.bayat-e-tork", "hossein-alizadeh.afshari"], "sounding"],
  ["Shur by three masters", ["hossein-alizadeh.shur", "ebadi.shur", "meshkatian.shur"], "tonic"],
  ["Shur and two of its avaz-ha", ["hossein-alizadeh.shur", "hossein-alizadeh.abu-ata", "hossein-alizadeh.dashti"], "tonic"],
  ["Homayoun and Bayat-e Esfahan", ["hossein-alizadeh.homayoun", "hossein-alizadeh.bayat-e-esfahan"], "sounding"],
];
const examples = () => EXAMPLES.filter((e) => e[1].every((id) => byId[id]));

// The route: tunings as "<master>.<dastgah>" or "<master>.<dastgah>:<note index>" for a start other than the
// tonic, an optional final "together" for the starting-notes line-up; or "dastgah/<id>" / "master/<id>"
// for the three tunings with the most recordings.
function resolve(parts) {
  if (parts[0] === "dastgah" || parts[0] === "master") {
    const pool = TUN.filter((t) => (parts[0] === "dastgah" ? t.d.id : t.m.id) === parts[1]).sort((a, b) => b.n - a.n);
    return { ids: pool.slice(0, 3).map((t) => t.id), starts: [], align: parts[0] === "dastgah" ? "tonic" : "sounding" };
  }
  const together = parts[parts.length - 1] === "together";
  const rows = (together ? parts.slice(0, -1) : parts).map((s) => s.split(":")).filter(([id]) => byId[id]);
  return { ids: rows.map(([id]) => id), starts: rows.map(([, i]) => (i === undefined ? null : +i)), align: together ? "tonic" : "sounding" };
}
const routeOf = () => `#/scales/${state.rows.map((id, r) => (state.start[r] === tonicIndex(byId[id]) ? id : `${id}:${state.start[r]}`)).join("/")}${state.align === "tonic" ? "/together" : ""}`;

export function scalesLink(kind, id) { return `#/scales/${kind}/${id}`; }

export function pageScales(catalog, data, parts) {
  prepare(catalog, data);
  const want = resolve(parts || []);
  let saved = null;
  try { saved = JSON.parse(store.get("ds.scales") || "null"); } catch (_) { saved = null; }
  if (saved && GRID[saved.hear] !== undefined) state.hear = saved.hear;
  if (want.ids.length) { setRows(want.ids, want.starts); state.align = want.align; }
  else if (saved && saved.rows && saved.rows.some((id) => byId[id])) { setRows(saved.rows, saved.start); state.align = saved.align || "sounding"; }
  else { const e = examples()[0]; setRows(e ? e[1] : [...TUN].sort((a, b) => b.n - a.n).slice(0, 3).map((t) => t.id)); state.align = e ? e[2] : "tonic"; }
  if (!state.rows.length) return `<h1>Scales</h1><p class="muted">No analysed recordings to pool yet.</p>`;
  return `<div id="sc-root"><h1>Scales and starting notes</h1>
    <p class="lede">Each tuning pools one master's recordings of a dastgah: every note carries the share of those recordings
      that use it. Choose up to three; A is the reference. Click any note to start that scale from it, and play it from the keyboard.</p>
    ${examples().length ? `<div class="br-bar sc-bar"><span class="br-k">Examples</span>${examples().map((e, k) => `<button type="button" class="btn" data-ex="${k}">${esc(e[0])}</button>`).join("")}</div>` : ""}
    <div class="sc-rows" id="sc-rows"></div>
    <div class="br-bar sc-bar"><span class="br-k">Line up</span><span class="seg" role="group" aria-label="Line up" id="sc-align">
        <button type="button" data-v="sounding">As sounding</button><button type="button" data-v="tonic">Starting notes together</button></span>
      <span class="br-k">Hear as</span><span class="seg" role="group" aria-label="Hear as" id="sc-hear">
        <button type="button" data-v="measured">Measured</button><button type="button" data-v="12">12-TET</button><button type="button" data-v="24">24-TET</button></span></div>
    <p class="muted sc-note" id="sc-alignnote"></p>
    <div class="sc-main">
      <div class="sc-instr"><div class="sc-view" id="sc-ring"></div><div id="sc-keys"></div></div>
      <div class="sc-side"><div class="sc-view" id="sc-tape"></div><div class="legend sc-legend" id="sc-legend"></div></div>
    </div>
    <div class="sc-read" id="sc-read"></div>
    <h2>Every starting note of the reference</h2><div id="sc-table"></div>
    <h2>Where these tunings come from</h2><div id="sc-sources"></div></div>`;
}

export function wireScales() {
  const root = document.getElementById("sc-root");   // replaced on every route, so its listeners go with it
  if (!root) return null;
  const $ = (id) => root.querySelector(`#${id}`);
  const persist = () => {
    store.set("ds.scales", JSON.stringify({ rows: state.rows, start: state.start, align: state.align, hear: state.hear }));
    try { history.replaceState(null, "", routeOf()); } catch (_) { /* file:// or sandbox: the page still works */ }
  };
  let notes = [];                 // the reference scale as it is heard now: one entry per key
  const held = new Set();         // key positions sounding now
  const drawChords = () => {
    const g = $("sc-chords"), ks = [...held].sort((a, b) => a - b).slice(0, 3);
    root.querySelectorAll(".sc-lit").forEach((el) => el.classList.remove("sc-lit"));
    ks.forEach((k) => {
      const cap = root.querySelector(`.sc-key[data-k="${k}"]`), bead = root.querySelector(`#sc-ring .sc-bead[data-i="${notes[k].i}"]`);
      if (cap) cap.classList.add("sc-lit");
      if (bead) bead.classList.add("sc-lit");
    });
    if (!g) return;
    let s = "";
    const labels = [];
    for (let a = 0; a < ks.length; a++) for (let b = a + 1; b < ks.length; b++) {
      const na = notes[ks[a]], nb = notes[ks[b]], size = 1200 * Math.log2(nb.hz / na.hz);
      const [x1, y1] = ringXY(na.x, RING.R - RING.band / 2 - 2), [x2, y2] = ringXY(nb.x, RING.R - RING.band / 2 - 2);
      if (Math.abs(x1 - x2) + Math.abs(y1 - y2) > 1) s += `<line class="sc-chord" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
      labels.push(`${size.toFixed(0)} ¢`);
    }
    g.innerHTML = s;
    const t = byId[state.rows[0]];
    $("sc-midsub").textContent = labels.length ? labels.join(" · ") : `from ${nice(t.p[state.start[0]].name)}`;
  };
  const press = (k, hold) => {
    if (!notes[k]) return;
    sound(notes[k].hz, byId[state.rows[0]].inst);
    held.add(k); drawChords();
    if (!hold) setTimeout(() => { held.delete(k); drawChords(); }, 450);
  };
  const draw = () => {
    $("sc-rows").innerHTML = rowsHTML();
    [...$("sc-align").children].forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === state.align)));
    [...$("sc-hear").children].forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === state.hear)));
    $("sc-alignnote").textContent = (state.align === "sounding"
      ? "Rows are placed by sounding pitch, measured from A's starting note. Letters are 12-TET at A4 = 440 Hz, for reference."
      : "Every row begins at its own starting note, so only the shapes are compared.") +
      (GRID[state.hear] ? ` You are hearing ${GRID_NAME[state.hear]} laid from each tonic; the ring's outer marks are that grid.` : "");
    notes = scaleHz(0).slice(0, KEYS.length);
    held.clear();
    $("sc-ring").innerHTML = ringHTML();
    $("sc-keys").innerHTML = keysHTML();
    $("sc-tape").innerHTML = tapeHTML(Math.max(300, $("sc-tape").clientWidth));
    $("sc-legend").innerHTML = CLS.map((c, k) => `<span><i class="sc-sw sc-bg${k}"></i>${esc(c.letter)} ${esc(c.text)}</span>`).join("") +
      `<span><i class="sc-sw sc-bgx"></i>other</span><span>▲ tonic</span><span>○ starting note</span><span>dashed: in under half the recordings</span>
       <span>short marks above B and C: A's notes</span>`;
    $("sc-read").innerHTML = readHTML();
    $("sc-table").innerHTML = tableHTML();
    $("sc-sources").innerHTML = sourcesHTML();
  };
  const update = () => { persist(); draw(); };
  const pick = (e) => {
    const el = e.target.closest("[data-i]");
    if (!el || !root.contains(el)) return;
    const r = +el.dataset.r, i = +el.dataset.i;
    state.start[r] = i;
    update();
    sound(scaleHz(r)[0].hz, byId[state.rows[r]].inst);
  };
  root.addEventListener("click", (e) => {
    const q = (sel) => e.target.closest(sel);
    const ex = q("[data-ex]"), play = q("[data-play]"), reset = q("[data-reset]"), cmp = q("[data-cmp]"), key = q(".sc-key");
    const al = q("#sc-align button"), hear = q("#sc-hear button"), list = q("[data-list]"), scl = q("[data-scl]");
    if (ex) { const x = examples()[+ex.dataset.ex]; setRows(x[1]); state.align = x[2]; update(); }
    else if (al) { state.align = al.dataset.v; update(); }
    else if (hear) { state.hear = hear.dataset.v; update(); }
    else if (key) press(+key.dataset.k, false);
    else if (play) {
      const r = +play.dataset.play;
      stopSequence();
      try { sequence(scaleHz(r).map((n) => n.hz), { instrument: byId[state.rows[r]].inst, step: 0.32 }); } catch (_) { /* no Web Audio */ }
    } else if (reset) { const r = +reset.dataset.reset; state.start[r] = tonicIndex(byId[state.rows[r]]); update(); }
    else if (cmp) { setRows([state.rows[0], cmp.dataset.cmp].concat(state.rows.slice(2)), [state.start[0]]); state.align = "tonic"; update(); }
    else if (list) { const t = byId[state.rows[+list.dataset.list]]; filterLibrary(cat, { master: t.m.id, dastgah: t.d.id }); location.hash = "#/list"; }
    else if (scl) {
      const r = +scl.dataset.scl, a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([scalaFile(r)], { type: "text/plain" }));
      a.download = `${state.rows[r]}.scl`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } else if (q("#sc-fit")) {
      const a = byId[state.rows[0]], other = layout(1, true).main.map((p) => p.x);
      let best = null;
      a.p.forEach((p, i) => { if (!p.main) return; state.start[0] = i; const s = sim(layout(0, true).main.map((x) => x.x), other); if (!best || s.mean < best.s.mean) best = { i, s }; });
      if (best) state.start[0] = best.i;
      state.align = "tonic"; update();
    } else pick(e);
  });
  root.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && e.target.closest("[data-i]")) { e.preventDefault(); pick(e); } });
  root.addEventListener("change", (e) => {
    const s = e.target.closest("select[data-r]");
    if (!s) return;
    const r = +s.dataset.r, ids = [...state.rows], st = [...state.start];
    if (s.value) { ids[r] = s.value; st[r] = null; } else { ids.splice(r, 1); st.splice(r, 1); }
    if (!ids.length) return;
    setRows(ids, st); update();
  });
  // The home row plays the reference scale. The listeners remove themselves once this page is gone.
  const typing = (e) => e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|SELECT|TEXTAREA)$/.test((e.target && e.target.tagName) || "");
  const down = (e) => {
    if (!root.isConnected) { document.removeEventListener("keydown", down); document.removeEventListener("keyup", up); return; }
    const k = KEYS.indexOf(e.key.toLowerCase());
    if (k < 0 || e.repeat || typing(e) || held.has(k)) return;
    press(k, true);
  };
  const up = (e) => { const k = KEYS.indexOf(e.key.toLowerCase()); if (k >= 0 && held.delete(k) && root.isConnected) drawChords(); };
  document.addEventListener("keydown", down);
  document.addEventListener("keyup", up);

  draw();
  persist();
  // The tape is drawn at its container's width, so redraw it whenever that width changes.
  let width = $("sc-tape").clientWidth;
  if (window.ResizeObserver) new ResizeObserver(() => {
    const w = $("sc-tape").clientWidth;
    if (w && Math.abs(w - width) > 1) { width = w; $("sc-tape").innerHTML = tapeHTML(Math.max(300, w)); }
  }).observe($("sc-tape"));
  return null;
}
