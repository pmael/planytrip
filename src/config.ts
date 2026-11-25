// Every tunable constant of the app lives here and nowhere else (use-cases.md §2).

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** R1: an airport counts for a place when it is at most this far away. */
export const AIRPORT_RADIUS_KM = 150;

/** Car costs (A-S6, R5). `distance_km_AR × consumption × fuel_price (+ tolls)`. */
export const car = {
  consumptionLPer100Km: 6.5,
  /** Petrol, when the EU Weekly Oil Bulletin has no price for the countries of the drive (outside the EU, or not reached: `fuel`) */
  fuelPriceEurPerL: 1.8,
  /** Estimated cost per km of motorway driven. */
  tollEurPerKm: 0.09,
  /** Hotel night added for each leg of an `overnight_stop` variant (R2). */
  overnightStopEur: 60,
  /** POC: one person in the car, so `per_vehicle` = that guest's cost (R5). */
  occupants: 1,
} as const;

/**
 * Fuel prices (task.md T8.12): the EU Weekly Oil Bulletin, the European Commission's pump prices with taxes in each EU
 * country, published each Monday. Its page is read for the link to the latest file; both are kept a week.
 */
export const fuel = {
  oilBulletin: { page: "https://energy.ec.europa.eu/data-and-analysis/weekly-oil-bulletin_en", cacheTtlMs: 7 * DAY_MS, timeoutMs: 60_000 },
} as const;

/**
 * Airport → accommodation transfer (B-S3). The spec gives no figure: 11 €/10 km is
 * derived from the Mont-Saxonnex fixture (45 km bus/taxi ≈ 50 €).
 */
export const lastMile = {
  /** Added to the transport only beyond this distance. */
  minDistanceKm: 20,
  eurPer10Km: 11,
} as const;

/** R2: comfort thresholds. Hours are local clock hours, a window is [from, to). */
export const comfort = {
  /** plane / train / bus */
  transit: {
    green: {
      maxStops: 0,
      /** Duration ≤ this × the fastest option on the route. */
      maxDurationRatio: 1.3,
      departure: { from: 8, to: 21 },
    },
    yellow: {
      maxStops: 2,
      maxDurationRatio: 2,
      departureWindows: [
        { from: 6, to: 8 },
        { from: 21, to: 23 },
      ],
    },
    /** Red beyond yellow: ≥ 3 stops, ratio > 2, or a departure between 23:00 and 06:00. */
    red: { minStops: 3, maxDurationHours: 20 },
  },
  /** car, one driver: hours of driving per day */
  car: {
    greenMaxHoursPerDay: 6,
    yellowMaxHoursPerDay: 10,
  },
  /** comfort_score (0–100) weights, sum = 1; drives the "Most Practical" sort. */
  scoreWeights: { duration: 0.4, schedule: 0.3, stops: 0.2, lastMile: 0.1 },
  /** How each criterion maps to its 0–100 sub-score. The spec gives the weights, not the curves. */
  scoreShape: {
    /** Transit duration: 100 at the fastest option, falling linearly to 0 at this ratio. */
    transitZeroAtRatio: 2,
    /** Car driving per day: 100 up to the first value, falling linearly to 0 at the second. */
    carFullBelowHours: 2,
    carZeroAtHours: 12,
    /** Departure window: green, yellow, red. */
    scheduleScores: [100, 50, 0],
    /** Indexed by number of stops, the last value applies to any higher count. */
    stopsScores: [100, 60, 30, 0],
    /** Each euro of last-mile transfer costs this many points. */
    lastMilePenaltyPerEur: 1,
  },
} as const;

/** R6: `ratio = cost / max budget`. ≤ comfy → green, ≤ limited → yellow, above → red. */
export const budgetTier = {
  comfyMaxRatio: 0.8,
  limitedMaxRatio: 1,
} as const;

/**
 * Cache lifetimes. The spec gives no figure; these are working defaults.
 * Geocoding results barely change, prices and listings do.
 */
export const cacheTtlMs = {
  scrape: DAY_MS,
  geo: 30 * DAY_MS,
} as const;

/**
 * The POC's geographic scope (use-cases.md R1, open question 3). A place is in scope when its
 * country is European and it lies in the European box: geocoders report overseas territories
 * such as La Réunion under their parent country ("FR"), so the country alone cannot tell.
 */
