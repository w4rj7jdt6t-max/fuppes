/* fuppes – Daten von OpenLigaDB (https://api.openligadb.de), ohne API-Key, CORS offen. */
"use strict";

const API = "https://api.openligadb.de";
const SEASON = seasonFor(new Date());   // Saison beginnt im Juli: Nov 2026 -> 2026 (= 2026/27)
const KOELN_ID = 65;
const KOELN_NAME = "1. FC Köln";
const CACHE_MIN = 3;

function seasonFor(d) { return d.getMonth() >= 6 ? d.getFullYear() : d.getFullYear() - 1; }

/* ---------- Helfer ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const safeImg = (u) => (typeof u === "string" && /^(https:\/\/|data:image\/)/.test(u) ? u : "");

const mem = new Map();
async function api(path) {
  if (mem.has(path)) return mem.get(path);
  const key = "fuppes:" + path;
  try {
    const hit = JSON.parse(sessionStorage.getItem(key) || "null");
    if (hit && Date.now() - hit.t < CACHE_MIN * 60e3) { mem.set(path, Promise.resolve(hit.d)); return hit.d; }
  } catch (_) { /* Storage nicht verfügbar */ }
  const p = fetch(API + path).then((r) => {
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  }).then((d) => {
    try { sessionStorage.setItem(key, JSON.stringify({ t: Date.now(), d })); } catch (_) {}
    return d;
  });
  mem.set(path, p);
  p.catch(() => mem.delete(path));
  return p;
}

const tz = { timeZone: "Europe/Berlin" };
const kick = (m) => new Date(m.matchDateTimeUTC || m.matchDateTime);
const fmtDay = (d) => d.toLocaleDateString("de-DE", { ...tz, weekday: "short", day: "2-digit", month: "2-digit" });
const fmtLongDay = (d) => d.toLocaleDateString("de-DE", { ...tz, weekday: "long", day: "numeric", month: "long", year: "numeric" });
const fmtTime = (d) => d.toLocaleTimeString("de-DE", { ...tz, hour: "2-digit", minute: "2-digit" });

/** Ergebnis eines Spiels: {h, a, state: "done" | "live" | "open"} */
function score(m) {
  if (m.matchIsFinished && m.matchResults?.length) {
    const r = [...m.matchResults].sort((x, y) => y.resultOrderID - x.resultOrderID)[0];
    return { h: r.pointsTeam1, a: r.pointsTeam2, state: "done" };
  }
  const started = Date.now() >= kick(m).getTime();
  const recent = Date.now() - kick(m).getTime() < 3 * 3600e3;
  if (started && recent && !m.matchIsFinished) {
    const g = m.goals?.length ? m.goals[m.goals.length - 1] : null;
    return { h: g ? g.scoreTeam1 : 0, a: g ? g.scoreTeam2 : 0, state: "live" };
  }
  return { h: null, a: null, state: m.matchIsFinished ? "done" : "open" };
}

const isTeam = (t, idOrName) => (typeof idOrName === "number" ? t.teamId === idOrName : t.teamName === idOrName);
const involves = (m, who) => isTeam(m.team1, who) || isTeam(m.team2, who);

/** Ausgang aus Sicht eines Teams: W / D / L */
function outcome(m, who) {
  const s = score(m);
  if (s.state !== "done" || s.h == null) return null;
  const home = isTeam(m.team1, who);
  const mine = home ? s.h : s.a, theirs = home ? s.a : s.h;
  return mine > theirs ? "W" : mine < theirs ? "L" : "D";
}

const byKick = (a, b) => kick(a) - kick(b);
const compName = (m) => {
  const n = m.leagueName || "";
  if (/pokal/i.test(n)) return "DFB-Pokal · " + (m.group?.groupName || "");
  if (/bundesliga/i.test(n)) return "Bundesliga · " + (m.group?.groupName || "");
  return n + (m.group?.groupName ? " · " + m.group.groupName : "");
};

function fail(el, err) {
  el.classList.remove("loading");
  el.innerHTML = `<p class="error">Daten konnten nicht geladen werden (${esc(err.message || err)}). Seite neu laden oder später erneut versuchen.</p>`;
}

/* ---------- Bausteine ---------- */
function teamCell(t, cls = "") {
  const img = safeImg(t.teamIconUrl);
  return `<div class="m-team ${cls}">${img ? `<img src="${esc(img)}" alt="" loading="lazy" onerror="this.remove()">` : ""}<span title="${esc(t.teamName)}">${esc(t.shortName || t.teamName)}</span></div>`;
}

