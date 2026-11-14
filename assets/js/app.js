// Dastgah Scales: static site.
// Hash router over data/catalog.json; track pages lazy-load data/tracks/<key>.json.
// All URLs are relative so the site works under a GitHub Pages subpath.

import { buildSlots, drawAbsolute, drawIntervals, legendHTML } from "./compare.js?v=14";
import { drawTimeline, progressionTables } from "./progression.js?v=14";
import { drawRuler, drawSteps, accuracyHTML, ciHalf, FARHAT } from "./track.js?v=14";
import { pluck, sequence, stopSequence, setDrone, droneOn, degreeHz, scaleHz } from "./synth.js?v=14";
import { pageBrowse, wireBrowse, stripSVG, filterLibrary } from "./browse.js?v=14";
import { drawTuningMap, tuningMapHTML } from "./tuningmap.js?v=14";
import { pageScales, wireScales, scalesLink } from "./scales.js?v=14";
import { signatureHTML, mountSignature, nearHTML, galleryHTML, LEGEND as SIG_LEGEND } from "./signature.js?v=14";

const app = document.getElementById("app");
const footer = document.getElementById("footer");
let afterRender = null;        // set by pages that draw charts after their HTML is in place
let catalog = null;
let method = null;
let tunings = null;            // data/tunings.json, loaded the first time a page needs it

let signatures = null;         // data/signatures.json: every recording's melodic signature, for galleries and matching

async function loadSignatures() {
  if (!signatures) signatures = (await loadJSON("data/signatures.json")).signatures;
  return signatures;
}

