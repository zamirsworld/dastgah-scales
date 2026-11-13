// Tuning map: where each master sets the tonic of each dastgah.
//
// Form: one lane per dastgah on a shared pitch axis; one mark per master, dastgah,
// instrument and pitch, its area the number of recordings. Instrument is the only
// categorical variable, so it takes colour and shape together (never colour alone).
// The pitch axis folds octaves by default, because the octave a tonic is assigned to
// depends on where the performance sits; the register view shows it as sounding.
// Note positions are 12-TET at A4 = 440 Hz, for reference only: Persian music has no
// fixed pitch. Every value is also in the table under the chart.

import { el, attachTip } from "./compare.js?v=13";

const C4 = 261.6256;
const NAT = [["C", 0], ["D", 200], ["E", 400], ["F", 500], ["G", 700], ["A", 900], ["B", 1100]];
const INSTRUMENTS = ["setar", "santur", "tar"];          // fixed colour order; others share the last slot
const slot = (inst) => { const i = INSTRUMENTS.indexOf(inst); return i < 0 ? 3 : i; };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const median = (a) => { const s = [...a].sort((x, y) => x - y), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
const cents = (hz) => 1200 * Math.log2(hz / C4);
const folded = (hz) => ((cents(hz) % 1200) + 1200) % 1200;
const noteOf = (label) => String(label || "").replace(/\d+$/, "");

// One group per master × dastgah × instrument × pitch (45 ¢ buckets on the chosen axis).
export function tuningGroups(catalog, axis = "fold") {
  const by = new Map();
  catalog.masters.forEach((m) => m.albums.forEach((a) => a.tracks.forEach((t) => {
    if (!t.has_result) return;
    const inst = t.instrument || m.instrument;
    const pos = axis === "fold" ? folded(t.tonic_hz) : cents(t.tonic_hz);
    const k = `${m.id}|${t.dastgah}|${inst}|${Math.round(pos / 45)}`;
    if (!by.has(k)) by.set(k, { master: m, dastgah: t.dastgah, inst, tracks: [] });
    by.get(k).tracks.push(t);
  })));
  return [...by.values()].map((g) => {
    const hz = median(g.tracks.map((t) => t.tonic_hz));
    const names = {};
    g.tracks.forEach((t) => { const n = noteOf(t.tonic_label); names[n] = (names[n] || 0) + 1; });
    return { ...g, n: g.tracks.length, hz, note: Object.entries(names).sort((a, b) => b[1] - a[1])[0][0],
      inferred: g.tracks.filter((t) => t.tonic_inferred).length };
  }).sort((a, b) => b.n - a.n);
}

export function drawTuningMap(host, catalog, { axis = "fold", onPick } = {}) {
  host.replaceChildren();
  const groups = tuningGroups(catalog, axis);
  const lanes = catalog.dastgahs.filter((d) => groups.some((g) => g.dastgah === d.id));
  const W = Math.max(300, host.clientWidth || 900), narrow = W < 620;
  const L = narrow ? 10 : 132, R = 16, top = 28, LH = narrow ? 56 : 42;
  const H = top + lanes.length * LH + 6, pw = W - L - R;
  const svg = el("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "img",
    "aria-label": "Tonic pitch of each dastgah by master. The table below holds every value." }, host);
  const lo = cents(92), hi = cents(880);
  const X = (hz) => L + (axis === "fold" ? folded(hz) / 1200 : (cents(hz) - lo) / (hi - lo)) * pw;
  const guide = (x, text, strong) => {
    el("line", { x1: x, x2: x, y1: top, y2: H - 6, class: "grid" }, svg);
    if (text) el("text", { x, y: top - 9, "text-anchor": "middle", class: `tick${strong ? " tick-strong" : ""}` }, svg).textContent = text;
  };
  if (axis === "fold") NAT.concat([["C", 1200]]).forEach(([n, c]) => guide(L + c / 1200 * pw, n, true));
  else for (let o = 1; o <= 5; o++) NAT.forEach(([n, c]) => {
    const cc = (o - 4) * 1200 + c;
    if (cc >= lo && cc <= hi) guide(L + (cc - lo) / (hi - lo) * pw, narrow && n !== "C" && n !== "G" ? "" : n + (n === "C" ? o : ""), n === "C");
  });
  lanes.forEach((d, i) => {
    const y = top + i * LH + (narrow ? LH - 20 : LH / 2);
    el("line", { x1: L, x2: W - R, y1: y, y2: y, class: "lane" }, svg);
    const name = d.kind === "group" ? "Shared gushe-ha" : d.name;
    if (narrow) el("text", { x: L, y: y - 22, class: "rowlabel" }, svg).textContent = name;
    else el("text", { x: L - 12, y: y + 4, "text-anchor": "end", class: "rowlabel" }, svg).textContent = name;
  });
  [...groups].forEach((g) => {                      // largest first, so small marks stay on top
    const i = lanes.findIndex((d) => d.id === g.dastgah);
    const y = top + i * LH + (narrow ? LH - 20 : LH / 2);
    const x = X(axis === "fold" ? g.tracks[0].tonic_hz : g.hz), r = Math.min(LH / 2 - 2, 3.5 + 2.1 * Math.sqrt(g.n));
    const s = slot(g.inst), d = catalog.dastgahs.find((q) => q.id === g.dastgah);
    const label = `${g.master.name}, ${d.name}, ${g.inst}: tonic ${g.note}, ${g.hz.toFixed(1)} Hz, ${g.n} recording${g.n > 1 ? "s" : ""}`;
    const common = { class: `bub bub-${s}`, tabindex: 0, role: "link", "aria-label": label };
    const mark = s === 1 ? el("rect", { x: x - r * 0.9, y: y - r * 0.9, width: r * 1.8, height: r * 1.8, rx: 2, ...common }, svg)
      : s === 2 ? el("path", { d: `M${x},${y - r * 1.15} L${x + r * 1.15},${y} L${x},${y + r * 1.15} L${x - r * 1.15},${y} Z`, ...common }, svg)
      : el("circle", { cx: x, cy: y, r, ...common }, svg);
    attachTip(mark, [["v", `${g.master.name} · ${d.name}`], ["k", `${g.inst} · tonic ${g.note}, median ${g.hz.toFixed(1)} Hz`],
      ["k", `${g.n} recording${g.n > 1 ? "s" : ""}${g.inferred ? ` · ${g.inferred} not yet checked by ear` : ""}`]], mark);
    if (onPick) {
      mark.addEventListener("click", () => onPick(g));
      mark.addEventListener("keydown", (e) => { if (e.key === "Enter") onPick(g); });
    }
  });
}