/** opts: {me: id|name, comp: bool} */
function matchRow(m, opts = {}) {
  const s = score(m);
  const d = kick(m);
  let cls = "pending", txt = fmtTime(d);
  if (s.state === "live") { cls = "live"; txt = `${s.h}:${s.a}`; }
  else if (s.state === "done" && s.h != null) {
    txt = `${s.h}:${s.a}`;
    cls = opts.me && involves(m, opts.me) ? outcome(m, opts.me) : "";
  } else if (s.state === "done") { txt = "–:–"; cls = ""; }
  const me1 = opts.me && isTeam(m.team1, opts.me) ? "me" : "";
  const me2 = opts.me && isTeam(m.team2, opts.me) ? "me" : "";
  const hl1 = opts.hl?.(m.team1) ? "me" : "", hl2 = opts.hl?.(m.team2) ? "me" : "";
  return `<div class="m">
    <div class="m-when">${esc(fmtDay(d))}${s.state !== "open" ? "<br>" + esc(fmtTime(d)) : ""}</div>
    ${teamCell(m.team1, `home ${me1 || hl1}`)}
    <div class="m-score ${cls}"${s.state === "live" ? ' title="läuft"' : ""}>${esc(txt)}</div>
    ${teamCell(m.team2, `away ${me2 || hl2}`)}
    ${opts.comp ? `<div class="m-comp">${esc(compName(m))}</div>` : ""}
  </div>`;
}

function heroMatch(el, m, label) {
  if (!m) { el.innerHTML = `<p class="loading">Aktuell ist kein Spiel angesetzt.</p>`; return; }
  const d = kick(m), s = score(m);
  const nm = (t) => ((t.shortName || "").length > 3 ? t.shortName : t.teamName);
  const img = (t) => (safeImg(t.teamIconUrl) ? `<img src="${esc(safeImg(t.teamIconUrl))}" alt="" onerror="this.remove()">` : "");
  const center = s.state === "live"
    ? `<div class="hm-time">${s.h}:${s.a}</div><div class="hm-date">läuft</div>`
    : `<div class="hm-time">${esc(fmtTime(d))}</div><div class="hm-date">${esc(fmtDay(d))}</div>`;
  el.innerHTML = `
    <div class="hm-meta"><span class="pill">${esc(s.state === "live" ? "Live" : label)}</span><span>${esc(compName(m))}</span><span>${esc(fmtLongDay(d))}</span></div>
    <div class="hm-board">
      <div class="hm-team">${img(m.team1)}<span>${esc(nm(m.team1))}</span></div>
      <div class="hm-center">${center}</div>
      <div class="hm-team away">${img(m.team2)}<span>${esc(nm(m.team2))}</span></div>
    </div>
    ${s.state === "open" ? `<div class="hm-count" data-kick="${d.getTime()}"></div>` : ""}`;
  tickCountdowns();
}

function tickCountdowns() {
  document.querySelectorAll("[data-kick]").forEach((el) => {
    let ms = Number(el.dataset.kick) - Date.now();
    if (ms <= 0) { el.innerHTML = "<div><b>Anpfiff</b></div>"; return; }
    const d = Math.floor(ms / 864e5); ms -= d * 864e5;
    const h = Math.floor(ms / 36e5); ms -= h * 36e5;
    const min = Math.floor(ms / 6e4); const s = Math.floor((ms - min * 6e4) / 1e3);
    const unit = (v, l) => `<div><b>${String(v).padStart(2, "0")}</b><small>${l}</small></div>`;
    el.innerHTML = unit(d, d === 1 ? "Tag" : "Tage") + unit(h, "Std") + unit(min, "Min") + unit(s, "Sek");
  });
}
setInterval(tickCountdowns, 1000);

