// Library page: the scale wall and the index list, two renderings of one filtered set.
//
// Wall: every recording is one row of ticks (its scale in cents above its own tonic);
// rows stack into columns that stand on a shared baseline, so a column's height is the
// size of that part of the library and the tick alignment is the comparison.
// List: the same recordings as a sortable table with the strip in every row.
// Filters dim rows on the wall (you keep your place) and remove rows from the list.

import { sequence, stopSequence } from "./synth.js?v=10";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const store = {
  get(k) { try { return window.sessionStorage.getItem(k); } catch (_) { return null; } },
  set(k, v) { try { window.sessionStorage.setItem(k, v); } catch (_) { /* storage blocked: fine */ } },
};
const median = (a) => { const s = [...a].sort((x, y) => x - y), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
const fmtDur = (s) => (s === null || s === undefined ? "" : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);
const signed = (x) => { if (x === null || x === undefined) return "—"; const r = Math.round(x); return `${r > 0 ? "+" : r < 0 ? "−" : ""}${Math.abs(r)}`; };
const noteOf = (label) => String(label || "").replace(/\d+$/, "");
// Ek → E koron, Fs → F sori (the site's notation; see the Method page)
const noteName = (n) => { const m = /^([A-G])(k|s|b|#)?$/.exec(n); return m ? m[1] + ({ k: " koron", s: " sori", b: "♭", "#": "♯" }[m[2]] || "") : n; };

const RH = 6;                 // wall row pitch, px
const PAGE = 60;              // list rows per "show more"
const state = { group: "dastgah", order: "master", q: "", f: { d: null, m: null, inst: null, inf: null }, sort: null, dir: 1, shown: PAGE };
try { Object.assign(state, JSON.parse(store.get("ds.browse") || "{}")); } catch (_) { /* keep defaults */ }
state.shown = PAGE;
const save = () => store.set("ds.browse", JSON.stringify({ group: state.group, order: state.order, q: state.q, f: state.f, sort: state.sort, dir: state.dir }));

let src = null, T = [], M = [], DG = [];

function prepare(catalog) {
  if (src === catalog) return;
  src = catalog;
  DG = catalog.dastgahs.map((d, i) => ({ ...d, i }));
  M = catalog.masters.map((m, i) => ({ i, id: m.id, name: m.name, name_fa: m.name_fa, instrument: m.instrument, n: 0 }));
  T = [];
  catalog.masters.forEach((m, mi) => m.albums.forEach((a) => a.tracks.forEach((t) => {
    const d = DG.find((x) => x.id === t.dastgah);
    T.push({
      i: T.length, key: t.key, title: t.title, m: mi, album: a, d: d ? d.i : -1, review: t.review,
      inst: t.instrument || m.instrument, has: !!t.has_result, hz: t.tonic_hz, label: t.tonic_label,
      off: t.tuning_offset_cents, cents: t.degrees_cents || [], st: t.degrees_status || "", inf: !!t.tonic_inferred,
      dur: t.duration_s,
      hay: `${t.title} ${m.name} ${m.name_fa || ""} ${a.title} ${d ? d.name : ""} ${t.instrument || m.instrument}`.toLowerCase(),
    });
    M[mi].n += 1;
  })));
  [...M].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)).forEach((m, r) => { m.rank = r; });
}

// ── filters ────────────────────────────────────────────────────────────────

const FACETS = {
  m: { title: "Master", of: (t) => t.m },
  d: { title: "Dastgah", of: (t) => t.d },
  inst: { title: "Instrument", of: (t) => t.inst },
  inf: { title: "Tonic", of: (t) => (t.inf ? 1 : 0) },
};
const needle = () => state.q.trim().toLowerCase();
function matches(t, skip) {
  for (const k in FACETS) if (k !== skip && state.f[k] !== null && FACETS[k].of(t) !== state.f[k]) return false;
  const q = needle();
  return !q || t.hay.includes(q);
}
const filtering = () => !!needle() || Object.values(state.f).some((v) => v !== null);

// A facet as a cloud of names sized by how many recordings stand behind each (after Past Visions).
// Counts respect the other filters, so no choice leads to an empty result.
function cloud(k, options) {
  const pool = T.filter((t) => matches(t, k));
  const counts = options.map((o) => pool.filter((t) => FACETS[k].of(t) === o.v).length);
  const max = Math.max(1, ...counts);
  const items = options.map((o, j) => {
    const n = counts[j], on = state.f[k] === o.v;
    const size = (0.74 + 0.46 * Math.log(1 + n) / Math.log(1 + max)).toFixed(2);
    return `<button type="button" class="cl${o.sub ? " cl-sub" : ""}" style="font-size:${size}rem" data-f="${k}" data-v="${esc(o.v)}"
      aria-pressed="${on}" ${n || on ? "" : "disabled"}>${esc(o.label)}<sup>${n}</sup></button>`;
  }).join("");
  return `<div class="facet"><div class="facet-k">${FACETS[k].title}</div><div class="cloud">${items}</div></div>`;
}

function facetsHTML() {
  const insts = [...new Set(T.map((t) => t.inst))];
  return cloud("d", DG.filter((d) => T.some((t) => t.d === d.i)).map((d) => ({ v: d.i, label: d.kind === "group" ? "Shared gushe-ha" : d.name, sub: d.kind === "avaz" }))) +
    cloud("m", [...M].sort((a, b) => a.rank - b.rank).map((m) => ({ v: m.i, label: m.name }))) +
    `<div class="facet-pair">${cloud("inst", insts.map((v) => ({ v, label: v })))}` +
    cloud("inf", [{ v: 0, label: "as measured or by ear" }, { v: 1, label: "from the literature, not yet by ear" }]) + `</div>`;
}

// ── strip: x is cents (viewBox −12…1212) stretched to the box; strokes keep their width ──

function ticks(t, y, h) {
  let s = "";
  t.cents.forEach((c, k) => {
    const st = t.st[k] || "t";
    s += `<line class="tk tk-${st}" x1="${c}" x2="${c}" y1="${(st === "t" ? y + h * 0.45 : y + 1).toFixed(1)}" y2="${y + h - 1}"/>`;
  });
  if (t.inf) s += `<line class="tk-inf" x1="-11" x2="-4" y1="${y + h / 2}" y2="${y + h / 2}"/>`;
  return s;
}

export function stripSVG(track, h = 14) {
  const t = track.cents ? track : { cents: track.degrees_cents || [], st: track.degrees_status || "", inf: !!track.tonic_inferred };
  if (!t.cents.length) return "";
  return `<svg class="strip" viewBox="-12 0 1224 ${h}" height="${h}" preserveAspectRatio="none" aria-hidden="true">` +
    `<line class="strip-base" x1="0" x2="1200" y1="${h - 0.5}" y2="${h - 0.5}"/>${ticks(t, 0, h)}</svg>`;
}

// ── wall ───────────────────────────────────────────────────────────────────

function groups() {
  if (state.group === "master") {
    return [...M].sort((a, b) => a.rank - b.rank).filter((m) => m.n > 1)
      .map((m) => ({ name: m.name, fa: m.name_fa, kind: m.instrument, href: `#/master/${m.id}`, ctx: ["master", m.id], items: T.filter((t) => t.m === m.i) }))
      .concat([{ name: `${M.filter((m) => m.n === 1).length} other masters`, fa: "", kind: "one recording each", items: T.filter((t) => M[t.m].n === 1) }])
      .filter((g) => g.items.length);
  }
  if (state.group === "tonic") {
    const by = new Map();
    T.filter((t) => t.has).forEach((t) => { const k = noteOf(t.label); if (!by.has(k)) by.set(k, []); by.get(k).push(t); });
    return [...by.entries()].sort((a, b) => b[1].length - a[1].length)
      .map(([k, items]) => ({ name: noteName(k), fa: "", kind: "tonic", items }));
  }
  return DG.map((d) => ({
    name: d.kind === "group" ? "Shared gushe-ha" : d.name, fa: d.name_fa, href: `#/dastgah/${d.id}`, ctx: ["dastgah", d.id],
    kind: d.kind === "avaz" ? `avaz of ${(DG.find((x) => x.id === d.parent) || {}).name || ""}` : d.kind === "group" ? "each on its own tonic" : "dastgah",
    med: d.kind !== "group", items: T.filter((t) => t.d === d.i),
  })).filter((g) => g.items.length);
}

const ORDER = {
  master: (t) => M[t.m].rank * 1e5 + t.i,
  second: (t) => (t.cents.length > 1 ? t.cents[1] : 9999),
  pitch: (t) => (t.has ? 1200 * Math.log2(t.hz / 16.3516) % 1200 : 9999),
};

function wallHTML() {
  const key = ORDER[state.order] || ORDER.master, on = filtering();
  const pos = (c) => `${((c + 12) / 1224 * 100).toFixed(2)}%`;
  const cols = groups().map((g, gi) => {
    const items = g.items.filter((t) => t.has).sort((a, b) => key(a) - key(b));
    let y = 0, body = "", prev = null, hits = 0;
    items.forEach((t) => {
      if (state.order === "master" && prev !== null && prev !== t.m) y += 5;
      prev = t.m;
      const hit = matches(t);
      hits += hit ? 1 : 0;
      body += `<g class="row${on && !hit ? " dim" : ""}" data-i="${t.i}" data-g="${gi}"><rect class="hit" x="-12" y="${y}" width="1224" height="${RH}"/>${ticks(t, y, RH)}</g>`;
      y += RH;
    });
    const full = items.filter((t) => t.cents.length === 7);
    if (g.med && full.length > 1) {          // the column's median scale, standing on the baseline
      y += 6;
      body += `<g class="med">${[0, 1, 2, 3, 4, 5, 6].map((k) => { const c = median(full.map((t) => t.cents[k])); return `<line x1="${c}" x2="${c}" y1="${y}" y2="${y + 13}"/>`; }).join("")}</g>`;
      y += 14;
    }
    let guides = "";
    for (let c = 0; c <= 1200; c += 100) guides += `<line class="gd${c === 0 || c === 500 || c === 700 || c === 1200 ? " gd-k" : ""}" x1="${c}" x2="${c}" y1="0" y2="${y}"/>`;
    const name = g.href ? `<a href="${g.href}">${esc(g.name)}</a>` : esc(g.name);
    return `<section class="wcol"><svg class="wallsvg" viewBox="-12 0 1224 ${y}" height="${y}" preserveAspectRatio="none" role="img"
        aria-label="${esc(g.name)}: ${items.length} recordings, one row of scale degrees each">${guides}${body}</svg>
      <div class="waxis" aria-hidden="true">${[0, 500, 700, 1200].map((c) => `<span style="left:${pos(c)}">${c}</span>`).join("")}</div>
      <h3>${name}${g.fa ? ` <bdi class="fa" lang="fa">${esc(g.fa)}</bdi>` : ""}<span class="wn">${on ? `${hits} / ` : ""}${items.length}</span></h3>
      <div class="wkind">${esc(g.kind)}</div></section>`;
  }).join("");
  return `<div class="wall">${cols}</div>
    <div class="legend"><span><i class="lg lg-c"></i>degree, confirmed</span><span><i class="lg lg-t"></i>probable or tentative</span>
      <span><i class="lg lg-m"></i>bottom row: the column's median scale</span><span><i class="lg lg-i"></i>tonic from the literature, not yet checked by ear</span>
      <span>guides every 100 ¢, cents above each recording's own tonic</span></div>`;
}

// ── list ───────────────────────────────────────────────────────────────────

const COLS = [
  ["title", "Recording", (t) => t.title.toLowerCase()],
  ["master", "Master", (t) => M[t.m].name],
  ["dastgah", "Dastgah", (t) => t.d],
  ["tonic", "Tonic", (t) => (t.has ? t.hz : Infinity)],
  ["off", "¢ from A440", (t) => (t.has ? t.off : Infinity), true],
  ["scale", "Scale, 0–1200 ¢", (t) => (t.cents.length > 1 ? t.cents[1] : Infinity)],
  ["dur", "Length", (t) => t.dur ?? Infinity, true],
];

function listHTML() {
  const col = COLS.find((c) => c[0] === state.sort);
  const rows = T.filter((t) => matches(t));
  if (col) rows.sort((a, b) => { const x = col[2](a), y = col[2](b); return (x < y ? -1 : x > y ? 1 : a.i - b.i) * state.dir; });
  const head = COLS.map((c) => `<th class="${c[3] ? "num" : ""}"${state.sort === c[0] ? ` aria-sort="${state.dir > 0 ? "ascending" : "descending"}"` : ""}>
    <button type="button" class="th-sort" data-sort="${c[0]}">${c[1]}${state.sort === c[0] ? (state.dir > 0 ? " ▲" : " ▼") : ""}</button></th>`).join("");
  const body = rows.slice(0, state.shown).map((t) => {
    const d = DG[t.d] || { id: "", name: "" }, m = M[t.m];
    return `<tr data-i="${t.i}"><td><a href="#/track/${esc(t.key)}">${esc(t.title)}</a>${t.review !== "approved" ? '<span class="badge draft">draft</span>' : ""}</td>
      <td><a href="#/master/${esc(m.id)}">${esc(m.name)}</a></td><td><a href="#/dastgah/${esc(d.id)}">${esc(d.name)}</a></td>
      <td>${t.has ? `${esc(t.label)} <span class="muted">${t.hz.toFixed(1)} Hz</span>${t.inf ? '<span class="badge draft" title="Tonic set from the literature, not yet checked by ear">to check</span>' : ""}` : '<span class="muted">not analysed</span>'}</td>
      <td class="num">${t.has ? signed(t.off) : ""}</td><td class="sc">${stripSVG(t)}</td><td class="num">${fmtDur(t.dur)}</td></tr>`;
  }).join("") || `<tr><td colspan="${COLS.length}" class="muted">No recordings match. Clear a filter to widen the list.</td></tr>`;
  return `<div class="table-wrap"><table class="index"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>
    ${rows.length > state.shown ? `<p><button type="button" class="btn" id="br-more">Show ${Math.min(PAGE, rows.length - state.shown)} more of ${rows.length}</button></p>` : ""}`;
}

// ── page ───────────────────────────────────────────────────────────────────

const seg = (name, cur, opts) => `<span class="seg" role="group" aria-label="${name}">${opts.map(([v, label]) =>
  `<button type="button" data-set="${name}" data-v="${v}" aria-pressed="${cur === v}">${label}</button>`).join("")}</span>`;

function toolbarHTML(mode) {
  const n = T.filter((t) => matches(t)).length;
  return `<div class="br-bar">
    <span class="seg" role="group" aria-label="View"><a href="#/" ${mode === "wall" ? 'aria-current="page"' : ""}>Wall</a><a href="#/list" ${mode === "list" ? 'aria-current="page"' : ""}>List</a></span>
    ${mode === "wall" ? `<span class="br-k">Group by</span>${seg("group", state.group, [["dastgah", "Dastgah"], ["master", "Master"], ["tonic", "Tonic"]])}
      <span class="br-k">Order by</span>${seg("order", state.order, [["master", "Master"], ["second", "Size of 2nd"], ["pitch", "Tonic pitch"]])}` : ""}
    <input type="search" id="br-q" placeholder="Search title, master, album" aria-label="Search recordings" value="${esc(state.q)}">
    <span class="muted" id="br-n">${filtering() ? `${n} of ${T.length}` : `${T.length} recordings`}</span>
    ${filtering() ? '<button type="button" class="btn" id="br-clear">Clear filters</button>' : ""}
  </div>`;
}

export function pageBrowse(catalog, mode) {
  prepare(catalog);
  const used = DG.filter((d) => d.kind !== "group" && T.some((t) => t.d === d.i)).length;
  return `<div class="br-head"><h1 class="sr">Dastgah Scales</h1>
      <p class="lede">The measured tunings of ${M.length} Iranian masters in ${T.length} recordings across ${used} dastgah-ha and avaz-ha.
      Each row below is one recording: the degrees of its scale, in cents above its own tonic.</p></div>
    <details class="br-facets" id="br-facets" open><summary>Filter</summary><div id="br-fbody">${facetsHTML()}</div></details>
    <div id="br-tools">${toolbarHTML(mode)}</div>
    <div id="br-view" class="br-view br-${mode}">${mode === "wall" ? wallHTML() : listHTML()}</div>
    <div class="inspect" id="br-inspect" aria-live="polite"><span class="muted">Point at or tap a row to read it here. Click it, or press Open, to go to the recording.
      ${mode === "wall" ? 'The <a href="#/list">list</a> has the same recordings for keyboard and screen-reader use.' : ""}</span></div>`;
}

// Wire the page after its HTML is in place. `setCtx(kind, id)` records where a track was
// opened from, so its page can offer previous / next within that dastgah or master.
export function wireBrowse(mode, { setCtx } = {}) {
  const root = document.getElementById("app");
  const view = root.querySelector("#br-view"), tools = root.querySelector("#br-tools");
  const fbody = root.querySelector("#br-fbody"), inspect = root.querySelector("#br-inspect");
  const fold = root.querySelector("#br-facets");
  const narrow = window.matchMedia("(max-width: 720px)");
  fold.open = !narrow.matches || filtering();
  let cur = null, lit = null, pointer = "mouse";

  const show = (t, el) => {
    if (lit) lit.classList.remove("hl");
    lit = el; if (el) el.classList.add("hl");
    if (cur === t) return;
    cur = t;
    const m = M[t.m], d = DG[t.d] || { name: "" };
    inspect.innerHTML = `<div class="in-main"><div class="in-t">${esc(t.title)}${t.inf ? ' <span class="badge draft">tonic to check by ear</span>' : ""}</div>
        <div class="in-s">${esc(m.name)}${m.name_fa ? ` <bdi class="fa" lang="fa">${esc(m.name_fa)}</bdi>` : ""} · ${esc(d.name)} · ${esc(t.inst)}
        ${t.has ? ` · tonic ${esc(t.label)}, ${t.hz.toFixed(1)} Hz (${signed(t.off)} ¢ from A440)` : " · not analysed"}${t.dur ? ` · ${fmtDur(t.dur)}` : ""}</div></div>
      <div class="in-strip">${stripSVG(t, 18)}<div class="in-c">${t.cents.map((c) => Math.round(c)).join(" · ")}${t.cents.length ? " ¢" : ""}</div></div>
      <div class="in-act">${t.has ? '<button type="button" class="btn" id="in-play">▶ Scale</button>' : ""}
        <a class="btn btn-primary" id="in-open" href="#/track/${esc(t.key)}">Open</a></div>`;
  };
  const open = (t, el) => {
    const g = el && el.dataset.g !== undefined ? groups()[+el.dataset.g] : null;
    if (setCtx) {
      if (g && g.ctx) setCtx(...g.ctx);
      else if (state.f.m !== null) setCtx("master", M[state.f.m].id);
      else if (state.f.d !== null) setCtx("dastgah", DG[state.f.d].id);
    }
    location.hash = `#/track/${t.key}`;
  };
  const rowOf = (e) => { const el = e.target.closest("[data-i]"); return el && view.contains(el) ? el : null; };

  view.addEventListener("pointerdown", (e) => { pointer = e.pointerType || "mouse"; });
  view.addEventListener("pointerover", (e) => { const el = rowOf(e); if (el) show(T[+el.dataset.i], el); });
  view.addEventListener("focusin", (e) => { const el = rowOf(e); if (el) show(T[+el.dataset.i], el); });
  view.addEventListener("click", (e) => {
    const more = e.target.closest("#br-more");
    if (more) { state.shown += PAGE; view.innerHTML = listHTML(); return; }
    const sort = e.target.closest("[data-sort]");
    if (sort) {
      if (state.sort === sort.dataset.sort) state.dir = -state.dir; else { state.sort = sort.dataset.sort; state.dir = 1; }
      save(); view.innerHTML = listHTML(); return;
    }
    const el = rowOf(e);
    if (!el || mode !== "wall") return;           // list rows are ordinary links
    const t = T[+el.dataset.i];
    // a mouse has already previewed the row by hovering; a finger selects first, then opens
    if (pointer === "mouse" || cur === t && lit === el && el.dataset.armed) open(t, el);
    else { show(t, el); view.querySelectorAll("[data-armed]").forEach((x) => delete x.dataset.armed); el.dataset.armed = "1"; }
  });
  inspect.addEventListener("click", (e) => {
    if (e.target.closest("#in-play") && cur) {
      stopSequence();
      const hz = cur.cents.map((c) => cur.hz * 2 ** (c / 1200));
      sequence([...hz, cur.hz * 2], { instrument: cur.inst, step: 0.34 });
    } else if (e.target.closest("#in-open") && cur) { e.preventDefault(); open(cur, lit); }
  });

  const redraw = (keepFocus) => {
    save();
    fbody.innerHTML = facetsHTML();
    if (!keepFocus) tools.innerHTML = toolbarHTML(mode);
    else {
      const n = T.filter((t) => matches(t)).length;
      tools.querySelector("#br-n").textContent = filtering() ? `${n} of ${T.length}` : `${T.length} recordings`;
    }
    view.innerHTML = mode === "wall" ? wallHTML() : listHTML();
    lit = null;
  };
  fbody.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-f]");
    if (!b || b.disabled) return;
    const k = b.dataset.f, v = k === "inst" ? b.dataset.v : +b.dataset.v;
    state.f[k] = state.f[k] === v ? null : v;
    state.shown = PAGE;
    redraw();
  });
  tools.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-set]");
    if (b) { state[b.dataset.set] = b.dataset.v; redraw(); return; }
    if (e.target.closest("#br-clear")) { state.q = ""; state.f = { d: null, m: null, inst: null, inf: null }; state.shown = PAGE; redraw(); }
  });
  let typing = null;
  tools.addEventListener("input", (e) => {
    if (e.target.id !== "br-q") return;
    state.q = e.target.value; state.shown = PAGE;
    clearTimeout(typing);
    typing = setTimeout(() => {
      redraw(true);
      const has = !!tools.querySelector("#br-clear");
      if (has !== filtering()) { const at = e.target.selectionStart; tools.innerHTML = toolbarHTML(mode); const q = tools.querySelector("#br-q"); q.focus(); q.setSelectionRange(at, at); }
    }, 90);
  });
  return null;   // nothing to redraw on resize: the strips stretch with their boxes
}
