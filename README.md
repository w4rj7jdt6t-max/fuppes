# fuppes

Meine persönliche Fußballseite. Sechs Bereiche als Tabs:

0. **Home** – Monatskalender mit FC-Spielen, Länderspielen, Europapokalspielen deutscher Klubs und den Vorverkaufsstarts im FC-Ticketshop (inkl. Kontingent und Sonderphasen wie 20+ / U25)
1. **Effzeh** – nächstes Spiel mit Countdown, Tabellenausschnitt, Form, Torschützen, Spielplan (Bundesliga + DFB-Pokal)
2. **Nationalelf** – Länderspiele und Nations-League-Gruppe
3. **Bundesliga** – Tabelle, Spieltage zum Durchblättern, Torjäger
4. **Europapokal** – Champions League, Europa League, Conference League (Ligaphase, deutsche Klubs)
5. **Topligen** – Premier League live, Links zu LaLiga, Serie A, Ligue 1, Eredivisie

Reines HTML/CSS/JS ohne Build-Schritt.

## Datenquellen

| Was | Quelle | Wie |
| --- | --- | --- |
| Spiele, Tabellen, Torjäger | [OpenLigaDB](https://www.openligadb.de) | live im Browser |
| FC-Vorverkaufsstarts | offizieller FC-Kalender „Vorverkäufe abonnieren“ (calovo) | `scripts/update-data.mjs` → `data/vorverkauf.json` |
| Transfers & Personal (FC) | kicker-Teamfeed, GEISSBLOG, Google News | `scripts/update-data.mjs` → `data/news-fc.json` |
| Transfer-Radar | Transfermarkt, kicker, Google News; gefiltert auf Top-Klubs oder Ablöse ≥ 20 Mio. € | `scripts/update-data.mjs` → `data/transfers.json` |

Kalender und News-Feeds erlauben keinen direkten Abruf aus dem Browser (CORS). Deshalb holt das Skript sie ab und legt sie
als JSON in `data/`. Die Liste der Top-Klubs und die Mindestablöse stehen oben im Skript.

    node scripts/update-data.mjs

Auf GitHub erledigt das `.github/workflows/update-data.yml` automatisch alle zwei Stunden.

## Lokal starten

    python3 -m http.server 8000

Dann http://localhost:8000 öffnen.

## Online stellen

Den Ordner auf einen beliebigen statischen Hoster legen (GitHub Pages, Netlify, Cloudflare Pages).