async function loadTunings() {
  if (!tunings) tunings = await loadJSON("data/tunings.json");
  return tunings;
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fa = (s) => (s ? ` <bdi class="fa" lang="fa">${esc(s)}</bdi>` : "");
const fmt = (x, d = 1) => (x === null || x === undefined ? "—" : Number(x).toFixed(d));
const pct = (x) => (x === null || x === undefined ? "—" : `${Math.round(x * 100)} %`);
const store = {
  get(area, k) { try { return window[area].getItem(k); } catch (_) { return null; } },
  set(area, k, v) { try { window[area].setItem(k, v); } catch (_) { /* storage blocked: fine */ } },
};

async function loadJSON(path) {
  const res = await fetch(path, { cache: "no-cache" });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

function dastgah(id) {
  return catalog.dastgahs.find((d) => d.id === id) || { id, name: id };
}

// "avaz of Shur", "dastgah", or for a group (e.g. shared gushe-ha) its own description
function kindLabel(d) {
  if (d.kind === "avaz") return `avaz of ${esc(dastgah(d.parent).name)}`;
  if (d.kind === "group") return esc(d.label || "group");
  return "dastgah";
}

function allTracks() {
  const out = [];
  for (const m of catalog.masters)
    for (const a of m.albums)
      for (const t of a.tracks) out.push({ master: m, album: a, track: t });
  return out;
}

const instrumentsOf = (m) => [...new Set([m.instrument, ...m.albums.flatMap((a) => a.tracks.map((t) => t.instrument))]
  .filter(Boolean))].join(", ");
const draftBadge = (t) => (t.review !== "approved" ? '<span class="badge draft">draft</span>' : "");
const trackLink = (t) => `<a href="#/track/${esc(t.key)}">${esc(t.title)}</a>${draftBadge(t)}`;
const tonicCell = (t) => (t.has_result ? `${esc(t.tonic_label)} · ${fmt(t.tonic_hz, 2)} Hz` : '<span class="muted">not analysed</span>');

function crumbs(parts) {
  return `<nav class="crumbs" aria-label="Breadcrumb">${parts.map(([href, label]) =>
    href ? `<a href="${href}">${label}</a>` : `<span aria-current="page">${label}</span>`).join(" › ")}</nav>`;
}

function extLinks(links) {
  return (links || []).map((l) =>
    `<a href="${esc(l.url)}" rel="noopener" target="_blank">${esc(l.label || l.kind)} ↗</a>`).join(" · ");
}

// ── browsing context (for ◀ / ▶ within a dastgah, album or master) ─────────

function setCtx(kind, id) { store.set("sessionStorage", "ds.ctx", JSON.stringify({ kind, id })); }

function contextList(hit) {
  let ctx = null;
  try { ctx = JSON.parse(store.get("sessionStorage", "ds.ctx") || "null"); } catch (_) { ctx = null; }
  const all = allTracks();
  const lists = {
    dastgah: (id) => [all.filter((x) => x.track.dastgah === id), `in ${dastgah(id).name}`, `#/dastgah/${id}`],
    master: (id) => [all.filter((x) => x.master.id === id), `by ${hit.master.name}`, `#/master/${id}`],
    album: (id) => [all.filter((x) => `${x.master.id}/${x.album.id}` === id), `on ${hit.album.title}`,
      `#/album/${id}`],
  };
  if (ctx && lists[ctx.kind]) {
    const [list, label, href] = lists[ctx.kind](ctx.id);
    if (list.some((x) => x.track.key === hit.track.key)) return { list, label, href };
  }
  const [list, label, href] = lists.album(`${hit.master.id}/${hit.album.id}`);
  return { list, label, href };
}

function prevNext(hit) {
  const { list, label, href } = contextList(hit);
  if (list.length < 2) return "";
  const i = list.findIndex((x) => x.track.key === hit.track.key);
  const p = list[(i - 1 + list.length) % list.length], n = list[(i + 1) % list.length];
  return `<nav class="pager" aria-label="Previous and next track">
    <a href="#/track/${esc(p.track.key)}" rel="prev">◀ ${esc(p.track.title)}</a>
    <a class="muted" href="${href}">${i + 1} of ${list.length} ${esc(label)}</a>
    <a href="#/track/${esc(n.track.key)}" rel="next">${esc(n.track.title)} ▶</a></nav>`;
}

// ── pages ──────────────────────────────────────────────────────────────────

function pageHome(mode) {
  afterRender = () => wireBrowse(mode, { setCtx });
  return pageBrowse(catalog, mode);
}

function pageMaster(id) {
  const m = catalog.masters.find((x) => x.id === id);
  if (!m) return notFound();
  setCtx("master", m.id);
  const albums = m.albums.map((a) => `<div class="card">
      <h3><a href="#/album/${esc(m.id)}/${esc(a.id)}">${esc(a.title)}</a></h3>
      <div class="muted">${esc(a.release_date || "")} · ${a.tracks.length} track(s)</div></div>`).join("");
  const mine = allTracks().filter((x) => x.master.id === m.id);
  const ds = [...new Set(mine.map((x) => x.track.dastgah))].map(dastgah);
  const tonicRows = mine.filter((x) => x.track.has_result).map(({ album, track }) => `<tr>
      <td>${trackLink(track)}</td><td>${esc(album.title)}</td><td>${esc(album.release_date || "")}</td>
      <td><a href="#/dastgah/${esc(track.dastgah)}">${esc(dastgah(track.dastgah).name)}</a></td>
      <td>${esc(track.tonic_label)}</td><td class="num">${fmt(track.tonic_hz, 2)}</td>
      <td class="num">${track.tuning_offset_cents === undefined || track.tuning_offset_cents === null ? "—" :
        `${track.tuning_offset_cents > 0 ? "+" : ""}${fmt(track.tuning_offset_cents, 0)}`}</td>
      <td class="sc">${stripSVG(track)}</td></tr>`).join("");
  return crumbs([["#/", "Library"], [null, esc(m.name)]]) +
    `<h1>${esc(m.name)}${fa(m.name_fa)}</h1>
     <div class="muted">${esc(instrumentsOf(m))}${m.years ? ` · ${esc(m.years)}` : ""}</div>
     ${m.bio ? `<p>${esc(m.bio)}</p>` : ""}
     ${m.links && m.links.length ? `<p>${extLinks(m.links)}</p>` : ""}
     <p><strong>Dastgahs recorded:</strong> ${ds.map((d) => `<a href="#/dastgah/${esc(d.id)}">${esc(d.name)}</a>${fa(d.name_fa)}`).join(" · ")}</p>
     <p><a class="btn" href="${scalesLink("master", esc(m.id))}">Compare this master's scales and starting notes</a></p>
     <h2>Albums</h2><div class="grid">${albums}</div>
     ${tonicRows ? `<h2>Tonic across recordings</h2>
       <p class="muted">Did the master hold a fixed pitch over the years? Absolute Hz is as recorded: old
       transfers can run slightly fast or slow.</p>
       <div class="table-wrap"><table><thead><tr><th>Track</th><th>Album</th><th>Released</th><th>Dastgah</th>
       <th>Tonic</th><th class="num">Hz</th><th class="num">¢ from A440</th><th>Scale, 0–1200 ¢</th></tr></thead><tbody>${tonicRows}</tbody></table></div>` : ""}`;
}

function pageAlbum(mid, aid) {
  const m = catalog.masters.find((x) => x.id === mid);
  const a = m && m.albums.find((x) => x.id === aid);
  if (!a) return notFound();
  setCtx("album", `${m.id}/${a.id}`);
  const rows = a.tracks.map((t) => {
    const d = dastgah(t.dastgah);
    return `<tr><td class="num">${esc(t.track_number ?? "")}</td><td>${trackLink(t)}</td>
      <td><a href="#/dastgah/${esc(d.id)}">${esc(d.name)}</a>${fa(d.name_fa)}</td>
      <td>${tonicCell(t)}</td><td class="muted">${t.has_result ? esc((t.scale || []).join(" ")) : ""}</td>
      <td class="sc">${stripSVG(t)}</td></tr>`;
  }).join("");
  return crumbs([["#/", "Library"], [`#/master/${esc(m.id)}`, esc(m.name)], [null, esc(a.title)]]) +
    `<h1>${esc(a.title)}</h1><div class="muted">${esc(m.name)} · ${esc(a.release_date || "")}</div>
     <h2>Tracks</h2><div class="table-wrap"><table>
     <thead><tr><th class="num">#</th><th>Title</th><th>Dastgah / avaz</th><th>Tonic</th><th>Scale</th><th>0–1200 ¢</th></tr></thead>
     <tbody>${rows}</tbody></table></div>`;
}

let mapAxis = "fold";

function pageDastgahs() {
  const card = (d) => {
    const n = allTracks().filter((x) => x.track.dastgah === d.id).length;
    return `<div class="card${n ? "" : " card-empty"}"><h3><a href="#/dastgah/${esc(d.id)}">${esc(d.name)}</a>${fa(d.name_fa)}</h3>
      <div class="muted">${kindLabel(d)} · ${n} recording(s)</div></div>`;
  };
  // each dastgah followed by the avaz-ha derived from it, as the tradition groups them
  const roots = catalog.dastgahs.filter((d) => !d.parent);
  const cards = roots.map((d) => card(d) + catalog.dastgahs.filter((k) => k.parent === d.id).map(card).join("")).join("");
  afterRender = () => {
    const host = document.getElementById("tm-map");
    const draw = () => drawTuningMap(host, catalog, {
      axis: mapAxis,
      onPick: (g) => { filterLibrary(catalog, { master: g.master.id, dastgah: g.dastgah }); location.hash = "#/list"; },
    });
    app.querySelector(".tm-bar").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-axis]");
      if (!b) return;
      mapAxis = b.dataset.axis;
      app.querySelectorAll("button[data-axis]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      draw();
    });
    draw();
    return draw;
  };
  return crumbs([["#/", "Library"], [null, "Dastgahs"]]) + `<h1>Dastgahs and avaz</h1>` +
    tuningMapHTML(catalog, mapAxis) + `<h2>All dastgah-ha and avaz-ha</h2><div class="grid">${cards}</div>`;
}

