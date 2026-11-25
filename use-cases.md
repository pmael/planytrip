# PlanyTrip — Concrete use cases

> Companions: [architecture.md](./architecture.md) · [database.md](./database.md) · [task.md](./task.md)
> Scope: personal use, local app. The *Extra* is specified in **R10 to R12** and **UC-D** ([extra.md](./extra.md), task.md Phase 8). The budget counts it since T8.9. UC-A to UC-C tell the story with the figures without it, and UC-D, D.6 says what changes; the tests state D.6's figures.

---

## 1. The reference scenario

> Martin is from Madrid and wants to go on a trip with his friends Chloé and Jessy. Jessy also lives in Madrid, Chloé lives in Paris. They are available from **26 August to 14 September**, except Martin who, because of work, can only be there until **5 September**. They are hesitating between **Barcelona**, **La Réunion** and **Le Mont-Saxonnex**. Chloé and Jessy want to fly (**plane**), Martin wants to drive (**car**) from Madrid. Budgets: Chloé **1,200 €**, Martin **800 €**, Jessy **400 €**. The goal is for everyone to be satisfied, on budget **and** on comfort: a flight with 4 connections and 23 h of travel is not comfortable.

**What the app must produce:** a **recommended destination** that fits everyone's budget with acceptable comfort, and a numbers-backed explanation of that choice.

### 1.1 Input data

| Guest | City | Max budget | Availability | Preferred mode | Accepted modes (step 3) |
|---|---|---|---|---|---|
| Martin | Madrid (MAD) | 800 € | 26/08 → 05/09 | car | car |
| Chloé | Paris (ORY, CDG) | 1,200 € | 26/08 → 14/09 | plane | plane |
| Jessy | Madrid (MAD) | 400 € | 26/08 → 14/09 | plane | plane |

| Destination | Country | Nearest airport | Budget level | Goal | In POC scope (Europe) |
|---|---|---|---|---|---|
| Barcelona | ES | BCN | light | partying | yes |
| La Réunion (Saint-Gilles) | FR (overseas) | RUN | high | chill | **no**, computed but flagged |
| Le Mont-Saxonnex | FR | GVA (45 km) | high | nature | yes |

### 1.2 Derived values

- **Common window** = intersection of availabilities = **26/08 → 05/09**, i.e. **10 nights** (`trips.nights = null`, so the whole window).
- **Origin keys**: `MAD` (Martin, Jessy) and `PAR` (Chloé). Madrid flights are searched only once for both.
- **Group size** = 3, so accommodation with capacity ≥ 3, and housing share = total ÷ 3.

### 1.3 Test dataset (fixtures)

> **The prices below are plausible estimates for testing the algorithm, not quotes.** They are used as the seed (`src/db/seed/scenario-martin.ts`) and as fixtures for the fake adapters. The real adapters will replace them.

**Accommodation (10 nights, 3 people)**

| Destination | Offer | Source | Total | Share / guest | AI verdict |
|---|---|---|---|---|---|
| Barcelona | Gràcia apartment, 2 bedrooms, 3 beds | airbnb | 900 € | 300 € | ok |
| Barcelona | Hotel Cuatro Naciones, 2 rooms | booking | 1,200 € | 400 € | good |
| La Réunion | Villa Saint-Gilles, 2 bedrooms | airbnb | 800 € | ~267 € | good |
| Mont-Saxonnex | Chalet Le Bargy, 3 bedrooms | airbnb | 900 € | 300 € | good |

**Transport (round trip)**

| Destination | Origin | Option | Price | Travel time (outbound) | Stops | Comfort |
|---|---|---|---|---|---|---|
| Barcelona | PAR | Transavia ORY→BCN, departs 06:30 | 120 € /person | 1 h 40 | 0 | 🟡 (early hour) |
| Barcelona | PAR | Vueling ORY→BCN, departs 11:30 | 165 € /person | 1 h 40 | 0 | 🟢 |
| Barcelona | MAD | Vueling MAD→BCN, departs 06:45 | 70 € /person | 1 h 15 | 0 | 🟡 |
| Barcelona | MAD | Iberia MAD→BCN, departs 10:15 | 95 € /person | 1 h 15 | 0 | 🟢 |
| Barcelona | MAD | Car **without tolls** (620 km) | 145 € /vehicle | 6 h 15 | – | 🟡 |
| Barcelona | MAD | Car **with tolls** | 175 € /vehicle | 5 h 50 | – | 🟢 |
| La Réunion | PAR | Air Austral ORY→RUN direct, departs 22:30 | 880 € /person | 11 h 05 | 0 | 🟡 (late departure) |
| La Réunion | PAR | Via Marseille | 820 € /person | 14 h 30 | 1 | 🟡 |
| La Réunion | MAD | 3 stops | 910 € /person | **23 h 40** | **3** | 🔴 excluded by default |
| La Réunion | MAD | Via Paris-Orly | 1,040 € /person | 14 h 30 | 1 | 🟡 |
| La Réunion | MAD | Car | — | — | — | ⛔ no route (ocean) |
| Mont-Saxonnex | PAR | easyJet CDG→GVA + bus/taxi 45 km | 110 € + 50 € | 1 h 05 + 1 h | 0 | 🟢 |
| Mont-Saxonnex | MAD | easyJet MAD→GVA + bus/taxi | 140 € + 50 € | 1 h 55 + 1 h | 0 | 🟢 |
| Mont-Saxonnex | MAD | Car **with tolls** (1,330 km) | 531 € /vehicle | 13 h 00 | – | 🔴 (> 10 h alone) |
| Mont-Saxonnex | MAD | Car **without tolls** (1,390 km) | 325 € /vehicle | 17 h 30 | – | 🔴 |
| Mont-Saxonnex | MAD | Car **without tolls + 1 overnight stop** each way | 325 € + 2 × 60 € = 445 € | 2 × 8 h 45 | – | 🟡 |

Car: cost = round-trip distance × 6.5 L/100 km × 1.80 €/L (+ estimated tolls). Only one person in the car, so `per_vehicle` = Martin's cost.

