# Trip Manager → price import (SNCF Connect, Eurostar, Iryo)

A Chrome extension (Manifest V3) that adds a **→ Trip Manager** button to the results pages of **SNCF Connect**, **Eurostar** and **Iryo**. When you click it, it reads the trains and prices **already displayed in your tab**, shows a preview, and on **Envoyer** posts them to `http://localhost:3000/api/price-observations`.

It sends nothing to those sites, opens no page and clicks nothing. You do the search yourself, as usual.

The folder is still called `sncf-import`, so that Chrome keeps the extension you already loaded: only reload it.

## Install

1. `chrome://extensions` → turn on **Developer mode** → **Load unpacked** → pick this folder (`extension/sncf-import`). Already loaded? Click ⟳ on its card, then **refresh the tabs** of the sites (a tab opened before the reload keeps the old script, and its button says "Envoi…" for ever).
2. Run Trip Manager (`npm run dev`).
3. Search a trip, **for 1 adult** (see below), on sncf-connect.com, eurostar.com or iryo.eu, scroll to load the trains you want, click **→ Trip Manager**, check the preview, then **Envoyer**.
4. Do the same for the way back: a price is shown as "vu sur Eurostar" (or SNCF Connect, Iryo) on a card once both ways were seen. Then look at **Settings → Fiabilité des prix**.

The more different routes and days you capture, the better the estimates get. A page read twice at different times counts twice: prices move.

## Where it runs

| Site | Pages (`manifest.json`) | Files, in the order they load |
|---|---|---|
| SNCF Connect | `https://www.sncf-connect.com/*` | `sncf-parser.js`, `site-sncf.js`, `content.js` |
| Eurostar | `https://www.eurostar.com/search/*` (every market: `fr-fr`, `uk-en`…) | `eurostar-parser.js`, `site-eurostar.js`, `content.js` |
| Iryo | `https://iryo.eu/*/booking/*` (`/es/`, `/en/`, `/ca/`) | `iryo-parser.js`, `site-iryo.js`, `content.js` |

| File | Role |
|---|---|
| `manifest.json` | The pages above; may call `localhost:3000` |
| `*-parser.js` | **Pure** parsers, no DOM: what a page shows → `{direction, origin, destination, date, offers[]}`. Loadable from Node, so tested |
| `site-*.js` | How each page is read: which elements hold the rows, the fares, the day. Sets `TripManagerSite` |
| `content.js` | The button, the preview, the send. The same for every site |
| `background.js` | Does the POST; only for this extension's own script |

The parsers are tested by `tests/sncf-parser.test.ts`, `tests/eurostar-parser.test.ts` and `tests/iryo-parser.test.ts`: SNCF's on text of real cards, the two others on **what `site-*.js` read on the real saved pages** (`tests/fixtures/eurostar/real-page.json`, `tests/fixtures/iryo/real-page.json`), and the extension's rules by `tests/sncf-extension.test.ts`. `tests/price-observations-sellers.test.ts` takes those two real pages through the app's own validation, import, matching and the price on the card.

## Payload sent to the app

```json
{
  "source": "eurostar",
  "pageUrl": "https://www.eurostar.com/search/fr-fr?adult=1&…",
  "capturedAt": "2026-10-26T12:00:00.000Z",
  "direction": "out",
  "origin": "Paris",
  "destination": "Londres",
  "date": "2026-10-30",
  "offers": [
    {
      "departTime": "07:05", "arriveTime": "08:30",
      "departStation": "Paris Gare du Nord", "arriveStation": "Londres St Pancras Int'l",
      "durationMin": 145, "changes": 0, "trainType": "EUROSTAR",
      "price2ndEur": 135, "price1stEur": 180, "seatsAtPrice": [27],
      "rawText": "ES 9007 · 07:05 → 08:30 · 2 h 25 · Direct · Standard 135 € · Plus 180 € · Premier 325 € (27 places)"
    }
  ]
}
```

`source` is `sncf-connect`, `eurostar` or `iryo`. The app answers `{ saved, matched, duplicates, skipped }`, or a 400 with a message in French that the preview shows, or a 403 for anything that is not this extension on this machine.

`price2ndEur` is the price of the cheapest class, `price1stEur` the price of the one above it (the app only stores it):

| Site | `price2ndEur` | `price1stEur` | Not sent as a price (kept in `rawText`) |
|---|---|---|---|
| SNCF Connect | Seconde classe | Première classe | |
| Eurostar | Eurostar Standard | Eurostar Plus (else Premier) | Premier |
| Iryo | Inicial | Infinita | Infinita Bistró |

## For 1 adult

The prices the app learns from are those for one adult. The preview says who the page was searched for ("Voyageurs: 1 adulte") and warns when it is anything else, since a page may show a total for the group. Not sent: it is only shown.

## What each page looks like