export const europe = {
  countryCodes: [
    "AD", "AL", "AT", "AX", "BA", "BE", "BG", "BY", "CH", "CY", "CZ", "DE", "DK", "EE", "ES", "FI",
    "FO", "FR", "GB", "GG", "GI", "GR", "HR", "HU", "IE", "IM", "IS", "IT", "JE", "LI", "LT", "LU",
    "LV", "MC", "MD", "ME", "MK", "MT", "NL", "NO", "PL", "PT", "RO", "RS", "RU", "SE", "SI", "SK",
    "SM", "TR", "UA", "VA", "XK",
  ],
  bounds: { minLat: 34, maxLat: 72, minLon: -25, maxLon: 45 },
} as const;

/** The routing service used to tell whether a road trip exists (use-cases.md R1). */
export const osrm = {
  /** Public demo server: fair use only, and no `exclude=toll`. Override with the OSRM_URL variable. */
  baseUrl: "https://router.project-osrm.org",
  minIntervalMs: 1100,
  timeoutMs: 15_000,
  /**
   * OSRM snaps each point to the nearest road, and ignores small disconnected road networks such as
   * an island's. A point snapped further than this from where it was asked has no road to it.
   */
  maxSnapKm: 25,
} as const;

/** The background worker that runs the jobs of the `jobs` table (task.md §6, phase 3). */
export const jobs = {
  /** Pause between looks at the queue when it is empty */
  pollMs: 1000,
  /** A failing job is tried again this many times (so it runs up to 1 + maxRetries times) */
  maxRetries: 2,
  /** Wait before retry number 1, 2... The last value repeats if there are more retries. */
  backoffMs: [5_000, 30_000],
  /** How often a job that is waiting for others (compute_trip) looks again */
  waitMs: 1000,
} as const;

/**
 * How long each step of a computation should take (core/estimates.ts): learnt from the jobs that ran on this computer.
 * `typicalSeconds` is what is said until a kind of job has run `enough` times: measured in November 2026, one job each.
 */
export const estimates = {
  typicalSeconds: {
    routes: 3,
    "search_transport:plane": 60,
    "search_transport:train": 10,
    "search_transport:bus": 5,
    "search_transport:car": 2,
    search_stays: 70,
    survey_places: 100,
    price_destination: 16,
    rate_stays: 18,
    rate_transport: 18,
    advise_extras: 7,
  },
  otherSeconds: 10,
  /** What is kept when nothing changed (the AI's answers, what is around a stay, the local prices) takes about this long again */
  keptKinds: ["survey_places", "price_destination", "rate_stays", "rate_transport", "advise_extras"],
  keptSeconds: 1,
  enough: 3,
  /** The last times a kind of job ran that are looked at: sites get slower or faster */
  remembered: 12,
  /** The past counts as this many of the computation's own jobs */
  pastWeight: 3,
  /** A job this long was not working all along: the computer slept, or the worker was stopped */
  notWorkAfterSeconds: 900,
  /** Said to be slow past this many times what it usually takes, and at least this long */
  slowFactor: 2.5,
  slowAfterSeconds: 30,
} as const;

/**
 * Where each kind of option comes from: "fixture" is the test dataset of use-cases.md §1.3, anything
 * else is a real site that is scraped (task.md phase 7). The car is always real: it needs no
 * scraping. Airbnb and Google Hotels (stays), Google Flights (flights) and FlixBus (buses, trains) are scraped;
 * TRIP_STAYS_ADAPTER and TRIP_FLIGHTS_ADAPTER ("fixture") go back to the dataset, TRIP_GROUND_ADAPTER and
 * TRIP_HOTELS_ADAPTER ("none") search no bus, train or hotel, without touching the code.
 */
export const adapters = {
  flights: process.env.TRIP_FLIGHTS_ADAPTER === "fixture" ? "fixture" : "google-flights",
  stays: process.env.TRIP_STAYS_ADAPTER === "fixture" ? "fixture" : "airbnb",
  /** Hotels, next to Airbnb's rentals. "none" searches no hotel. Only used when `stays` is "airbnb". */
  hotels: process.env.TRIP_HOTELS_ADAPTER === "none" ? "none" : "google-hotels",
  /** Buses, and the trains FlixBus sells. "none" searches no bus or train at all. */
  ground: process.env.TRIP_GROUND_ADAPTER === "none" ? "none" : "flixbus",
  /** Trains all over Europe: Transitous' timetables with the prices of the sources that have them, and RegioJet. "none" searches none. */
  trains: process.env.TRIP_TRAINS_ADAPTER === "none" ? "none" : "transitous",
} as const;