---

## 2. Cross-cutting rules (apply to all the use cases)

### R1 — Reachability
- `plane`: reachable if the origin and the destination each have an airport within ≤ 150 km.
- `car`, `train`, `bus`: reachable if OSRM returns a road route. The public OSRM server does not say "no route" for an island (it snaps La Réunion to a road in southern India, 5,000 km away), so a point that had to be moved more than 25 km counts as having no road: Madrid → La Réunion has no road route, so `route_checks.reachable = 0`, `reason = no_road_route`. **No hard-coded list.**
- A guest for whom **no accepted mode** reaches a destination is marked **⛔ unreachable** for that destination. The app then suggests a **fallback mode**: the cheapest among the non-accepted modes, shown greyed out, and enabled in one click, which adds the mode to `guest_modes`.

### R2 — Trip comfort (`core/comfort.ts`)
| Mode | 🟢 green | 🟡 yellow | 🔴 red |
|---|---|---|---|
| plane / train / bus | 0 stops and duration ≤ 1.3 × the fastest on the route, departure between 08:00 and 21:00 | 1–2 stops, **or** duration between 1.3 and 2 × the fastest, **or** departure between 06:00 and 08:00 or between 21:00 and 23:00 | ≥ 3 stops, **or** duration > 2 × the fastest, **or** duration > 20 h, **or** departure between 23:00 and 06:00 |
| car (1 driver) | ≤ 6 h of driving per day | 6–10 h per day | > 10 h per day |

- When all car options for a trip are 🔴, the app automatically generates an **`overnight_stop`** variant: the trip split over 2 days, + 60 € hotel night per leg.
- `comfort_score` (0–100) = 40 % duration + 30 % schedule + 20 % stops + 10 % last mile. It is used for the "Most Practical" sort.

### R3 — A guest's default option (as long as there is no ❤)
1. Keep the options of the accepted modes **whose comfort is not 🔴**.
2. Take the cheapest.
3. If all are 🔴, take the cheapest anyway and flag it "uncomfortable".
4. An option rated **bad** at setup (R9) is skipped too, as long as another is left: the comfort rule comes first, the rating only refines it.

### R4 — Default accommodation (as long as there is no ❤)
The cheapest with `capacity ≥ group size` and a rating `verdict ≠ bad` (R9), or not rated at all. If every one that fits was rated bad, the cheapest of them: a destination never loses its accommodation (and its cost) because nothing pleased, the card says "not recommended".

### R5 — Costs (`core/pricing.ts`, `core/scenario.ts`)
With the Extra (R10), since T8.9:
```
transport(g) = price_eur                          if per_person: the last mile is the Extra's transfer (D3)
             = price_eur / car occupants          if per_vehicle (POC: 1 occupant)
core(g)      = transport(g) + housing.total_price_eur / nbGuests + mandatory(g)
cost(g)      = core(g) + plus(g)
total(d)     = Σ cost(g)
```
`last_mile_eur` stays on the option: the comfort score (R2) still counts a far airport, only its price left the transport. The Extra counts once the destination's local prices are stored. Until then, as before T8.9, `transport(g) = price_eur + last_mile_eur` (per person) and `cost(g) = transport(g) + housing / nbGuests`: a trip computed before T8.4 keeps those figures until it is computed again. UC-A to UC-C tell those figures.

### R6 — Budget tier
**With the Extra (decision D2): the Mandatory counts fully, the Plus is a suggestion.** 🔴 **over** only when `core(g)` (transport + housing + Mandatory) is above the budget, and the overrun is `core(g) − max_budget_eur`. Otherwise 🟢 **comfy** if `cost(g)` (with the Plus) ≤ 80 % of the budget, else 🟡 **limited**. **The Plus alone never makes a guest 🔴**: over budget because of the nights out is 🟡, with the advice (R12). `budgetTierWithExtra` in `core/extras.ts`. A destination's tier is **the worst tier among its guests**. A ⛔ guest counts as 🔴.

Without the Extra (before T8.9, or before the local prices are stored): `ratio = cost(g) / max_budget_eur`, 🟢 if ≤ 80 %, 🟡 between 80 and 100 %, 🔴 above.

### R7 — Recommendation (`core/recommend.ts`)
Destinations are ranked criterion by criterion:
1. **Eligible**: all guests reachable and none in 🔴 budget (R6 with the Extra: the Plus never makes a destination ineligible).
2. Number of guests in 🟢 budget, the Plus counted (descending).
3. **Total overrun** (ascending): the sum of the over-budget guests' overruns of their core, a ⛔ guest counted with the fallback. 0 for every eligible destination, so it only orders those that do not work (open question 6, decided at T8.9).
4. Average comfort of the selected trips (descending).
5. ★ votes (descending).
6. Total cost, with the Extra (ascending).

The 1st eligible destination is **recommended**. If there is none, the app shows "No destination works for everyone" and lists, for each destination, **what is blocking and by how much** (e.g. "Jessy +172 €": the core's overrun).

### R8 — On-screen colours
All colours come from a single function `colorOf()` (`core/colors.ts`): budget (R6), comfort (R2), relative price of an option (cheapest / middle / most expensive third), dates (covers / partly / not), and AI verdict for accommodation.

### R9 — Ratings: the AI curates what was scraped, once, at setup
A site returns whatever it has, some of it poor or beside the point. While the trip is set up, the AI rates **every accommodation and every journey** of each destination, against the others and the group's budgets (above all the poorest guest's share): a verdict (good / ok / bad), a score 0-100 and a one-line reason, stored with the fingerprint of what it was shown.
- **The dashboard only reads these scores and never calls the AI.** Offers are ordered by them (B-S4), and a `bad` one is not a default pick (R3, R4) and says "not recommended" with its reason. The one live call afterwards is **Why this?** (B-S6), on a click.
- **If the AI does not work** (no CLI, timeout, an answer that does not hold up after the retries), simple rules rate instead (`core/ratings.ts`), every score says **"Rule-based"** / "not rated by the AI", and the person is told. The trip is never blocked.
- **When a guest's budget, the dates or an offer changes later**, the stored scores may be out of date: the dashboard says so and offers **Re-rate**; nothing is asked of the AI until it is pressed. Re-rating searches nothing again, and keeps what is still current.

