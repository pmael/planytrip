# Trip Manager — Real train prices and a price model

> Companions: [train-sources.md](./train-sources.md) · [database.md](./database.md) · [task.md](./task.md)
> Written 2026-10-24 for Claude Code. Extension code: [`extension/sncf-import/`](./extension/sncf-import/README.md). Phase 4 was built on 2026-10-26: see "Phase 4, Eurostar and Iryo" below.

## What was built, and where it differs from the plan below (T7.9, 2026-10-24)

Everything in P1 to P3 is built, except Phase 4. Tested on the Mac: the extension in a real Chromium against a page served at the SNCF address (nothing reached SNCF), then through the real route into a copy of the real database, with the Toulouse → Lyon page of 4 December: the 07:37, 15:42 and 17:43 were matched with their options.

**Differences, and why:**

- **Where things are.** The extension is in `extension/sncf-import/`. The accuracy page is `/trips/{tripId}/settings/price-accuracy`: the app's pages hang under a trip, and Settings links to it. Its words are in French, as written here. The rest of the app is in English.
- **The parser had two bugs, fixed**: a duration such as `4h11` was read as a time, so a card with the duration before the arrival time gave the duration as the arrival; and a station was cut wrong when the minutes of a time also started the line (`07:07`). `content.js` also shows the app's own message when it refuses an import, finds the date when it is not in the title's element, and does not add a second button when injected twice.
- **`price_observations`** has a `direction` column (the page was the way there or the way back), and its stations are `NOT NULL DEFAULT ''` so that the unique index holds when the page gave none. A train shown with no price is not stored (`price_2nd_eur` is `NOT NULL`).
- **The endpoint** also checks that the request is addressed to a local host. A page captured again, later, is stored again: prices move, and that is what the model learns from. Only the same page at the same instant is a duplicate.
- **An observed price is laid over the option when it is read, one way at a time**, never stored on it: the way there and the way back are each priced by what was seen for them, else by the search's estimate. The price is `observed` when nothing left in it is an estimate; while one way is still estimated the card says so ("Aller vu sur SNCF Connect il y a 2 h · …"). After 24 hours the estimate shows again. It applies wherever an option's price is read (the dashboard, the budget, what the AI is told, the summaries, a ❤). Only the train the search paired with the option is priced: a return price applies when that same train is on the page that was imported.
- **The model is two models**, because a direct TGV INOUI or OUIGO with a published range is predicted as a place in that range, and any other train by the kilometre. Each is judged on its own, and used only when it has ≥ 30 rows and beats its simple method by ≥ 15 % held out (on top of ≥ 100 observations from ≥ 15 sessions for all). The model is used only for journeys of SNCF's own trains: it learns from SNCF Connect, and says nothing of Renfe or SBB.
- **Boosting is `GradientBoostingRegressor`, not `HistGradientBoostingRegressor`**: the plan exports `tree_` arrays, which only the first has. 50 trees, depth 3. It replaces the Ridge only when it wins by more than 2 € of mean absolute error.
- **The training script checks its own export**: it recomputes the model's predictions from the exported JSON, as the app does, and refuses to write if they differ from scikit-learn's. `tests/price-model.test.ts` holds the TypeScript to scikit-learn's numbers for 32 trains, both kinds of model, to 9 decimals.
- **The accuracy page shows the model's numbers on data it never saw**: `train.py` saves, for each observation, the price the model gave it when it had been held out, so the model is compared with the simple methods on the same rows.
- **Python is not needed by the app to run**: "Réentraîner" runs `uv run tools/price-model/train.py`, which installs scikit-learn by itself (`brew install uv`); a `python3` that already has it is used when `uv` is missing.

**Corrections after the first real captures (2026-10-26, 10 searches of the spreadsheet `recherches-sncf.xlsx`):**

- **The extension read its own preview as trains** when "→ Trip Manager" was clicked a second time with the preview still open (58 rows, with wrong dates and prices). It now ignores its own button and preview, and the app refuses a train whose "station" contains `→`, `€` or `·`.
- **Fares are read by their labels.** SNCF's cards say "Seconde classe" and "Première classe"; the parser took the first price as second class, so a card whose second class was full ("Complet") stored the first-class price as second (9 rows). It now reads each fare after its label.
- **Types of train.** SNCF writes TER as "Train T E R" and its night trains "Train de nuit". Many cards carry no type text at all; the extension now also reads what the logo carries and sends it as `logoHint`. If a card still has no type, the preview shows `?` for it.
- **A "session" is one page read**, not one hour: thirty searches made in one afternoon, as the spreadsheet advises, are thirty sessions. What is held out together when the model is judged is **one route on one day** (all its readings), which is stricter and is what the model must do: price a route it has not seen.
- **A model must have seen several routes**: at least 3 different routes and 10 route-days, on top of the rules below. A trial on the first 357 rows reached the 15% gain on a single route (Lyon → Paris) and would have been used for every other.
- A journey with changes is `MIXED` in the model's features, as the app calls the ones it prices (the page names it by its first logo).
- The 58 preview rows and the 9 wrong-price rows were deleted from the database, and 28 rows were given the type their card text says.

