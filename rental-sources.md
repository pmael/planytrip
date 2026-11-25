# Trip Manager — Rental car prices

> Companions: [extra.md](./extra.md) (§6.4, decision D6) · [task.md](./task.md) · [train-sources.md](./train-sources.md)
> Written 2026-11-15. Goal: a real daily price for the car a Nature trip rents at the arrival airport for the whole stay, instead of the AI's estimate, without getting past CAPTCHAs or bot walls.

---

## What was actually tested (2026-11-15, from the Mac, residential connection)

Each source was called once or twice with the app's own `User-Agent` (`planytrip/1.0 (personal use, low volume)`, no contact) and no other header that pretends to be a browser. Its `robots.txt` was read first: a page it forbids was not fetched.

| Source | Result | Consequence |
|---|---|---|
| Getaround Europe, search (`fr.getaround.com/search`) | **Forbidden by robots.txt**: `/search`, `/autocomplete`, and any `?address=` or `?end_date=` query. The one plain request (sent before reading it) was sent back to the home page | Not used |
| Getaround, city pages (`/location-voiture/lyon`, `/location-voiture/annecy`) | **Answer, with real listed prices**: "dès 25 €/j"; cars "à partir de 5 €/h • 45 €/jour". About 4,000 such pages in its sitemap. No dates and no season: the cheapest listings of private cars around a town, not a rental at an airport | Not used: a "from" price with no season says less than the AI's estimate. It could be a floor for a French town later |
| GoMore (`gomore.es`) | No answer (the connection failed) | Not used. It merges with Getaround in 2026 |
| Rentalcars.com (`/en/city/es/barcelona/`) | **Walled**: an AWS WAF challenge, no prices in the page | Not used |
| **DiscoverCars**, place pages: airport (`/spain/barcelona/bcn`, `/france/ferney-voltaire/gva`), city (`/spain/barcelona`), country (`/france`, `/spain`) | **Answer, no wall.** Each place page publishes "Average rental costs per day", **one figure per month**, from its customers' bookings: Barcelona airport 38 € in August, 17 € in November; Geneva, Swiss side, 68 € in August and 86 € in July; Geneva, French side, 53 € in August. A country page lists its airport pages. Its robots.txt forbids the search, the offers, the bookings and the JSON, not these pages. The deals at the top of a page (2 to 4 € a day) are teasers for dates it does not say | **Used**, below |
| DiscoverCars for La Réunion | No page found: `/reunion` and `/reunion/saint-denis/run` are 404, and RUN is not on the France page | La Réunion keeps the AI's estimate |
| Kayak (`kayak.com/Cheap-Barcelona-Car-Rentals.22567.cars.ksp`) | **Answers**, but in dollars on kayak.com, and only the cheapest and the dearest month ("November, $18/day"; "December, $41/day") and "from $7/day" | Not used: DiscoverCars gives every month, in euros |
| Turo | Not called: its own help pages list North America, Australia and the UK only | Not used |
| Sixt, Europcar, Hertz, Avis, Enterprise, Ucar, Rent A Car | Not tested | Later, only if DiscoverCars stops answering |

The rules of [train-sources.md](./train-sources.md) apply: no CAPTCHA, no challenge page, nothing forged. A source that answers like a wall is blocked for that search and never retried around. Their terms of use were not reviewed: the app reads these pages for personal use, at low volume, and keeps each a month, as it does for Airbnb and Google Hotels.

---

## What was built (task.md T8.11)

- **`src/scrapers/prices/discovercars.ts`**:
  - `createDiscoverCarsRental` reads the destination's country page to find the page of the first of its airports that has one, then that airport's twelve monthly averages (`monthlyAverages`, euros only).
  - It weights the stay's months by its nights (`stayAverage`). 26 August → 5 September is six nights of August and four of September.
  - Two pages per country and airport, one at a time, 2 to 4 s apart (`config.extraPrices.rentalCars`), each kept a month in the scrape cache.
  - A 403, a 429 or a verification page is a `ScrapeBlockedError`; a page that does not exist means no price; a chart that is no longer where it was, or not in euros, is a `ScrapeChangedError`.
- **Used for Nature only**, the one objective that rents cars (R10, D6), by the `price_destination` job (`worker/handlers/price-destination.ts`):
  - With the AI's prices, or the rules' when the AI is not there, the car's daily price becomes DiscoverCars' average, as a new kind of price, `published`, with whose figure it is and the page's address.
  - Prices kept from before are given the car's price on the next computation, without asking the AI again.
  - When DiscoverCars has no page or turns the app away, the estimate stays, and the prices' message says why.
- **On the Extra page** the car's line says "49.40 € (DiscoverCars' average at GVA, August and September)", marked "published average", with ≈ because it is an average, not the price of those dates. The figure links to the page, where a person can search their own dates.
- **Checked for real on 2026-11-15:**
  - Le Mont-Saxonnex (France, the French side of Geneva airport), 26 August → 5 September: **49.40 € a day** (53 € in August, 44 € in September). The AI's figure in the seed is 55 €.
  - The same dates at Barcelona airport: 31.60 €.
  - A second ask comes from the cache in 2 ms.
- **Limits:**
  - It is the average of every car booked there, while small cars are the cheapest.
  - The insurance is what the site sells by default; a driver under 25 and the deposit are not counted.
  - A trip in France uses the French side of Geneva airport, as its country page lists it. The Swiss side is dearer: 60.80 € a day for the same dates.
  - The figures change as the site updates them, and a cached page is a month old at most.
