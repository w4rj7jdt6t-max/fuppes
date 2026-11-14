#!/usr/bin/env node
/*
 * fuppes – Datenupdate
 * Holt Quellen, die der Browser wegen CORS nicht direkt laden darf, und legt sie als JSON in ./data ab:
 *   data/vorverkauf.json   – Vorverkaufsstarts aus dem offiziellen FC-Kalender (calovo)
 *   data/news-fc.json      – Transfer- & Personal-News zum 1. FC Köln
 *   data/transfers.json    – Transfer-Radar Bundesliga & Europa (nur Top-Klubs oder hohe Ablösen)
 *
 * Aufruf: node scripts/update-data.mjs        (Node >= 20, keine Abhängigkeiten)
 * Hinter einem Proxy: NODE_USE_ENV_PROXY=1 node scripts/update-data.mjs
 */
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "data");
const UA = "Mozilla/5.0 (fuppes personal football page)";

/* ------------------------------------------------------------------ Konfiguration */

// Offizielle FC-Kalender (fc.de › Ticketing › „Vorverkäufe abonnieren“)
const VVK_ICS = "https://i.cal.to/ical/218/fckoeln/1-fc-koeln-vorverkaufsstarts/12345.12345-54321.ics";

const gnews = (q) => `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=de&gl=DE&ceid=DE:de`;

const FC_FEEDS = [
  { name: "kicker", url: "https://newsfeed.kicker.de/team/1-fc-koeln" },
  { name: "GEISSBLOG", url: "https://geissblog.koeln/feed/" },
  { name: "Google News", url: gnews('"1. FC Köln" (Transfer OR Wechsel OR Vertrag OR Verletzung OR Trainer OR Leihe) when:14d') },
];

const TOP_FEEDS = [
  { name: "Transfermarkt", url: "https://www.transfermarkt.de/rss/news" },
  { name: "kicker", url: "https://newsfeed.kicker.de/news/bundesliga" },
  { name: "kicker", url: "https://newsfeed.kicker.de/news/fussball" },
  { name: "Google News", url: gnews("Fußball Transfer Ablöse Millionen when:10d") },
  { name: "Google News", url: gnews("Fußball Wechsel perfekt when:10d") },
  { name: "Google News", url: gnews("(Bayern OR BVB OR Leverkusen OR \"Real Madrid\" OR Barcelona OR Liverpool OR \"Manchester City\" OR Arsenal OR PSG) Transfer when:7d") },
];

// Wer gilt als Top-Klub? (Teilstrings, Groß/Klein egal)
const TOP_CLUBS = [
  "Bayern", "FCB", "Dortmund", "BVB", "Leverkusen", "Bayer 04", "RB Leipzig", "Leipzig", "Stuttgart", "VfB", "Eintracht Frankfurt", "Frankfurt",
  "Real Madrid", "Barcelona", "Barça", "Atlético", "Atletico",
  "Manchester City", "Man City", "Manchester United", "ManUnited", "Man United", "Liverpool", "Arsenal", "Chelsea", "Tottenham", "Newcastle",
  "Paris Saint-Germain", "PSG", "Juventus", "Inter Mailand", "Inter", "AC Mailand", "Milan", "Neapel", "Napoli",
];
const MIN_FEE_MIO = 20; // Ablöse ab dieser Summe gilt immer als interessant

const TRANSFER_RX = /\b(transfer|wechsel|wechselt|ablöse|verpflicht|leihe|leiht|ausleih|neuzugang|zugang|abgang|vertrag|verlänger|klausel|angebot|interesse|interessiert|gerücht|holt|kauft|kaufoption|unterschreibt|unterschrieben|perfekt|deal|winter-transfer|sommer-transfer)/i;
const PERSONNEL_RX = /\b(verletz|ausfall|fällt aus|fehlt|operation|comeback|rückkehr|sperre|gesperrt|trainer|cheftrainer|sportdirektor|sportchef|geschäftsführer|kader|nominier|kapitän|entlass|beurlaub|amt)/i;
const NOT_FOOTBALL_RX = /\b(handball|basketball|eishockey|nba|nfl|tennis|formel 1|leichtathletik|darts|füchse|kec|haie)\b/i;

/* ------------------------------------------------------------------ Helfer */