**Phase 4, Eurostar and Iryo (2026-10-26).** The same extension now reads the results pages of **Eurostar** (`eurostar.com/search/…`) and **Iryo** (`iryo.eu/…/booking/…`) as well, from a saved copy of each page (Paris → Londres, 30 October: 19 trains; Madrid → Valencia, 31 October: 7 trains). One parser per site, the same payload, the same endpoint:

- **Where it differs from SNCF.** The pages give structure, so the parsers read ids and elements rather than patterns in text: Eurostar's rows carry the train, the day and the times in their ids (`9007-2026-10-30-07:05-08:30-tab-0-panel`), and Iryo's cells carry the price to pay apart from the struck-through original. `price_2nd_eur` is the cheapest class (Eurostar Standard, Iryo Inicial) and `price_1st_eur` the one above it (Eurostar Plus, Iryo Infinita); the third class is kept in the raw text only. Types of train are `EUROSTAR` and `IRYO` (`MIXED` with a change).
- **`source`** is `sncf-connect`, `eurostar` or `iryo`. Observations of any seller are laid over the cards for 24 h and shown on the accuracy page, where they measure how wrong the kilometre rate is for Eurostar and Iryo.
- **The model does not learn from them.** `train.py` reads the rows of `sncf-connect` only: the app uses the model for SNCF's own trains, and a Paris–Londres price per kilometre is not an SNCF one. They also do not count towards the thresholds (≥ 100 observations, ≥ 15 sessions). A model for Eurostar or Iryo would be its own task, once there are enough rows to judge it on.
- **Matching.** `core/stations.ts` now knows that "Londres St Pancras Int'l" and "London St Pancras International" are one station. Iryo's row leaves the arrival station blank: it is taken from the search's summary when that names one station.
- **Only one adult.** The preview says who the page was searched for and warns when it is not one adult, since a page may show a total. Prices that are not in euros (Eurostar's UK site) are not sent.
- **Not seen:** the way back of either site, Iryo in the layout of a narrow window, trains with a change.

**Not built:** Trainline's pages, Renfe's Kaggle data, a model for any seller but SNCF. **Not yet done, because it needs you:** installing the extension in your Chrome, and collecting prices.

---

## Goal

Trains without a live price are priced with an estimate: the middle of SNCF's published range for TGVs, 0.15 €/km otherwise. We want to:

1. **Collect real prices** from the pages pael already looks at, without scraping: a browser extension reads the SNCF Connect results tab when pael clicks a button.
2. **Measure** how wrong each estimate method is, on a page anyone can check.
3. **Train a small model** that beats the current estimate, and use it only once the numbers prove it.

Not in scope: automated requests to SNCF Connect, Trainline or Eurostar, or any way around their bot protection. All real prices come from pages pael opened in their own browser.

## Phase 1 — Capture real prices

### P1.1 Extension (already written)

`tools/sncf-import-extension/` (Manifest V3). Copy it into the repo as `extension/sncf-import/`. It posts the payload described in its README. Keep `sncf-parser.test.mjs` in the test suite (adapt to Vitest if that's the project's runner).

### P1.2 Table `price_observations`

| Column | Type | Note |
|---|---|---|
| `id` | text PK | cuid2 |
| `source` | text | `sncf-connect`, `eurostar`, `iryo` |
| `captured_at` | text | ISO, from the payload |
| `travel_date` | text | `YYYY-MM-DD` |
| `days_before` | int | `travel_date − captured_at`, in days |
| `origin_label`, `destination_label` | text | as shown in the header |
| `depart_station`, `arrive_station` | text | as shown in the card |
| `depart_time`, `arrive_time` | text | `HH:MM` local |
| `duration_min`, `changes` | int | |
| `train_type` | text | `TGV INOUI`, `OUIGO`, `TER`, `INTERCITES`, `MIXED`, null |
| `price_2nd_eur`, `price_1st_eur` | real | cents matter for the model, so `real` here (exception to the whole-euros rule, document it) |
| `distance_km` | int | filled by the server (OSRM or station coordinates), for the per-km baseline |
| `range_min_eur`, `range_max_eur` | real | SNCF published range for this station pair, null if none |
| `transport_option_id` | text FK nullable | the matched option, `ON DELETE SET NULL` |
| `estimate_eur`, `estimate_method` | real, text | **snapshot of what the app estimated** for that train, at capture time |
| `raw_json` | text | the offer as received |

Index `(travel_date, depart_time)`. Unique `(source, travel_date, depart_station, depart_time, captured_at)` to make re-imports idempotent.

### P1.3 `POST /api/price-observations`

- Validate with Zod; reject when `date`, `origin` or `offers` is missing (400 with a French message, the extension shows it).
- Accept only requests from the extension (check `Origin` starts with `chrome-extension://`) and listen on localhost only, as today.
- For each offer: compute `days_before`, `distance_km`, look up the SNCF range, then **match** a `transport_options` row with `mode = train`, same date, `depart_time` within ±2 min, station names fuzzy-equal (normalise accents/case, "Part Dieu" = "Part-Dieu"). When matched, copy the option's current estimate into `estimate_eur` / `estimate_method` **before** anything else changes it.
- Response: `{ saved, matched }`.

### P1.4 Use the real price in the app

When a matched option has an observation less than 24 h old, show its `price_2nd_eur` with a new `priceKind = "observed"` and the label "vu sur SNCF Connect il y a 2 h". The AI prompt treats `observed` like `live`. Older observations stay for training but don't override the estimate on the card.

## Phase 2 — Accuracy page

Page **Settings → Fiabilité des prix** (`/settings/price-accuracy`).

- For each method, on every observation with a real price: mean absolute error (€), median absolute error, % of estimates within ±10 €, and bias (mean signed error: does it under- or over-estimate?).
- Methods compared: `per_km_0.15`, `range_mid`, `range_max`, and `model` once it exists. Compute all baselines for every observation from its stored features, so they are compared on the same rows (not only the snapshot method).
- A scatter plot estimate vs real (one colour per method, diagonal line), and a table of the 20 worst misses.
- Breakdown by `train_type` and by `days_before` bucket (0–7, 8–30, 31–90, 90+).
- The model's numbers must come from **held-out** data, labelled as such on the page.

## Phase 3 — Model

### P3.1 Why not a Hugging Face model

This is tabular regression with a few hundred rows. A small classical model is more accurate at this size, trains in a second, runs offline, and can be explained on the accuracy page. No LLM, no GPU.

### P3.2 Target and features

- **Target (TGV/OUIGO with a published range):** position in the range, `t = (price_2nd − range_min) / (range_max − range_min)`, clipped to [0, 1.2] (real prices can exceed the published max). Predicted price = `range_min + t̂ × (range_max − range_min)`. This lets one model work across routes.
- **Target (no range: TER, Intercités, Renfe, Eurostar):** `price_2nd / distance_km`.
- **Features:** `days_before` (and `log1p(days_before)`), weekday of travel, departure hour (bucketed: <8, 8–12, 12–16, 16–20, >20), `is_friday_or_sunday`, school-holiday flag (French zones calendar from data.gouv.fr), `train_type`, `changes`, `duration_min / distance_km`.

### P3.3 Training and evaluation

- Script `tools/price-model/train.py`. Reads `data/trip.db`, writes `data/price-model.json`.
- Candidates: Ridge regression on the features above, then `HistGradientBoostingRegressor` only if it beats Ridge by > 2 € MAE (on CV) — export trees with `sklearn`'s `tree_` arrays to JSON and walk them in TS.
- **Cross-validation grouped by capture session** (`source + captured_at` rounded to the hour): all cards from one search page are correlated, so they must never be split between train and test. 5 folds, or leave-one-session-out under 30 sessions.
- Report per fold: MAE for the model and for each baseline on the same rows. Write the report to `data/price-model-report.json`; the accuracy page reads it.
- **Activation rule:** the app uses the model only when there are ≥ 100 observations from ≥ 15 sessions **and** its held-out MAE beats `range_mid` by ≥ 15 %. Otherwise the page shows "pas encore assez de données (n/100)" and the current estimate stays.
- Inference in TypeScript (`src/core/price-model.ts`): Ridge is a dot product. If boosting wins, export trees with `sklearn`'s `tree_` arrays to JSON and walk them in TS (≤ 50 trees, depth ≤ 4).
- Retrain on demand from the accuracy page ("Réentraîner"), which spawns the script. Show the training date; prices drift, so flag the model as stale after 60 days.

### P3.4 Honesty notes for the page

- Data comes only from pael's own searches, so it covers pael's routes and booking habits, not France in general.
- "Dès" prices are the cheapest fare still on sale at capture time, which is what the trip budget needs.

## Phase 4 — Eurostar and Iryo built (2026-10-26), the rest later

- Same extension for Eurostar and Iryo: **built**, one parser each, same payload. Trainline, which also covers Renfe and Ouigo España, is **not built**.
- Spain: the public Kaggle dataset of Renfe prices (2019–2020) can pre-train the "no range" model for Spanish routes. Check its licence before importing, and keep it out of the French model's evaluation.

## Build order and done criteria

| Task | Done when |
|---|---|
| P1.1 extension in repo + parser tests | tests pass; a real SNCF Connect page imports and the preview matches the screen |
| P1.2 migration | `price_observations` exists; database.md updated |
| P1.3 endpoint + matching | importing the Toulouse → Lyon page of 4 Dec matches the 07:37 and 17:43 trains to their options |
| P1.4 observed price on cards | the 07:37 card shows 66 € "vu sur SNCF Connect" instead of the estimate |
| P2 accuracy page | shows the three baselines on the imported rows |
| P3 model | `train.py` runs, report written, page shows held-out MAE; activation rule enforced |