### Eurostar (checked on a saved copy of Paris → Londres, 30 October 2026, 19 trains)

- A train is `[data-testid="search-results-outbound-item"]`; its details are in `…-journey-details`, its three fares are `…-tab` buttons, one per class, each with its price, its seats left ("27 places restantes") and, hidden, its class.
- **The day, the times and the train number are in the ids**: `data-e2e="9007-2026-10-30-07:05-08:30-tab-0-panel"` = train 9007, 30 October 2026, 07:05 → 08:30. The page's header gives no year, so the date is read there.
- The stations are in the details that open under the fares (hidden but in the page): `Paris Gare du Nord`, `Londres St Pancras Int'l`. The duration is the page's own (2 h 25), not the difference of two local times: Paris and London are an hour apart.
- The title `Paris → Londres (voyage aller)` gives the trip (the arrow is drawn, not text).
- Prices are whole euros. A fare with no price (sold out, "Non disponible") has no price: a train with no Standard price is not stored. A page in pounds or dollars (Eurostar's UK and US sites; not seen, tried on the saved page with its € turned into £) has trains but no price in euros: the preview says so and does not send.

### Iryo (checked on a saved copy of Madrid → Valencia, 31 October 2026, 7 trains)

- A train is a row `.ilsa-schedule__row[data-qa="select-travel-outSchedule-row_0"]`; its cells are the fares, one per comfort zone (Inicial, Infinita, Infinita Bistró, in the header row).
- **Each cell shows two prices when a cut applies: the original, struck through (`…__price--original`), and the one to pay.** The price kept is the one to pay (41,30 € and not 43,47 €).
- The row gives the departure station ("Madrid-Chamartin") and leaves the arrival blank: it is taken from the search's summary when it names one station, and not when it says "all stations".
- The day is the tab that is showing ("31 Octubre"), the year comes from the address (`travels=[{"direction":"outbound","departure":"2026-10-31"},…]`) when it agrees. The summary says `MADRID - VALENCIA` in capitals, written as names; for the way back the trip is turned round.
- All the trains seen were direct: a row is read as direct unless its text says it has a connection.

## Known limits

- **The way back was not seen on Eurostar or Iryo**, only the way there. The readers look for the same things under their other names (`search-results-inbound-item` on Eurostar, the second tab and `inSchedule` rows on Iryo): this was run on the saved pages edited to look so, not on the real pages. If a way back reads wrong, save the page ("Webpage, Complete") and the parser is corrected from it.
- **Iryo is read in the layout of a wide window.** The page draws another one for a narrow window (below 1024 px) that was not saved; there, the preview says no train was recognised. Widen the window.
- Eurostar trains with a change, and Iryo trains with a connection, were not seen; they are read from their words ("1 changement", "conexión") and are `MIXED`.
- A site that changes its page needs its reader corrected (`site-*.js` for where things are, `*-parser.js` for what they say). The raw read is logged in the console (`[Trip Manager] raw page`, `raw cards` on SNCF): paste it into the parser's test to see what went wrong.
- Matching a train with the app's own search depends on how the timetable spells the stations (`core/stations.ts` knows "Londres St Pancras Int'l" is "London St Pancras International"). A price that is not matched is still kept, and teaches the accuracy page.
- SNCF Connect: see the next section.

## SNCF Connect

What the real page looks like (checked on a saved copy of Toulouse → Marseille, 30 October):

- A result row is `li[data-test="proposal-card"]`; its summary is `[data-test="trip-info"]` inside. `site-sncf.js` reads those, and falls back on the text patterns if SNCF drops the markers.
- **The type of train is not in the summary**: the logo is an unnamed SVG. It is in the row's visually hidden `<h3>`: "INTERCITES Départ de Toulouse Matabiau 06:43 à destination de …". A journey with changes is titled "Trajet en correspondance" (no type: it is MIXED).
- The day is in the selected day tab (`[aria-pressed="true"] abbr[title]` = "vendredi 30 octobre 2026", with the year); the header only says "vendredi 30 octobre".
- A fare is "Seconde classe" / "Première classe" then the price; "dès60 €" (no space) when seats are not counted, "-" when the class is not sold. Opened rows add their own fare details below: they are not read.
- "Afficher le jour précédent" / "Afficher les trajets suivants" may bring other days into the list: the preview warns when the departure times stop rising, since every train is sent with the one date of the page. (Not checked on a page that does it.)
- Times are read as `07:37`. A page that wrote `7h37` would show no train. "Dès" = the cheapest fare still on sale, which is exactly what the estimate should predict.
- Some cards carry no type of train in their text; the preview shows `?` for them, and the logo hint that is sent with each train tells how to recognise them.

History of the first version: the preview is no longer read as trains on a second click; fares are read by their labels; TER and night trains are recognised; the card's logo hints are sent as `logoHint`. The parser's two first bugs were fixed.
