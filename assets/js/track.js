// Track page charts: the scale ruler (measured degrees vs theory models) and the
// interval strip (step sizes with Farhat classes), plus the accuracy table.
//
// Form: a shared 0–1200 ¢ axis. One series colour; degree status is the marker
// style (filled = confirmed, ring = probable, dashed ring = tentative). Model rows
// are recessive grey ticks joined to the measured value, so the gap *is* the
// residual. Every mark has a hover/focus tooltip and the tables below hold every
// value, so nothing is tooltip-only.

import { el, attachTip, fitText, marker, hitArea } from "./compare.js?v=8";

const fmt = (x, d = 1) => (x === null || x === undefined ? "—" : Number(x).toFixed(d));
const sgn = (x, d = 1) => (x > 0 ? "+" : "") + fmt(x, d);
const MODEL_SHORT = { "12tet": ["12-tone equal", "12-TET"], "vaziri-24tet": ["24-TET (Vaziri)", "24-TET"],
  pythagorean: ["Pythagorean", "Pyth."] };
export const FARHAT = { semitone: ["S", "semitone ≈ 90 ¢"], "small-neutral": ["n", "small neutral ≈ 135 ¢"],
  "large-neutral": ["N", "large neutral ≈ 160 ¢"], "whole-tone": ["T", "whole tone ≈ 204 ¢"],
  "plus-tone": ["T+", "plus tone ≈ 270 ¢"] };

// ± half-width of a pitch's 95 % CI in cents (the interval may wrap past 1200)
export function ciHalf(p) {
  if (!p || !p.ci95_cents) return null;
  const [lo, hi] = p.ci95_cents;
  return (((hi - lo) % 1200) + 1200) % 1200 / 2;
}

function frame(host, height, padL) {
  host.replaceChildren();
  const W = Math.max(300, host.clientWidth);
  const svg = el("svg", { width: W, height, viewBox: `0 0 ${W} ${height}`, role: "img" }, host);
  const padR = 18;
  const x = (c) => padL + (c / 1200) * (W - padL - padR);
  return { svg, W, x, padR };
}

function axis(svg, x, W, padL, top, bottom, every) {
  const g = el("g", {}, svg);
  for (let c = 0; c <= 1200; c += 100) {
    el("line", { x1: x(c), x2: x(c), y1: top, y2: bottom, class: c % 600 === 0 ? "grid" : "grid grid-minor" }, g);
    if (c % every === 0) {
      const t = el("text", { x: x(c), y: bottom + 14, "text-anchor": "middle", class: "tick" }, g);
      t.textContent = c === 0 ? "0 ¢" : String(c);
    }
  }
}

// ── scale ruler ────────────────────────────────────────────────────────────