async function pageScalesRoute(parts) {
  const data = await loadTunings();
  afterRender = () => wireScales();
  return crumbs([["#/", "Library"], [null, "Scales"]]) + pageScales(catalog, data, parts);
}

async function pageDastgah(id) {
  const d = dastgah(id);
  setCtx("dastgah", id);
  const entries = allTracks().filter((x) => x.track.dastgah === id);
  const rel = d.kind === "group" ? `<p class="muted">${esc(d.description || "")}</p>` : d.parent
    ? `<p class="muted">Avaz of <a href="#/dastgah/${esc(d.parent)}">${esc(dastgah(d.parent).name)}</a>${fa(dastgah(d.parent).name_fa)}.</p>`
    : (() => {
        const kids = catalog.dastgahs.filter((x) => x.parent === id);
        return kids.length ? `<p class="muted">Avaz derived from it: ${kids.map((k) =>
          `<a href="#/dastgah/${esc(k.id)}">${esc(k.name)}</a>${fa(k.name_fa)}`).join(" · ")}.</p>` : "";
      })();
  let pooled = [];
  try { pooled = (await loadTunings()).tunings.filter((t) => t.dastgah === id); } catch (_) { pooled = []; }
  const explore = pooled.length ? `<p><a class="btn" href="${scalesLink("dastgah", esc(id))}">Compare the masters' scales and starting notes</a></p>` : "";
  const head = crumbs([["#/", "Library"], ["#/dastgahs", "Dastgahs"], [null, esc(d.name)]]) +
    `<h1>${esc(d.name)}${fa(d.name_fa)}</h1>${rel}${explore}`;
  const analysed = entries.filter((e) => e.track.has_result);
  if (!entries.length) return head + '<p class="muted">No recordings yet.</p>';
  let sigs = {};
  try { sigs = await loadSignatures(); } catch (_) { sigs = {}; }
  const gallery = entries.some((e) => sigs[e.track.key]) ? `<h2>Melodic signatures</h2>
    <p class="muted">How each recording moves between its notes, tonic at the top: one line per move, from the notes extracted from
      the recording. ${d.kind === "group" ? "" : "The notes are the same from one to the next; the moves are what tell the gushe-ha apart. "}Open a recording to replay it.</p>
    ${SIG_LEGEND}${galleryHTML(entries, sigs)}` : "";
  const recs = await Promise.all(analysed.map(async (e) => ({
    ...e, c: (await loadJSON(`data/tracks/${e.track.key}.json`)).consensus })));
  const slots = buildSlots(recs);
  const list = entries.map(({ master, album, track }) => `<tr><td>${trackLink(track)}</td>
      <td><a href="#/master/${esc(master.id)}">${esc(master.name)}</a></td><td>${esc(album.title)}</td>
      <td>${tonicCell(track)}</td></tr>`).join("");
  if (!recs.length || d.kind === "group") {   // a group mixes modes: no shared degree table
    return head + gallery + `<h2>Recordings</h2><div class="table-wrap"><table><tbody>${list}</tbody></table></div>`;
  }
  // degree × recording table (cents from tonic) + summary row
  const cell = (r, s) => {
    const m = s.members.find((m) => m.ri === recs.indexOf(r));
    return m ? `${fmt(m.d.cents_from_tonic)}${m.d.status && m.d.status !== "confirmed" ? `<span class="muted">*</span>` : ""}` : "—";
  };
  const degRows = recs.map((r) => `<tr><th scope="row">${esc(r.master.name)} — ${esc(r.track.title)}</th>
      <td>${esc(r.c.tonic.label)} ${fmt(r.c.tonic.hz, 2)}</td>${slots.map((s) => `<td class="num">${cell(r, s)}</td>`).join("")}
      <td class="muted">${r.c.scale.steps_cents.map((x) => fmt(x, 0)).join(" · ")}</td></tr>`).join("");
  const sumRow = recs.length >= 2 ? `<tr class="sum"><th scope="row">Median (range)</th><td></td>${slots.map((s) =>
      `<td class="num">${s.members.length >= 2 ? `${fmt(s.median)}<br><span class="muted">${fmt(s.min, 0)}–${fmt(s.max, 0)}</span>` : "—"}</td>`).join("")}<td></td></tr>` : "";
  const byId = (c) => Object.fromEntries(c.pitches.map((p) => [p.id, p]));
  const absCell = (r, s) => {
    const m = s.members.find((m) => m.ri === recs.indexOf(r));
    const p = m && byId(r.c)[m.d.pitch_id];
    return p && p.registers.length ? p.registers.map((g) => fmt(g.hz, 2)).join("<br>") : "—";
  };
  const absRows = recs.map((r) => `<tr><th scope="row">${esc(r.master.name)} — ${esc(r.track.title)}</th>
      ${slots.map((s) => `<td class="num">${absCell(r, s)}</td>`).join("")}</tr>`).join("");
  const slotHead = slots.map((s, i) => `<th class="num">${i + 1}<br><span class="muted">${esc(s.label)}</span></th>`).join("");

  afterRender = () => {
    const iv = document.getElementById("cmp-intervals"), ab = document.getElementById("cmp-absolute");
    const grid24 = document.getElementById("cmp-grid24");
    const draw = () => { drawIntervals(iv, recs, slots, { grid24: grid24 && grid24.checked }); drawAbsolute(ab, recs); };
    draw();
    if (grid24) grid24.addEventListener("change", draw);
    return draw;
  };
  return head + `
    <p class="muted">${recs.length} analysed recording(s)${entries.length > recs.length ? ` of ${entries.length}` : ""}.
      Every recording sits on the same axes, so tunings can be compared across masters, albums and instruments.</p>
    ${legendHTML(recs.length >= 2)}
    <h2>Intervals</h2>
    <p class="muted">Scale degrees in cents above each recording's own tonic. Guides: 12-TET every 100 ¢.
      <label class="inline"><input type="checkbox" id="cmp-grid24"> show the 24-TET quarter-tone grid</label></p>
    <div id="cmp-intervals" class="viz"></div>
    <h2>Absolute pitch</h2>
    <p class="muted">Measured frequency of every degree in every octave it was played (log scale), against 12-TET note
      guides at A4 = 440 Hz. ▲ marks the tonic. Absolute Hz is as recorded: old transfers may run slightly fast or slow.</p>
    <div id="cmp-absolute" class="viz"></div>
    ${gallery}
    <h2>Degrees by recording (¢ from tonic)</h2>
    <div class="table-wrap"><table><thead><tr><th>Recording</th><th>Tonic (Hz)</th>${slotHead}<th>Steps ¢</th></tr></thead>
      <tbody>${degRows}${sumRow}</tbody></table></div>
    <p class="muted">* probable or tentative degree.</p>
    <h2>Measured Hz by degree</h2>
    <div class="table-wrap"><table><thead><tr><th>Recording</th>${slotHead}</tr></thead><tbody>${absRows}</tbody></table></div>
    <h2>Recordings</h2>
    <div class="table-wrap"><table><thead><tr><th>Track</th><th>Master</th><th>Album</th><th>Tonic</th></tr></thead>
      <tbody>${list}</tbody></table></div>`;
}