/** How the real sites are scraped (task.md T7.1). */
export const scraping = {
  /** Chrome's own folder: kept between runs so that cookies and consent choices stay */
  profileDir: "data/chrome-profile",
  /** No window by default. SCRAPE_HEADFUL=1 shows the browser, which some sites trust more */
  headless: process.env.SCRAPE_HEADFUL !== "1",
  /** Pause between two page loads, chosen at random within this range so the rhythm is not mechanical */
  pauseMs: { min: 2500, max: 5000 },
  pageTimeoutMs: 45_000,
} as const;

/**
 * Airbnb (task.md T7.3). It is searched by a map box around the destination's coordinates: asking by
 * name puts "Saint-Gilles" (La Réunion) in Europe.
 */
export const airbnb = {
  baseUrl: "https://www.airbnb.com",
  /** Pages of results read, 18 listings each */
  searchPages: 2,
  /** Half-width of the search box in km, tried in turn until the area gives enough listings */
  radiiKm: [6, 15, 30],
  /** Fewer usable listings than this in the box and the next, wider, one is tried */
  minCards: 10,
  /** Listings opened one by one, at most: that is where the exact capacity and room type are */
  detailLimit: 16,
  /** For a group of N, the listings kept sleep N to N + this many, never fewer */
  extraCapacity: 1,
  /** When fewer than `minListings` fit that band, it is widened to N + this many */
  relaxedExtraCapacity: 3,
  minListings: 4,
  /** Opening listings stops once this many fit the band */
  enough: 8,
} as const;

/**
 * Google Flights (task.md T7.2). It is asked for a round trip between two airports, in euros, for one
 * adult in economy. What it shows for each outbound flight is the price of the round trip.
 */
export const googleFlights = {
  baseUrl: "https://www.google.com/travel/flights",
  language: "en",
  /** Which Google it talks to: it decides the language of the consent page and little else */
  region: "FR",
  currency: "EUR",
  /** A place with several airports (Paris) is searched airport pair by airport pair, at most this many pairs */
  maxAirportPairs: 4,
  /** Outbound flights kept, cheapest first */
  maxOptions: 10,
  /** How long to wait for Google's answer to a search or to a chosen flight */
  answerTimeoutMs: 25_000,
} as const;

/**
 * Google Hotels (task.md T7.4). Booking.com turns an automated browser away, so the hotels come from
 * Google Hotels, which lists Booking's prices with the other sites'. A search is for one room of up to
 * `guestsPerRoom` guests; a bigger group takes several rooms.
 */
export const googleHotels = {
  baseUrl: "https://www.google.com/travel/search",
  language: "en",
  region: "FR",
  currency: "EUR",
  /** Most guests put in one room: a group of 4 takes 2 rooms of 2 */
  guestsPerRoom: 3,
  /** Hotels kept, the first Google lists (its own relevance order) */
  maxResults: 12,
  /** How long to wait for the list of hotels */
  answerTimeoutMs: 25_000,
} as const;

/**
 * FlixBus (task.md T7.5). Its own search service answers plain requests, so no browser is needed:
 * the city of each end is looked up by name, then the rides of each day are listed. The search lists
 * buses and the trains FlixBus sells, so one answer serves both modes.
 */
/**
 * Trains (task.md T7.8, train-sources.md). Transitous gives the timetables of the whole of Europe; a price comes
 * from the source that has the train's real fare (Trenitalia, RegioJet), from SNCF's published fare range for French
 * high-speed trains, or else from the distance. Only the first kind is a real price: the others are marked as estimates.
 */