/** zones: fn(pos, total) -> CSS-Farbe | ""; rows: optional Auswahl [{row, pos}] mit Lücken (null) */
function tableHTML(rows, { zones = () => "", me = null, compact = false, hl = null } = {}) {
  const body = rows.map((r) => {
    if (r === null) return `<tr class="gap"><td colspan="${compact ? 5 : 9}">⋯</td></tr>`;
    const t = r.t, pos = r.pos;
    const img = safeImg(t.teamIconUrl);
    const mine = (me && (t.teamId === me || t.teamName === me)) || (hl && hl(t));
    const diff = t.goalDiff > 0 ? "+" + t.goalDiff : t.goalDiff;
    return `<tr class="${mine ? "me" : ""}">
      <td class="pos" style="--zone:${zones(pos)}">${pos}</td>
      <td class="l team"><div class="team-cell">${img ? `<img src="${esc(img)}" alt="" loading="lazy" onerror="this.remove()">` : ""}<span title="${esc(t.teamName)}">${esc(t.teamName)}</span></div></td>
      <td>${t.matches}</td>
      ${compact ? "" : `<td class="opt">${t.won}</td><td class="opt">${t.draw}</td><td class="opt">${t.lost}</td><td class="opt">${t.goals}:${t.opponentGoals}</td>`}
      <td>${diff}</td>
      <td class="pts">${t.points}</td>
    </tr>`;
  }).join("");
  return `<div class="tbl-wrap"><table class="tbl"><thead><tr>
    <th class="l">#</th><th class="l">Team</th><th>Sp</th>
    ${compact ? "" : '<th class="opt">S</th><th class="opt">U</th><th class="opt">N</th><th class="opt">Tore</th>'}
    <th>Diff</th><th>Pkt</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

const blZones = (p) => p <= 4 ? "var(--z-cl)" : p === 5 ? "var(--z-el)" : p === 6 ? "var(--z-ecl)" : p === 16 ? "var(--z-rel)" : p >= 17 ? "var(--z-down)" : "";
const plZones = (p) => p <= 4 ? "var(--z-cl)" : p === 5 ? "var(--z-el)" : p >= 18 ? "var(--z-down)" : "";
const euZones = (p) => p <= 8 ? "var(--z-cl)" : p <= 24 ? "var(--z-el)" : "var(--z-down)";

/** Spieltag-Blättern über eine komplette Saison-Spielliste */
function matchdayStepper({ matches, title, list, prev, next, rowOpts = {} }) {
  const groups = new Map();
  matches.slice().sort(byKick).forEach((m) => {
    const k = m.group?.groupOrderID ?? 0;
    if (!groups.has(k)) groups.set(k, { name: m.group?.groupName || `${k}. Spieltag`, ms: [] });
    groups.get(k).ms.push(m);
  });
  const keys = [...groups.keys()].sort((a, b) => a - b);
  if (!keys.length) { list.innerHTML = '<p class="empty">Keine Spiele gefunden.</p>'; prev.disabled = next.disabled = true; return; }
  let i = keys.findIndex((k) => groups.get(k).ms.some((m) => !m.matchIsFinished));
  if (i === -1) i = keys.length - 1;
  // Wenn der offene Spieltag erst in > 3 Tagen beginnt und der vorige gerade lief, den vorigen zeigen.
  if (i > 0) {
    const first = groups.get(keys[i]).ms[0];
    const prevLast = groups.get(keys[i - 1]).ms.at(-1);
    if (kick(first) - Date.now() > 3 * 864e5 && Date.now() - kick(prevLast) < 2 * 864e5) i -= 1;
  }
  const draw = () => {
    const g = groups.get(keys[i]);
    title.textContent = g.name;
    list.innerHTML = g.ms.map((m) => matchRow(m, rowOpts)).join("");
    prev.disabled = i === 0;
    next.disabled = i === keys.length - 1;
  };
  prev.onclick = () => { if (i > 0) { i--; draw(); } };
  next.onclick = () => { if (i < keys.length - 1) { i++; draw(); } };
  draw();
}

/* ---------- 1 · Effzeh ---------- */
async function loadEffzeh() {
  renderFcNews();
  const [bl, dfb, table] = await Promise.all([
    api(`/getmatchdata/bl1/${SEASON}`),
    api(`/getmatchdata/dfb/${SEASON}`).catch(() => []),
    api(`/getbltable/bl1/${SEASON}`),
  ]);
  const isFC = (t) => t.teamId === KOELN_ID || t.teamName === KOELN_NAME;
  const fc = [...bl, ...dfb].filter((m) => isFC(m.team1) || isFC(m.team2)).sort(byKick);
  const meOf = (m) => (isFC(m.team1) ? m.team1.teamId : m.team2.teamId);

  // Nächstes Spiel
  const upcoming = fc.filter((m) => score(m).state !== "done");
  heroMatch($("#fc-next"), upcoming[0], "Nächstes Spiel");

  // Tabelle, Ausschnitt um den FC
  const tEl = $("#fc-table");
  const idx = table.findIndex(isFC);
  if (idx === -1) {
    tEl.innerHTML = `<p class="empty">Der FC steht nicht in der Bundesliga-Tabelle ${SEASON}/${String(SEASON + 1).slice(2)}.</p>`;
  } else {
    const lo = Math.max(0, Math.min(idx - 3, table.length - 7)), hi = Math.min(table.length, lo + 7);
    const rows = [];
    if (lo > 0) rows.push({ t: table[0], pos: 1 }, ...(lo > 1 ? [null] : []));
    for (let k = lo; k < hi; k++) rows.push({ t: table[k], pos: k + 1 });
    if (hi < table.length) rows.push(null);
    tEl.innerHTML = tableHTML(rows, { zones: blZones, compact: true, hl: isFC }) +
      `<p class="note">Platz ${idx + 1} · ${table[idx].points} Punkte · <a href="#bundesliga">ganze Tabelle</a></p>`;
  }
  tEl.classList.remove("loading");

  // Form + letzte Spiele
  const done = fc.filter((m) => score(m).state === "done" && m.matchResults?.length);
  const last5 = done.slice(-5);
  const formEl = $("#fc-form");
  formEl.classList.remove("loading");
  if (!last5.length) formEl.innerHTML = '<p class="empty">Noch keine Pflichtspiele.</p>';
  else {
    const res = last5.map((m) => outcome(m, meOf(m)));
    const label = { W: "S", D: "U", L: "N" };
    const pts = res.reduce((s, r) => s + (r === "W" ? 3 : r === "D" ? 1 : 0), 0);
    formEl.innerHTML = `<div class="form">${res.map((r, k) => `<span class="chip ${r}" title="${esc(last5[k].team1.teamName)} – ${esc(last5[k].team2.teamName)}">${label[r]}</span>`).join("")}</div>
      <p class="form-sum">${pts} von ${res.length * 3} möglichen Punkten aus den letzten ${res.length} Pflichtspielen</p>`;
  }
  $("#fc-last").innerHTML = done.slice(-4).reverse().map((m) => matchRow(m, { me: meOf(m), comp: true })).join("");

  // Torschützen aus den Spielverläufen
  const tally = new Map();
  done.forEach((m) => {
    const home = isFC(m.team1);
    let p1 = 0, p2 = 0;
    (m.goals || []).forEach((g) => {
      const t1 = g.scoreTeam1 > p1;
      p1 = g.scoreTeam1; p2 = g.scoreTeam2;
      if (t1 === home && !g.isOwnGoal && g.goalGetterName) tally.set(g.goalGetterName, (tally.get(g.goalGetterName) || 0) + 1);
    });
  });
  const top = [...tally].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const sEl = $("#fc-scorers");
  sEl.classList.remove("loading");
  sEl.innerHTML = top.length
    ? `<ol class="scorers">${top.map(([n, c]) => `<li><span>${esc(n)}</span><b>${c}</b><i class="bar" style="width:${(c / top[0][1]) * 100}%"></i></li>`).join("")}</ol>
       <p class="note">Bundesliga und DFB-Pokal, ohne Eigentore.</p>`
    : '<p class="empty">Noch keine Tore erfasst.</p>';

  // Spielplan
  const fx = $("#fc-fixtures");
  const show = (n) => {
    fx.innerHTML = upcoming.slice(0, n).map((m) => matchRow(m, { me: meOf(m), comp: true })).join("") ||
      '<p class="empty">Keine weiteren Spiele angesetzt.</p>';
    if (upcoming.length > n) {
      const b = document.createElement("button");
      b.type = "button"; b.className = "more"; b.textContent = `Alle ${upcoming.length} Spiele zeigen`;
      b.onclick = () => show(upcoming.length);
      fx.append(b);
    }
  };
  show(6);
}

/* ---------- 2 · Nationalelf ---------- */
async function loadNationalelf() {
  const GER = "Deutschland";
  const matches = (await api(`/getmatchdata/DFBN/${SEASON}`)).sort(byKick);
  const upcoming = matches.filter((m) => score(m).state !== "done");
  heroMatch($("#nt-next"), upcoming[0], "Nächstes Länderspiel");
  $("#nt-matches").innerHTML = matches.length
    ? matches.map((m) => matchRow(m, { me: GER, comp: true })).join("")
    : '<p class="empty">Keine Länderspiele erfasst.</p>';

  const tEl = $("#nt-table");
  try {
    const table = await api(`/getbltable/nla/${SEASON}`);
    const opps = new Set(matches.flatMap((m) => [m.team1.teamName, m.team2.teamName]));
    const group = table.filter((t) => opps.has(t.teamName));
    group.sort((a, b) => b.points - a.points || b.goalDiff - a.goalDiff || b.goals - a.goals);
    tEl.innerHTML = group.length >= 2
      ? tableHTML(group.map((t, k) => ({ t, pos: k + 1 })), { zones: (p) => (p <= 2 ? "var(--z-cl)" : p === 4 ? "var(--z-down)" : ""), me: GER })
      : '<p class="empty">Keine Gruppentabelle verfügbar.</p>';
  } catch (e) { fail(tEl, e); return; }
  tEl.classList.remove("loading");
}

/* ---------- 3 · Bundesliga ---------- */
async function loadBundesliga() {
  renderRadar("bl-radar");
  const [table, matches] = await Promise.all([api(`/getbltable/bl1/${SEASON}`), api(`/getmatchdata/bl1/${SEASON}`)]);
  const tEl = $("#bl-table");
  tEl.classList.remove("loading");
  tEl.innerHTML = tableHTML(table.map((t, k) => ({ t, pos: k + 1 })), { zones: blZones, me: KOELN_ID });
  matchdayStepper({ matches, title: $("#bl-md-title"), list: $("#bl-matchday"), prev: $("#bl-prev"), next: $("#bl-next"), rowOpts: { hl: (t) => t.teamId === KOELN_ID } });

  const sEl = $("#bl-scorers");
  try {
    const g = (await api(`/getgoalgetters/bl1/${SEASON}`)).sort((a, b) => b.goalCount - a.goalCount).slice(0, 10);
    sEl.innerHTML = `<ol class="scorers">${g.map((p) => `<li><span>${esc(p.goalGetterName)}</span><b>${p.goalCount}</b><i class="bar" style="width:${(p.goalCount / g[0].goalCount) * 100}%"></i></li>`).join("")}</ol>`;
    sEl.classList.remove("loading");
  } catch (e) { fail(sEl, e); }
}

/* ---------- 4 · Europapokal ---------- */
const EU = {
  ucl: { name: "Champions League" },
  uel: { name: "Europa League" },
  uecl: { name: "Conference League" },
};
// OpenLigaDB führt EL/ECL je Saison unter eigenem Kürzel; für künftige Saisons Kürzel mit Jahr probieren.
function euKey(c) { return c === "ucl" ? "ucl" : (c === "uel" ? "uel" : "uecl") + SEASON; }

async function loadEuropapokal(comp = "ucl") {
  document.querySelectorAll(".seg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.comp === comp)));
  const key = euKey(comp);
  const tEl = $("#eu-table"), gEl = $("#eu-german"), mEl = $("#eu-matchday");
  tEl.classList.add("loading"); tEl.innerHTML = "Lade Tabelle …";
  gEl.innerHTML = '<div class="loading">…</div>'; mEl.innerHTML = "";
  $("#eu-table-title").textContent = `${EU[comp].name} · Ligaphase`;
  try {
    const [table, matches, bl] = await Promise.all([
      api(`/getbltable/${key}/${SEASON}`),
      api(`/getmatchdata/${key}/${SEASON}`),
      api(`/getbltable/bl1/${SEASON}`).catch(() => []),
    ]);
    const german = new Set(bl.map((t) => t.teamName));
    const isGer = (t) => german.has(t.teamName);
    tEl.classList.remove("loading");
    tEl.innerHTML = table.length
      ? tableHTML(table.map((t, k) => ({ t, pos: k + 1 })), { zones: euZones, hl: isGer })
      : '<p class="empty">Noch keine Tabelle.</p>';

    // Deutsche Klubs: letztes Ergebnis und nächstes Spiel
    const clubs = [...new Set(matches.flatMap((m) => [m.team1, m.team2]).filter(isGer).map((t) => t.teamName))];
    const sorted = matches.slice().sort(byKick);
    gEl.innerHTML = clubs.length ? clubs.map((name) => {
      const mine = sorted.filter((m) => involves(m, name));
      const last = mine.filter((m) => score(m).state === "done").at(-1);
      const nxt = mine.find((m) => score(m).state !== "done");
      return `<div class="daygroup">${esc(name)}</div>${[last, nxt].filter(Boolean).map((m) => matchRow(m, { me: name })).join("")}`;
    }).join("") : '<p class="empty">Kein deutscher Klub in diesem Wettbewerb.</p>';

    matchdayStepper({ matches, title: $("#eu-md-title"), list: mEl, prev: $("#eu-prev"), next: $("#eu-next"), rowOpts: { hl: isGer } });
  } catch (e) { fail(tEl, e); gEl.innerHTML = ""; }
}

/* ---------- 5 · Topligen ---------- */
async function loadTopligen() {
  renderRadar("tl-radar");
  const [table, matches] = await Promise.all([api(`/getbltable/pl/${SEASON}`), api(`/getmatchdata/pl/${SEASON}`)]);
  const tEl = $("#pl-table");
  tEl.classList.remove("loading");
  tEl.innerHTML = tableHTML(table.map((t, k) => ({ t, pos: k + 1 })), { zones: plZones });
  matchdayStepper({ matches, title: $("#pl-md-title"), list: $("#pl-matchday"), prev: $("#pl-prev"), next: $("#pl-next") });
}


/* ---------- Lokale Daten (vom Update-Skript erzeugt) ---------- */
const localJSON = (name) => {
  // Bevorzugt die per <script> geladenen Daten (funktioniert auch ohne Server, file://)
  const pre = window.FUPPES_DATA && window.FUPPES_DATA[name];
  if (pre) return Promise.resolve(pre);
  const k = "local:" + name;
  if (!mem.has(k)) {
    const p = fetch(`data/${name}.json`, { cache: "no-cache" }).then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); });
    mem.set(k, p);
    p.catch(() => mem.delete(k));
  }
  return mem.get(k);
};
const fmtStand = (iso) => { const d = new Date(iso); return isNaN(d) ? "" : `Stand ${fmtDay(d)}, ${fmtTime(d)}`; };
function ago(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  const h = Math.round(ms / 36e5);
  if (h < 1) return "gerade eben";
  if (h < 24) return `vor ${h} Std.`;
  const d = Math.round(h / 24);
  return d === 1 ? "gestern" : `vor ${d} Tagen`;
}
const safeLink = (u) => (/^https?:\/\//.test(u || "") ? u : "#");
const noData = '<p class="empty">Noch keine Daten. Einmal <code>node scripts/update-data.mjs</code> ausführen (oder die GitHub Action laufen lassen).</p>';

function newsHTML(items, { fee = false } = {}) {
  return items.map((i) => `<div class="nw">
    <a href="${esc(safeLink(i.link))}" target="_blank" rel="noopener">${esc(i.title)}</a>
    <div class="nw-meta">${fee && i.fee ? `<span class="fee">${esc(String(i.fee).replace(".", ","))} Mio. €</span>` : ""}${(i.tags || []).map((t) => `<span class="tag t-${esc(t)}">${esc(t)}</span>`).join("")}<span>${esc(i.source)} · ${esc(ago(i.date))}</span></div>
  </div>`).join("");
}

async function renderFcNews() {
  const el = $("#fc-news");
  try {
    const d = await localJSON("news-fc");
    $("#fc-news-stand").textContent = fmtStand(d.updated);
    el.innerHTML = d.items.length ? newsHTML(d.items.slice(0, 8)) : '<p class="empty">Gerade keine Transfer- oder Personalmeldungen.</p>';
  } catch (_) { el.innerHTML = noData; }
}

async function renderRadar(id) {
  const el = $("#" + id);
  try {
    const d = await localJSON("transfers");
    $(`#${id}-stand`).textContent = fmtStand(d.updated);
    el.innerHTML = d.items.length ? newsHTML(d.items.slice(0, 12), { fee: true }) : '<p class="empty">Gerade nichts Großes auf dem Transfermarkt.</p>';
  } catch (_) { el.innerHTML = noData; }
}