// Persian music has no fixed pitch: the tonic is named on its customary note and the
// instrument's distance from A4 = 440 Hz is reported separately.
function tuningLine(t) {
  if (t.tuning_offset_cents === undefined || t.tuning_offset_cents === null) return "";
  const off = t.tuning_offset_cents;
  const near = Math.abs(off) < 5;
  return `<p class="muted">${near ? "Tuned at concert pitch" : `Tuned ${off > 0 ? "+" : ""}${fmt(off, 0)} ¢ from concert pitch`}
    (A4 ≈ ${fmt(t.reference_a4_hz, 1)} Hz). Persian music has no fixed pitch, so the tonic is named on its
    customary note and the other notes are named from it.</p>`;
}

// timestamped link for sources that support it (YouTube); otherwise none
function atTime(links, s) {
  const yt = (links || []).find((l) => l.kind === "youtube");
  if (!yt || s === null || s === undefined) return "";
  const t = Math.floor(s);
  return ` <a href="${esc(yt.url)}${yt.url.includes("?") ? "&" : "?"}t=${t}s" rel="noopener" target="_blank"
    aria-label="Open on YouTube at ${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}">▶ YouTube</a>`;
}

async function pageTrack(key) {
  const hit = allTracks().find((x) => x.track.key === key);
  if (!hit) return notFound();
  const { master, album, track } = hit;
  const head = crumbs([["#/", "Library"], [`#/master/${esc(master.id)}`, esc(master.name)],
    [`#/album/${esc(master.id)}/${esc(album.id)}`, esc(album.title)], [null, esc(track.title)]]);
  const d = dastgah(track.dastgah);
  const links = extLinks(track.links);
  let html = head + prevNext(hit) + `<h1>${esc(track.title)}${draftBadge(track)}</h1>
    <dl class="kv">
      <dt>Master</dt><dd><a href="#/master/${esc(master.id)}">${esc(master.name)}</a>${fa(master.name_fa)} · ${esc(track.instrument || master.instrument || "")}</dd>
      <dt>Album</dt><dd><a href="#/album/${esc(master.id)}/${esc(album.id)}">${esc(album.title)}</a>${album.release_date ? ` <span class="muted">(${esc(album.release_date)})</span>` : ""}</dd>
      <dt>Dastgah</dt><dd><a href="#/dastgah/${esc(d.id)}">${esc(d.name)}</a>${fa(d.name_fa)}</dd>
      ${(track.gushe || []).length ? `<dt>Gushe-ha</dt><dd>${track.gushe.map((g) => `${esc(g.name)}${fa(g.name_fa)}`).join(" · ")}</dd>` : ""}
      <dt>Listen to the original</dt><dd>${links || '<span class="muted">no external link yet</span>'}</dd>
    </dl>`;
  if (track.review !== "approved") {
    html += `<p class="note">Draft: this analysis has not been reviewed by ear yet, and may change.</p>`;
  }
  if (!track.has_result) return html + '<p class="muted">Not analysed yet.</p>';

  const page = await loadJSON(`data/tracks/${key}.json`);
  const c = page.consensus;
  const byId = Object.fromEntries(c.pitches.map((p) => [p.id, p]));
  const farhat = (c.theory_fit || []).find((m) => m.model === "farhat");

  const deg = c.scale.degrees.map((x, i) => {
    const p = byId[x.pitch_id], h = ciHalf(p);
    const hz = degreeHz(c, x.cents_from_tonic, x.pitch_id);
    return `<tr class="status-row" data-row="${i}"><td><button class="play" data-deg="${i}" aria-label="Play ${esc(x.label)}">▶</button></td>
      <td class="num">${x.degree}</td><td>${esc(x.label)}</td>
      <td class="num">${fmt(x.cents_from_tonic, 1)}${h ? ` <span class="muted">±${fmt(h, 1)}</span>` : ""}</td>
      <td class="num">${fmt(hz, 2)}</td><td class="num">${pct(x.support)}</td>
      <td class="status-${esc(x.status || "confirmed")}">${esc(x.status || "")}</td></tr>`;
  }).join("");
  const stepRows = c.scale.steps_cents.map((s, i) => {
    const a = c.scale.degrees[i], b = c.scale.degrees[i + 1] || c.scale.degrees[0];
    const cls = farhat && farhat.assignment[i];
    return `<tr><td>${esc(a.label)} → ${esc(b.label)}</td><td class="num">${fmt(s, 1)}</td>
      <td>${cls ? `${esc((FARHAT[cls.class] || [0, cls.class])[1])} <span class="muted">(${cls.residual > 0 ? "+" : ""}${fmt(cls.residual, 1)})</span>` : "—"}</td></tr>`;
  }).join("");
  const variants = (c.scale.variants || []).map((v) =>
    `<li>degree ${v.degree}: <strong>${esc(v.label)}</strong> ${fmt(v.cents_from_tonic, 1)} ¢
     <span class="muted">(${esc(v.status || "")}, ${v.offset_cents > 0 ? "+" : ""}${fmt(v.offset_cents, 1)} ¢)</span></li>`).join("");
  const additional = (c.scale.additional || []).map((a) =>
    `<li><strong>${esc(a.label)}</strong> ${fmt(a.cents_from_tonic, 1)} ¢</li>`).join("");
  const theory = (c.theory_fit || []).map((m) =>
    `<tr><td>${esc(m.name)}</td><td>${esc(m.basis)}</td><td class="num">${fmt(m.residual_rms, 1)}</td></tr>`).join("");
  const hyps = (c.hypotheses || []).filter((h) => !h.error).map((h) => `
    <h3>${esc(h.label || h.source)}</h3>
    <p class="muted">Median difference ${fmt(h.median_diff_cents, 1)} ¢ (measured − hypothesis) over ${h.compared.length} notes.</p>
    <div class="table-wrap"><table><thead><tr><th>Note</th><th class="num">Hypothesis Hz</th><th class="num">Measured Hz</th><th class="num">Diff ¢</th></tr></thead>
    <tbody>${h.compared.map((n) => `<tr><td>${esc(n.name)}${n.octave}</td><td class="num">${fmt(n.hz, 2)}</td>
      <td class="num">${fmt(n.measured_hz, 2)}</td><td class="num">${n.diff_cents > 0 ? "+" : ""}${fmt(n.diff_cents, 1)}</td></tr>`).join("")}</tbody></table></div>`).join("");
  const pitchRows = c.pitches.map((p) => {
    const reg = p.registers.map((r) => `<button class="play play-sm" data-hz="${r.hz}" aria-label="Play ${esc(p.label)} at ${fmt(r.hz, 2)} hertz">▶</button>
      ${fmt(r.hz, 2)} Hz <span class="muted">(oct ${r.octave}${r.ci95_hz ? `, ±${fmt((r.ci95_hz[1] - r.ci95_hz[0]) / 2, 2)}` : ""}${r.notes ? `, ${r.notes} notes` : ""})</span>`).join("<br>");
    return `<tr><td>${esc(p.label)}</td><td class="num">${fmt(p.cents_from_tonic, 1)}</td>
      <td>${reg || '<span class="muted">no register established</span>'}</td><td class="num">${pct(p.support)}</td>
      <td class="status-${esc(p.status)}">${esc(p.status)}</td><td>${esc(p.kind)}</td></tr>`;
  }).join("");
  const gushe = c.segments.gushe.map((g) => `<tr><td>${esc(g.name)}${fa(g.name_fa)}</td>
      <td class="num">${g.start_s === null ? "—" : `${Math.floor(g.start_s / 60)}:${String(Math.floor(g.start_s % 60)).padStart(2, "0")}`}</td>
      <td>${esc(g.status)}${atTime(track.links, g.start_s)}</td></tr>`).join("");

  html += `<h2>Listen to the tuning</h2>
    <div class="listen" role="group" aria-label="Tuning playback">
      <button id="pl-scale" class="btn btn-primary">▶ Scale up and down</button>
      <button id="pl-drone" class="btn" aria-pressed="false">Drone on ${esc(c.tonic.label)}</button>
      <button id="pl-stop" class="btn">Stop</button>
      <label class="inline"><input type="checkbox" id="pl-et"> hear 12-TET instead, to compare</label>
    </div>
    <p class="muted">Synthesized at the measured frequencies, not the recording. Click a degree on the ruler or ▶ in a
      table to hear a single note.</p>

    <h2>Tonic</h2>
    <p><strong>${esc(c.tonic.label)}</strong> · ${fmt(c.tonic.hz, 2)} Hz${c.tonic.ci95_hz ? ` <span class="muted">(95 % CI ${fmt(c.tonic.ci95_hz[0], 2)}–${fmt(c.tonic.ci95_hz[1], 2)})</span>` : ""}</p>
    ${tuningLine(c.tonic)}

    <h2>Scale</h2>
    <p class="muted">Measured degrees (top row, with 95 % CI whiskers) against the nearest values of three theory models.
      The grey joins show how far each degree sits from the model. Models are references only: they never steer the measurement.</p>
    <div id="tr-ruler" class="viz"></div>
    <div id="tr-steps" class="viz"></div>
    <p class="muted">Farhat classes: ${Object.values(FARHAT).map(([k, v]) => `<strong>${k}</strong> ${esc(v)}`).join(" · ")}.</p>
    <div class="table-wrap" style="margin-top:10px"><table>
      <thead><tr><th><span class="sr">Play</span></th><th class="num">Degree</th><th>Note</th><th class="num">¢ from tonic</th>
      <th class="num">Hz (tonic octave)</th><th class="num">Support</th><th>Status</th></tr></thead>
      <tbody id="deg-body">${deg}</tbody></table></div>
    ${variants ? `<p><strong>Variants</strong> (mobile degrees):</p><ul>${variants}</ul>` : ""}
    ${additional ? `<p><strong>Additional pitches</strong>:</p><ul>${additional}</ul>` : ""}
    <h3>Intervals</h3>
    <div class="table-wrap"><table><thead><tr><th>Step</th><th class="num">¢</th><th>Nearest Farhat class (difference ¢)</th></tr></thead>
      <tbody>${stepRows}</tbody></table></div>
    ${theory ? `<h3>Fit to theory models</h3><p class="muted">RMS distance of the measured degrees (or steps) from each model's nearest values.</p>
      <div class="table-wrap"><table><thead><tr><th>Model</th><th>Basis</th><th class="num">RMS ¢</th></tr></thead><tbody>${theory}</tbody></table></div>` : ""}

    <h2>Absolute pitch by register</h2>
    <p class="muted">Every pitch heard, in every octave where it was played as a real note. Absolute Hz is as recorded.</p>
    <div class="table-wrap"><table>
      <thead><tr><th>Note</th><th class="num">¢ from tonic</th><th>Hz by register</th>
      <th class="num">Support</th><th>Status</th><th>Kind</th></tr></thead>
      <tbody>${pitchRows}</tbody></table></div>
    ${hyps ? `<h2>Hypotheses</h2>${hyps}` : ""}`;
  if (page.signature) {
    html += `<h2>Melodic signature</h2>
      <p class="muted">How the performance moves between its notes. Each line is a step of the melody from one note to the next,
        from the notes extracted from this recording; the tonic is at the top. Play replays them in order, at their measured
        times, with each line fading as the music goes on. Synthesized from the measured notes, not the recording.</p>
      ${signatureHTML()}`;
  }
  if (c.progression) {
    html += `<h2>Progression</h2><p>${esc(c.progression.narrative)}</p>
      <p class="muted">Each bar is a note (time across, pitch up); faint lines are the scale degrees in every octave,
      stronger lines the tonic. Shaded bands are the ${c.segments.level === "gushe" ? "gushe-ha" : "phrases"}.</p>
      <div id="prog-timeline" class="viz"></div>${progressionTables(c, esc)}`;
  }
  if (gushe) html += `<h2>Gushe-ha</h2>
    <p class="muted">Start times are proposed by the pipeline until confirmed by ear.</p>
    <div class="table-wrap"><table>
      <thead><tr><th>Gushe</th><th class="num">Start</th><th>Status</th></tr></thead>
      <tbody>${gushe}</tbody></table></div>`;
  html += `<h2>Accuracy</h2>${accuracyHTML(c, esc)}
    <p class="muted" style="margin-top:24px">Pipeline ${esc(c.pipeline_version)} · matrix
    “${esc(c.matrix.preset)}” (${c.matrix.n_runs} runs, ${esc(c.matrix.families.join(", "))}) · ${esc(c.generated_at)} ·
    <a href="#/method">method</a></p>` + prevNext(hit);

  afterRender = () => {
    if (page.signature && c.progression) {
      mountSignature(c, page.signature, track.instrument || master.instrument);
      loadSignatures().then((sigs) => {
        const el = document.getElementById("sig-near");
        const lookup = (k) => { const x = allTracks().find((e) => e.track.key === k); return x && { ...x, dastgah: dastgah(x.track.dastgah).name }; };
        if (el && location.hash === `#/track/${key}`) el.innerHTML = nearHTML(key, sigs, lookup);
      }).catch(() => { /* the page works without the comparison */ });
    }
    return wireTrack(c, track.instrument || master.instrument);
  };
  return html;
}