export const trains = {
  transitous: {
    apiUrl: "https://api.transitous.org/api",
    /** Transitous asks every program to say who it is, with a way to reach them: TRIP_CONTACT in .env.local */
    contact: process.env.TRIP_CONTACT ?? null,
    /** Only a few requests per search, and they ask not to be hammered */
    pauseMs: { min: 1000, max: 2500 },
    timeoutMs: 30_000,
    /** The journeys of a day are looked for from this hour (UTC: 5 or 6 in the morning in Europe), for this many seconds */
    searchFromHourUtc: 4,
    searchWindowSeconds: 16 * 60 * 60,
    /** Journeys asked for per direction (one request gives the whole day) */
    itineraries: 40,
    /** A journey with more changes, or taking longer than this many times the quickest, is not offered */
    maxTransfers: 3,
    maxDurationRatio: 2,
    /** The way to the first station and from the last is on foot or by car, up to this long (seconds) */
    maxAccessSeconds: 3600,
    /** The station at the destination end must be within this distance of the destination (a taxi from there is counted as the last mile) */
    maxStationDistanceKm: 40,
    /** Round trips kept per search: the fewest changes and the quickest first, shown in the order of the day */
    maxOptions: 10,
    /** Only one way back is kept, so only a few are priced to find the cheapest */
    maxBackOptions: 5,
  },
  /** Where trains are checked and booked: the link of a card, by who runs the train */
  links: {
    sncf: "https://www.sncf-connect.com/en-en/",
    trenitalia: "https://www.lefrecce.it/",
    regiojet: "https://www.regiojet.com/",
    other: "https://www.thetrainline.com/",
  },
  /**
   * SNCF's stations with their position (open data, data.sncf.com "gares-de-voyageurs"): where the trains read on SNCF Connect
   * leave and arrive, by UIC number, for the transfer to the stay. About 2,800 stations, a few times a year.
   */
  sncfStations: {
    url: "https://ressources.data.sncf.com/api/explore/v2.1/catalog/datasets/gares-de-voyageurs/exports/csv?delimiter=%3B",
    file: "data/sncf-stations.csv",
    maxAgeMs: 30 * DAY_MS,
    timeoutMs: 60_000,
  },
  /** SNCF's published fare range for TGV INOUI and OUIGO (open data, data.gouv.fr) */
  sncfFares: {
    url: "https://www.data.gouv.fr/api/1/datasets/r/cffcec3b-1c13-4e92-b530-1db00bb3ac1b",
    file: "data/sncf-fares.csv",
    maxAgeMs: 30 * DAY_MS,
    timeoutMs: 60_000,
    /** Second class, full fare: the price counted is this far between the lowest and the highest (0 lowest, 1 highest) */
    positionInRange: 0.5,
  },
  /**
   * What a train costs when no source knows: so much per kilometre of the way (as the crow flies, station to station), at
   * least this much, each way. Between the live fares of 4 December 2026: Milano to Roma 0.14 €/km, Toulouse to Lyon 0.18 to 0.28.
   */
  distanceEstimate: { eurPerKm: 0.15, minEur: 9 },
  trenitalia: {
    apiUrl: "https://www.lefrecce.it/Channels.Website.BFF.WEB/website",
    pauseMs: { min: 1000, max: 2500 },
    timeoutMs: 30_000,
    /** It answers 10 solutions at a time: this many pages are read at most to reach the last train wanted */
    pageSize: 10,
    maxPages: 6,
  },
  /**
   * One day of SNCF Connect trains, read through the person's running Chrome by a Python script (tools/sncf-api/fetch_day.py),
   * run as a separate process, one at a time. While it is on and answers, its trains are the trains of a search, at their real
   * price; Transitous' timetable and the estimates are only for when it cannot answer.
   */
  sncfConnect: {
    /** Off until the person turns it on in Settings (saved in appSettings.file). It needs the app to run on the Mac where Chrome is open */
    enabled: false,
    /** Where Chrome writes its debugging port while remote debugging is on (macOS stable and beta, Linux), relative to the home folder */
    chromePortFiles: [
      "Library/Application Support/Google/Chrome/DevToolsActivePort",
      "Library/Application Support/Google/Chrome Beta/DevToolsActivePort",
      ".config/google-chrome/DevToolsActivePort",
    ],
    script: "tools/sncf-api/fetch_day.py",
    /**
     * A whole day takes several pages of about 8 trains each, 0.3 s apart, plus connecting to Chrome (about 12 s), and once
     * more when the tab was lost; uv's first run also installs playwright
     */
    timeoutMs: 120_000,
    /** After SNCF Connect turned a request away, it is not asked again for this long */
    blockedCooldownMs: 30 * 60_000,
  },
  regiojet: {
    apiUrl: "https://brn-ybus-pubapi.sa.cz/restapi",
    pauseMs: { min: 800, max: 1800 },
    timeoutMs: 30_000,
    /** A city of the answer is the place asked for only when it lies within this distance of it */
    maxCityDistanceKm: 40,
    maxOptions: 6,
  },
} as const;

