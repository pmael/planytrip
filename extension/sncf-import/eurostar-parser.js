// Turns what the Eurostar search page shows into the observations Trip Manager takes: the same payload as sncf-parser.js.
// Pure function, no DOM access: site-eurostar.js reads the page and passes strings. Also loadable from Node for tests.
(function (root) {
  // Months by their first letters, in the languages the site comes in. Only used when no train of the page carries its own date
  const MONTHS = [
    [1, /^jan/], [2, /^(fev|feb)/], [3, /^mar/], [4, /^(avr|apr)/], [5, /^(mai|may)/], [6, /^(juin|jun)/],
    [7, /^(juil|jul)/], [8, /^(aou|aug)/], [9, /^sep/], [10, /^oct/], [11, /^nov/], [12, /^dec/],
  ];

  const TIME = /\b([01]?\d|2[0-3]):([0-5]\d)\b/g;
  const PRICE = /(\d{1,4}(?:[,.]\d{2})?)\s?€/;
  // What the page marks a train with: "9007-2026-10-30-07:05-08:30" = number, day, departure, arrival. It starts the id of each of the
  // fares' tabs ("…-tab-0-panel") and of the row's title ("train-title-…")
  const TRAIN_ID = /([A-Za-z0-9]+)-(\d{4}-\d{2}-\d{2})-(\d{2}:\d{2})-(\d{2}:\d{2})/;
  // The fares, from the cheapest class up: the order of the tabs, and what the page names them
  const CLASSES = ['standard', 'plus', 'premier'];

  const priceOf = (s) => {
    const m = PRICE.exec(s ?? '');
    return m ? Number(m[1].replace(',', '.')) : null;
  };

  // "Durée totale: 2 h heures 25 min minutes", "2 heures 25 minutes": hours then minutes, however the page words them
  function durationOf(text) {
    const h = /(\d+)\s*(?:h\b|heures?|hours?)/i.exec(text ?? '');
    const m = /(\d+)\s*(?:min\b|minutes?)/i.exec(text ?? '');
    return h || m ? (h ? Number(h[1]) * 60 : 0) + (m ? Number(m[1]) : 0) : null;
  }

  function changesOf(text) {
    if (/\b(direct|non[- ]stop|sans changement)\b/i.test(text ?? '')) return 0;
    const m = /(\d+)\s*(?:changements?|changes?|correspondances?)/i.exec(text ?? '');
    return m ? Number(m[1]) : null;
  }

  // "1 adulte", "2 adultes, 1 enfant": who the prices are for
  function travellersOf(text) {
    const found = [...(text ?? '').matchAll(/\b(\d+)\s*(adult[eos]?s?|jeunes?|youths?|seniors?|enfants?|child(?:ren)?|ni[nñ]os?|b[ée]b[ée]s?|infants?)\b/gi)];
    // The page may write it twice (a layout for a wide window and one for a narrow one): said once
    return found.length ? [...new Set(found.map((m) => `${m[1]} ${m[2].toLowerCase()}`))].join(', ') : null;
  }

  // "ven. 30 oct.vendredi 30 octobre - 115 €": the day of the tab that is selected, with no year
  function dayOf(text, now) {
    const m = /(\d{1,2})\s*([A-Za-zÀ-ÿ]{3,})/.exec(text ?? '');
    if (!m) return null;
    const word = m[2].normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const month = (MONTHS.find(([, re]) => re.test(word)) ?? [])[0];
    if (!month) return null;
    const day = Number(m[1]);
    let year = now.getFullYear();
    // No year on the page: the next time that date comes round
    if (new Date(year, month - 1, day) < new Date(now.getFullYear(), now.getMonth(), now.getDate())) year += 1;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  // One fare tab: "325 €\n\n27 places restantes\n,  Départ de: 07:05, Eurostar Premier, 2 heures 25 minutes, Direct"
  function parseFare(fare, index) {
    const text = fare.text ?? '';
    const named = /eurostar\s+(standard|plus|premier|snap)/i.exec(text);
    const tab = /-tab-(\d+)(?:-|$)/.exec(fare.id ?? '');
    const seats = /(\d+)\s+(?:places?|seats?)\b/i.exec(text);
    return {
      klass: named ? named[1].toLowerCase() : CLASSES[tab ? Number(tab[1]) : index] ?? null,
      price: priceOf(text),
      // "Dernière place restante à ce prix": one
      seats: seats ? Number(seats[1]) : /derni[eè]re place|last seat/i.test(text) ? 1 : null,
    };
  }

  // One row of the page: a train and its fares
  function parseRow(row) {
    const id = TRAIN_ID.exec(row.id ?? '');
    const times = id ? [id[3], id[4]] : [...(row.details ?? '').matchAll(TIME)].slice(0, 2).map((m) => `${m[1].padStart(2, '0')}:${m[2]}`);
    if (times.length < 2) return null;

    const fares = (row.fares ?? []).map(parseFare);
    const priceOfClass = (klass) => fares.find((f) => f.klass === klass)?.price ?? null;
    const changes = changesOf(row.details);
    const stations = (row.stations ?? []).map((s) => (s ?? '').trim());
    const duration = durationOf(row.details);

    return {
      day: id ? id[2] : null,
      offer: {
        departTime: times[0],
        arriveTime: times[1],
        departStation: stations[0] || null,
        arriveStation: stations.length > 1 ? stations[stations.length - 1] || null : null,
        durationMin: duration,
        changes,
        // A journey with changes is MIXED, as the app calls the ones it prices
        trainType: changes !== null && changes > 0 ? 'MIXED' : 'EUROSTAR',
        // Standard is the second-class price; the first of the classes above it is the "first class" one
        price2ndEur: priceOfClass('standard'),
        price1stEur: priceOfClass('plus') ?? priceOfClass('premier'),
        seatsAtPrice: fares.map((f) => f.seats).filter((n) => n !== null).slice(0, 5),
        rawText: [
          id ? `ES ${id[1]}` : null,
          `${times[0]} → ${times[1]}`,
          duration !== null ? `${Math.floor(duration / 60)} h ${String(duration % 60).padStart(2, '0')}` : null,
          changes === 0 ? 'Direct' : changes ? `${changes} changement(s)` : null,
          ...fares.map((f) => `${f.klass ? f.klass[0].toUpperCase() + f.klass.slice(1) : '?'} ${f.price ?? '-'} €${f.seats !== null ? ` (${f.seats} places)` : ''}`),
        ].filter(Boolean).join(' · '),
      },
    };
  }

  // page = { cities: ["Paris", "Londres"], directionText, dayText, travellersText, rows: [{ way, id, details, fares: [{ id, text }], stations }] }
  function parsePage(page, now = new Date()) {
    const parsed = (page.rows ?? []).map((row) => ({ ...parseRow(row), way: /(outbound|inbound)/.exec(row.way ?? '')?.[1] ?? null }));
    const rows = parsed.filter((r) => r.offer);

    // The way the page is for is the way most of its lists are: a train that was already chosen may be shown above the other way's list
    const ways = rows.map((r) => r.way).filter(Boolean);
    const way = ways.length === 0 ? null : ways.filter((w) => w === 'inbound').length > ways.length / 2 ? 'inbound' : 'outbound';
    const ofWay = rows.filter((r) => !way || !r.way || r.way === way);

    // The day is the one every train carries: each is stamped with the page's one date, so a train of another day is not kept
    const day = ofWay.find((r) => r.day)?.day ?? dayOf(page.dayText, now);
    const kept = ofWay.filter((r) => !r.day || !day || r.day === day);

    const text = page.directionText ?? '';
    const direction = way ? (way === 'inbound' ? 'back' : 'out') : /retour|return|inbound|rückreise/i.test(text) ? 'back' : /aller|outbound|hinreise/i.test(text) ? 'out' : null;

    const cities = (page.cities ?? []).map((c) => (c ?? '').trim()).filter(Boolean);
    return {
      direction,
      origin: cities.length >= 2 ? cities[0] : null,
      destination: cities.length >= 2 ? cities[cities.length - 1] : null,
      date: day,
      offers: kept.map((r) => r.offer),
      travellers: travellersOf(page.travellersText),
    };
  }

  const api = { parsePage, parseRow, travellersOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EurostarParser = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