### R10 — The Extra (`core/extras.ts`, `config.extras`)
What each guest spends once there, worked out for **the group's ❤ stay (the ❤ is the group's vote, D1), or the default one (R4)**. It is worked out on every read from stored facts (local prices, what is around the stay, how each guest gets to it, the activities), so a ❤ on another stay or a budget change shows at once. Amounts stay unrounded until display. Prices from the AI or the rules are estimates, shown with ≈; open data is said to be real. Each amount is a **line**; a line that does not apply is left out.

**Mandatory**
- **Food** (`food`): `meals = nights × 3`. The restaurant share starts from the objective (None 30 %, Partying 25 %, Culture 40 %, Chill 60 %, Nature 15 %, D7), plus the budget level (light −15, medium 0, high +20 points), plus 15 points when the nearest supermarket is farther than 1 km, kept between 0 and 100 %; **at least 67 % when the stay has no kitchen**. `restaurant meals = round(meals × share)` (halves up), the others from the supermarket. `food = restaurant meals × meal + grocery meals × groceries per day ÷ 3`, the meal being a cheap one, a mid-range one for a high budget.
- **Transfer** (`transfer`), for a guest arriving by plane, train or bus, each way on its own: between the arrival airport or station and the stay (the flight's airport, the train's last station; the destination itself when the journey does not say), at the time they arrive, and back at the time they leave. **Public transport** when Transitous finds a journey of at most 90 min (asked at midday when the trip is set up, task.md T8.6) and the guest's hour is between 06:00 and 23:00 (a ticket). **Otherwise a taxi**: `start + km × per km` (the straight line × 1.3), shared by the guests of the same airport whose times are within 30 min of the first of them, 4 per taxi: each pays `taxis × fare ÷ guests`. It replaces `last_mile_eur` (D3).
- **Parking** (`parking`): a guest who comes by car pays `parking per day × nights` when the stay has no free parking. No transfer.
- **Tourist tax** (`tourist-tax`): `rate per night × nights`, at most `maxNights` nights where the place caps it (7 in Catalonia and Lisbon). **A line of 0 when the stay's price already includes it.** Whether it does (`core/tourist-tax.ts`, task.md T8.5): what the stay's page says first (Airbnb's own "Taxes" line in its price details: included; a host who says it is paid at check-in, or gives its rate: not; Google Hotels' totals: included by its policy); an Airbnb without that line is one Airbnb does not collect for, so the guest pays on top, unless the host pays it. The rate: the host's own figure when they write one, else France's open data for a French commune (a rental with no star rating pays a share of the price per person per night, with the extra taxes, capped), else the config table, else the AI's. No line where there is none, or nothing is known. Every guest counts as an adult (the app does not know ages).

**Plus**, by the destination's objective:
- **Partying**: `nights out = ceil(nights ÷ 2)` (D5). Each night, per guest: the club entry and 4 drinks (`nights-out`), the pre-drinks (`pre-drinks`), a ticket there and the way back at 03:00 (`night-transport`): a ticket when Transitous finds a night bus within the hour from the nearest spot of the nightlife district, else a taxi, `taxis × fare ÷ guests`, 4 per taxi.
- **Chill**: one paid relaxing activity, the first `spa` of the list, when the stay has no spa (`relax`); `max(1, floor(nights ÷ 3))` day passes (`local-transport`).
- **Culture**: the first `min(5, max(3, nights))` activities of the list, most worthwhile first (`activities`); a day pass per night when the historic centre is farther than 1.5 km (`local-transport`).
- **Nature**: `hike days = round(nights × 60 %)`, the first that many activities (`activities`, their fees). An activity within 2 km of the stay is on foot; else by public transport when it takes at most 90 min (two tickets, `local-transport`); else it needs a car. Its distance from the stay is the road from the destination's point (OSRM, T8.6) stretched to the stay; public transport from the destination's point counts for a stay within 5 km of it; an activity the map could not place counts as 20 km away (1 km for the other objectives). When one does: `cars = ceil(guests ÷ 5)`, the guests' own cars first; **the rest are rented for the whole stay at the arrival airport (D6)**, their passengers are the guests without a car, and the rental is their transfer. `car-rental = rented cars × nights × daily rate ÷ passengers`, the daily rate being DiscoverCars' published average at the destination's airport for the stay's months when it has one (task.md T8.11, [rental-sources.md](./rental-sources.md)), else the AI's estimate. `fuel` at 6.5 L/100 km and the local fuel price (Euro-super 95 in the EU Weekly Oil Bulletin for an EU country, task.md T8.12; else the estimate): every car, there and back, to each activity that needs one, split by all guests; plus the rented cars' drive between the airport and the stay, split by their passengers.
- **None**: 2 public transport tickets a night (`local-transport`).

### R11 — The objective in the stay rating
The stays are rated for the destination's objective as well (R9).
- **The AI** is given each stay's facts and the objective's criteria. Partying: close to where young people go out, safe to walk back at night, a home where the group can gather. Chill: a spa, a pool in summer or a sauna in winter, a view, quiet. Culture: walking distance to the historic centre and the top sights. Nature: close by road to the trails and parks, parking. Its reason must give a concrete fact; safety at night is never a vague "bad area".
- **The rules** (`stayObjectiveScore`, `blendObjectiveScore` in `core/ratings.ts`): `score = round(75 % × the score of R9's rules + 25 % × objective score)`; for **None** the score is unchanged. The objective score is `round(100 × s)`, `s` between 0 and 1, linear between the distances given, an unknown fact counting as halfway:
  - Partying: 50 % the nightlife district (full within 0.5 km, nothing from 5 km), 30 % the centre (1 km, 8 km), 20 % a home (Airbnb 1, hotel 0.4); −0.1 when the listing says "no parties" or sets quiet hours.
  - Chill: 30 % a spa, 25 % the season (June–September a pool; November–March a sauna, hot tub or hammam; in between either earns half; **south of the equator the months are six months on**), 15 % a view, 20 % quiet (5 bars or fewer within 500 m full, 40 nothing), 10 % calm words in the title or reviews.
  - Culture: 70 % the historic centre (0.5 km, 4 km), 30 % the sights within 1 km (10 for full).
  - Nature: 80 % the distance, as the crow flies, to the nearest marked hiking path, trailhead or small natural park (2 km, 40 km; task.md T8.3), 20 % free parking.