async function get(url) {
  const r = await fetch(url, { headers: { "user-agent": UA, accept: "*/*" }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.text();
}

const decode = (s) => String(s ?? "")
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/<[^>]+>/g, " ")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
  .replace(/\s+/g, " ").trim();

function parseRss(xml, sourceName) {
  return [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/g)].map(([, it]) => {
    const tag = (t) => { const m = it.match(new RegExp(`<${t}\\b[^>]*>([\\s\\S]*?)<\\/${t}>`)); return m ? decode(m[1]) : ""; };
    let title = tag("title");
    let source = sourceName;
    const src = tag("source");
    // Google News hängt " - Quelle" an den Titel
    if (sourceName === "Google News") {
      const cut = title.lastIndexOf(" - ");
      if (cut > 20) { source = title.slice(cut + 3); title = title.slice(0, cut); }
      else if (src) source = src;
    }
    const date = new Date(tag("pubDate") || tag("dc:date") || Date.now());
    return { title, link: tag("link"), summary: tag("description").slice(0, 280), source, date: isNaN(date) ? new Date().toISOString() : date.toISOString() };
  }).filter((i) => i.title && /^https?:\/\//.test(i.link));
}

async function collect(feeds) {
  const res = await Promise.allSettled(feeds.map(async (f) => parseRss(await get(f.url), f.name)));
  res.forEach((r, i) => { if (r.status === "rejected") console.warn("⚠ Feed fehlgeschlagen:", feeds[i].url, r.reason.message); });
  return res.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
}

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9äöüß ]/g, "").replace(/\s+/g, " ").slice(0, 60);
function dedupe(items) {
  const seen = new Set();
  return items.filter((i) => { const k = norm(i.title); if (seen.has(k)) return false; seen.add(k); return true; });
}

/** Höchste genannte Summe in Mio. € (z. B. "65 Millionen Euro", "20 Mio.", "1,5 Mrd.") */
function feeMio(text) {
  let max = 0;
  for (const m of text.matchAll(/(\d{1,3}(?:[.,]\d{1,2})?)\s*(millionen|mio\.?|mrd\.?|milliarden)/gi)) {
    let v = parseFloat(m[1].replace(",", "."));
    if (/^m(rd|illiarden)/i.test(m[2])) v *= 1000;
    if (v > max) max = v;
  }
  return max || null;
}

function clubsIn(text) {
  const hits = TOP_CLUBS.filter((c) => new RegExp(`(^|[^\\p{L}])${c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\p{L}]|$)`, "iu").test(text));
  return [...new Set(hits)];
}

const tagsFor = (title, t = title) => {
  const tags = [];
  if (/gerücht|angeblich|interesse|interessiert|beobachte|\bwohl\b|offenbar|\bspur\b|\?/i.test(title)) tags.push("Gerücht");
  if (/leihe|leiht|ausleih|leihabbruch/i.test(t)) tags.push("Leihe");
  if (/vertrag|verlänger|unterschreibt|klausel/i.test(t)) tags.push("Vertrag");
  if (/perfekt|wechselt|verpflicht|neuzugang|unterschrieben|holt/i.test(t) && !tags.includes("Gerücht")) tags.push("Fix");
  if (/verletz|ausfall|fällt aus|fehlt|operation|comeback|rückkehr|sperre|gesperrt/i.test(t)) tags.push("Personal");
  if (/trainer|sportdirektor|sportchef|geschäftsführer|entlass|beurlaub/i.test(t)) tags.push("Verein");
  if (!tags.length) tags.push(TRANSFER_RX.test(t) ? "Transfer" : "Personal");
  return tags;
};

/* ------------------------------------------------------------------ ICS (Vorverkauf) */

/** Lokale Berliner Zeit -> UTC-ISO, ohne Bibliothek */
function berlinToISO(y, mo, d, h, mi) {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(guess));
  const p = Object.fromEntries(parts.map((x) => [x.type, +x.value]));
  const asBerlin = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return new Date(guess - (asBerlin - guess)).toISOString();
}