function wireTrack(c, instrument) {
  const et = document.getElementById("pl-et");
  const rows = [...document.querySelectorAll("#deg-body tr")];
  const mark = (i) => rows.forEach((r, k) => r.classList.toggle("playing", k === i));
  const playDeg = (i) => {
    const dg = c.scale.degrees[i];
    pluck(degreeHz(c, dg.cents_from_tonic, dg.pitch_id, { tempered: et.checked }), { instrument });
    mark(i);
    setTimeout(() => mark(-1), 600);
  };
  document.getElementById("pl-scale").addEventListener("click", () => {
    const up = scaleHz(c, { tempered: et.checked });
    const seq = [...up, ...up.slice(0, -1).reverse()];
    const n = c.scale.degrees.length;
    sequence(seq, { instrument, onStep: (i) => mark((i < up.length ? i : seq.length - 1 - i) % n), onDone: () => mark(-1) });
  });
  document.getElementById("pl-stop").addEventListener("click", () => {
    stopSequence(); mark(-1);
    if (droneOn()) { setDrone(null); updDrone(); }
  });
  const droneBtn = document.getElementById("pl-drone");
  const updDrone = () => droneBtn.setAttribute("aria-pressed", String(droneOn()));
  droneBtn.addEventListener("click", () => { setDrone(droneOn() ? null : c.tonic.hz); updDrone(); });
  app.querySelectorAll("button[data-deg]").forEach((b) => b.addEventListener("click", () => playDeg(+b.dataset.deg)));
  app.querySelectorAll("button[data-hz]").forEach((b) => b.addEventListener("click", () => pluck(+b.dataset.hz, { instrument })));

  const ruler = document.getElementById("tr-ruler"), steps = document.getElementById("tr-steps");
  const tl = document.getElementById("prog-timeline");
  const onPlay = (d) => {
    const i = c.scale.degrees.findIndex((x) => x.pitch_id === d.pitch_id);
    if (i >= 0 && !d.variant) playDeg(i);
    else pluck(degreeHz(c, d.cents_from_tonic, d.pitch_id, { tempered: et.checked }), { instrument });
  };
  const draw = () => {
    drawRuler(ruler, c, { onPlay });
    drawSteps(steps, c);
    if (tl) drawTimeline(tl, c);
  };
  draw();
  return draw;
}