/* ---------- Home: Kalender ---------- */
const CAT_LABEL = { fc: "Effzeh", dfb: "Nationalelf", eu: "Europapokal", vvk: "Vorverkauf" };
let cats = { fc: true, dfb: true, eu: true, vvk: true };
try { cats = { ...cats, ...JSON.parse(localStorage.getItem("fuppes:cats") || "{}") }; } catch (_) {}
let allEvents = [];
let calMonth = (() => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), 1); })();
let calSel = null;

const berlinKey = (d) => d.toLocaleDateString("sv-SE", tz); // YYYY-MM-DD in Berliner Zeit
const nameShort = (t) => ((t.shortName || "").length > 3 ? t.shortName : t.teamName);

function matchEvent(m, cat) {
  const s = score(m);
  return {
    id: `${cat}-${m.matchID}`, cat, start: kick(m),
    title: `${nameShort(m.team1)} – ${nameShort(m.team2)}`,
    sub: compName(m),
    result: s.state !== "open" && s.h != null ? `${s.h}:${s.a}` : null,
  };
}

async function gatherEvents() {
  const tasks = {
    bl: api(`/getmatchdata/bl1/${SEASON}`),
    dfb: api(`/getmatchdata/dfb/${SEASON}`),
    nt: api(`/getmatchdata/DFBN/${SEASON}`),
    table: api(`/getbltable/bl1/${SEASON}`),
    ucl: api(`/getmatchdata/${euKey("ucl")}/${SEASON}`),
    uel: api(`/getmatchdata/${euKey("uel")}/${SEASON}`),
    uecl: api(`/getmatchdata/${euKey("uecl")}/${SEASON}`),
    vvk: localJSON("vorverkauf"),
  };
  const keys = Object.keys(tasks);
  const res = await Promise.allSettled(Object.values(tasks));
  const r = Object.fromEntries(keys.map((k, i) => [k, res[i].status === "fulfilled" ? res[i].value : null]));
  const ev = [];
  const isFC = (t) => t.teamId === KOELN_ID || t.teamName === KOELN_NAME;
  [...(r.bl || []), ...(r.dfb || [])].filter((m) => isFC(m.team1) || isFC(m.team2)).forEach((m) => ev.push(matchEvent(m, "fc")));
  (r.nt || []).forEach((m) => ev.push(matchEvent(m, "dfb")));
  const german = new Set((r.table || []).map((t) => t.teamName));
  [r.ucl, r.uel, r.uecl].forEach((list) => (list || []).filter((m) => german.has(m.team1.teamName) || german.has(m.team2.teamName))
    .forEach((m) => ev.push(matchEvent(m, "eu"))));
  if (r.vvk) {
    $("#vvk-stand").textContent = "Vorverkauf: " + fmtStand(r.vvk.updated);
    if (/^webcal:\/\//.test(r.vvk.subscribe || "")) $("#vvk-sub").href = r.vvk.subscribe;
    r.vvk.items.forEach((v) => ev.push({
      id: "vvk-" + v.id, cat: "vvk", start: new Date(v.start),
      title: `VVK: ${v.match}`,
      sub: [v.phase, v.competition, v.round].filter(Boolean).join(" · "),
      limit: v.limit, note: v.note, link: r.vvk.shop,
    }));
    // Weitere Phasen (20+, U25 …) als eigene Termine
    r.vvk.items.forEach((v) => (v.extraPhases || []).forEach((x, k) => ev.push({
      id: `vvk-${v.id}-${k}`, cat: "vvk", start: new Date(x.start),
      title: `VVK ${x.group}: ${v.match}`,
      sub: [`Phase ${x.group}`, v.competition, v.round].filter(Boolean).join(" · "),
      limit: v.limit, link: r.vvk.shop,
    })));
  } else {
    $("#vvk-stand").textContent = "Vorverkaufsdaten fehlen noch (Update-Skript ausführen).";
  }
  const failed = keys.filter((k, i) => res[i].status === "rejected" && k !== "vvk");
  if (failed.length === keys.length - 1) throw new Error("Spieldaten nicht erreichbar");
  return ev.sort((a, b) => a.start - b.start);
}

const NUM = { eine: 1, einer: 1, ein: 1, zwei: 2, drei: 3, vier: 4, fünf: 5 };
function shortLimit(t) {
  const m = t.match(/auf (\w+) Karten? pro (Mitglied|Person|Kunde)(?:[^,.]*)?(?:,\s*(davon[^.]*))?/i);
  if (!m) return t.replace(/\.$/, "");
  const n = NUM[m[1].toLowerCase()] ?? m[1];
  return `max. ${n} ${n === 1 ? "Karte" : "Karten"} pro ${m[2]}${m[3] ? ", " + m[3] : ""}`;
}

function eventHTML(e, { date = false } = {}) {
  const time = fmtTime(e.start);
  return `<div class="ev ${e.cat}">
    <div class="ev-time">${esc(e.result || time)}</div>
    <div class="ev-body">
      <div class="ev-title">${e.link ? `<a href="${esc(safeLink(e.link))}" target="_blank" rel="noopener">${esc(e.title)}</a>` : esc(e.title)}</div>
      <div class="ev-sub">${date ? esc(fmtDay(e.start)) + " · " : ""}${esc(CAT_LABEL[e.cat])} · ${esc(e.sub)}${e.result ? " · Anstoß " + esc(time) : ""}</div>
      ${e.limit ? `<span class="ev-limit" title="${esc(e.limit)}">Kontingent: ${esc(shortLimit(e.limit))}</span>` : ""}
      ${e.note ? `<div class="ev-sub">${esc(e.note)}</div>` : ""}
    </div>
  </div>`;
}

const visible = () => allEvents.filter((e) => cats[e.cat]);

function renderCal() {
  const grid = $("#cal-grid");
  const y = calMonth.getFullYear(), mo = calMonth.getMonth();
  $("#cal-title").textContent = calMonth.toLocaleDateString("de-DE", { month: "long", year: "numeric" });
  const first = new Date(y, mo, 1);
  const offset = (first.getDay() + 6) % 7; // Montag zuerst
  const start = new Date(y, mo, 1 - offset);
  const weeks = Math.ceil((offset + new Date(y, mo + 1, 0).getDate()) / 7);
  const byDay = new Map();
  visible().forEach((e) => { const k = berlinKey(e.start); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(e); });
  const todayKey = berlinKey(new Date());
  let html = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"].map((w) => `<div class="cal-wd" role="columnheader">${w}</div>`).join("");
  for (let i = 0; i < weeks * 7; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const list = byDay.get(key) || [];
    const cls = ["cal-cell", d.getMonth() !== mo ? "out" : "", key === todayKey ? "today" : "", key < todayKey ? "past" : ""].join(" ");
    const tags = list.slice(0, 3).map((e) => `<span class="cal-tag ${e.cat}" title="${esc(e.title)}">${esc(e.cat === "vvk" ? "VVK " + e.title.replace(/^VVK[^:]*:\s*/, "") : e.title)}</span>`).join("");
    const more = list.length > 3 ? `<span class="cal-more">+${list.length - 3}</span>` : "";
    const dots = `<span class="cal-dots">${[...new Set(list.map((e) => e.cat))].map((c) => `<i class="cat cat-${c}"></i>`).join("")}</span>`;
    const label = `${d.getDate()}. ${d.toLocaleDateString("de-DE", { month: "long" })}${list.length ? `, ${list.length} Termin${list.length > 1 ? "e" : ""}` : ""}`;
    html += `<button type="button" role="gridcell" class="${cls}" data-day="${key}" aria-label="${esc(label)}" aria-selected="${key === calSel}"><span class="cal-num">${d.getDate()}</span>${tags}${more}${dots}</button>`;
  }
  grid.innerHTML = html;
  renderCalDay();
}

function renderCalDay() {
  const el = $("#cal-day");
  if (!calSel) { el.innerHTML = ""; return; }
  const list = visible().filter((e) => berlinKey(e.start) === calSel);
  const [yy, mm, dd] = calSel.split("-").map(Number);
  const d = new Date(yy, mm - 1, dd);
  el.innerHTML = `<h4>${esc(d.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" }))}</h4>` +
    (list.length ? list.map((e) => eventHTML(e)).join("") : '<div class="soon-empty">Keine Termine an diesem Tag.</div>');
  const todayKey = berlinKey(new Date());
  if (calSel <= todayKey) {
    const upcoming = visible().filter((e) => berlinKey(e.start) > calSel && e.start > Date.now()).slice(0, 3);
    if (upcoming.length) el.innerHTML += `<h4>Als Nächstes</h4>` + upcoming.map((e) => eventHTML(e, { date: true })).join("");
  }
}

function renderMine() { renderCal(); }

async function loadHome() {
  if (!calSel) calSel = berlinKey(new Date());
  document.querySelectorAll(".flt").forEach((b) => {
    b.setAttribute("aria-pressed", String(!!cats[b.dataset.cat]));
    b.addEventListener("click", () => {
      cats[b.dataset.cat] = !cats[b.dataset.cat];
      b.setAttribute("aria-pressed", String(cats[b.dataset.cat]));
      try { localStorage.setItem("fuppes:cats", JSON.stringify(cats)); } catch (_) {}
      renderMine();
    });
  });
  $("#cal-prev").onclick = () => { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1); renderCal(); };
  $("#cal-next").onclick = () => { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1); renderCal(); };
  $("#cal-today").onclick = () => { const n = new Date(); calMonth = new Date(n.getFullYear(), n.getMonth(), 1); calSel = berlinKey(n); renderCal(); };
  $("#cal-grid").addEventListener("click", (ev) => {
    const c = ev.target.closest(".cal-cell");
    if (!c) return;
    calSel = calSel === c.dataset.day ? null : c.dataset.day;
    renderCal();
  });
  renderCal(); // leeres Raster sofort
  try {
    allEvents = await gatherEvents();
    renderMine();
  } catch (e) { fail($("#cal-day"), e); }
}