function parseIcs(text) {
  const lines = text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "").split("\n");
  const events = [];
  let ev = null, depth = 0;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") { ev = {}; depth = 0; continue; }
    if (!ev) continue;
    if (line.startsWith("BEGIN:")) { depth++; continue; }
    if (line.startsWith("END:") && depth > 0) { depth--; continue; }
    if (line === "END:VEVENT") { events.push(ev); ev = null; continue; }
    if (depth > 0) continue; // VALARM o. ä.
    const i = line.indexOf(":");
    if (i < 0) continue;
    const [name, ...params] = line.slice(0, i).split(";");
    ev[name] = { value: line.slice(i + 1), params };
  }
  const unesc = (s) => s.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
  const toISO = (f) => {
    if (!f) return null;
    const m = f.value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/);
    if (!m) return null;
    if (!m[4]) return berlinToISO(+m[1], +m[2], +m[3], 0, 0);
    if (m[7]) return new Date(Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5])).toISOString();
    return berlinToISO(+m[1], +m[2], +m[3], +m[4], +m[5]); // TZID=Europe/Berlin
  };
  return events.map((e) => ({
    uid: e.UID?.value,
    start: toISO(e.DTSTART),
    summary: unesc(e.SUMMARY?.value || ""),
    location: unesc(e.LOCATION?.value || ""),
    description: unesc(e.DESCRIPTION?.value || ""),
    status: e.STATUS?.value,
  }));
}

function presaleFromEvent(e) {
  const [match = e.summary, comp = "", round = ""] = e.summary.split("|").map((s) => s.trim());
  const desc = e.description.replace(/\n{2,}/g, "\n").replace(/Anbieter-Impressum[\s\S]*$/i, "").trim();
  const sentences = desc.replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").split(/(?<=\.)\s+/);
  const limit = sentences.find((s) => /begrenzt|kontingent|pro mitglied|pro person/i.test(s)) || null;
  const phase = (desc.match(/Der ([\wäöüÄÖÜß+-]*verkauf) startet/i) || [])[1] || "Vorverkauf";
  const extra = (desc.match(/HINWEIS[^:]*:\s*([\s\S]*)/i) || [])[1];
  return {
    id: e.uid,
    start: e.start,
    match: match.replace(/\s+/g, " "),
    competition: comp.replace("Bundesliage", "Bundesliga"),
    round,
    phase: phase.charAt(0).toUpperCase() + phase.slice(1),
    limit: limit ? limit.replace(/^[A-ZÄÖÜ\s]{6,}(?=[A-ZÄÖÜ][a-zäöü])/, "").trim() : null,
    note: extra ? extra.replace(/\s+/g, " ").trim().slice(0, 300) : null,
    location: e.location,
    extraPhases: extra ? extraPhases(extra, e.start) : [],
  };
}

const MONTHS = { januar: 1, februar: 2, märz: 3, april: 4, mai: 5, juni: 6, juli: 7, august: 8, september: 9, oktober: 10, november: 11, dezember: 12 };
/** Weitere Verkaufsphasen aus dem Hinweistext, z. B. „Der Vorverkauf 20+ beginnt am Freitag, 13. November 2026, um 10 Uhr.“ */
function extraPhases(text, refISO) {
  const ref = new Date(refISO);
  const out = [];
  for (const s of text.replace(/\s+/g, " ").split(/(?<=Uhr)\.\s*|\n/)) {
    const g = s.match(/\b(20\+|U\s?\d{2}|Ü\s?\d{2}|Dauerkarten\w*|Mitglieder\w*|freie[nr]? Verkauf|Gäste\w*)/i);
    const d = s.match(/(\d{1,2})\.\s*(Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember)(?:\s+(\d{4}))?[^0-9]{0,12}?(\d{1,2})(?::(\d{2}))?\s*Uhr/i);
    if (!g || !d) continue;
    const mo = MONTHS[d[2].toLowerCase()];
    let y = d[3] ? +d[3] : ref.getUTCFullYear();
    if (!d[3] && mo < ref.getUTCMonth() + 1 - 6) y++; // Jahreswechsel
    out.push({ group: g[1].replace(/\s/g, ""), start: berlinToISO(y, mo, +d[1], +d[4], +(d[5] || 0)) });
  }
  return out;
}

/* ------------------------------------------------------------------ Jobs */