function pageMethod() {
  const rules = tunings && tunings.rules;
  const cal = (method && method.calibrations) || [];
  const pr = method && method.progression;
  const calRows = cal.map((k) => `<tr><td>${esc(k.instrument)}</td><td class="num">${fmt(k.median_err_cents, 2)}</td>
      <td class="num">${fmt(k.p90_err_cents, 2)}</td><td class="num">${pct(k.recall)}</td><td class="num">${fmt(k.false_per_take, 1)}</td>
      <td class="num">${k.improv ? `${fmt(k.improv.median_err_cents, 2)} ¢ · ${pct(k.improv.recall)}` : "—"}</td></tr>`).join("");
  const prRows = pr ? Object.entries({ overall: pr.overall, ...(pr.by_instrument || {}) }).map(([k, v]) =>
    `<tr><td>${esc(k)}</td><td class="num">${pct(v.recall)}</td><td class="num">${pct(v.precision)}</td>
     <td class="num">${pct(v.label_acc)}</td><td class="num">${pct(v.register_acc)}</td></tr>`).join("") : "";
  return crumbs([["#/", "Library"], [null, "Method"]]) + `<h1>Method</h1>
    <p class="lede">Each recording is analysed many times, by several independent pitch estimators under different
    settings, and only the notes they agree on are published, each with its support and uncertainty.</p>
    <h2>How a tuning is measured</h2>
    <ol class="steps-list">
      <li><strong>Many runs.</strong> The recording is analysed whole and in halves, in mono and in each stereo
        channel, by three families of estimator: a chroma inventory (E1), a partial tracker that fits the stretched
        harmonics of stiff strings (E2), and pYIN pitch tracking (E3). Frequencies are refined below the FFT bin
        with time-frequency reassignment.</li>
      <li><strong>Consensus.</strong> Every run's pitches are clustered on the 1200 ¢ circle. A pitch is
        <em>confirmed</em> when at least 60 % of the weighted runs and two independent families find it; each comes
        with a bootstrap 95 % confidence interval.</li>
      <li><strong>Registers.</strong> A pitch is placed in an octave only where it was played as at least two real
        notes, which keeps harmonics and sympathetic strings from posing as notes.</li>
      <li><strong>Tonic and scale.</strong> The tonic is voted from the cadences of whole-recording runs; the scale
        is the strongest pitch in each region of the octave, with mobile degrees listed as variants.</li>
      <li><strong>Progression.</strong> Notes are followed through time; only notes confirmed by an independent
        estimator decide the opening, peak, final cadence and new pitches of each section.</li>
      <li><strong>Review.</strong> Nothing is published until the analysis has been checked by ear.</li>
    </ol>
    <h2>Pooled tunings</h2>
    <p>A short gushe recording uses only part of its scale. The <a href="#/scales">scale explorer</a> therefore pools all of
      one master's recordings of a dastgah into a single tuning: each note is the median of where those recordings play it,
      and its share is the fraction of them that use it.${rules ? ` Recordings whose tonic is within ${fmt(rules.tonic_window_cents, 0)} ¢ of the
      group's commonest tonic are pooled; pitches within ${fmt(rules.merge_cents, 0)} ¢ of each other are one note; a note counts as part of the
      scale when its share is at least ${pct(rules.main_share)}, and notes under ${pct(rules.min_share)} are left out.` : ""}
      Every pooled tuning lists the recordings it comes from.</p>
    <h2>Melodic signatures</h2>
    <p>The wheel on a recording's page draws every step of the melody from one note to a different note as a line across the
      octave. The notes are the ones the progression analysis trusts (long enough, or found by several runs). A step counts as
      rising or falling by the register it sounds in, so C up to D and C down to the D below are kept apart; a repeated note
      or an octave leap is not a step. Recordings are matched by scale degree and direction, which lets a gushe in one
      dastgah resemble a gushe in another.</p>
    <h2>Measured accuracy</h2>
    <p class="muted">Against an instrument tuned and checked note by note with a tuner (pipeline ${esc(method ? method.pipeline_version : "")}).</p>
    ${calRows ? `<div class="table-wrap"><table><thead><tr><th>Instrument</th><th class="num">Median error ¢</th>
      <th class="num">90th pct ¢</th><th class="num">Notes found</th><th class="num">False notes / take</th>
      <th class="num">Improvisation</th></tr></thead><tbody>${calRows}</tbody></table></div>` : '<p class="muted">No calibration data.</p>'}
    ${prRows ? `<h3>Note progression (synthetic performances, ${pr.cases} cases)</h3>
      <div class="table-wrap"><table><thead><tr><th>Set</th><th class="num">Notes found</th><th class="num">Precision</th>
      <th class="num">Right pitch</th><th class="num">Right octave</th></tr></thead><tbody>${prRows}</tbody></table></div>` : ""}
    <h2>Caveats</h2>
    <ul>
      <li><strong>Transfer speed.</strong> Records and tapes digitised at the wrong speed shift every frequency by the
        same ratio. Intervals are unaffected; absolute Hz is shown as recorded.</li>
      <li><strong>Intonation is musical.</strong> A master may play the same koron differently in different
        gushe-ha. Spread and variants are reported rather than averaged away.</li>
      <li><strong>Theory models</strong> (12-TET, Vaziri's 24-TET, Pythagorean, Farhat's interval classes) are shown
        for reference and never steer the measurement.</li>
      <li><strong>No recordings are hosted.</strong> Playback is synthesized from the measured frequencies; the
        originals are linked at their publishers.</li>
    </ul>
    <h2>Notation</h2>
    <p>Koron is written <strong>k</strong> (Ek = E koron, about a quarter-tone flat) and sori <strong>s</strong>
      (Fs = F sori); b is a flat. Octaves follow scientific pitch notation (A4 = 440 Hz).</p>`;
}