export function tuningMapHTML(catalog, axis) {
  const groups = tuningGroups(catalog, axis);
  const insts = [...new Set(groups.map((g) => g.inst))].sort((a, b) => slot(a) - slot(b));
  const order = catalog.dastgahs.map((d) => d.id);
  const rows = [...groups].sort((a, b) => order.indexOf(a.dastgah) - order.indexOf(b.dastgah) || b.n - a.n).map((g) => {
    const d = catalog.dastgahs.find((q) => q.id === g.dastgah);
    return `<tr><td><a href="#/dastgah/${esc(d.id)}">${esc(d.name)}</a></td><td><a href="#/master/${esc(g.master.id)}">${esc(g.master.name)}</a></td>
      <td>${esc(g.inst)}</td><td>${esc(g.note)}</td><td class="num">${g.hz.toFixed(1)}</td><td class="num">${g.n}</td><td class="num">${g.inferred || ""}</td></tr>`;
  }).join("");
  return `<h2>Where each master sets the tonic</h2>
    <p class="muted">One mark per master, dastgah and pitch; its area is the number of recordings. Click a mark to list them.
      Note positions are 12-TET at A4 = 440 Hz, for reference only.</p>
    <div class="br-bar tm-bar"><span class="br-k">Pitch axis</span><span class="seg" role="group" aria-label="Pitch axis">
      <button type="button" data-axis="fold" aria-pressed="${axis === "fold"}">Note, octaves folded</button>
      <button type="button" data-axis="reg" aria-pressed="${axis === "reg"}">Sounding register</button></span>
      <span class="viz-legend tm-legend">${insts.map((i) => `<span class="lg-item"><i class="tm-sw tm-sw-${slot(i)}"></i>${esc(i)}</span>`).join("")}</span></div>
    <div id="tm-map" class="viz"></div>
    <details class="tm-table"><summary>Table of these values</summary><div class="table-wrap"><table><thead><tr><th>Dastgah</th><th>Master</th>
      <th>Instrument</th><th>Tonic</th><th class="num">Median Hz</th><th class="num">Recordings</th><th class="num">Not yet by ear</th></tr></thead>
      <tbody>${rows}</tbody></table></div></details>`;
}