/** The choices made in the app's Settings that are not a trip's: read by the pages and by the worker, on each search. */
export const appSettings = {
  file: "data/settings.json",
} as const;

export const flixbus = {
  apiUrl: "https://global.api.flixbus.com",
  /** Where an offer's link opens */
  shopUrl: "https://shop.flixbus.com/search",
  locale: "en_GB",
  currency: "EUR",
  /** Pause between two requests, chosen at random within this range */
  pauseMs: { min: 800, max: 1800 },
  timeoutMs: 20_000,
  /** A city of the answer is the place asked for only when it lies within this distance of it */
  maxCityDistanceKm: 50,
  /** Round trips kept, cheapest first */
  maxOptions: 8,
} as const;

/**
 * The simple rules that rate stays and journeys when the AI is not available: the same questions the
 * AI is asked (does it fit, what does it cost the poorest guest, is it any good), answered by formula.
 */
export const ratingRules = {
  /** Scores of 70 and more are good, the rest ok: the rules call something bad only when it is plainly unusable */
  verdicts: { good: 70 },
  /**
   * What is plainly unusable keeps only this share of what it would have scored, so it always ends up
   * below the rest but is still told apart: a well rated place nobody can afford is less bad than a poor one
   */
  badScoreShare: 0.3,
  stay: {
    weights: { affordability: 0.5, quality: 0.25, capacity: 0.15, distance: 0.1 },
    /** The stay's share per guest, against the poorest guest's budget: at this share it is as good as it gets, at 100 % worth nothing */
    comfortableShare: 0.3,
    /** A rating of this earns nothing, a rating of 5 earns everything */
    ratingFloor: 3.5,
    /** Under this many reviews a rating is less certain, and earns at most `fewReviewsCap` of the quality score */
    fewReviews: 10,
    fewReviewsCap: 0.6,
    /** What a listing with no rating yet earns of the quality score */
    unratedQuality: 0.5,
    /** Room beyond one spare place is paid for and unused: each extra person costs this much of the capacity score */
    unusedCapacityPenalty: 0.25,
    /** Distance from the destination's centre: at this one it is as good as it gets, at the other worth nothing */
    distanceKm: { full: 3, zero: 15 },
  },
  transport: {
    weights: { comfort: 0.6, affordability: 0.4 },
    /** What the journey costs, against the poorest guest's budget: as good as it gets at the first, worth nothing at the second */
    shares: { full: 0.15, zero: 0.8 },
  },
} as const;

/**
 * What is around each place to stay, from OpenStreetMap through the Overpass API (task.md T8.3, use-cases.md R10, R11).
 * One request per destination, for an area that covers its stays and its centre, rounded out to a grid so that the next
 * search of the same place asks the same and finds the answer kept. Open data, free, public servers ask for a light use
 * (wiki.openstreetmap.org/wiki/Overpass_API); OVERPASS_URL points at another server.
 */
export const places = {
  overpassUrl: process.env.OVERPASS_URL ?? "https://overpass-api.de/api/interpreter",
  /** What the server is allowed to spend on the query, and how long we wait for it */
  serverTimeoutS: 120,
  timeoutMs: 150_000,
  pauseMs: { min: 1000, max: 2000 },
  /** OpenStreetMap changes slowly: an area is asked again after a month */
  cacheTtlMs: 30 * DAY_MS,
  /** The area: the stays and the destination's centre, `centreKm` around the centre and `marginKm` around everything */
  area: { centreKm: 3, marginKm: 1.2, gridDeg: 0.05 },
  /** How far the nearest supermarket and hiking path are looked for, and the nearest natural park or reserve */
  searchKm: { supermarket: 5, trail: 5, park: 40 },
  /**
   * A park is known by the box around it. Up to this size (across) the box is close to its shape; a bigger one's box says
   * nothing (Collserola's covers half of Barcelona and ends 200 m from the old town), and its marked paths decide.
   */
  parkBoxKm: 10,
  /** Counted around each stay */
  withinKm: { bars: 0.5, nightclubs: 1, sights: 1 },
  /**
   * The nightlife district and the historic centre: the spots, on a grid, with at least `share` of the most bars (or
   * sights) within `radiusKm`. An area whose busiest spot has fewer than `min*` has none.
   */
  clusters: { radiusKm: 0.5, stepKm: 0.25, share: 0.5, minNightlife: 10, minHistoric: 5 },
} as const;

