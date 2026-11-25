# SNCF Connect Train Search API Client

Reverse-engineered Python client for the SNCF Connect BFF API.  
Fetches **all trains for a full day** between any two French cities/stations.

---

## Quick start

```bash
pip install playwright pytz
playwright install chromium
python api_client.py
```

> **Requirement:** Google Chrome must be running on your Mac/Linux before you run the script. The client connects to Chrome via CDP and uses its DataDome-verified session, so no manual cookie setup is needed.

---

## How it works

| Layer | What happens |
|-------|-------------|
| **Chrome CDP** | Playwright detects the running Chrome via `~/Library/Application Support/Google/Chrome/DevToolsActivePort` and connects to it |
| **Page context** | API calls are executed via `page.evaluate()` as browser `fetch()` requests — DataDome sees a real browser and passes them |
| **Pagination** | The SNCF BFF returns ~8 proposals per call; the client loops from midnight to midnight, advancing the cursor by 1 minute after the last departure, deduplicating by `travelId` |

---

## APIs discovered

### 1. POST `/bff/api/v2/autocomplete`

Station/city name search.

**Request:**
```json
{
  "searchTerm": "Lyon",
  "resultTypes": ["PLACE"],
  "recentSearchTypes": ["ORIGIN", "ITINERARY"]
}
```

**Response:** `places[].results[]` — list of location objects with `label`, `galileoId`, `codes`.

---

### 2. POST `/bff/api/v1/itineraries`

Train search.

**Request:**
```json
{
  "schedule": {
    "outward": { "date": "2026-11-10T05:00:00.000Z", "arrivalAt": false }
  },
  "mainJourney": {
    "origin":      { "label": "Paris", "id": "CITY_FR_6455259", "codes": [{"type":"RESARAIL","value":"FRPAR"}], "geolocation": false },
    "destination": { "label": "Lyon",  "id": "CITY_FR_6454573", "codes": [{"type":"RESARAIL","value":"FRLYS"}], "geolocation": false }
  },
  "passengers": [{ "id": "<uuid>", "discountCards": [], "typology": "ADULT", ... }],
  "itineraryId": "<uuid>",
  "branch": "SHOP",
  "forceDisplayResults": true,
  "trainExpected": true,
  "directJourney": false,
  "userNavigation": ["IS_NOT_BUSINESS"],
  ...
}
```

**Response:** `longDistance.proposals.proposals[]` — each item:
```json
{
  "travelId": "2026-11-10T06:16_9761, 889317",
  "departure": { "timeLabel": "06:16", "dateLabel": "10 nov.", "originStationLabel": "Paris Gare de Lyon" },
  "arrival":   { "timeLabel": "09:04", "destinationStationLabel": "Lyon Part-Dieu" },
  "durationLabel": "2h48",
  "bestPriceLabel": "70,60 €",
  "transporterDescription": "1 correspondance"
}
```

---

## Authentication

| Component | Value |
|-----------|-------|
| **BFF Key** | `ah1MPO-izehIHD-QZZ9y88n-kku876` (static, hardcoded in JS bundle) |
| **DataDome** | Handled automatically by running in Chrome — no manual cookie needed |
| **Other headers** | `x-client-channel: web`, `x-client-app-id: front-web`, `x-market-locale: fr_FR` |

---

## Usage examples

### Get all trains for a day

```python
from api_client import SNCFConnectClient, print_trains

with SNCFConnectClient() as client:
    trains = client.get_all_trains_for_day("Paris", "Lyon", "2026-11-10")
    print_trains(trains)
```

### Single search at a specific time

```python
from datetime import datetime
from api_client import SNCFConnectClient, STATIONS, print_trains

with SNCFConnectClient() as client:
    result = client.search_trains(
        origin=STATIONS["PARIS"],
        destination=STATIONS["MARSEILLE"],
        departure_dt=datetime(2026, 11, 10, 14, 0),  # 14:00 Paris time
    )
    proposals = result["longDistance"]["proposals"]["proposals"]
    print_trains(proposals)
```

### Autocomplete / resolve station names

