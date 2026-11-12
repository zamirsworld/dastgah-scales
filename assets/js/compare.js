// Cross-recording comparison for a dastgah: intervals and absolute pitch.
//
// Form: one row per recording on a shared axis (dot strip). Rows carry identity via
// their labels, so a single series colour is used; degree status is encoded by marker
// style (filled = confirmed, ring = probable, dashed ring = tentative), never colour.
// Every mark has a ≥ 24 px hit area with hover/focus tooltip; the tables below the
// charts hold every value, so nothing is tooltip-only.

const NS = "http://www.w3.org/2000/svg";
const A4 = 440;
const NOTE = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];

export const el = (tag, attrs = {}, parent = null) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
};
const fmt = (x, d = 1) => (x === null || x === undefined ? "—" : Number(x).toFixed(d));
const circDist = (a, b) => { const d = Math.abs(a - b) % 1200; return Math.min(d, 1200 - d); };

// Fit a row label into maxW: try the variants in order, then truncate with an ellipsis.
export function fitText(t, variants, maxW) {
  for (const v of variants) {
    t.textContent = v;
    if (t.getComputedTextLength() <= maxW) return;
  }
  let v = variants[variants.length - 1];
  while (v.length > 4 && t.getComputedTextLength() > maxW) {
    v = v.slice(0, -2);
    t.textContent = v + "…";
  }
}

// ── degree slots shared across recordings ──────────────────────────────────

export function buildSlots(recs) {
  const pts = [];
  recs.forEach((r, ri) => r.c.scale.degrees.forEach((d) => pts.push({ ri, d })));
  pts.sort((a, b) => a.d.cents_from_tonic - b.d.cents_from_tonic);
  const slots = [];
  for (const p of pts) {
    const s = slots.find((s) => circDist(s.centre, p.d.cents_from_tonic) <= 60 && !s.members.some((m) => m.ri === p.ri));
    if (s) {
      s.members.push(p);
      s.centre = s.members.reduce((a, m) => a + m.d.cents_from_tonic, 0) / s.members.length;
    } else slots.push({ centre: p.d.cents_from_tonic, members: [p] });
  }
  slots.sort((a, b) => a.centre - b.centre);
  slots.forEach((s) => {
    const counts = {};
    s.members.forEach((m) => { counts[m.d.label] = (counts[m.d.label] || 0) + 1; });
    s.label = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
    const v = s.members.map((m) => m.d.cents_from_tonic).sort((a, b) => a - b);
    s.min = v[0]; s.max = v[v.length - 1];
    s.median = v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
  });
  return slots;
}

// ── tooltip ────────────────────────────────────────────────────────────────

function tooltip() {
  let tip = document.getElementById("viz-tip");
  if (!tip) {
    tip = document.createElement("div");
    tip.id = "viz-tip";
    tip.className = "viz-tip";
    tip.setAttribute("role", "status");
    document.body.appendChild(tip);
  }
  return tip;
}

export function attachTip(hit, lines, mark) {
  const show = (ev) => {
    const tip = tooltip();
    tip.replaceChildren();
    lines.forEach(([cls, text]) => {
      const div = document.createElement("div");
      div.className = cls;
      div.textContent = text;          // labels are data: textContent, never innerHTML
      tip.appendChild(div);
    });
    tip.style.display = "block";
    const box = hit.getBoundingClientRect();
    const x = ev && ev.clientX !== undefined && ev.type !== "focus" ? ev.clientX : box.left + box.width / 2;
    const y = ev && ev.clientY !== undefined && ev.type !== "focus" ? ev.clientY : box.top;
    const tw = tip.offsetWidth;
    tip.style.left = `${Math.min(window.innerWidth - tw - 8, Math.max(8, x - tw / 2)) + window.scrollX}px`;
    tip.style.top = `${y + window.scrollY - tip.offsetHeight - 12}px`;
    mark.classList.add("hover");
  };
  const hide = () => { tooltip().style.display = "none"; mark.classList.remove("hover"); };
  hit.addEventListener("pointermove", show);
  hit.addEventListener("pointerleave", hide);
  hit.addEventListener("focus", show);
  hit.addEventListener("blur", hide);
}

export function marker(g, x, y, status, opts = {}) {
  const r = opts.small ? 3.5 : 5;
  let m;
  if (opts.tonic) {
    const s = 6.5;
    m = el("path", { d: `M${x},${y - s} L${x + s},${y + s * 0.8} L${x - s},${y + s * 0.8} Z`, class: "mk mk-tonic" }, g);
  } else {
    m = el("circle", { cx: x, cy: y, r, class: `mk mk-${opts.variant ? "variant" : status}` }, g);
  }
  return m;
}

