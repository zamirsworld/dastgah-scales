// Melodic signature: how a performance moves between its notes, drawn on the pitch wheel.
//
// The octave is a circle with the tonic at the top. Every step of the melody from one note
// to a different note is a line across the circle, taken from the notes extracted from the
// recording (the same sequence the progression analysis uses). Two views:
//   whole performance  all moves laid over each other; a line's width is how often the move
//                      was made, so the most-used moves are the heaviest;
//   replay             the notes in order, at their measured times: each move draws its line,
//                      which fades as the music goes on (or stays, with the trail set to "all").
// Direction is never colour alone: a rising move is orange and a falling move blue (a validated pair), every line
// is widest at the note it leaves, and the two directions of a pair bow to opposite sides,
// so C up to D and D down to C stay apart. Rising and falling come from the sounding
// register, so C down to the D below is a falling move.
// The signature itself is computed by the pipeline (tunelib/signature.py): `n` moves,
// `p` notes [cents, scale degree or 0, share of sounding time, label], `m` moves
// [from, to, rising, falling]. The table beside the wheel holds the same counts.

import { pluck, stopSequence } from "./synth.js?v=14";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtT = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

// ── geometry ───────────────────────────────────────────────────────────────

const xy = (cents, r, C) => { const a = (cents / 1200) * 2 * Math.PI; return [C + r * Math.sin(a), C - r * Math.cos(a)]; };

// A line from one note to another as a tapered, slightly bowed shape: widest where it starts.
function chord(fromC, toC, w, r, C) {
  const [x0, y0] = xy(fromC, r, C), [x2, y2] = xy(toC, r, C);
  const dx = x2 - x0, dy = y2 - y0, len = Math.hypot(dx, dy) || 1;
  const mx = (x0 + x2) / 2, my = (y0 + y2) / 2, bow = Math.min(r * 0.16, len * 0.22);
  const qx = C + (mx - C) * 0.5 + (dy / len) * bow, qy = C + (my - C) * 0.5 - (dx / len) * bow;
  const left = [], right = [];
  for (let k = 0; k <= 14; k++) {
    const t = k / 14, u = 1 - t;
    const bx = u * u * x0 + 2 * u * t * qx + t * t * x2, by = u * u * y0 + 2 * u * t * qy + t * t * y2;
    const tx = 2 * u * (qx - x0) + 2 * t * (x2 - qx), ty = 2 * u * (qy - y0) + 2 * t * (y2 - qy), tl = Math.hypot(tx, ty) || 1;
    const h = (w / 2) * (1 - 0.8 * t) + 0.35;
    left.push(`${(bx - (ty / tl) * h).toFixed(1)},${(by + (tx / tl) * h).toFixed(1)}`);
    right.push(`${(bx + (ty / tl) * h).toFixed(1)},${(by - (tx / tl) * h).toFixed(1)}`);
  }
  return `M${left.join("L")}L${right.reverse().join("L")}Z`;
}

function movesSVG(sig, counts, maxCount, r, C, scale) {
  // widest first, so thin lines stay visible on top
  const items = [];
  counts.forEach(([a, b, rise, fall]) => {
    if (rise) items.push([a, b, rise, "rise"]);
    if (fall) items.push([a, b, fall, "fall"]);
  });
  items.sort((p, q) => q[2] - p[2]);
  return items.map(([a, b, n, dir]) => {
    const w = (1.4 + 10 * Math.sqrt(n / maxCount)) * scale;
    return `<path class="sg-${dir}" d="${chord(sig.p[a][0], sig.p[b][0], w, r, C)}"><title>${esc(sig.p[a][3])} → ${esc(sig.p[b][3])}, ${dir === "rise" ? "rising" : "falling"}: ${n} of ${sig.n} moves</title></path>`;
  }).join("");
}

const maxOf = (sig) => Math.max(1, ...sig.m.map((m) => Math.max(m[2], m[3])));

// A small wheel for lists and galleries: the whole performance, no labels.
export function miniWheel(sig, size = 116) {
  const C = size / 2, R = size * 0.42;
  const beads = sig.p.map((p) => { const [x, y] = xy(p[0], R, C);
    return `<circle class="sg-bead${p[1] === 1 ? " sg-tonic" : ""}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(1.2 + 5 * Math.sqrt(p[2])).toFixed(1)}"/>`; }).join("");
  return `<svg class="sg-mini" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true"><circle class="sg-ring" cx="${C}" cy="${C}" r="${R}"/>
    ${movesSVG(sig, sig.m, maxOf(sig), R - 3, C, size / 440)}${beads}</svg>`;
}