export function drawRuler(host, c, { onPlay } = {}) {
  const models = (c.theory_fit || []).filter((m) => m.basis === "degrees");
  const narrow = host.clientWidth < 560;
  const padL = narrow ? 64 : 128;
  const rowH = 34, measY = 56;
  const H = measY + 18 + models.length * rowH + 24;
  const { svg, W, x } = frame(host, H, padL);
  svg.setAttribute("aria-label", `Scale ruler: ${c.scale.degrees.length} measured degrees against ${models.length} theory models`);
  axis(svg, x, W, padL, 30, H - 24, narrow ? 300 : 100);

  const byId = Object.fromEntries(c.pitches.map((p) => [p.id, p]));
  const degs = c.scale.degrees.map((d) => ({ ...d, p: byId[d.pitch_id] }));
  const vars = (c.scale.variants || []).map((v) => ({ ...v, p: byId[v.pitch_id], variant: true }));

  // row labels
  const lbl = (y, variants) => {
    const t = el("text", { x: 8, y: y + 4, class: "rowlabel" }, svg);
    fitText(t, variants, padL - 14);
  };
  lbl(measY, ["Measured", "Meas."]);

  // model rows: grey tick at the model's value, joined to the measured degree
  models.forEach((m, i) => {
    const y = measY + 18 + (i + 0.5) * rowH;
    el("line", { x1: padL, x2: W - 18, y1: y, y2: y, class: "baseline" }, svg);
    lbl(y, [...(MODEL_SHORT[m.model] || [m.name]).map((n) => `${n} · ${fmt(m.residual_rms, 1)} ¢`),
      ...(MODEL_SHORT[m.model] || [m.name])]);
    m.assignment.forEach((a, k) => {
      const d = degs[k];
      if (!d) return;
      el("line", { x1: x(a.model), x2: x(a.measured), y1: y, y2: y, class: "resid" }, svg);
      el("line", { x1: x(a.measured), x2: x(a.measured), y1: measY + 8, y2: y, class: "drop" }, svg);
      const tick = el("line", { x1: x(a.model), x2: x(a.model), y1: y - 7, y2: y + 7, class: "mtick" }, svg);
      hitArea(svg, x(a.model), y, [["v", `${d.label}: ${fmt(a.model, 1)} ¢ in ${m.name}`],
        ["k", `measured ${fmt(a.measured, 1)} ¢ · difference ${sgn(a.residual)} ¢`]], tick,
        `${m.name}, degree ${d.degree}: model ${fmt(a.model, 0)} cents, measured ${fmt(a.measured, 0)}`);
    });
  });

  // measured row: CI whisker, marker, note label (staggered when crowded)
  const all = [...degs, ...vars].sort((a, b) => a.cents_from_tonic - b.cents_from_tonic);
  let lastX = -99, flip = false;
  all.forEach((d) => {
    const cx = x(d.cents_from_tonic);
    const h = ciHalf(d.p);
    if (h && h > 0.05) {
      el("line", { x1: x(d.cents_from_tonic - h), x2: x(d.cents_from_tonic + h), y1: measY, y2: measY, class: "ci" }, svg);
    }
    const mk = marker(svg, cx, measY, d.status || "confirmed", { variant: d.variant, tonic: d.degree === 1 && !d.variant });
    flip = cx - lastX < 26 ? !flip : false;
    lastX = cx;
    const t = el("text", { x: cx, y: flip ? 22 : 38, "text-anchor": "middle",
      class: d.variant ? "tick" : "tick tick-strong" }, svg);
    t.textContent = d.label;
    const lines = [["v", `${d.label} · ${fmt(d.cents_from_tonic, 1)} ¢${h ? ` ± ${fmt(h, 1)}` : ""}`],
      ["k", d.variant ? `variant of degree ${d.degree} (${sgn(d.offset_cents)} ¢)` : `degree ${d.degree} · ${d.status}`],
      ["k", `support ${Math.round((d.support || 0) * 100)} %${onPlay ? " · click to hear" : ""}`]];
    const hit = el("circle", { cx, cy: measY, r: 12, class: "hit", tabindex: 0,
      "aria-label": `${d.label}, ${fmt(d.cents_from_tonic, 0)} cents${onPlay ? ", press Enter to hear" : ""}` }, svg);
    attachTip(hit, lines, mk);
    if (onPlay) {
      hit.addEventListener("click", () => onPlay(d));
      hit.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); onPlay(d); } });
    }
  });
  // octave tonic, for orientation
  marker(svg, x(1200), measY, "probable", { small: true });
}

// ── interval strip ─────────────────────────────────────────────────────────