export function hitArea(g, x, y, lines, mark, label) {
  const hit = el("circle", { cx: x, cy: y, r: 12, class: "hit", tabindex: 0, "aria-label": label }, g);
  attachTip(hit, lines, mark);
}

// ── interval chart (¢ above each recording's tonic) ───────────────────────

export function drawIntervals(host, recs, slots, opts = {}) {
  host.replaceChildren();
  const W = Math.max(320, host.clientWidth), padL = 10, padR = 14, rowH = 46, top = 8;
  const summary = recs.length >= 2;
  const nRows = recs.length + (summary ? 1 : 0);
  const H = top + nRows * rowH + 34;
  const svg = el("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "img",
    "aria-label": "Scale degrees of each recording, in cents above its tonic" }, host);
  const x = (c) => padL + (W - padL - padR) * (c / 1200);
  const g = el("g", {}, svg);
  // recessive grid: 12-TET every 100 ¢ (optionally 24-TET every 50 ¢)
  const step = opts.grid24 ? 50 : 100;
  for (let c = 0; c <= 1200; c += step) {
    el("line", { x1: x(c), x2: x(c), y1: top, y2: H - 26, class: c % 100 ? "grid grid-minor" : "grid" }, g);
    if (c % 100 === 0) {
      const t = el("text", { x: x(c), y: H - 10, class: "tick", "text-anchor": "middle" }, g);
      t.textContent = W < 520 && c % 200 ? "" : String(c);
    }
  }
  let row = 0;
  if (summary) {
    const y = top + rowH * 0.5 + 10;
    const lab = el("text", { x: padL, y: top + 13, class: "rowlabel" }, g);
    fitText(lab, [`All ${recs.length} recordings — median and range per degree`, `All ${recs.length} — median, range`],
      W - padL - padR);
    slots.forEach((s) => {
      if (s.members.length < 2) return;
      el("line", { x1: x(s.min), x2: x(s.max) + 0.01, y1: y, y2: y, class: "range" }, g);
      const m = el("line", { x1: x(s.median), x2: x(s.median), y1: y - 7, y2: y + 7, class: "median" }, g);
      hitArea(g, x(s.median), y, [["v", `${fmt(s.median)} ¢ median`], ["k", `${s.label} · range ${fmt(s.min)}–${fmt(s.max)} ¢ · ${s.members.length} recordings`]], m,
        `${s.label}: median ${fmt(s.median)} cents`);
    });
    row = 1;
  }
  recs.forEach((r, i) => {
    const y0 = top + (row + i) * rowH, y = y0 + 30;
    const lab = el("text", { x: padL, y: y0 + 13, class: "rowlabel" }, g);
    fitText(lab, [`${r.master.name} — ${r.track.title} · tonic ${r.c.tonic.label} ${fmt(r.c.tonic.hz, 2)} Hz`,
      `${r.track.title} · ${r.c.tonic.label} ${fmt(r.c.tonic.hz, 1)} Hz`, r.track.title], W - padL - padR);
    el("line", { x1: x(0), x2: x(1200), y1: y, y2: y, class: "baseline" }, g);
    r.c.scale.degrees.forEach((d) => {
      const mk = marker(g, x(d.cents_from_tonic), y, d.status || "confirmed");
      hitArea(g, x(d.cents_from_tonic), y, [["v", `${fmt(d.cents_from_tonic)} ¢`],
        ["k", `${d.label} · degree ${d.degree} · ${d.status || "confirmed"}`], ["k", `${r.master.name} — ${r.track.title}`]],
      mk, `${r.track.title}: ${d.label} at ${fmt(d.cents_from_tonic)} cents`);
    });
    (r.c.scale.variants || []).forEach((v) => {
      const mk = marker(g, x(v.cents_from_tonic), y, "variant", { variant: true, small: true });
      hitArea(g, x(v.cents_from_tonic), y, [["v", `${fmt(v.cents_from_tonic)} ¢`],
        ["k", `${v.label} · variant of degree ${v.degree} (${v.status || ""})`], ["k", `${r.master.name} — ${r.track.title}`]],
      mk, `${r.track.title}: variant ${v.label} at ${fmt(v.cents_from_tonic)} cents`);
    });
  });
}

// ── absolute pitch chart (measured Hz, log axis) ───────────────────────────