/**
 * The local prices and the things to do at a destination (task.md T8.4, use-cases.md R10): the AI gives them once, while
 * the trip is set up; without it, the rules give the EU average price of each thing times the country's price level
 * (Eurostat, prc_ppp_ind, EU27 = 100), marked "rule-based".
 */
export const extraPrices = {
  /** Every country's price levels, every category, the last years: one small file, kept on disk for three months */
  eurostat: {
    url: "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/prc_ppp_ind?format=JSON&lang=EN&na_item=PLI_EU27_2020&sinceTimePeriod=2022",
    file: "data/eurostat-price-levels.json",
    maxAgeMs: 90 * DAY_MS,
    timeoutMs: 60_000,
  },
  /**
   * What each thing costs at the EU average (price level 100), one adult, in euros: the app's own round figures for
   * 2024, not a statistic. A country's price level scales them.
   */
  euAverage: {
    groceriesPerDay: 12,
    cheapMeal: 15,
    midMeal: 30,
    drink: 6,
    clubEntry: 15,
    preDrinks: 4,
    transitTicket: 2.2,
    transitDayPass: 8,
    taxiStart: 3.5,
    taxiPerKm: 1.6,
    parkingPerDay: 15,
    carRentalPerDay: 45,
    fuelPerL: 1.75,
  },
  /** The Eurostat category whose price level scales each thing */
  levelOf: {
    groceriesPerDay: "A010101",
    cheapMeal: "A0111",
    midMeal: "A0111",
    drink: "A0111",
    clubEntry: "A0109",
    preDrinks: "A010201",
    transitTicket: "A010703",
    transitDayPass: "A010703",
    taxiStart: "A010703",
    taxiPerKm: "A010703",
    parkingPerDay: "A0107",
    carRentalPerDay: "A0107",
    fuelPerL: "A0107",
  },
  /** An AI price this far from the rules' (below the first share, above the second) is not believed: the rules' is kept */
  believable: { min: 0.33, max: 3 },
  /** How many things to do the AI is asked for, by objective (none for None) */
  activities: { partying: 5, chill: 4, culture: 6, nature: 8, none: 0 },
  /** An activity is kept when the map finds it this close to the destination; a hike may be farther than a museum */
  placeCheckKm: { city: 30, nature: 80 },
  timeoutMs: 150_000,
  /**
   * A rental car's real daily price for a Nature trip (task.md T8.11, rental-sources.md): DiscoverCars' published
   * average at the destination's airport, month by month. Its country and airport pages only, one at a time, kept a month.
   */
  rentalCars: { site: "https://www.discovercars.com", cacheTtlMs: 30 * DAY_MS, pauseMs: { min: 2_000, max: 4_000 }, timeoutMs: 30_000 },
} as const;

/**
 * The tourist tax (task.md T8.5, use-cases.md R10): what a guest of a whole rented home pays per night, when the stay's
 * price does not already have it. France: each commune's own rates (open data, DELTA). Elsewhere: this table, then the
 * AI (task.md T8.4's answer). Rates checked on 2026-11-14 against the sources named; they change, often in April or
 * January.
 */
