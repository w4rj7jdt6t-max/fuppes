#!/usr/bin/env node
/* Sucht zu jedem Stadion aus stadien.js ein Foto (Wikidata „Bild“ → Wikimedia Commons)
   und schreibt data/stadionbilder.json + .js mit Bild-URL, Urheber und Lizenz.
   Nur nötig, wenn neue Stadien in stadien.js dazukommen:
     NODE_USE_ENV_PROXY=1 node scripts/stadionbilder.mjs            (nur fehlende)
     NODE_USE_ENV_PROXY=1 node scripts/stadionbilder.mjs --alle     (alle neu)        */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data", "stadionbilder");
const UA = "fuppes/1.0 (personal football page; static site)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function json(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    const r = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(20000) });
    if (r.status === 429) { await sleep(5000 * (i + 1)); continue; }
    if (!r.ok) throw new Error(`${r.status} ${url}`);
    return r.json();
  }
  throw new Error("429 " + url);
}
const q = (base, params) => `${base}?${new URLSearchParams({ format: "json", ...params })}`;
const words = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !["stadion", "stadium", "arena", "park"].includes(w));
const strip = (h) => String(h || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

async function lookup(stadium, city) {
  const s = await json(q("https://de.wikipedia.org/w/api.php", { action: "query", list: "search", srsearch: `${stadium} ${city}`, srlimit: "3" }));
  const want = words(stadium);
  const hit = s.query.search.find((h) => !want.length || words(h.title).some((w) => want.includes(w))) || (want.length ? null : s.query.search[0]);
  if (!hit) return null;
  const p = await json(q("https://de.wikipedia.org/w/api.php", { action: "query", prop: "pageprops", titles: hit.title }));
  const qid = Object.values(p.query.pages)[0]?.pageprops?.wikibase_item;
  if (!qid) return null;
  const e = await json(`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`);
  const files = (e.entities[qid].claims.P18 || []).map((c) => c.mainsnak?.datavalue?.value).filter((f) => f && !/logo|schild|wappen|\.svg$/i.test(f));
  if (!files.length) return null;
  const ii = await json(q("https://commons.wikimedia.org/w/api.php", { action: "query", titles: "File:" + files[0], prop: "imageinfo", iiprop: "url|extmetadata", iiurlwidth: "960" }));
  const info = Object.values(ii.query.pages)[0]?.imageinfo?.[0];
  if (!info?.thumburl) return null;
  const md = info.extmetadata || {};
  return {
    img: info.thumburl,
    page: info.descriptionurl,
    artist: strip(md.Artist?.value).slice(0, 80),
    license: strip(md.LicenseShortName?.value),
    article: `https://de.wikipedia.org/wiki/${encodeURIComponent(hit.title.replace(/ /g, "_"))}`,
  };
}

// stadien.js ist ein Browser-Skript: mit einem Fake-window auswerten
const win = {};
new Function("window", await readFile(join(ROOT, "stadien.js"), "utf8"))(win);
const all = new Map();
for (const [st, city] of [...Object.values(win.FUPPES_STADIEN), ...Object.values(win.FUPPES_NT_ORTE)]) all.set(st, city);

let old = {};
try { old = JSON.parse(await readFile(OUT + ".json", "utf8")).bilder || {}; } catch (_) {}
const redo = process.argv.includes("--alle");
const bilder = {};
for (const [st, city] of all) {
  if (!redo && old[st]) { bilder[st] = old[st]; continue; }
  try { bilder[st] = await lookup(st, city); } catch (e) { console.warn("⚠", st, e.message); bilder[st] = old[st] ?? null; }
  console.log(bilder[st] ? "✓" : "–", st);
  await sleep(1200);
}
const data = { updated: new Date().toISOString(), bilder };
const out = JSON.stringify(data, null, 1);
await writeFile(OUT + ".json", out + "\n");
await writeFile(OUT + ".js", `window.FUPPES_DATA = window.FUPPES_DATA || {};\nwindow.FUPPES_DATA["stadionbilder"] = ${out};\n`);
console.log(`${Object.values(bilder).filter(Boolean).length}/${all.size} Stadien mit Bild`);