export function degreeRegisters(c) {
  // every measured register of every scale degree (and variant), with the tonic's own
  const byId = Object.fromEntries(c.pitches.map((p) => [p.id, p]));
  const out = [];
  c.scale.degrees.forEach((d) => {
    const p = byId[d.pitch_id];
    (p ? p.registers : []).forEach((reg) => out.push({ d, reg, variant: false, tonic: d.degree === 1 }));
  });
  (c.scale.variants || []).forEach((v) => {
    const p = byId[v.pitch_id];
    (p ? p.registers : []).forEach((reg) => out.push({ d: v, reg, variant: true, tonic: false }));
  });
  return out;
}

export function drawAbsolute(host, recs) {
  host.replaceChildren();
  const all = recs.flatMap((r) => degreeRegisters(r.c).map((x) => x.reg.hz));
  if (!all.length) return;
  const lo = Math.log2(Math.min(...all)) - 0.12, hi = Math.log2(Math.max(...all)) + 0.12;
  const W = Math.max(320, host.clientWidth), padL = 10, padR = 14, rowH = 46, top = 8;
  const H = top + recs.length * rowH + 34;
  const svg = el("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "img",
    "aria-label": "Measured frequency of every scale degree in every octave, per recording" }, host);
  const x = (hz) => padL + (W - padL - padR) * ((Math.log2(hz) - lo) / (hi - lo));
  const g = el("g", {}, svg);
  // 12-TET (A4 = 440) semitone guides; naturals labelled, C carries its Hz
  for (let n = Math.ceil(12 * (lo - Math.log2(A4)) + 57); n <= Math.floor(12 * (hi - Math.log2(A4)) + 57); n++) {
    const hz = A4 * 2 ** ((n - 57) / 12), pc = ((n % 12) + 12) % 12, oct = Math.floor(n / 12);
    const natural = [0, 2, 4, 5, 7, 9, 11].includes(pc);
    el("line", { x1: x(hz), x2: x(hz), y1: top, y2: H - 26, class: natural ? "grid" : "grid grid-minor" }, g);
    if (natural && (W >= 640 || pc === 0 || pc === 7)) {
      const t = el("text", { x: x(hz), y: H - 10, class: pc === 0 ? "tick tick-strong" : "tick", "text-anchor": "middle" }, g);
      t.textContent = pc === 0 ? `C${oct} ${Math.round(hz)}` : `${NOTE[pc]}${oct}`;
    }
  }
  recs.forEach((r, i) => {
    const y0 = top + i * rowH, y = y0 + 30;
    const lab = el("text", { x: padL, y: y0 + 13, class: "rowlabel" }, g);
    fitText(lab, [`${r.master.name} — ${r.track.title}`, r.track.title], W - padL - padR);
    el("line", { x1: padL, x2: W - padR, y1: y, y2: y, class: "baseline" }, g);
    degreeRegisters(r.c).forEach(({ d, reg, variant, tonic }) => {
      const mk = marker(g, x(reg.hz), y, d.status || "confirmed", { variant, small: variant, tonic });
      const ci = reg.ci95_hz ? ` · ±${fmt((reg.ci95_hz[1] - reg.ci95_hz[0]) / 2, 2)} Hz` : "";
      hitArea(g, x(reg.hz), y, [["v", `${fmt(reg.hz, 2)} Hz`],
        ["k", `${d.label}${reg.octave} · ${fmt(d.cents_from_tonic)} ¢ above tonic${variant ? " · variant" : ""}${tonic ? " · tonic" : ""}`],
        ["k", `${reg.notes ? reg.notes + " notes" : "frame estimate"}${ci}`], ["k", `${r.master.name} — ${r.track.title}`]],
      mk, `${r.track.title}: ${d.label}${reg.octave} at ${fmt(reg.hz, 2)} hertz`);
    });
  });
}

// ── legend (marker key) ────────────────────────────────────────────────────

export function legendHTML(summary) {
  const item = (svg, text) => `<span class="lg-item"><svg width="16" height="16" aria-hidden="true">${svg}</svg>${text}</span>`;
  return `<div class="viz-legend">
    ${item('<circle cx="8" cy="8" r="5" class="mk mk-confirmed"/>', "confirmed")}
    ${item('<circle cx="8" cy="8" r="5" class="mk mk-probable"/>', "probable")}
    ${item('<circle cx="8" cy="8" r="5" class="mk mk-tentative"/>', "tentative")}
    ${item('<circle cx="8" cy="8" r="3.5" class="mk mk-variant"/>', "variant (mobile degree)")}
    ${item('<path d="M8,2 L14,13 L2,13 Z" class="mk mk-tonic"/>', "tonic (absolute chart)")}
    ${summary ? item('<line x1="1" x2="15" y1="8" y2="8" class="range"/><line x1="8" x2="8" y1="2" y2="14" class="median"/>', "median & range across recordings") : ""}
  </div>`;
}