export const touristTaxes = {
  france: {
    /** The commune at a point (its INSEE code), from the State's geography API */
    communeUrl: "https://geo.api.gouv.fr/communes",
    /** Every commune's voted rates, from 2024 (data.economie.gouv.fr, "Tarifs taxe de séjour - Delta") */
    ratesUrl: "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/delta_deliberation_ts_tarif0/records",
    /** The rate of a rental with no star rating, which most Airbnbs are: a share of the price per person per night */
    unclassified: "Hébergements sans classement ou en attente de classement",
    cacheTtlMs: 30 * DAY_MS,
    timeoutMs: 30_000,
  },
  /**
   * Places outside France, by country and a circle (`near`, km) or a box. `perPersonNightEur` 0: no tourist tax there.
   * `percentOfPrice`: a share of the price per person per night instead.
   */
  places: [
    {
      name: "Barcelona",
      country: "ES",
      near: { lat: 41.3874, lon: 2.1686, km: 12 },
      perPersonNightEur: 9.5,
      maxNights: 7,
      note: "a tourist flat: the Catalan tax (€4.50) and Barcelona's surcharge (€5), from April 2026",
      source: "https://www.idealista.com/en/news/node/886033",
    },
    { name: "Lisbon", country: "PT", near: { lat: 38.7223, lon: -9.1393, km: 12 }, perPersonNightEur: 4, maxNights: 7, note: "€4 a night, 7 nights at most", source: "https://www.travelpulse.com/news/destinations/lisbons-tourist-tax-is-increasing-this-fall" },
    { name: "Porto", country: "PT", near: { lat: 41.1579, lon: -8.6291, km: 10 }, perPersonNightEur: 3, maxNights: 7, note: "€3 a night, 7 nights at most", source: "https://www.idealista.pt/en/news/legal-advice-in-portugal/2025/08/05/70982-tourist-tax-in-portugal-2025-rates-for-lisbon-the-algarve-madeira" },
    { name: "Prague", country: "CZ", near: { lat: 50.0755, lon: 14.4378, km: 15 }, perPersonNightEur: 2, maxNights: 60, note: "CZK 50 a night", source: "https://www.mappr.co/europe-tourist-taxes/" },
    { name: "Berlin", country: "DE", near: { lat: 52.52, lon: 13.405, km: 20 }, percentOfPrice: 7, maxNights: null, note: "7.5 % of the price without its 7 % VAT", source: "https://www.visitberlin.de/en/city-tax-berlin" },
    { name: "Madrid", country: "ES", near: { lat: 40.4168, lon: -3.7038, km: 40 }, perPersonNightEur: 0, maxNights: null, note: "no tourist tax", source: "https://www.thelocal.es/20240508/why-spains-tourist-taxes-are-not-such-a-big-deal" },
    {
      name: "Andalusia",
      country: "ES",
      box: { south: 35.9, west: -7.6, north: 38.75, east: -1.6 },
      perPersonNightEur: 0,
      maxNights: null,
      note: "no tourist tax in force in Andalusia (2026)",
      source: "https://www.idealista.com/en/news/legal-advice-in-spain/2026/07/07/856013-spain-s-tourist-tax-barcelona-hike-new-city-levies-for-2026",
    },
    { name: "Finland", country: "FI", perPersonNightEur: 0, maxNights: null, note: "no tourist tax", source: "https://etoa.org/tourist-tax-rates/" },
  ],
} as const;

/**
 * The Extra: what the guests spend once there (extra.md, use-cases.md R10 to R12). Shares are whole percentage points,
 * so no rounding of 0.25 − 0.15 decides how many meals are eaten out.
 */
export const extras = {
  /** R10 food: meals counted per night of the stay */
  mealsPerNight: 3,
  /** R10 food: the share of meals eaten out, by objective, before the budget level and the stay move it (decision D7) */
  restaurantSharePct: { none: 30, partying: 25, culture: 40, chill: 60, nature: 15 },
  /** Points added to the share by the destination's budget level; a high budget eats mid-range meals */
  budgetLevelSharePts: { light: -15, medium: 0, high: 20 },
  /** A supermarket farther than this from the stay makes shopping harder: the share goes up */
  supermarketCloseKm: 1,
  farSupermarketSharePts: 15,
  /** A stay without a kitchen (most hotels): at least this share of meals is eaten out */
  noKitchenMinSharePct: 67,
  /** R10 transfer: public transport when a journey of at most this long exists at that hour, else a taxi */
  transfer: {
    maxTransitMin: 90,
    taxiSeats: 4,
    shareWithinMin: 30,
    /** A taxi's road is this much longer than the straight line */
    roadFactor: 1.3,
    /** Public transport is asked for at midday (UTC, about 12:00 or 13:00 in Europe) and counted on between these local hours only */
    askAtUtc: "11:00",
    transitHours: { from: "06:00", to: "23:00" },
    /** The arrival points looked at: the most used, those within `mergeKm` of another counting as the same */
    maxHubs: 3,
    mergeKm: 2,
    /** Back from a night out: asked at 03:00 local (02:00 UTC), a night bus within the hour or a taxi */
    nightAtUtc: "02:00",
  },
  partying: { nightsPerNightOut: 2, minNightsOut: 1, drinksPerNight: 4, taxiSeats: 4, nightTransportAt: "03:00" },
  /** Months of the northern hemisphere; south of the equator they are six months on (R11) */
  chill: { summerMonths: [6, 7, 8, 9], winterMonths: [11, 12, 1, 2, 3], nightsPerDayPass: 3 },
  culture: { minActivities: 3, maxActivities: 5, walkableKm: 1.5 },
  /** On foot up to `walkKm` from the stay, else public transport up to `maxTransitMin`, else a car */
  nature: { hikeSharePct: 60, walkKm: 2, maxTransitMin: 90, seatsPerCar: 5 },
  none: { transitTicketsPerNight: 2 },
  /** R11: what the objective weighs in the rules' score of a stay, and how each objective is scored (0 to 1) */
  rating: {
    objectiveWeight: 0.25,
    /** A distance or count nobody knows counts as halfway */
    unknown: 0.5,
    partying: {
      weights: { nightlife: 0.5, centre: 0.3, home: 0.2 },
      nightlifeKm: { full: 0.5, zero: 5 },
      centreKm: { full: 1, zero: 8 },
      /** What a hotel earns of the "home" part: the group cannot gather in it before going out */
      hotelHome: 0.4,
      /** "No parties" or quiet hours in the listing's rules */
      quietRulesPenalty: 0.1,
    },
    chill: {
      weights: { spa: 0.3, season: 0.25, view: 0.15, quiet: 0.2, calm: 0.1 },
      /** Bars within 500 m: quiet at the first, noisy at the second */
      quietBars: { full: 5, zero: 40 },
      /** Pool or sauna outside summer and winter */
      offSeason: 0.5,
    },
    culture: {
      weights: { historic: 0.7, sights: 0.3 },
      historicCentreKm: { full: 0.5, zero: 4 },
      /** Sights within 1 km for the full score */
      fullSights: 10,
    },
    nature: {
      weights: { nature: 0.8, parking: 0.2 },
      /** By road, to the nearest trailhead or natural park */
      natureKm: { full: 2, zero: 40 },
    },
  },
} as const;