### R12 — The advice
How to fit the Plus into the budgets, for the group and for each guest.
- **The levers**, each worked out by the rules with what it saves: `groceries-only`; `fewer-nights-out` (one at a time, at least one is left); `bars-only` (no club, one night at a time); `skip-activity` (the dearest paid one); `skip-relax`; `fewer-day-passes`; `transit-not-taxi` (only for a taxi the guest takes alone, so nobody else pays more).
- **The AI** (T8.8, built: `advise_extras`, at setup after the ratings and on **Ask again**) is given each guest's budget, their costs line by line and the levers with their savings. It answers up to 3 lines for the group and lines for the guests who are 🟡 or 🔴; **each line names one of the levers given, and the euros shown are the app's own**: a line that names another lever or another amount is dropped. Stored with a fingerprint (the budgets, the ❤ stay, the dates, the offers, the objective): when one changes, the advice says "may be out of date" and offers **Ask again**.
- **The rules, without the AI** (`adviseByRules`): for each guest whose cost with the Plus is above their budget, the step that saves the most, one step at a time, until it fits or no step is left. It says whether the guest then fits ("does not fit even with every lever" otherwise). No group advice without the AI. Said to be rule-based.

---

## UC-A — Martin's point of view: "By car with 800 €, where should I go?"

> The figures of this use case are **without the Extra**, as the budget was until T8.9. Since T8.9 they are the ones of UC-D, D.6, and the tests state those.

**Actor:** Martin, trip organiser. He creates the trip and enters everyone's info.
**Question:** "I'm driving from Madrid and I don't want to spend more than 800 €. Which destination suits me best between Barcelona, La Réunion and Le Mont-Saxonnex?"
**Covers:** the full setup wizard, the car computation, unreachability, the per-guest ❤.

### A.1 Flow

1. **Home** → **Start** creates the trip (`status = draft`).
2. **Step 1 — Guests**: Martin adds 3 guests through the popup. As soon as all 3 are entered, a banner shows "Common window: 26/08 → 05/09 (10 nights). Limited by Martin."
3. **Step 2 — Destinations**: he adds Barcelona, La Réunion and Mont-Saxonnex. When La Réunion is entered, an "Outside Europe, computed for reference" badge appears.
4. **Step 3 — Transport**: a **guest × mode** matrix, pre-checked with the preferred modes (Martin = car, Chloé = plane, Jessy = plane). Below the matrix, a **guest × destination** reachability preview is computed on the fly (geo + OSRM, no prices):
   - Martin → La Réunion: ⛔ "No route. Accept plane?" [Add plane].
   - Martin → Mont-Saxonnex: ⚠️ "About 13 h of driving, an overnight stop will be suggested".
5. **Next** starts the computation, then the **Computing** screen shows progress per source, and finally the **Dashboard**.
6. **Dashboard → Transport**, with destination = Mont-Saxonnex and guest = Martin: **Car** column with 3 cards (with tolls 🔴, without tolls 🔴, without tolls + stop 🟡).
7. Martin works until the evening of 25/08 and wants to reach Barcelona fast: on Barcelona, he puts a ❤ on **"Most Practical" = with tolls (175 €)**. His cost goes from 445 € to 475 €, and the Barcelona total from 1,235 € to 1,265 €.

### A.2 Expected result for Martin (no ❤)

| Destination | Selected option (R3) | Transport | Housing share | **Martin's cost** | % of 800 € | Budget | Comfort |
|---|---|---|---|---|---|---|---|
| **Barcelona** | car without tolls | 145 € | 300 € | **445 €** | 56 % | 🟢 comfy | 🟡 |
| Mont-Saxonnex | car without tolls + stop (the other 2 are 🔴) | 445 € | 300 € | **745 €** | 93 % | 🟡 limited | 🟡 |
| La Réunion | ⛔ car impossible | — | — | — | — | 🔴 (⛔) | — |
| *La Réunion, plane fallback* | *via Orly, if Martin accepts the plane* | *1,040 €* | *~267 €* | *1,307 €* | *163 %* | *🔴 over* | *🟡* |

**Answer shown to Martin:** "**Barcelona** suits you best: 445 € (56 % of your budget), 6 h 15 of driving. Le Mont-Saxonnex is still possible at 745 € with an overnight stop each way. La Réunion is not reachable by car."

### A.3 Specifications

| # | Specification |
|---|---|
| A-S1 | The guest popup validates: non-empty name, resolved city (geocoding), integer budget > 0, `available_to ≥ available_from`, preferred mode in the list. |
| A-S2 | The common window is recomputed on every guest addition or change. If it is empty, **Next** is blocked with "No common dates between X and Y". |
| A-S3 | `setGuestModes` always includes the preferred mode. At least one mode per guest. |
| A-S4 | `checkReachability(tripId)` fills `route_checks` for every (origin_key, destination, accepted mode) tuple, without scraping. |
| A-S5 | The `car` adapter produces, per origin/destination pair, the `tolls` and `no_tolls` variants, plus `overnight_stop` if R2 rates all of them 🔴. When the fastest drive has no tolls at all (Madrid → Barcelona), there is a single `standard` variant. |
| A-S6 | Car cost = `distance_km_AR × consumption × fuel_price (+ tolls)`. Consumption (6.5 L/100), toll (0.09 €/km of motorway) and overnight stop (60 €) live in `config.ts`. **The fuel price** is the pump price of Euro-super 95 in the EU Weekly Oil Bulletin: the mean of the home country's and the destination's, the one it has when it has one, and `config.ts`'s 1.80 €/L when it has neither or cannot be read. The reference scenario's car options keep their fixture prices (145 € for Madrid → Barcelona). |
| A-S7 | A transport ❤ is stored per **(destination, guest)** and does not change the other guests' costs. |
| A-S8 | The Transport screen filters by **guest**, with guests from the same origin grouped: "Martin · Jessy (MAD)". |