async function vorverkauf() {
  const ics = await get(VVK_ICS);
  const events = parseIcs(ics).filter((e) => e.start && e.status !== "CANCELLED");
  const cutoff = Date.now() - 120 * 864e5; // ältere Einträge weglassen
  const items = events.filter((e) => new Date(e.start) >= cutoff).map(presaleFromEvent).sort((a, b) => a.start.localeCompare(b.start));
  return { source: "1. FC Köln · Vorverkaufsstarts (calovo)", subscribe: VVK_ICS.replace(/^https:/, "webcal:"), shop: "https://www.ticket-onlineshop.com/ols/fckoeln/", items };
}

async function newsFC() {
  const all = dedupe((await collect(FC_FEEDS)).sort((a, b) => b.date.localeCompare(a.date)));
  const cutoff = Date.now() - 21 * 864e5;
  const items = all
    .filter((i) => new Date(i.date) >= cutoff)
    // Google-News-Treffer nur, wenn der FC im Titel vorkommt (kicker/GEISSBLOG sind ohnehin FC-Feeds)
    .filter((i) => i.source === "kicker" || i.source === "GEISSBLOG" || /köln|effzeh|geißb|\bfc-/i.test(i.title))
    .filter((i) => { const t = `${i.title} ${i.summary}`; return (TRANSFER_RX.test(t) || PERSONNEL_RX.test(t)) && !NOT_FOOTBALL_RX.test(t); })
    .map((i) => ({ ...i, tags: tagsFor(i.title, `${i.title} ${i.summary}`) }))
    .slice(0, 20);
  return { items };
}

async function transfers() {
  const all = dedupe((await collect(TOP_FEEDS)).sort((a, b) => b.date.localeCompare(a.date)));
  const cutoff = Date.now() - 14 * 864e5;
  const items = all
    .filter((i) => new Date(i.date) >= cutoff)
    .map((i) => {
      const t = `${i.title} ${i.summary}`;
      return { ...i, fee: feeMio(i.title) ?? feeMio(i.summary), clubs: clubsIn(t), transfer: TRANSFER_RX.test(t), off: NOT_FOOTBALL_RX.test(t) };
    })
    .filter((i) => i.transfer && !i.off && ((i.fee ?? 0) >= MIN_FEE_MIO || i.clubs.length))
    .map(({ transfer, off, ...i }) => ({ ...i, tags: tagsFor(i.title, `${i.title} ${i.summary}`) }))
    .slice(0, 24);
  return { rules: { minFeeMio: MIN_FEE_MIO, topClubs: TOP_CLUBS }, items };
}

/* ------------------------------------------------------------------ Spielinfos */

const FC_ICS = "https://i.cal.to/ical/34/fckoeln/bundesliga-spielplan/12345.12345-54321.ics";
const YT = (id) => `https://www.youtube.com/feeds/videos.xml?channel_id=${id}`;
const YT_CHANNELS = { fc: "UCQZhvmm636X6I5rrnLFBp1w", dfb: "UCfMo0xj-sbdzHuzxvKdu1hw" };

// Aufstellungen + Spielort aus dem offiziellen FC-Spielplan-Kalender
function fcMatchInfo(e) {
  const [stadium = "", city = ""] = e.location.split(",").map((x) => x.replace(/\(Stadion\)/, "").trim());
  const head = e.description.split("\n")[0];
  const blocks = e.description.split(/\n\n+/);
  const lineups = [];
  for (let i = 0; i < blocks.length; i++) {
    const m = blocks[i].match(/^([^\n]+):\n([^\n]+,[^\n]+)$/);
    if (m && m[1] !== "Tore") lineups.push({ team: m[1].trim(), players: m[2].split(/,\s*/).map((x) => x.trim()).filter(Boolean) });
  }
  const goals = (e.description.match(/Tore:\n([\s\S]*?)(\n\n|$)/) || [, ""])[1].split("\n").map((x) => x.trim()).filter(Boolean);
  return { start: e.start, title: e.summary.replace(/^\*\s*/, "").split("|")[0].trim(), result: /\d+:\d+/.test(head) ? head : null, stadium, city, lineups, goals };
}