export function drawSteps(host, c) {
  const narrow = host.clientWidth < 560;
  const padL = narrow ? 64 : 128;
  const H = 86;
  const { svg, W, x } = frame(host, H, padL);
  const degs = c.scale.degrees;
  const byId = Object.fromEntries(c.pitches.map((p) => [p.id, p]));
  const farhat = (c.theory_fit || []).find((m) => m.model === "farhat");
  svg.setAttribute("aria-label", `Interval strip: ${c.scale.steps_cents.length} steps from the tonic to its octave`);
  const t = el("text", { x: 8, y: 34, class: "rowlabel" }, svg);
  fitText(t, ["Steps (¢)", "Steps"], padL - 14);
  const t2 = el("text", { x: 8, y: 64, class: "tick" }, svg);
  fitText(t2, ["Farhat class", "Farhat"], padL - 14);

  let pos = 0;
  c.scale.steps_cents.forEach((s, i) => {
    const a = degs[i], b = degs[i + 1] || { label: degs[0].label, pitch_id: degs[0].pitch_id };
    const x0 = x(pos) + 1, x1 = x(pos + s) - 1;
    const ha = ciHalf(byId[a.pitch_id]), hb = ciHalf(byId[b.pitch_id]);
    const unc = ha !== null && hb !== null ? Math.hypot(ha, hb) : null;
    const cls = farhat && farhat.assignment[i];
    const rect = el("rect", { x: x0, y: 18, width: Math.max(1, x1 - x0), height: 26, rx: 4, class: "step" }, svg);
    if (x1 - x0 >= 30) {
      const v = el("text", { x: (x0 + x1) / 2, y: 35, "text-anchor": "middle", class: "steplabel" }, svg);
      v.textContent = fmt(s, 0);
    }
    if (cls && x1 - x0 >= 16) {
      const f = el("text", { x: (x0 + x1) / 2, y: 64, "text-anchor": "middle", class: "tick" }, svg);
      f.textContent = (FARHAT[cls.class] || [cls.class])[0];
    }
    const hit = el("rect", { x: x0, y: 12, width: Math.max(12, x1 - x0), height: 60, class: "hit", tabindex: 0,
      "aria-label": `${a.label} to ${b.label}: ${fmt(s, 0)} cents` }, svg);
    attachTip(hit, [["v", `${a.label} → ${b.label}: ${fmt(s, 1)} ¢${unc ? ` ± ${fmt(unc, 1)}` : ""}`],
      ...(cls ? [["k", `nearest Farhat class: ${(FARHAT[cls.class] || [0, cls.class])[1]} (${sgn(cls.residual)} ¢)`]] : [])], rect);
    pos += s;
  });
  const tk = el("text", { x: x(0), y: H - 6, class: "tick" }, svg);
  tk.textContent = degs[0].label;
  const tk2 = el("text", { x: x(1200), y: H - 6, "text-anchor": "end", class: "tick" }, svg);
  tk2.textContent = `${degs[0].label} (octave)`;
}

// ── accuracy panel ─────────────────────────────────────────────────────────

export function accuracyHTML(c, esc) {
  const byId = Object.fromEntries(c.pitches.map((p) => [p.id, p]));
  const fams = c.matrix.families;
  const tci = c.tonic.ci95_hz ? 1200 * Math.log2(c.tonic.ci95_hz[1] / c.tonic.ci95_hz[0]) / 2 : null;
  const rows = c.scale.degrees.map((d) => {
    const p = byId[d.pitch_id] || {};
    const vals = Object.values(p.by_family || {});
    const spread = vals.length >= 2 ? Math.max(...vals) - Math.min(...vals) : null;
    const h = ciHalf(p);
    return `<tr><td class="num">${d.degree}</td><td>${esc(d.label)}</td>
      ${fams.map((f) => `<td class="num">${p.by_family && p.by_family[f] !== undefined ? fmt(p.by_family[f], 1) : "—"}</td>`).join("")}
      <td class="num">${spread === null ? "—" : fmt(spread, 1)}</td>
      <td class="num">${h === null ? "—" : "±" + fmt(h, 1)}</td>
      <td class="num">${Math.round((d.support || 0) * 100)} %</td>
      <td class="status-${esc(d.status)}">${esc(d.status)}</td></tr>`;
  }).join("");
  const flags = c.diagnostics.flags.length
    ? `<ul class="flags">${c.diagnostics.flags.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>` : "";
  return `<p class="muted">${c.matrix.n_runs} analysis runs (preset “${esc(c.matrix.preset)}”) by ${fams.length}
    independent estimator families: E1 chroma, E2 partial tracker, E3 pYIN. Tonic 95 % CI
    ${tci === null ? "not available" : `± ${fmt(tci, 2)} ¢`}. A degree is <em>confirmed</em> when at least
    60 % of runs and two families agree on it.</p>
    <div class="table-wrap"><table>
      <thead><tr><th class="num">Degree</th><th>Note</th>${fams.map((f) => `<th class="num">${esc(f)} ¢</th>`).join("")}
      <th class="num">Family spread ¢</th><th class="num">95 % CI</th><th class="num">Support</th><th>Status</th></tr></thead>
      <tbody>${rows}</tbody></table></div>${flags}`;
}