### A.4 Acceptance criteria (seed `scenario-martin`)

- [ ] **Given** the 3 guests entered, **then** the displayed common window is 26/08 → 05/09, i.e. 10 nights.
- [ ] **Given** Martin on `car` only, **then** La Réunion is ⛔ for Martin with the "Add plane" action.
- [ ] **When** the computation is done, **then** Martin's cost is 445 € (Barcelona, 🟢) and 745 € (Mont-Saxonnex, 🟡, stop variant).
- [ ] **When** Martin puts a ❤ on "car with tolls" in Barcelona, **then** his cost becomes 475 € and the Barcelona total 1,265 €, without any network request.
- [ ] **When** he removes the ❤, **then** everything goes back to 445 € / 1,235 €.

### A.5 Edge cases
- Martin also checks `plane`: La Réunion becomes reachable (1,307 €, 🔴). Barcelona stays recommended for him.
- OSRM unavailable: `route_checks.reason = osrm_unavailable`, the car mode is marked "not verified", and the computation continues with the other modes.

---

## UC-B — Jessy's point of view: "With 400 € by plane, can I come?"

> The figures of this use case are **without the Extra**, as the budget was until T8.9. Since T8.9 they are the ones of UC-D, D.6, and the tests state those.

**Actor:** Jessy, who looks at the dashboard prepared by Martin.
**Question:** "I only have 400 €. At which destination can I join the others without going into debt and without spending 23 h on planes?"
**Covers:** tight budget constraint, exclusion of uncomfortable flights, Housing page, impact of a housing ❤ on a single guest.

### B.1 Flow

1. **Dashboard → Home**, guest list: Jessy is 🟡 *Limited* on Barcelona and 🔴 *Over* elsewhere.
2. **Transport**, destination = La Réunion, guest = Jessy: the "Cheapest" card shows **1,040 €**. The 910 € flight (3 stops, 23 h 40) is **not** offered as Cheapest. It only appears under **More**, with a 🔴 badge "Uncomfortable: 3 stops, 23 h 40".
3. **Housing**, destination = Barcelona: Airbnb column (Gràcia apartment 900 €) and Hotel column (Cuatro Naciones 1,200 €).
4. Jessy clicks **Why this?** on the hotel: the AI advise panel opens with pros and cons.
5. She clicks **Compare** on both offers: side-by-side table with price, share per guest, capacity, rating, pros/cons, and a **"budget impact" row** per guest.
6. The group puts a ❤ on the hotel: the housing share goes to 400 €, Jessy goes to 470 € 🔴, and **Barcelona's badge goes from 🟡 to 🔴**. The app then shows "This choice puts Jessy 70 € over budget". The ❤ is removed and everything goes back to 🟡.

### B.2 Expected result for Jessy (no ❤)

| Destination | Selected transport (R3) | Housing share | **Jessy's cost** | % of 400 € | Budget |
|---|---|---|---|---|---|
| **Barcelona** | Vueling 06:45, 70 € (🟡) | 300 € | **370 €** | 92.5 % | 🟡 limited |
| Mont-Saxonnex | easyJet + bus, 190 € (🟢) | 300 € | **490 €** | 122.5 % | 🔴 over (+90 €) |
| La Réunion | via Orly, 1,040 € (🟡). *The 910 € flight is excluded because it is 🔴.* | ~267 € | **1,307 €** | 327 % | 🔴 over (+907 €) |

**Answer shown to Jessy:** "Only **Barcelona** fits your budget: 370 € out of 400 €. The Airbnb is a must: the hotel would put you 70 € over."

### B.3 Specifications

| # | Specification |
|---|---|
| B-S1 | "Cheapest" = the cheapest **non-🔴** option (R3). 🔴 options stay visible under **More**, sorted at the end of the list with the reason for the red. |
| B-S2 | "Most Practical" = the best `comfort_score`. On a tie, the cheapest wins. |
| B-S3 | The last mile (airport → accommodation) is added to the transport when the accommodation is more than 20 km from the airport. POC: flat estimate `config.lastMileEurPer10Km` × OSRM distance. **Since T8.9 it is the Extra's transfer to the stay itself (R10, D3), no longer in the transport.** |
| B-S4 | The Housing page shows **one column per source type** (Airbnb, Hotel), each as a carousel, sorted by the offer's rating score (R9: the AI's, or the rules' when it was not available) then by price. Each card says who rated it ("AI 78 · Good fit", "Rule-based 30 · Not recommended"). |
| B-S5 | Each accommodation card shows: bedrooms, beds, nights, **Total**, **Per guest**, **Per guest / night** (explicit label), all coloured by relative price. |
| B-S6 | **Why this?** shows the stored rating at once and the AI's explanation. If there is no explanation yet, it creates an `analyze_stay` job and shows "Analysis in progress…", then updates itself. The score never changes by explaining it. |
| B-S7 | **Compare** accepts 2 or 3 offers and adds a "budget impact" row per guest (cost and tier if this offer were ❤). |
| B-S8 | A housing ❤ is **unique per destination** (group choice). Setting a new one replaces the previous one. |
| B-S9 | When a ❤ puts a guest into 🔴, a toast names the guest and the overrun ("Jessy +70 €"). |

### B.4 Acceptance criteria

- [ ] Jessy's cost: 370 € (🟡) in Barcelona, 490 € (🔴, +90 €) in Mont-Saxonnex, 1,307 € (🔴) in La Réunion.
- [ ] The 910 € flight (3 stops) **never** appears as "Cheapest" but appears under "More" with its 🔴 badge.
- [ ] ❤ on the Barcelona hotel: Jessy goes to 470 € 🔴, Barcelona becomes ineligible, and the "Jessy +70 €" toast is shown.
- [ ] **Why this?** without an analysis: the "in progress" state is shown, then the text appears without reloading the page.