// Pressekonferenzen von den offiziellen YouTube-Kanälen
function parseYt(xml, who) {
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, e]) => {
    const tag = (t) => { const m = e.match(new RegExp(`<${t}\\b[^>]*>([\\s\\S]*?)<\\/${t}>`)); return m ? m[1] : ""; };
    const id = tag("yt:videoId");
    const title = decode(tag("title"));
    const raw = tag("media:description").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
    const desc = raw.split(/\n\s*_{3,}|Alle offiziellen|Abonniere|Abonnieren/)[0].replace(/\s+/g, " ").trim();
    const quotes = [...`${title} ${desc}`.matchAll(/[„"“]([^„"“”]{8,160})[“"”]/g)].map((q) => q[1].trim());
    return { who, id, title, date: tag("published"), url: `https://www.youtube.com/watch?v=${id}`, summary: desc.slice(0, 320), quotes: [...new Set(quotes)].slice(0, 3) };
  }).filter((v) => v.id && /pressekonferenz|\bPK\b|medienrunde/i.test(v.title));
}

async function spielinfo() {
  const out = { fc: [], press: [], referees: [] };
  const [ics, ytFc, ytDfb, refs] = await Promise.allSettled([
    get(FC_ICS), get(YT(YT_CHANNELS.fc)), get(YT(YT_CHANNELS.dfb)),
    get(gnews("Schiedsrichter-Ansetzungen Spieltag site:bundesliga.com when:30d")),
  ]);
  if (ics.status === "fulfilled") out.fc = parseIcs(ics.value).filter((e) => e.start).map(fcMatchInfo);
  else console.warn("⚠ FC-Spielplan:", ics.reason.message);
  for (const [r, who] of [[ytFc, "fc"], [ytDfb, "dfb"]]) {
    if (r.status === "fulfilled") out.press.push(...parseYt(r.value, who));
    else console.warn("⚠ YouTube", who, r.reason.message);
  }
  if (refs.status === "fulfilled") {
    out.referees = parseRss(refs.value, "Google News")
      .map((i) => ({ ...i, matchday: +((i.title.match(/am (\d+)\. Spieltag/) || [])[1] || 0) }))
      .filter((i) => i.matchday)
      .map(({ summary, ...i }) => i);
  }
  if (!out.fc.length && !out.press.length) throw new Error("keine Spielinfos geladen");
  return out;
}

/* ------------------------------------------------------------------ TV-Sender pro Spiel */

const OLDB = "https://api.openligadb.de";
const seasonNow = () => { const d = new Date(); return d.getMonth() >= 6 ? d.getFullYear() : d.getFullYear() - 1; };
const BROADCASTERS = [
  ["Sky", /\bSky\b|\bWOW\b|Sky Go/i], ["DAZN", /\bDAZN\b/i], ["RTL", /\bRTL\b/], ["ARD", /\bARD\b|Das Erste|Sportschau/],
  ["ZDF", /\bZDF\b/], ["Sat.1", /Sat\.?\s?1\b/i], ["ProSieben", /ProSieben|Pro ?7(?! ?MAXX)/i], ["Prime Video", /Prime Video|Amazon Prime/i],
  ["MagentaTV", /Magenta ?TV/i], ["Nitro", /\bNitro\b/], ["Sport1", /\bSport1\b/i],
];
const KICKER_FEEDS = ["fussball", "bundesliga", "nationalmannschaft", "dfb-pokal", "champions-league", "europa-league"]
  .map((f) => ({ url: `https://newsfeed.kicker.de/news/${f}`, name: "kicker" }));
const SKIP_WORDS = new Set(["borussia", "eintracht", "verein", "sport", "club", "1846", "1907", "olympique", "real", "united"]);
const tokens = (t) => {
  if (t.teamName === "Deutschland") return ["deutschland", "dfb"];
  const ws = [t.shortName, ...t.teamName.split(/[\s.\-\/]+/)].filter((w) => w && w.length >= 4 && !SKIP_WORDS.has(w.toLowerCase()));
  return [...new Set(ws.map((w) => w.toLowerCase()))];
};
const mentions = (text, t) => tokens(t).some((w) => text.toLowerCase().includes(w));