function notFound() {
  return `<h1>Not found</h1><p><a href="#/">Back to the library</a></p>`;
}

// ── theme ──────────────────────────────────────────────────────────────────

function initTheme() {
  const btn = document.getElementById("theme");
  const saved = store.get("localStorage", "ds.theme");
  document.documentElement.dataset.theme = saved === "light" ? "light" : "dark";
  const current = () => document.documentElement.dataset.theme;
  const label = () => {
    btn.textContent = current() === "dark" ? "☀" : "☾";
    btn.setAttribute("aria-label", current() === "dark" ? "Switch to light theme" : "Switch to dark theme");
  };
  btn.addEventListener("click", () => {
    const next = current() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    store.set("localStorage", "ds.theme", next);
    label();
    if (redraw) redraw();
  });
  label();
}

// ── router ─────────────────────────────────────────────────────────────────

let redraw = null;
let resizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (redraw) redraw(); }, 120);
});

async function route() {
  const parts = decodeURIComponent(location.hash.replace(/^#\/?/, "")).split("/").filter(Boolean);
  const [page, ...rest] = parts;
  stopSequence();
  if (droneOn()) setDrone(null);
  try {
    let html;
    afterRender = null;
    if (!page) html = pageHome("wall");
    else if (page === "list") html = pageHome("list");
    else if (page === "master") html = pageMaster(rest[0]);
    else if (page === "album") html = pageAlbum(rest[0], rest[1]);
    else if (page === "dastgahs") html = pageDastgahs();
    else if (page === "dastgah") html = await pageDastgah(rest[0]);
    else if (page === "track") html = await pageTrack(rest.join("/"));
    else if (page === "scales") html = await pageScalesRoute(rest);
    else if (page === "method") { try { await loadTunings(); } catch (_) { /* the page works without the rules */ } html = pageMethod(); }
    else html = notFound();
    app.innerHTML = html;
    window.scrollTo(0, 0);
    redraw = afterRender ? afterRender() : null;
    document.querySelectorAll(".topbar nav a").forEach((a) => {
      const on = a.dataset.nav === (!page || page === "list" ? "library" : page === "dastgah" ? "dastgahs" : page);
      if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    const h1 = app.querySelector("h1");
    document.title = h1 && page && page !== "list" ? `${h1.childNodes[0].textContent.trim()} · Dastgah Scales` : "Dastgah Scales";
  } catch (err) {
    app.innerHTML = `<h1>Something went wrong</h1><p class="muted">${esc(err.message)}</p>`;
  }
}

async function init() {
  initTheme();
  try {
    catalog = await loadJSON("data/catalog.json");
  } catch (err) {
    app.innerHTML = `<h1>No data yet</h1><p class="muted">Run <code>python -m tunelib export</code>
      from analysis/ to build data/catalog.json. (${esc(err.message)})</p>`;
    return;
  }
  try { method = await loadJSON("data/method.json"); } catch (_) { method = null; }
  footer.innerHTML = `Data generated ${esc(catalog.generated_at.slice(0, 10))} · pipeline ${esc(catalog.pipeline_version)}` +
    (catalog.include_pending ? " · includes unreviewed drafts" : "") +
    ` · No recordings are hosted: playback is synthesized from the measured tuning.`;
  window.addEventListener("hashchange", route);
  route();
}

init();