### B.5 Edge cases
- A search fails (a site does not answer, turns us away...): the computation still finishes with what it has, and a banner on every dashboard page says which searches failed and why, with a **Search again** button that makes only those again. "Nothing found" is never left looking like "there is nothing".
- Claude unavailable while the trip is set up: the rules rate (R9), the scores say "Rule-based" and the person is told. Claude unavailable on **Why this?**: the explanation is "unavailable", the stored rating stays on show, and everything else keeps working.
- No accommodation offer with capacity ≥ 3: the app combines 2 nearby accommodations (< 1 km) and says so on the card.

---

## UC-C — The group's point of view (Chloé is looking): "Which destination works for everyone?"

> The figures of this use case are **without the Extra**, as the budget was until T8.9. Since T8.9 they are the ones of UC-D, D.6, and the tests state those.

**Actor:** Chloé, with the others around the screen.
**Question:** "I'm dreaming of La Réunion, but which destination fits **everyone's** budget **and** comfort?"
**Covers:** the compared Budget view, the filters (chips), the trends, the ★ votes, the recommendation, validation and PDF export.

### C.1 Flow

1. **Dashboard → Budget**: 3 cards, each with **Total**, **~ per guest** (average) and tier badge.
2. The **chips** (multi-select, state in the URL `?show=`) expand a section on each card:
   - **Dates**: selected window, nights, limiting guests ("limited by Martin, 05/09").
   - **Housing**: housing total, share per guest, ▲ ▼ ≈ between destinations.
   - **Transport**: cost and duration per guest, coloured comfort.
   - **Extra**: greyed out, tooltip "coming soon".
3. A **"Guest view" selector** replaces the average with the selected guest's actual cost and colours the cards by **their** budget.
4. Each guest casts their ★: Chloé ★ La Réunion, Martin ★ Barcelona, Jessy ★ Barcelona. The ★ count is shown on the cards.
5. The **Recommendation** banner at the top of the Budget view shows "**Barcelona** works for everyone: 1,235 € in total." A **Why?** link opens the details (R7) and, for La Réunion: "Jessy +907 €, Martin cannot go by car (plane fallback: +507 €)".
6. On the Barcelona destination view, **Validate this destination** freezes the scenario, then opens the **summary** (cost per guest, options, links) and offers **PDF export**.

### C.2 Expected result (no ❤)

| Destination | Martin | Chloé | Jessy | **Total** | ~ / guest | Tier | Eligible | ★ | Rank |
|---|---|---|---|---|---|---|---|---|---|
| **Barcelona** | 445 € 🟢 | 420 € 🟢 (120 + 300) | 370 € 🟡 | **1,235 €** | ~412 € | 🟡 | ✅ | 2 | **1 — recommended** |
| Mont-Saxonnex | 745 € 🟡 | 460 € 🟢 (160 + 300) | 490 € 🔴 | 1,695 € | ~565 € | 🔴 | ❌ Jessy +90 € | 0 | 2 |
| La Réunion | ⛔ (fallback 1,307 € 🔴) | 1,087 € 🟡 (820 + 267) | 1,307 € 🔴 | 3,700 €* | ~1,233 € | 🔴 | ❌ Jessy +907 €, Martin ⛔ | 1 | 3 |

\* total computed with Martin's plane fallback, flagged as an assumption.

Trends with the **Housing** chip: La Réunion ▲ (267 €, the cheapest), Barcelona ▼ and Mont-Saxonnex ▼ (300 €, tied as the most expensive).
Trends on the total: Barcelona ▲, Mont-Saxonnex ≈, La Réunion ▼.

### C.3 Specifications

| # | Specification |
|---|---|
| C-S1 | The Budget view reads `GET /api/trips/:id/budget?show=dates,housing,transports&guest=`. Totals, colours, trends and recommendation are computed server-side by `core/*`. |
| C-S2 | Chips are multi-select and persisted in the URL. No active chip = compact cards. |
| C-S3 | Trend: ▲ = minimum value among destinations, ▼ = maximum, ≈ = in between. Ties share the same symbol. If all values are equal: ≈ everywhere. Totals are computed on unrounded values; rounding to the euro only happens at display time. |
| C-S4 | The "Guest view" selector only changes the display, never the data. |
| C-S5 | ★: only one per guest (`guests.favorite_destination_id`). The vote only counts at criterion 4 of R7: **it never makes an over-budget destination eligible**. |
| C-S6 | The recommendation always shows its numbers-backed reasons. For each ineligible destination, the list of blockers (guest + amount or ⛔). |
| C-S7 | **Validate** creates a `summaries` row with a JSON snapshot and sets `trips.status` to `validated`. A later recomputation does not change the snapshot, but shows a "price changed" badge if an offer's price has changed (the fare and the stay; the Extra, made of estimates, is not compared). |
| C-S8 | The PDF is rendered by Playwright from `/trips/:id/summary?print=1`. |

### C.4 Acceptance criteria

- [ ] The displayed totals are 1,235 €, 1,695 € and 3,700 €*, with the tiers and eligibility of table C.2.
- [ ] The recommendation is **Barcelona**, despite Chloé's ★ for La Réunion.
- [ ] Housing chip only: the housing trends are shown as in C.2.
- [ ] Guest view = Jessy: Barcelona 370 € 🟡, Mont-Saxonnex 490 € 🔴, La Réunion 1,307 € 🔴.
- [ ] Validating Barcelona produces a summary and a PDF containing the 3 per-guest costs and the offer links.

---

## UC-D — The Extra: "What will we really spend once there?"

> **Actor:** the group, on the Extra page and the Budget page. **Question:** "Once we're there, what do food, getting to the stay, the tax and what we came for cost each of us, and can we afford it?"
> **Covers:** R10 to R12, the decisions D1 to D7 of [extra.md](./extra.md). Built in task.md Phase 8: the figures below are what the tests state (`tests/extras.test.ts`, and D.6 in the tests of UC-A to UC-C).

