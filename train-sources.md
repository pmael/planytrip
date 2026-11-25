# Trip Manager — Train data sources in Europe

> Companions: [architecture.md](./architecture.md) · [task.md](./task.md)
> Written 2026-10-24. Goal: get Trainline-like train data for France **and** the rest of Europe, without a manual "add a train" form and without getting past CAPTCHAs or bot walls.

---

## What was actually tested (2026-10-24, from the Mac, residential connection)

The research below was written without being able to call any endpoint. Each source was then called once or twice with a plain `User-Agent`, on the real trip date (Friday 4 December 2026). **Where this section and the tables below disagree, this section is right.**

| Source | Result | Consequence |
|---|---|---|
| Deutsche Bahn | **Blocked**: `OPS_BLOCKED` / `Forbidden` on the very first request, on all three profiles | Excluded. The library's own readme warns of "haphazard blocking". Not retried, no other profile or header tried after the three documented ones |
| ÖBB shop API | **Blocked**: an "Access temporarily restricted" page | Excluded |
| **Transitous** (MOTIS 2, `api.transitous.org/api/v6/plan`) | **Works, no key.** Real timetables for 4 Dec 2026 for France, Switzerland, Germany, Czechia, Spain, Italy, with train type, operator and changes. Toulouse → Lyon matched the SNCF Connect screenshot to the minute (07:37, 15:42, 17:43). `withFares` returns nothing | **Replaces `db-vendo-client` as step 1** for every country. Also makes the SNCF API token unnecessary: Transitous already carries SNCF's timetable |
| **RegioJet** (`brn-ybus-pubapi.sa.cz/restapi`) | **Works, live prices** (Prague → Vienna: trains from 13.90 €, buses 19.90 €). Its trains are **not** in Transitous | Own adapter: its own journeys and prices |
| **Trenitalia** (`lefrecce.it`, `ticket/solutions`) | **Works, live price per solution** (Milano Centrale → Roma Termini: 64.90 to 74.90 €) | Price source for journeys that are entirely Trenitalia's |
| SNCF open fare dataset | **Works**, 36,000 rows, TGV INOUI / OUIGO. Toulouse ↔ Lyon Part-Dieu, 2nd class, normal fare: **25.50 to 101 €** (the real fares of 4 Dec were 49.50 to 101 €) | Price **range** for French high-speed trains, shown as an estimate |
| SNCF open GTFS (`export-opendata-sncf-gtfs.zip`) | Reachable but **ends on 30 June 2026**, so useless for December | Not used |
| FlixBus | Works; FlixTrain rides come with it | Kept as is |
| Not tested | OJPFare (needs a free key), Italo, Renfe, Eurostar, České dráhy | Later, see "Not built yet" in [task.md](./task.md) T7.8 |

Things that still apply from the rules below: no CAPTCHA, no challenge page, nothing forged. A source that answers like a wall is marked blocked for the rest of the search and never retried around.

**Transitous' conditions** (https://transitous.org/api/): the project must be open source and non-commercial; every request carries a `User-Agent` with the application name and a contact; a visible link to https://transitous.org/sources/ is required; and they ask to be contacted before routing is used in volume. This app asks them for one route search per origin, destination and day, kept a day.

---

## What was built (task.md T7.8)

The plan below changed in two places after testing, and is otherwise followed:

- **Step 1 is Transitous, not `db-vendo-client`**. It gives the timetables of the whole of Europe, SNCF's included, so no SNCF API token is needed either.
- **Step 2 keeps what answered**: Trenitalia (live), RegioJet (live, its own journeys), SNCF's fare range (estimate, France), FlixBus (existing). ÖBB and DB are out; OJPFare (Switzerland) needs a key and is not built.
- **Step 3 is an estimate, not "price unknown"**: a train no source prices gets a rate per kilometre (`config.trains.distanceEstimate`, 0.15 €/km between Milano–Roma and Toulouse–Lyon fares seen on 4 Dec 2026), marked `estimated`, so the budget and the ratings still work and the person is told. `priceKind` is `live` or `estimated`; there is no `unknown`.
- **No manual form**: everything is found by the worker.

Files and rules: [task.md](./task.md) T7.8.

---

## SNCF Connect through the person's Chrome (2026-11-10)