async function tv() {
  const S = seasonNow();
  const lists = await Promise.allSettled(["bl1", "dfb", "DFBN", "ucl", `uel${S}`, `uecl${S}`].map((l) => get(`${OLDB}/getmatchdata/${l}/${S}`).then(JSON.parse)));
  const table = JSON.parse(await get(`${OLDB}/getbltable/bl1/${S}`).catch(() => "[]"));
  const german = new Set(table.map((t) => t.teamName));
  const now = Date.now();
  const relevant = lists.flatMap((r, i) => (r.status === "fulfilled" ? r.value.map((m) => ({ m, i })) : []))
    .filter(({ m, i }) => {
      const t = new Date(m.matchDateTimeUTC).getTime();
      if (t < now - 3 * 864e5 || t > now + 12 * 864e5) return false;
      if (i === 2) return true;                                         // Nationalelf
      if (i <= 1) return m.team1.teamId === 65 || m.team2.teamId === 65; // FC
      return german.has(m.team1.teamName) || german.has(m.team2.teamName);
    }).map(({ m }) => m);

  const kicker = (await collect(KICKER_FEEDS)).filter((i) => /überträgt|live im tv|im tv|stream/i.test(i.title));
  const out = [];
  for (const m of relevant) {
    const nm = (t) => ((t.shortName || "").length > 3 ? t.shortName : t.teamName);
    const q = `${nm(m.team1)} ${nm(m.team2)} live TV`;
    let items = [];
    try { items = parseRss(await get(gnews(`${q} when:10d`)), "Google News"); } catch (e) { console.warn("⚠ TV-Suche:", q, e.message); }
    const votes = new Map(), evidence = [];
    for (const it of items) {
      const t = it.title;
      if (!mentions(t, m.team1) || !mentions(t, m.team2)) continue;
      const found = BROADCASTERS.filter(([, rx]) => rx.test(t)).map(([n]) => n);
      if (!found.length || /österreich|schweiz|austria|\bAT\b|\bCH\b/i.test(t)) continue; // nur deutsche Sender
      if (/\boder\b/i.test(t) && found.length > 1) continue;            // „RTL, ARD oder ZDF?“ = Frage, keine Antwort
      found.forEach((n) => votes.set(n, (votes.get(n) || 0) + 1));
      if (evidence.length < 3) evidence.push({ title: t, source: it.source, link: it.link });
    }
    const max = Math.max(0, ...votes.values());
    let channels = [...votes].filter(([, n]) => n >= Math.max(1, max / 2)).sort((a, b) => b[1] - a[1]).map(([n]) => n);
    if (max === 1 && channels.length > 1) channels = [];                // widersprüchlich, lieber nichts
    const k = kicker.find((i) => mentions(i.title, m.team1) && mentions(i.title, m.team2) && Math.abs(new Date(i.date) - new Date(m.matchDateTimeUTC)) < 8 * 864e5);
    out.push({ matchID: m.matchID, kick: m.matchDateTimeUTC, team1: m.team1.teamName, team2: m.team2.teamName, channels, evidence, kicker: k ? k.link.replace(/#omrss$/, "") : null });
    await new Promise((r) => setTimeout(r, 400));
  }
  return { matches: out };
}

/* ------------------------------------------------------------------ Start */

await mkdir(DATA, { recursive: true });
const jobs = { "vorverkauf.json": vorverkauf, "news-fc.json": newsFC, "transfers.json": transfers, "spielinfo.json": spielinfo, "tv.json": tv };
let failed = 0;
for (const [file, job] of Object.entries(jobs)) {
  try {
    const data = { updated: new Date().toISOString(), ...(await job()) };
    const json = JSON.stringify(data, null, 1);
    await writeFile(join(DATA, file), json + "\n");
    // Zusätzlich als Skript, damit die Seite auch per Doppelklick (file://) ohne Server läuft
    const key = file.replace(/\.json$/, "");
    await writeFile(join(DATA, key + ".js"), `window.FUPPES_DATA = window.FUPPES_DATA || {};\nwindow.FUPPES_DATA[${JSON.stringify(key)}] = ${json};\n`);
    const n = Object.values(data).filter(Array.isArray).reduce((a, x) => a + x.length, 0);
    console.log(`✓ ${file}: ${n} Einträge`);
  } catch (e) {
    failed++;
    console.error(`✗ ${file}:`, e.message); // alte Datei bleibt bestehen
  }
}
process.exitCode = failed === Object.keys(jobs).length ? 1 : 0;