### D.1 What the seed adds (`src/db/seed/fixtures.ts`)

> Plausible estimates for testing the rules, not quotes, like §1.3. They have no table yet: T8.3 and T8.4 store them.

**Local prices, one adult, €**

| | Barcelona | La Réunion | Mont-Saxonnex |
|---|---|---|---|
| Groceries for a day | 12 | 15 | 15 |
| Cheap meal / mid-range meal | 15 / 30 | 18 / 30 | 18 / 28 |
| Drink / club entry / pre-drinks per night | 6 / 15 / 4 | 5 / 12 / 4 | 6 / 15 / 4 |
| Ticket / day pass | 2.50 / 10 | 2 / 6 | 2.50 / 10 |
| Taxi: start + per km | 2.50 + 1.50 | 3 + 2 | 4 + 2 |
| Parking a day | 15 | 8 | 10 |
| Rental car a day / fuel a litre | 45 / 1.60 | 40 / 1.90 | 55 / 1.80 |

**The stays**

| Stay | Kitchen | Free parking | Supermarket | To the airport | Tourist tax |
|---|---|---|---|---|---|
| Gràcia apartment | yes | no | 200 m | BCN, 16 km; bus 45 min, 7 €, 05:30–23:30 | 5 € a night, 7 nights at most, not in the price |
| Hotel Cuatro Naciones | no | no | 300 m | BCN, 14 km; bus 35 min, 7 € | 6 € a night, 7 nights at most, not in the price |
| Villa Saint-Gilles | yes (pool, view) | yes | 800 m | RUN, 45 km; bus 75 min, 5 €, 06:00–20:00 | in the Airbnb price |
| Chalet Le Bargy | yes (view) | yes | 4 km | GVA, 45 km; bus 1 h 45, 12 € (too long: a taxi) | in the Airbnb price |

A night bus runs back from the bars to both Barcelona stays.