```python
with SNCFConnectClient() as client:
    places = client.autocomplete("Bordeaux")
    for p in places[:3]:
        print(p["label"], p.get("galileoId"))

    # Resolve name → station object for use in search_trains()
    station = client.get_station("Toulouse")
```

### Non-stop trains only

```python
with SNCFConnectClient() as client:
    trains = client.get_all_trains_for_day(
        "Paris", "Bordeaux", "2026-11-10", direct_only=True
    )
```

---

## Supported stations (built-in, no autocomplete needed)

| Key | City/Station |
|-----|-------------|
| `PARIS` | Paris (all stations) |
| `LYON` | Lyon (all stations) |
| `MARSEILLE` | Marseille |
| `BORDEAUX` | Bordeaux |
| `TOULOUSE` | Toulouse |
| `NANTES` | Nantes |
| `LILLE` | Lille |
| `STRASBOURG` | Strasbourg |
| `NICE` | Nice |
| `RENNES` | Rennes |
| `PARIS_GARE_DE_LYON` | Paris Gare de Lyon (specific) |
| `PARIS_NORD` | Paris Gare du Nord (specific) |
| `PARIS_MONTPARNASSE` | Paris Montparnasse (specific) |
| `PARIS_SAINT_LAZARE` | Paris Saint-Lazare (specific) |

For any other station use `client.get_station("city name")` or pass `client.autocomplete("name")`.

---

## Output format

```
───────────────────────────────────────────────────────────────────────────
  DEP    ARR     DUR  TYPE                            PRICE
───────────────────────────────────────────────────────────────────────────
06:16  09:04    2h48  1 correspondance                70,60 €
07:00  09:11    2h11  Direct TGV INOUI                115 €
...
───────────────────────────────────────────────────────────────────────────
Total: 31 trains
```

---

## `fetch_day.py`: one day as JSON, for the app

```bash
python3 tools/sncf-api/fetch_day.py "Paris" "Lyon" 2026-11-10            # through the running Chrome
python3 tools/sncf-api/fetch_day.py "Paris" "Lyon" 2026-11-10 --from-file tools/sncf-api/trains.json   # no Chrome
```

- **stdout** carries one JSON document and nothing else; the client's progress goes to **stderr**.
- Each train: `id`, `departAt` / `arriveAt` (Paris local time, `YYYY-MM-DDTHH:MM`; arrival = departure + duration), `durationMin`, `from`, `to`, `changes`, `legs` (station, times, operator, number of each train), `bookable`, `priceEur: {best, second, first}`.
- `best` is SNCF's `bestPrice` and can be a **first-class** price when second class is sold out: read `second` for a second-class trip. Sold-out trains stay listed with `bookable: false` and no price.
- Searching a city returns several stations (Paris: Gare de Lyon, Bercy, CDG 2, Marne-la-Vallée), and one train can come twice, boarded at two of them: match on station **and** time.
- It only uses a Chrome that is already running with remote debugging; it never launches the client's own Chromium.
- On failure, stdout carries `{"schema": 1, "error": {"kind", "message"}}`:

| Exit | `kind` | Meaning |
|---|---|---|
| 0 | | OK, even with 0 trains |
| 2 | `usage` | bad arguments or unreadable `--from-file` |
| 3 | `browser` | Chrome not running with remote debugging, or the connection failed |
| 4 | `blocked` | SNCF answered HTTP 403 / 429 |
| 5 | `changed` / `error` | an answer in a shape the script does not know, or another SNCF error |
| 6 | `no-place` | SNCF knows no place by that name |

Tests (standard library only, Chrome replaced by a fake client):

```bash
python3 -m unittest discover -s tools/sncf-api -v
```

---

## Caveats

- **Chrome required:** The script uses your running Chrome browser for DataDome bypass. If Chrome is closed, Playwright Chromium launches as fallback, but DataDome may challenge it on the first run.
- **Date validity:** Dates too far in the future may return no results if SNCF hasn't opened bookings yet (typically opens 3–4 months ahead).
- **Price shown:** `bestPriceLabel` is the cheapest fare available at query time; it changes with seat availability. `-` means sold out or price not yet available.
- **Rate limiting:** A `delay_between_calls=0.3` (300 ms) pause is added between paginated calls. Increase it to be more polite.