/* ---------- Routing ---------- */
const VIEWS = {
  home: { load: loadHome, err: "#cal-day" },
  effzeh: { load: loadEffzeh, err: "#fc-next" },
  nationalelf: { load: loadNationalelf, err: "#nt-next" },
  bundesliga: { load: loadBundesliga, err: "#bl-table" },
  europapokal: { load: () => loadEuropapokal(currentComp), err: "#eu-table" },
  topligen: { load: loadTopligen, err: "#pl-table" },
};
const loaded = new Set();
let currentComp = "ucl";
try { currentComp = localStorage.getItem("fuppes:comp") || "ucl"; } catch (_) {}
if (!EU[currentComp]) currentComp = "ucl";

function show(name) {
  if (!VIEWS[name]) name = "home";
  document.querySelectorAll(".view").forEach((v) => (v.hidden = v.dataset.view !== name));
  document.querySelectorAll(".tabs a").forEach((a) => a.setAttribute("aria-selected", String(a.dataset.tab === name)));
  $(`.tabs a[data-tab="${name}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  document.title = name === "home" ? "fuppes" : `${$(`.tabs a[data-tab="${name}"]`).textContent} · fuppes`;
  if (!loaded.has(name)) {
    loaded.add(name);
    VIEWS[name].load().catch((e) => { loaded.delete(name); fail($(VIEWS[name].err), e); });
  }
}

document.querySelectorAll(".seg button").forEach((b) => b.addEventListener("click", () => {
  currentComp = b.dataset.comp;
  try { localStorage.setItem("fuppes:comp", currentComp); } catch (_) {}
  loadEuropapokal(currentComp);
}));

window.addEventListener("hashchange", () => show(location.hash.slice(1)));
let start = location.hash.slice(1);
show(VIEWS[start] ? start : "home");