**Activities** (the AI's list, most worthwhile first). Barcelona: none, because its nights out are priced from the club entry and the drinks. La Réunion: a spa session in Saint-Gilles (60 €) and two free beaches. Le Mont-Saxonnex:
- Lac de Bénit, from the chalet's door;
- Plateau de Solaison, 15 km;
- Lake Annecy, 45 km, 5 €;
- Cascade du Rouget, 25 km;
- the Aiguille du Midi cable car, 60 km, 75 €;
- Parc de Merlet, 55 km, 12 €.

None of the last five can be reached by public transport in 1 h 30.

### D.2 The Extra of each guest (no ❤)

| Destination | Guest | Food | Transfer | Parking | Tax | **Mandatory** | **Plus** | Extra |
|---|---|---|---|---|---|---|---|---|
| Barcelona | Martin (car) | 153 € | — | 150 € | 35 € | **338 €** | **240 €** | 578 € |
| Barcelona | Chloé, Jessy | 153 € | 14 € | — | 35 € | **202 €** | **240 €** | 442 € |
| La Réunion | each | 750 € | 36 € | — | 0 (included) | **786 €** | **78 €** | 864 € |
| Mont-Saxonnex | Martin (car) | 495 € | — | — (free) | 0 (included) | **495 €** | **107.60 €** | 602.60 € |
| Mont-Saxonnex | Chloé, Jessy | 495 € | 141 € | — | 0 (included) | **636 €** | **107.60 €** | 743.60 € |

**Barcelona.** Partying, light budget.
- **Food:** 25 % − 15 points = 10 % of 30 meals, so 3 restaurant meals at 15 € and 27 meals from the supermarket at 4 €.
- **Transfer:** the airport bus both ways, 7 € + 7 €.
- **Tax:** 5 € × 7 nights, because Catalonia stops at 7.
- **Plus:** 5 nights out:
  - entry and 4 drinks, 39 € a night, so 195 €;
  - pre-drinks 20 €;
  - a ticket there and the night bus back, 25 €.

**La Réunion.** Chill, high budget.
- **Food:** 60 % + 20 points = 80 %, so 24 mid-range meals at 30 € and 6 meals at 5 €.
- **Transfer:** Chloé lands at 23:30, Jessy and Martin at 00:00, with no bus at night. One taxi for the three of them (93 € ÷ 3), then the bus back by day (5 €).
- **Plus:** the spa session (the villa has no spa) and 3 day passes.

**Le Mont-Saxonnex.** Nature, high budget.
- **Food:** 15 % + 20 + 15 points (the supermarket is 4 km away) = 50 %, so 15 meals at 28 € and 15 at 5 €.
- **Transfer:** the bus from Geneva takes 1 h 45, so a taxi (94 €). Chloé (11:35) and Jessy (12:55) each take one alone, then share one on the way back (47 € each).
- **Plus:** 6 hike days in 10, fees 92 €. All three ride in Martin's car, so nothing is rented. Fuel for 400 km, 46.80 €, is shared by three.

### D.3 The whole trip with the Extra

The transport no longer carries the last mile (D3): Chloé and Jessy pay 50 € less for Le Mont-Saxonnex, and the Extra's transfer replaces it. The tier follows R6 with the Extra (D2).

| Destination | Guest | Transport + housing | + Mandatory (core) | + Plus | Budget | Tier |
|---|---|---|---|---|---|---|
| Barcelona | Martin | 445 € | 783 € | 1,023 € | 800 € | 🟡: only the Plus puts him over, so not 🔴 |
| Barcelona | Chloé | 420 € | 622 € | 862 € | 1,200 € | 🟢 |
| Barcelona | Jessy | 370 € | 572 € | 812 € | 400 € | 🔴 +172 € |
| Mont-Saxonnex | Martin | 745 € | 1,240 € | 1,347.60 € | 800 € | 🔴 +440 € |
| Mont-Saxonnex | Chloé | 410 € (110 + 300) | 1,046 € | 1,153.60 € | 1,200 € | 🟡 |
| Mont-Saxonnex | Jessy | 440 € (140 + 300) | 1,076 € | 1,183.60 € | 400 € | 🔴 +676 € |
| La Réunion | Martin | ⛔ (plane fallback 1,306.67 €) | 2,092.67 € | 2,170.67 € | 800 € | 🔴 ⛔ |
| La Réunion | Chloé | 1,086.67 € | 1,872.67 € | 1,950.67 € | 1,200 € | 🔴 +672.67 € |
| La Réunion | Jessy | 1,306.67 € | 2,092.67 € | 2,170.67 € | 400 € | 🔴 +1,692.67 € |

Totals: **Barcelona 2,697 €**, **Le Mont-Saxonnex 3,684.80 €**, **La Réunion 6,292 €\*** (\* with Martin's plane fallback).

### D.4 The recommendation

**"No destination works for everyone."** The ranking (R7):
1. **Barcelona**, one guest 🟢. Blocking it: "Jessy +172 €". Food and the tax alone are more than what Jessy's 400 € leaves after the flight and the flat.
2. **Le Mont-Saxonnex.** Blocking it: "Martin +440 €, Jessy +676 €": 1,116 € over in all.
3. **La Réunion.** Blocking it: "Chloé +673 €, Jessy +1,693 €, Martin ⛔" (+1,293 € with the plane): 3,658 € over in all.

Neither of the last two has a guest 🟢, so the smaller total overrun decides (criterion 3, open question 6): Le Mont-Saxonnex comes before La Réunion, where the comfort of the trips alone (88 against 87.7) would have put it after.

### D.5 The advice, by the rules (Barcelona)

- **Martin:** 4 nights out fewer (−192 €), then the supermarket for every meal (−33 €): **798 € of 800 €**.
- **Jessy:** every lever together (4 nights out fewer, the supermarket, bars only on the night left: −240 €) still leaves **572 € of 400 €**. Barcelona does not fit her budget.
- **Chloé:** nothing, because she is within her budget.

### D.6 What changes in UC-A to UC-C when the budget counts the Extra (T8.9)

- **A.4 #3:** Martin is 1,023 € in Barcelona (🟡) and 1,347.60 € at Le Mont-Saxonnex (🔴), no longer 445 € and 745 €.
- **A.4 #4 and #5:** the ❤ "with tolls" still adds 30 €, so Martin goes to 1,053 € and the Barcelona total to 2,727 €. Now his core (813 €) goes over his 800 €: the ❤ puts him 🔴 and the toast says "Martin +13 €".
- **B.4 #1:** Jessy is 812 € (🔴) in Barcelona, 1,183.60 € (🔴) at Le Mont-Saxonnex and 2,170.67 € (🔴) in La Réunion.
- **B.4 #3:** with the ❤ on the hotel, Jessy is already 🔴 before it. The hotel has no kitchen and its own tax: Jessy's Mandatory becomes 396 €, and Jessy's cost 1,106 € (+466 €). The hotel puts Martin 🔴 (his core 1,077 €), so the toast says "Martin +277 €"; the Barcelona total goes to 3,579 €. The Housing page's offers say the same before the ❤: each is worked out with its own Extra.
- **C.4 #1 and #2:** the totals are 2,697 €, 3,684.80 € and 6,292 €\*. No destination is eligible: Barcelona comes first without being recommended, then Le Mont-Saxonnex and La Réunion (D.4).

### D.7 Acceptance criteria (`tests/extras.test.ts`)

- [x] The Extra lines and totals of D.2, for each guest and destination.
- [x] A ❤ on the Barcelona hotel moves the Extra at once: 67 % of meals eaten out, 6 € of tax for 7 nights, so Chloé's Mandatory is 396 €.
- [x] The tiers of D.3, with the Plus never making a guest 🔴 on its own.
- [x] The advice of D.5.
- [x] R10 on what the scenario does not have:
  - Culture: Granada, the first 4 sights, a day pass a day when the old town is not walkable;
  - None;
  - a hotel without a kitchen;
  - five guests in two taxis;
  - a car rented for four guests by plane;
  - hikes on foot or by bus, with no car.
- [x] R11: for Partying, the Gràcia flat (96) before the hotel (88). For Chill, a quiet hotel with a spa and a pool gets 85 in July, and 60 south of the equator in August. Culture and Nature are scored; None is unchanged.

---

## 3. Appendix — Open questions

1. **Partial stay**: Chloé and Jessy could stay until 14/09 after Martin leaves. POC = common window only, partial stays in v2.
2. **Carpooling and pick-up**: Martin could pick Chloé up in Geneva (Mont-Saxonnex) or take Jessy along. The model allows it (`per_vehicle` / occupants), but it is out of the POC.
3. **Geographic scope**: the POC targets European cities, and La Réunion is computed but marked out of scope. Should non-European destinations be blocked at entry? Proposal: no, we keep the badge.
4. **Wizard order**: Guests → Destinations → Transport (unchanged). The Transport step comes last because it needs the other two to show guest × destination reachability and suggest a fallback at the right time.
5. **The scenario's budgets once the Extra counts. Decided at T8.9 (2026-11-14), as proposed: the budgets are kept.** Food and the tourist tax alone take Jessy's 400 € past what the flight and the flat leave, for 10 nights anywhere, so the reference scenario ends on "No destination works for everyone" (UC-D, D.4). It is the honest answer and it tests the blockers. To reverse: raise Jessy's budget in the seed (`scenario-martin.ts`) and the tests' figures.
6. **R7 among destinations that do not work. Decided at T8.9 (2026-11-14), as proposed: the smaller total overrun of the core, between criteria 2 and 3** (R7 criterion 3). Without it the comfort of the trips decided, and La Réunion (6,292 €) came before Le Mont-Saxonnex (3,684.80 €). To reverse: take `overrunEur` out of the sort in `core/recommend.ts`.
7. **Leaving out part of the Plus for one guest (D8)**, such as a guest who does not go clubbing: open. Not in Phase 8; each guest's Plus is kept apart so it can be added.