pael chose to read SNCF Connect's own prices with a Python client that runs inside their already-open Chrome (`tools/sncf-api/api_client.py`). This differs from the rule above: the requests are automated, but they go through a real session that DataDome has already let in, and nothing is forged. The plan has five steps:

1. **Done.** `tools/sncf-api/fetch_day.py ORIGIN DEST DATE` prints one day of trains as JSON. It never launches a browser of its own.
2. **Done.** `src/scrapers/transport/sncf-connect-day.ts` runs it as a separate process (`uv run`, else `python3`; `config.trains.sncfConnect`), one run at a time. It checks the output with zod and turns the script's error `kind` into the matching scraper error: `browser`/`no-place` → unavailable, `blocked` → blocked, `changed` → changed.
3. **Done, then changed on 2026-11-12: SNCF Connect is the source of the trains, not only of their price.** At first it was a `FareSource` that priced Transitous' journeys by matching each to the SNCF train with the same stations, minutes and changes. That left Transitous journeys SNCF does not sell (Paris 09:00 via Lyon and Montpellier) and failed matches estimated, and the cheapest pick could be a guess. pael asked for the right price on the right time, so now, while the switch is on, `trains.ts` asks `sncf-connect.ts` first:
   - **Two runs per search:** the places as typed (`placeName`: "Paris, France" → "Paris"), there on the first day, back on the last. Each day is cached for a day (`trains|PARIS|TOULOUSE|date`; a day with no train is not kept). The way back is not asked when the way there has nothing to offer.
   - **Its trains are the options:** SNCF's own stations, times, changes and prices (`toJourney`). Stations are placed by their UIC number in SNCF's open list of stations, for the transfer to the stay and to leave out a train stopping more than `maxStationDistanceKm` from it. A station abroad is placed at the end of the way it is at (no transfer counted).
   - **Chosen as the timetable's are** (`select`: changes, duration ratio, `maxOptions`), plus the cheapest train with seats however slow; the way back is the cheapest with seats among all of them. Two coupled trains listed under both numbers (17:06 TGV INOUI 8517 and 12267) are offered once.
   - **Nothing is guessed:** a train with no price (sales not open yet) is left out; a full one is shown sold out, with an estimate.
   - **Transitous only as a fallback:** when the switch is off, Chrome is closed, SNCF turned us away, a place is unknown, or a way has no priced train (a day not on sale yet), the search goes on with Transitous, Trenitalia, the published range and the estimates as before. Why SNCF Connect was not used is kept in the options' `fareProblems`. SNCF Connect is no longer one of the `fares`.
   - Checked for real on 2026-11-12: Paris → Toulouse, 22 → 26 Dec, 11 options in 31 s, all live (06:28 Intercités 91 € + 10:27 back 63 €, as on SNCF's page); the 11:06, "Fully booked" on SNCF, sold out.
   - **Price:** second class, rounded; first class with a note when only first class is left.
   - **Fixed 2026-11-11, found on the first real run:**
     - Every search to Nantes failed with an HTTP 500. The client's built-in `STATIONS["NANTES"]` id (`CITY_FR_2990969`) is not SNCF's (`CITY_FR_6434483`). `fetch_day.py` now always resolves places through SNCF's autocomplete. Lille, Strasbourg, Nice and Rennes in that list have ids of the same kind and are unverified.
     - The client swallowed the failed page and returned `[]`, which passed as "no train". A failed page is now an error.
     - SNCF says "not bookable" both for "Complet" and for "En vente prochainement" (sales not open yet). The script now outputs an `availability` field (`bookable | sold-out | not-on-sale | unavailable`). Only `sold-out` becomes Sold out; `not-on-sale` is estimated.
   - **Fixed 2026-11-12:** the client read through the SNCF Connect tab the person already had open. When they browsed in it during a search, the page went away (`TargetClosedError`), and the way back of Paris → Toulouse stayed estimated. `fetch_day.py` now opens a tab of its own behind the person's and closes it at the end, even on failure. A tab lost halfway is asked again once in a new tab. After that it is reported as kind `error` ("Chrome lost the SNCF Connect tab" / "Chrome has no internet connection"), not `browser`: Chrome is there, and the next recompute can try again.
   - **Sold-out trains:** a full train ("Complet") is answered `SoldOut`. `trains.ts` still prices it with the next sources and marks the option `sold_out`. A way back with seats is preferred when pairing. The card shows "Sold out"; the picks (R3, most practical) skip it while another option is left; the rules rate it bad; the AI is told `soldOut: true`.
   - **Failures:** a place SNCF does not know is remembered as nothing. Any failure sends the search to Transitous (step 3). After SNCF turns a request away, it is not asked again for `blockedCooldownMs` (30 min).
4. **Done.** It sits in `createRealTrainsAdapter`'s `fares` between Trenitalia and SNCF's published range, and asks only while the setting is on.
   - **The setting:** `config.trains.sncfConnect.enabled` is `false`. The person's choice is saved in `data/settings.json` (`server/appSettings.ts`), which the worker reads on each search, so a change counts from the next search without a restart.
   - **The switch:** under "Where trains come from" on the Settings page, through `GET`/`PUT /api/settings/sncf-connect` (same-origin only). It also says whether Chrome's remote debugging is on.
   - **Where it works:** only while the app runs on the Mac where Chrome is open, not in Docker or on a server. Fares already found are not changed: recompute.
5. Not built, on purpose (2026-11-11): feeding the prices it reads to the price model. The prices already go straight into the options. It would only help the searches SNCF Connect does not answer (Chrome closed, dates not on sale yet), and would first need a decision on mixing automatic rows with the extension's, and on what counts as a session.

---

## TL;DR

1. **No single free source replaces Trainline.** Trainline, SNCF Connect, Omio and Rail Europe all sit behind bot protection or sell B2B access only.
2. **Timetables are solved for all of Europe.** Deutsche Bahn's journey planner covers long-distance trains across most of Europe, with changes, operator and train type. Transitous and national APIs are backups.
3. **Live prices exist for a good part of Europe through operators' own JSON APIs, with no CAPTCHA:** Deutsche Bahn (Germany and many cross-border routes), Trenitalia (Italy), ÖBB (Austria), RegioJet (Czechia, Slovakia, Austria, Hungary), FlixTrain and Switzerland (official, beta).
4. **No clean live price for France, Spain (Renfe) or Eurostar.** France keeps the SNCF plan already proposed. Spain and Eurostar get real timetables, an estimated or missing price, and a "check the price" link.
5. Most price sources are **unofficial**. No wall to bypass, but no permission either: fine for a local personal app with caching and slow request rates, not for a public product.

---

## Ground rules used here

- **Clean** = an official API, an open dataset, or a JSON endpoint that answers a normal request from a home connection, with no CAPTCHA, no challenge page and no bot-protection cookie to forge.
- **Not clean** = anything that needs solving a CAPTCHA, forging DataDome/Akamai/PerimeterX tokens, or rotating proxies to avoid blocks. Excluded.
- **Runtime rule for every adapter:** if a response looks like a challenge (HTTP 403/429 with an HTML body, a `datadome` cookie, a CAPTCHA page), the adapter stops, marks the source `blocked` for the run, and the card shows "price unavailable" with a link. It never retries around the block.
- The app runs on pael's Mac. That matters: Trenitalia's API reportedly refuses datacenter IPs, so it works locally but would fail from a cloud server.
- I could not call any of these endpoints from my sandbox, so the statuses below come from library docs and published notes, not from my own test. Each adapter should start with a one-route smoke test.

---

## Comparison by source

### Pan-European timetables (no prices or partial prices)

| Source | Coverage | What it gives | Prices | Access & cost | Clean? |
|---|---|---|---|---|---|
| **Deutsche Bahn via [`db-vendo-client`](https://www.npmjs.com/package/db-vendo-client)** | Germany fully; long-distance and many regional trains across most of Europe (FR, IT, AT, CH, BE, NL, CZ, PL, DK…) | Journeys with legs, times, delays, platforms, train numbers, operator, changes, station search | **Yes for what DB sells**. Pure-foreign routes usually come back without a price | Free, no key. ~60 requests/min per IP. Node library, MIT-style open source | Yes (no CAPTCHA). Unofficial: the readme says DB's permission is strictly required |
| **[Transitous](https://transitous.org/api/)** | Europe-wide from official GTFS feeds | Routing with changes, times, operators, realtime where available | No | Free. Must be open-source and **non-commercial**, send a User-Agent with contact, show attribution, and contact them before heavy routing use | Yes. Usable for a personal open-source project; ask first |
| **National GTFS feeds** | Per country | Static timetables | Rarely (Renfe's GTFS has no fares) | Free open data | Yes. Heavy to self-host; the SNCF file stopped at 30 June 2026 when checked |

### France

| Source | What it gives | Prices | Access & cost | Clean? |
|---|---|---|---|---|
| **SNCF API** (`api.sncf.com`, Navitia) | Real departures, times, duration, changes, train type, connections | No | Free token, historically ~3,000–5,000 req/day (current quota unverified) | Yes, official |
| **[SNCF fare dataset](https://www.data.gouv.fr/datasets/tarifs-tgv-inoui-et-ouigo)** | Min/max 2nd-class fare per station pair, TGV INOUI and OUIGO only | **Range only**, no TER/Intercités | Free, ODbL | Yes, official |
| SNCF Connect, Trainline | Everything, live prices | Yes | DataDome bot protection ([SNCF's own case study](https://datadome.co/customers-stories/sncf-connect-tech-reduces-scraping-related-costs-carbon-footprint-with-datadome/)) | **No** |
| DB (`db-vendo-client`) | French TGV/ICE cross-border trains (Paris–Frankfurt/Stuttgart/Munich…) | Yes on routes DB sells | See above | Yes |

**Verdict:** no clean live price for domestic French trains. Keep the earlier plan.

### Germany

| Source | What it gives | Prices | Access | Clean? |
|---|---|---|---|---|
| **DB via `db-vendo-client`** | Everything Trainline shows for DB | **Yes, live** (Sparpreis, Flexpreis, cheapest of the day with `bestprice`) | Free, ~60 req/min | Yes (unofficial) |
| DB API Marketplace (official) | Station data, departure boards | No | Free key | Yes, official, but no journeys/prices |
| FlixTrain | Times + prices | **Yes** | Already in the FlixBus adapter | Same as current adapter |

### Italy

| Source | What it gives | Prices | Access | Clean? |
|---|---|---|---|---|
| **Trenitalia "Le Frecce" API** | Solutions with legs, times, changes, train category | **Yes, live per solution** | No key, no login. [Reportedly refuses datacenter IPs](https://anythingmcp.com/it/guides/trenitalia-to-mcp), fine from a home connection | Yes (unofficial, no CAPTCHA reported) |
| Italo | Times + prices | Yes | Unofficial. Scrapers [mention blocked requests and residential proxies](https://apify.com/studio-amba/italo-scraper) | **Uncertain.** Try once from the app's normal browser; drop it if a challenge appears |

### Austria

| Source | What it gives | Prices | Access | Clean? |
|---|---|---|---|---|
| **ÖBB ticket shop API** (`shop.oebbtickets.at`, used by [`juliuste/oebb`](https://github.com/juliuste/oebb)) | Journeys with prices, incl. Nightjet and cross-border | **Yes** | Anonymous session token, no key. Library is old (~2020), endpoints may have moved | Yes, unofficial; readme asks to request permission for production |
| ÖBB HAFAS (`oebb-hafas`) | Timetables | No | Free | Yes |
| DB (`db-vendo-client`) | Many Austrian routes, with DB prices for cross-border | Partial | See above | Yes |

### Czechia, Slovakia, Hungary (and Vienna, Budapest)

| Source | What it gives | Prices | Access | Clean? |
|---|---|---|---|---|
| **RegioJet public API** (`brn-ybus-pubapi.sa.cz/restapi`, listed as a [public API](https://publicapis.io/transport-for-czech-republic-api)) | Routes, times, seat availability, train and bus | **Yes, live** | No key | Yes |
| České dráhy (cd.cz) | Times + prices | Yes | Not checked | Not evaluated |

### Switzerland

| Source | What it gives | Prices | Access | Clean? |
|---|---|---|---|---|
| **opentransportdata.swiss — OJP** | Journeys, changes, operators, realtime | No | Free API key (registration) | Yes, official |
| **[OJPFare (beta)](https://opendata.swiss/en/dataset/beta-preisauskunft-uber-ojpfare-fur-den-ov-schweiz)** | Ticket price for a journey | **Yes, but "experimental"** | Same portal | Yes, official |
| `transport.opendata.ch` | Simple Swiss timetables | No | Free, no key | Yes |

### Spain

| Source | What it gives | Prices | Access | Clean? |
|---|---|---|---|---|
| **Renfe GTFS** (data.renfe.com, long distance + Cercanías; [`renfe-cli`](https://pypi.org/project/renfe-cli) uses it) | Static timetables | No fares in the feed | Free open data | Yes, official |
| renfe.com | Live prices | Yes | Scrapers [say Renfe "may block automated access"](https://apify.com/studio-amba/renfe-scraper) and use Spanish residential proxies | **No** (or at best uncertain) |
| Ouigo España, Iryo | Live prices | Yes | Not checked | Not evaluated |

**Verdict:** real timetables, no clean live price. Show "price unknown" plus link, or a static estimate if we build one.

### Eurostar, UK, Benelux

| Source | What it gives | Prices | Access | Clean? |
|---|---|---|---|---|
| Eurostar booking API | Times + prices | Yes | Scrapers say ["Eurostar.com has bot protection"](https://apify.com/studio-amba/eurostar-scraper), residential proxies recommended | **No** |
| DB (`db-vendo-client`) | Eurostar/Thalys timetables, Brussels/Amsterdam–Germany prices | Partial | See above | Yes |
| UK (National Rail) | Darwin/OpenLDBWS timetables | No (fares feed needs a licence) | Free registration | Yes, but out of scope for now |

### Aggregators and B2B APIs

| Source | Why not |
|---|---|
| Trainline (site and Partner Solutions) | DataDome on the site; partner API is B2B under contract |
| Omio | [Affiliate programme](https://www.omio.co.uk/affiliate) gives deep links and commission, not a search API; [B2B](https://omio.com/corporate/omio-b2b/) is contract only |
| Rail Europe, Distribusion, SilverRail | B2B for travel agencies, paid, contract |
| Paid scrapers (Apify actors for SNCF, Renfe, Italo, Eurostar) | Cost money and do the bot-wall work for you on residential proxies: same terms-of-service problem we ruled out |

---

## Recommended combination for the app

One train adapter per **price source**, all fed through the existing `throttle.ts` and `cache.ts`. They are plain JSON calls from the worker, so Playwright is not needed for trains.

| Step | Source | Role |
|---|---|---|
| 1. Find journeys | `db-vendo-client` | Default for every route in Europe: times, legs, changes, operator, train type |
| 2. Price by country | DB `bestprice`/`tickets` | Germany + DB-sold international routes |
|  | Trenitalia Le Frecce | Routes in Italy |
|  | ÖBB shop API | Austria, Nightjet |
|  | RegioJet API | CZ / SK / AT / HU where RegioJet runs |
|  | OJPFare (beta) | Switzerland |
|  | FlixBus adapter (existing) | FlixTrain |
|  | SNCF API + fare dataset | France: real departures, **estimated** range |
| 3. No clean price | Renfe, Italo (if blocked), Eurostar, Ouigo/Iryo, TER | Card shows the real train with "price unknown" or the estimate, plus "check the price on <operator>" link opened in pael's own browser. **Since 2026-10-26, Eurostar and Iryo also have a real price when pael has the page open and clicks the extension** (it reads what the tab shows; nothing is requested from those sites): the card shows "vu sur Eurostar il y a 2 h" for a day |
| Backup timetables | Transitous, SNCF API, Swiss OJP | If DB doesn't know a route or rate-limits |

How the price is chosen: for each journey from step 1, the worker looks at the operator(s) of the legs and calls the matching price adapter. If several apply, it takes the first one that returns a real price. Each card carries `priceKind: "live" | "estimated" | "unknown"` and the AI is told which one it is, so budget maths stays honest.

### Suggested build order

1. `db-vendo-client` journeys + DB prices.
2. Trenitalia, then RegioJet.
3. SNCF API + fare range (France).
4. ÖBB, OJPFare.
5. Try Italo once; keep only if it answers without a challenge.

### Open points

- All endpoints need a smoke test from pael's Mac.
- Unofficial APIs can change or close without notice; each adapter should fail soft to "price unknown".
- The DB, ÖBB and Trenitalia endpoints are used without the operators' explicit permission. Acceptable for a local personal tool with caching and low request rates; would need agreements before any public release.
