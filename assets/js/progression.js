// Progression timeline for a track: main notes over time (time → x, pitch → y),
// scale-degree guides in every octave, tonic octaves emphasised, segment bands on top.
// Single series colour; every note bar has a ≥ 24 px hover/focus target; the segment
// and transition tables below hold the same information without hovering.

import { attachTip, el, fitText } from "./compare.js?v=8";

const fmt = (x, d = 1) => (x === null || x === undefined ? "—" : Number(x).toFixed(d));
const mmss = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, "0")}`;

export function drawTimeline(host, c) {
  host.replaceChildren();
  const pr = c.progression;
  if (!pr) return;
  const ev = pr.events.filter((e) => e.main && e.pitch_id);
  if (!ev.length) return;
  const W = Math.max(320, host.clientWidth), padL = 44, padR = 12, top = 26, H = 340, bottom = 26;
  const t0 = c.window.start_s, t1 = c.window.end_s;
  const rc = ev.map((e) => e.register_cents);
  const lo = Math.min(...rc) - 120, hi = Math.max(...rc) + 120;
  const x = (t) => padL + (W - padL - padR) * ((t - t0) / (t1 - t0));
  const y = (r) => top + (H - top - bottom) * (1 - (r - lo) / (hi - lo));
  const svg = el("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "img",
    "aria-label": "Notes over time, by pitch above the tonic" }, host);
  const g = el("g", {}, svg);
  // segment bands + names
  (pr.segments || []).forEach((sg, i) => {
    const xa = x(Math.max(t0, sg.start_s)), xb = x(Math.min(t1, sg.end_s));
    if (i % 2 === 1) el("rect", { x: xa, y: top, width: Math.max(0, xb - xa), height: H - top - bottom, class: "band" }, g);
    el("line", { x1: xa, x2: xa, y1: top - 4, y2: H - bottom, class: "seg-edge" }, g);
    const t = el("text", { x: xa + 4, y: top - 9, class: "seg-name" }, g);
    fitText(t, [sg.name, sg.name.replace(/^Phrase /, "")], Math.max(8, xb - xa - 6));
  });
  // degree guides in every octave of the range, tonic octaves stronger
  const degs = c.scale.degrees;
  const guides = [];
  for (let k = Math.floor(lo / 1200) - 1; k <= Math.ceil(hi / 1200) + 1; k++) {
    degs.forEach((d) => {
      const r = d.cents_from_tonic + 1200 * k;
      if (r >= lo && r <= hi) guides.push({ r, d, tonic: d.degree === 1 });
    });
  }
  guides.forEach((gd) => el("line", { x1: padL, x2: W - padR, y1: y(gd.r), y2: y(gd.r),
    class: gd.tonic ? "guide guide-tonic" : "guide" }, g));
  // labels: tonic always; others only where they don't collide (≥ 11 px apart)
  const placed = guides.filter((gd) => gd.tonic).map((gd) => y(gd.r));
  [...guides].sort((a, b) => b.tonic - a.tonic).forEach((gd) => {
    const yy = y(gd.r);
    if (!gd.tonic && placed.some((p) => Math.abs(p - yy) < 11)) return;
    if (!gd.tonic) placed.push(yy);
    const t = el("text", { x: padL - 6, y: yy + 3.5, class: gd.tonic ? "glabel glabel-tonic" : "glabel", "text-anchor": "end" }, g);
    t.textContent = gd.d.label;
  });
  // time axis
  const span = t1 - t0, step = span > 240 ? 60 : span > 90 ? 30 : span > 40 ? 10 : 5;
  for (let t = Math.ceil(t0 / step) * step; t <= t1; t += step) {
    const tt = el("text", { x: x(t), y: H - 8, class: "tick", "text-anchor": "middle" }, g);
    tt.textContent = mmss(t).replace(/\.0$/, "");
  }
  // notes
  ev.forEach((e) => {
    const xa = x(e.t_on), xb = Math.max(xa + 3, x(e.t_off) - 1), yy = y(e.register_cents);
    const bar = el("rect", { x: xa, y: yy - 3, width: xb - xa, height: 6, rx: 3, class: "note" }, g);
    const hit = el("rect", { x: xa - 2, y: yy - 12, width: Math.max(10, xb - xa + 4), height: 24, class: "hit",
      tabindex: 0, "aria-label": `${e.label} at ${mmss(e.t_on)}` }, g);
    attachTip(hit, [["v", `${e.label} · ${fmt(e.hz, 2)} Hz`],
      ["k", `${mmss(e.t_on)}–${mmss(e.t_off)} · ${fmt(e.cents_from_tonic)} ¢ above tonic`],
      ["k", `${e.role}${e.degree ? " · degree " + e.degree : ""} · confirmed by ${e.agree} other run(s)`]], bar);
  });
}

export function progressionTables(c, esc) {
  const pr = c.progression;
  if (!pr) return "";
  const seg = pr.segments.map((s) => `<tr><td>${esc(s.name)}${s.name_fa ? ` <bdi class="fa" lang="fa">${esc(s.name_fa)}</bdi>` : ""}</td>
      <td class="num">${mmss(s.start_s)}</td><td class="num">${s.n_notes}</td>
      <td>${s.shahed ? `${esc(s.shahed.label)} <span class="muted">${Math.round(100 * s.shahed.share)}%</span>` : "—"}</td>
      <td>${s.ist ? esc(s.ist.label) : "—"}</td>
      <td>${s.ambitus ? `${esc(s.ambitus.low)}–${esc(s.ambitus.high)}` : "—"}</td>
      <td>${s.new_pitches.length ? esc(s.new_pitches.join(", ")) : '<span class="muted">—</span>'}</td></tr>`).join("");
  const tr = pr.transitions.slice(0, 10).map((t) => `<tr><td>${esc(t.from_label)} → ${esc(t.to_label)}</td>
      <td class="num">${t.count}</td></tr>`).join("");
  const just = pr.just_intervals.map((j) => j.interval === "octave"
    ? `<li>Octaves of ${esc(j.pitch)}: ${(j.deviation_cents || []).map((d) => `${d > 0 ? "+" : ""}${fmt(d)} ¢`).join(", ") || "—"} from pure</li>`
    : `<li>${esc(j.interval)} (${esc(j.pitch)}): ${fmt(j.measured_cents)} ¢ vs pure ${fmt(j.pure_cents, 2)} ¢ → <strong>${j.deviation_cents > 0 ? "+" : ""}${fmt(j.deviation_cents)} ¢</strong></li>`).join("");
  return `
    <div class="table-wrap"><table><thead><tr><th>Segment</th><th class="num">Start</th><th class="num">Notes</th>
      <th>Shahed (most dwelt-on)</th><th>Ist (final note)</th><th>Range</th><th>New pitches</th></tr></thead><tbody>${seg}</tbody></table></div>
    <h3>Most frequent moves</h3>
    <div class="table-wrap" style="max-width:360px"><table><thead><tr><th>From → to</th><th class="num">Times</th></tr></thead><tbody>${tr}</tbody></table></div>
    <h3>Perfect intervals against pure ratios</h3><ul>${just}</ul>
    <p class="muted">${pr.n_main} main notes of ${pr.n_notes} detected (reference run ${esc(pr.reference_run)}); statistics use main notes —
      at least 0.15 s long or confirmed by ≥ 3 other runs.</p>`;
}