// ── likeness between two signatures ────────────────────────────────────────

// A signature as weights over (from degree, to degree, direction). Using scale degrees, not
// cents, lets two recordings in different dastgah-ha match when they move the same way.
function vector(sig) {
  const v = new Map();
  sig.m.forEach(([a, b, rise, fall]) => {
    const da = sig.p[a][1], db = sig.p[b][1];
    if (!da || !db || da === db) return;
    if (rise) v.set(`${da},${db},r`, (v.get(`${da},${db},r`) || 0) + rise);
    if (fall) v.set(`${da},${db},f`, (v.get(`${da},${db},f`) || 0) + fall);
  });
  return v;
}
const norm = (v) => Math.sqrt([...v.values()].reduce((s, x) => s + x * x, 0)) || 1;
// Cosine likeness, also trying B moved up by 1–6 scale degrees (the same pattern on other notes).
export function likeness(a, b) {
  const va = vector(a), vb = vector(b), na = norm(va), nb = norm(vb);
  let best = { score: 0, shift: 0 };
  for (let k = 0; k < 7; k++) {
    let dot = 0;
    vb.forEach((x, key) => {
      const [da, db, dir] = key.split(",");
      const y = va.get(`${((+da - 1 + k) % 7) + 1},${((+db - 1 + k) % 7) + 1},${dir}`);
      if (y) dot += x * y;
    });
    const score = dot / (na * nb);
    if (score > best.score + (k ? 0.02 : 0)) best = { score, shift: k };     // prefer no shift unless a shift is clearly better
  }
  return best;
}

export function galleryHTML(entries, sigs, { withMaster = true } = {}) {
  return `<div class="sig-grid">${entries.filter((e) => sigs[e.track.key]).map((e) => `<a class="sig-card" href="#/track/${esc(e.track.key)}">
    ${miniWheel(sigs[e.track.key])}<span class="sig-t">${esc(e.track.title)}</span>${withMaster ? `<span class="muted">${esc(e.master.name)}</span>` : ""}</a>`).join("")}</div>`;
}

export const LEGEND = `<div class="legend sig-legend"><span><i class="sig-sw sig-sw-rise"></i>rising move</span><span><i class="sig-sw sig-sw-fall"></i>falling move</span>
  <span>a line is widest at the note it leaves</span><span>width: how often the move is made</span><span>dot size: time spent on the note</span></div>`;

// ── the wheel on a track page ──────────────────────────────────────────────

export function signatureHTML() {
  return `<div class="sig-main"><div class="sig-wheel" id="sig-wheel"></div>
    <div class="sig-side">
      <div class="br-bar sig-bar"><span class="seg" role="group" aria-label="View" id="sig-mode">
          <button type="button" data-v="all">Whole performance</button><button type="button" data-v="replay">Replay</button></span>
        <button type="button" class="btn btn-primary" id="sig-play">▶ Play</button></div>
      <div class="br-bar sig-bar"><input type="range" id="sig-seek" min="0" step="0.05" value="0" aria-label="Position in the recording">
        <span class="muted sig-time" id="sig-time"></span></div>
      <div class="br-bar sig-bar">
        <label class="br-k" for="sig-speed">Speed</label><select id="sig-speed"><option value="1">×1</option><option value="2" selected>×2</option><option value="4">×4</option><option value="8">×8</option></select>
        <label class="br-k" for="sig-trail">Lines last</label><select id="sig-trail"><option value="3">3 s</option><option value="8" selected>8 s</option><option value="20">20 s</option><option value="0">all so far</option></select>
        <label class="inline"><input type="checkbox" id="sig-sound" checked> sound</label></div>
      ${LEGEND}
      <div id="sig-table"></div>
    </div></div>
    <div id="sig-near"></div>`;
}

