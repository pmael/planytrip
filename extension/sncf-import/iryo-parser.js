// Turns what the Iryo booking page shows into the observations Trip Manager takes: the same payload as sncf-parser.js.
// Pure function, no DOM access: site-iryo.js reads the page and passes strings. Also loadable from Node for tests.
(function (root) {
  // Months by their first letters, in Spanish, Catalan and English (the three languages of the site)
  const MONTHS = [
    [1, /^(ene|gen|jan)/], [2, /^feb/], [3, /^mar/], [4, /^(abr|apr)/], [5, /^(may|mai)/], [6, /^jun/],
    [7, /^jul/], [8, /^(ago|aug)/], [9, /^(sep|set)/], [10, /^oct/], [11, /^nov/], [12, /^(dic|dec|des)/],
  ];

  const TIME = /\b([01]?\d|2[0-3]):([0-5]\d)\b/g;
  const PRICE = /(\d{1,4}(?:[,.]\d{2})?)\s?€/g;
  // A station that stands for every station of a city ("Madrid-Todas las estaciones"): not a place a train leaves from
  const EVERY_STATION = /todas las estaciones|all stations|totes les estacions/i;

  const priceOf = (s) => {
    const all = [...(s ?? '').matchAll(PRICE)];
    return all.length ? Number(all[all.length - 1][1].replace(',', '.')) : null;
  };

  // "2h", "1h 59m": the way the page writes a duration
  function durationOf(text) {
    const h = /(\d+)\s*h/i.exec(text ?? '');
    const m = /(\d+)\s*m/i.exec(text ?? '');
    return h || m ? (h ? Number(h[1]) * 60 : 0) + (m ? Number(m[1]) : 0) : null;
  }

  // 41.3 → "41,30", 52 → "52": amounts as the page writes them
  const eur = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace('.', ','));

  // "MADRID" → "Madrid": the page shouts its cities
  const titleCase = (s) => (s ?? '').trim().toLowerCase().replace(/(^|[\s\-'’])(\p{L})/gu, (_, sep, ch) => sep + ch.toUpperCase());

  const travellersOf = (text) => {
    const found = [...(text ?? '').matchAll(/\b(\d+)\s*(adult[eos]?s?|jeunes?|youths?|seniors?|enfants?|child(?:ren)?|ni[nñ]os?|b[ée]b[ée]s?|infants?)\b/gi)];
    // The page may write it twice (a layout for a wide window and one for a narrow one): said once
    return found.length ? [...new Set(found.map((m) => `${m[1]} ${m[2].toLowerCase()}`))].join(', ') : null;
  };

  // "31 Octubre", "01 noviembre": day and month, as numbers, or null
  function dayMonthOf(text) {
    const m = /(\d{1,2})\s*(?:de\s+)?([A-Za-zÀ-ÿ]{3,})/.exec(text ?? '');
    if (!m) return null;
    const word = m[2].normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const month = (MONTHS.find(([, re]) => re.test(word)) ?? [])[0];
    return month ? { day: Number(m[1]), month } : null;
  }

  // The day of the tab that is showing. The page's address carries the full dates of the search ("travels"), with the year; the tab
  // carries what is on screen, with none. The tab is the day the prices are for: the address gives it its year when it agrees, else it is
  // the next time that date comes round.
  function dateOf(tabDate, addressDate, now) {
    const shown = dayMonthOf(tabDate);
    if (!shown) return addressDate ?? null;
    if (addressDate && Number(addressDate.slice(5, 7)) === shown.month && Number(addressDate.slice(8, 10)) === shown.day) return addressDate;
    let year = now.getFullYear();
    if (new Date(year, shown.month - 1, shown.day) < new Date(now.getFullYear(), now.getMonth(), now.getDate())) year += 1;
    return `${year}-${String(shown.month).padStart(2, '0')}-${String(shown.day).padStart(2, '0')}`;
  }

  // page = {
  //   active: 0 | 1, tabs: [{ date: "31 Octubre" }], cities: "MADRID - VALENCIA", stations: "Madrid-Todas las estaciones - Valencia-Joaquín Sorolla",
  //   travellersText, addressDates: { outbound: "2026-10-31", inbound: "2026-11-01" },
  //   columns: ["Inicial", "Infinita", "Infinita Bistró"],
  //   rows: [{ id, originStation, destinationStation, duration, times: ["09:30", "11:30"], text, cells: [{ id, paid: "41,30 €", original: "43,47 €", text }] }]
  // }
  function parsePage(page, now = new Date()) {
    const rows = page.rows ?? [];
    // The rows say which way they are for (the ids of the outward schedule contain "out"); else it is the tab that is showing
    const direction = rows.some((r) => /inSchedule|inbound/i.test(r.id ?? '')) ? 'back' : rows.some((r) => /outSchedule|outbound/i.test(r.id ?? '')) ? 'out' : page.active === 1 ? 'back' : 'out';

    const places = (page.cities ?? '').split(/\s+[-–→]\s+/).map(titleCase).filter(Boolean);
    const [origin, destination] = places.length >= 2 ? (direction === 'back' ? [places[1], places[0]] : [places[0], places[1]]) : [null, null];

    // The station the trains of the search leave from and arrive at, when the page names one ("…-Todas las estaciones" does not)
    const named = (page.stations ?? '').split(/\s+-\s+/).map((s) => s.trim()).filter(Boolean);
    const [fromStation, toStation] = named.length >= 2 ? (direction === 'back' ? [named[1], named[0]] : [named[0], named[1]]) : [null, null];
    const specific = (s) => (s && !EVERY_STATION.test(s) ? s : null);

    const date = dateOf(page.tabs?.[page.active ?? 0]?.date, page.addressDates?.[direction === 'back' ? 'inbound' : 'outbound'], now);

    const offers = [];
    for (const row of rows) {
      const times = row.times?.length >= 2 ? row.times.slice(0, 2).map((t) => t.trim()) : [...(row.text ?? '').matchAll(TIME)].slice(0, 2).map((m) => `${m[1].padStart(2, '0')}:${m[2]}`);
      if (times.length < 2 || !times.every((t) => /^\d{1,2}:\d{2}$/.test(t))) continue;
      const [dep, arr] = times.map((t) => t.padStart(5, '0'));

      // One cell per fare, from the cheapest comfort zone up. The price paid is the one that is not struck through
      const fares = (row.cells ?? []).map((cell, i) => ({
        name: page.columns?.[i] ?? null,
        price: priceOf(cell.paid) ?? priceOf(cell.text),
        original: cell.paid ? priceOf(cell.original) : null,
        seats: (/(\d+)\s+(?:plazas?|places?|seats?)\b/i.exec(cell.text ?? '') ?? [])[1],
      }));
      if (fares.every((f) => f.price === null)) continue;

      const duration = durationOf(row.duration);
      // Every train seen was a direct one: a row only says it has a change if it says so
      const change = /(\d+)\s*(?:conexi|transbordo|connection|change)/i.exec(row.text ?? '');
      const changes = change ? Number(change[1]) : /conexi[oó]n|transbordo|escala|connection/i.test(row.text ?? '') ? 1 : 0;

      offers.push({
        departTime: dep,
        arriveTime: arr,
        departStation: specific(row.originStation?.trim()) ?? specific(fromStation),
        arriveStation: specific(row.destinationStation?.trim()) ?? specific(toStation),
        durationMin: duration,
        changes,
        trainType: changes > 0 ? 'MIXED' : 'IRYO',
        price2ndEur: fares[0]?.price ?? null,
        price1stEur: fares[1]?.price ?? null,
        seatsAtPrice: fares.map((f) => (f.seats === undefined ? null : Number(f.seats))).filter((n) => n !== null).slice(0, 5),
        rawText: [
          row.originStation?.trim() || null,
          `${dep} → ${arr}`,
          row.duration?.trim() || null,
          ...fares.map((f) => `${f.name ?? '?'} ${f.price === null ? '-' : eur(f.price)} €${f.original ? ` (${eur(f.original)} € avant remise)` : ''}`),
        ].filter(Boolean).join(' · '),
      });
    }

    return { direction, origin, destination, date, offers, travellers: travellersOf(page.travellersText) };
  }

  const api = { parsePage, travellersOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.IryoParser = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
