# Endlos-Quiz Koop

Raum eröffnen, Code/Link teilen, gleiche Fragen für alle, 15 s pro Frage. Sobald alle geantwortet haben (oder die Zeit abgelaufen ist), wird aufgedeckt: richtig/falsch pro Spieler, Punkte, Zwischenstand. „Weiter“ klickt ein beliebiger Spieler.

## Deployment (Vercel)
1. Repo anlegen und pushen (oder `vercel` im Projektordner).
2. Vercel-Projekt → Storage / Marketplace → **Upstash Redis** hinzufügen und mit dem Projekt verbinden. Das setzt `KV_REST_API_URL` und `KV_REST_API_TOKEN` (alternativ `UPSTASH_REDIS_REST_URL`/`_TOKEN`).
3. Neu deployen. Fertig, keine npm-Pakete nötig.

## Lokal
`npm run dev` → http://localhost:3000 (In-Memory-Store, ohne Redis; nur ein Prozess). Tests: `npm test`, `node test/timeout.js`.

## Aufbau
- `public/index.html` – gesamter Client (Start, Lobby, Spiel, Endstand), pollt `/api/state` alle 0,8 s.
- `api/room.js` – POST-Aktionen: create, join, start, answer, next, again.
- `api/state.js` – GET Spielzustand; deckt lazy auf (alle geantwortet oder Zeit um).
- `lib/game.js` – Spiellogik, Punkte, Fragenauswahl. `lib/store.js` – Redis über REST. `lib/questions.json` – 4225 Fragen (nur serverseitig, Lösungen gehen erst beim Aufdecken an die Clients).

## Regeln
- 10/15/20 Fragen, Schwierigkeit steigt von Stufe 2 bis 8, Kategorien wechseln.
- Punkte: richtig = 100 + 15·(Stufe−1) + bis zu 60 Schnelligkeitsbonus; falsch/keine Antwort = 0.
- Max. 8 Spieler, Beitritt nur in der Lobby, Räume laufen nach 6 h ab.