export function mountSignature(c, sig, instrument) {
  const host = document.getElementById("sig-wheel");
  if (!host || !sig) return;
  const $ = (id) => document.getElementById(id);
  const S = 440, C = S / 2, R = 158, maxCount = maxOf(sig);
  const byId = Object.fromEntries(c.pitches.map((p) => [p.id, p]));
  const at = (pid) => { const cents = ((byId[pid].cents_from_tonic % 1200) + 1200) % 1200;
    let best = -1; sig.p.forEach((p, k) => { if (Math.abs(p[0] - cents) <= 1.5 || Math.abs(p[0] - cents) >= 1198.5) best = k; }); return best; };
  const seq = (c.progression.events || []).filter((e) => e.main && e.pitch_id && byId[e.pitch_id])
    .map((e) => ({ t: e.t_on, hz: e.hz, k: at(e.pitch_id), reg: e.register_cents, label: e.label })).filter((e) => e.k >= 0);
  const t0 = seq.length ? seq[0].t : 0, end = seq.length ? seq[seq.length - 1].t + 1.2 : 0;
  const segs = (c.progression.segments || []).filter((s) => s.name);
  const state = { mode: "all", playing: false, cursor: t0, fired: 0, last: 0 };

  let ticks = "";
  for (let k = 0; k < 12; k++) { const [x1, y1] = xy(k * 100, R + 4, C), [x2, y2] = xy(k * 100, R + 9, C); ticks += `<line class="sg-tick" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`; }
  const beads = sig.p.map((p, k) => { const [x, y] = xy(p[0], R, C), [tx, ty] = xy(p[0], R + 26, C);
    return `<circle class="sg-bead${p[1] === 1 ? " sg-tonic" : ""}" data-k="${k}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(2.5 + 11 * Math.sqrt(p[2])).toFixed(1)}"><title>${esc(p[3])}: ${Math.round(p[2] * 100)} % of the sounding time</title></circle>` +
      (p[1] || p[2] >= 0.03 ? `<text class="sg-nm" x="${tx.toFixed(1)}" y="${(ty + 4).toFixed(1)}" text-anchor="middle">${esc(p[3])}</text>` : ""); }).join("");
  host.innerHTML = `<svg viewBox="0 0 ${S} ${S}" role="img" aria-label="Melodic signature: moves between notes as lines across the pitch wheel, tonic at the top. The table beside it lists the most used moves.">
    <circle class="sg-ring" cx="${C}" cy="${C}" r="${R}"/>${ticks}<g id="sg-all">${movesSVG(sig, sig.m, maxCount, R - 4, C, 1)}</g><g id="sg-live"></g>${beads}
    <text class="sg-nm sg-mid" id="sg-mid" x="${C}" y="${S - 14}" text-anchor="middle"></text></svg>`;
  const all = host.querySelector("#sg-all"), live = host.querySelector("#sg-live"), mid = host.querySelector("#sg-mid");

  const rows = [];
  sig.m.forEach(([a, b, rise, fall]) => { if (rise) rows.push([a, b, "rising", rise]); if (fall) rows.push([a, b, "falling", fall]); });
  rows.sort((p, q) => q[3] - p[3]);
  $("sig-table").innerHTML = `<div class="table-wrap"><table><thead><tr><th>Move</th><th>Direction</th><th class="num">Times</th><th class="num">Share</th></tr></thead><tbody>
    ${rows.slice(0, 10).map(([a, b, dir, n]) => `<tr><td>${esc(sig.p[a][3])} → ${esc(sig.p[b][3])}</td><td><i class="sig-sw sig-sw-${dir === "rising" ? "rise" : "fall"}"></i> ${dir}</td>
      <td class="num">${n}</td><td class="num">${Math.round((n / sig.n) * 100)} %</td></tr>`).join("")}</tbody></table></div>
    <p class="muted">${sig.n} moves between ${sig.p.length} notes, from ${seq.length} extracted notes.${rows.length > 10 ? ` The ${rows.length - 10} rarer moves are on the wheel.` : ""}</p>`;

  const seek = $("sig-seek"), playBtn = $("sig-play");
  seek.min = String(t0); seek.max = String(end);
  const draw = () => {
    [...$("sig-mode").children].forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === state.mode)));
    playBtn.textContent = state.playing ? "❚❚ Pause" : "▶ Play";
    host.querySelectorAll(".sg-bead.sg-on").forEach((b) => b.classList.remove("sg-on"));
    if (state.mode === "all") {
      all.style.display = ""; live.innerHTML = ""; mid.textContent = "";
      $("sig-time").textContent = `${fmtT(end - t0)} of music`;
      return;
    }
    all.style.display = "none";
    const trail = +$("sig-trail").value;
    let i = -1;
    for (let k = 0; k < seq.length && seq[k].t <= state.cursor; k++) i = k;
    let html = "";
    if (trail === 0) {                       // everything so far, growing into the whole performance
      const counts = new Map();
      for (let k = 1; k <= i; k++) { const a = seq[k - 1], b = seq[k]; if (a.k === b.k) continue;
        const key = `${a.k},${b.k}`, cur = counts.get(key) || [a.k, b.k, 0, 0]; cur[b.reg > a.reg ? 2 : 3] += 1; counts.set(key, cur); }
      html = movesSVG(sig, [...counts.values()], maxCount, R - 4, C, 1);
    } else {
      for (let k = i; k >= 1 && state.cursor - seq[k].t < trail; k--) {
        const a = seq[k - 1], b = seq[k];
        if (a.k === b.k) continue;
        const age = (state.cursor - b.t) / trail;
        html = `<path class="sg-${b.reg > a.reg ? "rise" : "fall"}" style="opacity:${Math.max(0.04, (1 - age) ** 1.6).toFixed(2)}" d="${chord(sig.p[a.k][0], sig.p[b.k][0], 7, R - 4, C)}"/>` + html;
      }
    }
    live.innerHTML = html;
    if (i >= 0) { const bead = host.querySelector(`.sg-bead[data-k="${seq[i].k}"]`); if (bead) bead.classList.add("sg-on"); }
    const seg = segs.filter((s) => s.start_s <= state.cursor).pop();
    mid.textContent = i >= 0 ? `${seq[i].label}${seg ? ` · ${seg.name}` : ""}` : "";
    seek.value = String(state.cursor);
    $("sig-time").textContent = `${fmtT(Math.max(0, state.cursor - t0))} / ${fmtT(end - t0)}`;
  };
  const frame = (now) => {
    if (!state.playing) return;
    if (!host.isConnected) { state.playing = false; return; }        // the page was left
    const dt = Math.min(0.1, (now - state.last) / 1000);
    state.last = now;
    state.cursor += dt * +$("sig-speed").value;
    let sounded = 0;
    while (state.fired < seq.length && seq[state.fired].t <= state.cursor) {
      if ($("sig-sound").checked && sounded++ < 4) { try { pluck(seq[state.fired].hz, { instrument, gain: 0.26 }); } catch (_) { /* no Web Audio: silent */ } }
      state.fired += 1;
    }
    if (state.cursor >= end) { state.playing = false; state.mode = "all"; state.cursor = t0; state.fired = 0; }
    draw();
    if (state.playing) requestAnimationFrame(frame);
  };
  const setCursor = (t) => { state.cursor = t; state.fired = seq.findIndex((e) => e.t > t); if (state.fired < 0) state.fired = seq.length; };
  playBtn.addEventListener("click", () => {
    state.playing = !state.playing;
    if (state.playing) { state.mode = "replay"; if (state.cursor >= end - 0.01) setCursor(t0); state.last = performance.now(); requestAnimationFrame(frame); }
    else stopSequence();
    draw();
  });
  $("sig-mode").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return;
    state.mode = b.dataset.v; if (state.mode === "all") { state.playing = false; stopSequence(); } draw(); });
  seek.addEventListener("input", () => { setCursor(+seek.value); state.mode = "replay"; draw(); });
  $("sig-trail").addEventListener("change", draw);
  draw();
}

// "Closest signatures": other recordings that move the same way, in any dastgah.
export function nearHTML(key, sigs, lookup, limit = 6) {
  const me = sigs[key];
  if (!me || me.n < 8) return "";
  const near = Object.entries(sigs).filter(([k, s]) => k !== key && s.n >= 8).map(([k, s]) => ({ k, s, ...likeness(me, s) }))
    .sort((a, b) => b.score - a.score).slice(0, limit).filter((x) => x.score > 0.2);
  if (!near.length) return "";
  return `<h3>Recordings that move the same way</h3>
    <p class="muted">Compared by scale degree and direction, so a recording in another dastgah can match. A shift means the same pattern sits that many degrees higher there.</p>
    <div class="sig-grid">${near.map((x) => { const e = lookup(x.k); return e ? `<a class="sig-card" href="#/track/${esc(x.k)}">${miniWheel(x.s)}
      <span class="sig-t">${esc(e.track.title)}</span><span class="muted">${esc(e.master.name)} · ${esc(e.dastgah)}</span>
      <span class="muted">${Math.round(x.score * 100)} % alike${x.shift ? `, shifted ${x.shift} degree${x.shift > 1 ? "s" : ""}` : ""}</span></a>` : ""; }).join("")}</div>`;
}