/**
 * Where the `claude` CLI runs (task.md T6.1). "local" is the CLI installed and logged in on this machine;
 * "docker" runs each call in a throwaway container made from docker/claude (`npm run claude:image`),
 * signed in with a long-lived token (`claude setup-token`, put as CLAUDE_CODE_OAUTH_TOKEN in .env.local)
 * instead of this machine's own login. TRIP_CLAUDE_MODE=docker switches.
 */
export const claude = {
  mode: process.env.TRIP_CLAUDE_MODE === "docker" ? "docker" : "local",
  image: "planytrip-claude",
  /** The environment variable that carries the token into the container */
  tokenVariable: "CLAUDE_CODE_OAUTH_TOKEN",
  /** What a container may use: it only writes text */
  memory: "1g",
  pidsLimit: 256,
} as const;

/**
 * Real train prices, seen by the person on their own SNCF Connect pages and sent by the browser extension
 * (task.md T7.9, price-model.md), and the model trained on them.
 */
export const priceObservations = {
  /** An observed price replaces the estimate on a card for this long; after that it is only kept for training */
  freshMs: 24 * HOUR_MS,
  /** A train of the page and a train of an option are the same one when they leave within this many minutes of each other */
  matchMinutes: 2,
  /** Trains in one import */
  maxOffers: 200,
} as const;

export const priceModel = {
  /** Written by tools/price-model/train.py, read by the app */
  file: "data/price-model.json",
  reportFile: "data/price-model-report.json",
  /**
   * The model is used only with this much data, and only when it beats the published range by this much (held-out). A model must also have
   * seen several routes and days: held out one route-day at a time, a model trained on a single route would look fine and know nothing of the rest.
   */
  activation: { minObservations: 100, minSessions: 15, minImprovement: 0.15, minRowsPerModel: 30, minRoutes: 3, minGroups: 10 },
  /** A model older than this is flagged: fares drift */
  staleAfterDays: 60,
  /** How long a training run may take */
  trainTimeoutMs: 120_000,
} as const;

/** The AI that rates what was scraped, once, while the trip is set up (use-cases.md R4, B-S1). */
export const ratings = {
  /** The most candidates of one destination shown to the AI in one question; the rest are rated by the rules */
  maxPromptCandidates: 25,
  /** The AI reads a lot and writes a lot: more room than a short question */
  timeoutMs: 150_000,
} as const;

/**
 * The routing engine that knows about tolls (the public OSRM does not). Free public instance with
 * fair use and a 1,500 km limit per route; override with the VALHALLA_URL variable to use another.
 */
export const valhalla = {
  baseUrl: "https://valhalla1.openstreetmap.de",
  minIntervalMs: 1100,
  timeoutMs: 30_000,
} as const;
