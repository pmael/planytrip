// Turns the text of an SNCF Connect results page into structured offers.
// Pure function, no DOM access: content.js passes the header text and the
// innerText of each result card. Also loadable from Node for tests.
(function (root) {
  const MONTHS = {
    janvier: 1, février: 2, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6,
    juillet: 7, août: 8, aout: 8, septembre: 9, octobre: 10, novembre: 11, décembre: 12, decembre: 12,
  };

  // Times are written "06:51". A duration is "5h07": it must not be taken for a time (it would be, with
  // `[:h]`, and a duration that comes before the arrival time would then be read as the arrival).
  const TIME = /\b([01]?\d|2[0-3]):([0-5]\d)\b/g;
  const PRICE = /(\d{1,4}(?:[,.]\d{2})?)\s?€/g;
  const PRICE_ONE = /(\d{1,4}(?:[,.]\d{2})?)\s?€/;

  // "Aller : Toulouse - Lyon" + "Vendredi 04 décembre, à partir de 6:00"
  function parseHeader(text, now = new Date()) {
    const out = { direction: null, origin: null, destination: null, date: null };
    const route = text.match(/(Aller|Retour)\s*:\s*(.+?)\s+[-–→]\s+(.+?)(?:\n|$)/i);
    if (route) {
      out.direction = route[1].toLowerCase() === 'aller' ? 'out' : 'back';
      out.origin = route[2].trim();
      out.destination = route[3].trim();
    }
    const d = text.match(/\b(\d{1,2})\s+(janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre)(?:\s+(\d{4}))?/i);
    if (d) {
      const day = Number(d[1]);
      const month = MONTHS[d[2].toLowerCase()];
      let year = d[3] ? Number(d[3]) : now.getFullYear();
      // No year on the page: take the next occurrence of that date.
      if (!d[3] && new Date(year, month - 1, day) < new Date(now.getFullYear(), now.getMonth(), now.getDate())) year += 1;
      out.date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
    return out;
  }

  function toMinutes(h) {
    const m = h.match(/(\d{1,2})h(\d{2})?/);
    return m ? Number(m[1]) * 60 + Number(m[2] ?? 0) : null;
  }

  function parsePrice(s) {
    return Number(s.replace(',', '.'));
  }

  // One card's innerText, plus the logo alt text if any (e.g. "TGV INOUI").
  function parseCard(text, logoAlt = '') {
    const times = [...text.matchAll(TIME)].map((m) => `${m[1].padStart(2, '0')}:${m[2]}`);
    const prices = [...text.matchAll(PRICE)].map((m) => parsePrice(m[1]));
    if (times.length < 2 || prices.length === 0) return null;

    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    const isDetail = (l) => /^\d{1,2}[:h][0-5]\d\b/.test(l) || /€/.test(l) || /\b(direct|correspondances?)\b/i.test(l) || /^(dès|détail)/i.test(l);
    // The station name sits on the same line as the time, or on the line after it.
    const stationAfter = (time) => {
      const bare = time.replace(/^0/, '');
      const i = lines.findIndex((l) => l.startsWith(time + ' ') || l === time || l.startsWith(bare + ' ') || l === bare);
      if (i < 0) return null;
      const used = lines[i].startsWith(time) ? time : bare;
      const rest = lines[i].slice(used.length).trim();
      if (rest) return rest;
      const next = lines[i + 1];
      return next && !isDetail(next) ? next : null;
    };

    const duration = text.match(/\b(\d{1,2}h\d{2})\b/);
    let changes = null;
    if (/\bdirect\b/i.test(text)) changes = 0;
    const c = text.match(/(\d+)\s+correspondances?/i);
    if (c) changes = Number(c[1]);

    // SNCF writes TER as "Train T E R" (letters apart), and its night trains as "Train de nuit" (Intercités de nuit)
    const typeIn = (s) => {
      const hay = s.toLowerCase();
      return /ouigo/.test(hay) ? 'OUIGO'
        : /in\s?oui/.test(hay) ? 'TGV INOUI'
        : /intercit|train de nuit/.test(hay) ? 'INTERCITES'
        : /\bter\b|\bt\s+e\s+r\b/.test(hay) ? 'TER'
        : /lyria/.test(hay) ? 'TGV LYRIA'
        : /eurostar/.test(hay) ? 'EUROSTAR'
        : /frecciarossa|trenitalia/.test(hay) ? 'TRENITALIA'
        : null;
    };
    // What the page says of the logo, or of the row's title, is the train's own name: it comes before words that merely appear in the
    // card (an opened Intercités lists "Presse et contenus sur le Portail TGV INOUI" among its services)
    const trainType = typeIn(logoAlt) ?? typeIn(text) ?? (changes && changes > 0 ? 'MIXED' : null);

    // The page labels its two fares "Seconde classe" and "Première classe": read each by its label, so that a second class that is
    // full ("Complet") is not taken for the first-class price that comes next. Without labels, the first price is second class.
    const fareAfter = (label, stop) => {
      const start = text.search(label);
      if (start < 0) return undefined;
      const rest = text.slice(start);
      const end = stop ? rest.search(stop) : -1;
      const m = (end > 0 ? rest.slice(0, end) : rest).match(PRICE_ONE);
      return m ? parsePrice(m[1]) : null;
    };
    const labelled = /seconde classe/i.test(text);
    const price2nd = labelled ? fareAfter(/seconde classe/i, /première classe/i) : prices[0] ?? null;
    const price1st = labelled ? fareAfter(/première classe/i) ?? null : prices[1] ?? null;

    return {
      departTime: times[0],
      arriveTime: times[1],
      departStation: stationAfter(times[0]),
      arriveStation: stationAfter(times[1]),
      durationMin: duration ? toMinutes(duration[1]) : null,
      changes,
      trainType,
      // "Dès" means "from", i.e. the cheapest fare left.
      price2ndEur: price2nd,
      price1stEur: price1st,
      seatsAtPrice: [...text.matchAll(/(\d+)\s+places?\s+à\s+ce\s+prix/gi)].map((m) => Number(m[1])),
      rawText: text,
      // What the card's logo said (its alt text, file name...): kept to learn from the trains whose type is still not found
      logoHint: logoAlt ? logoAlt.slice(0, 300) : undefined,
    };
  }

  function parsePage({ headerText, cards }, now = new Date()) {
    const header = parseHeader(headerText ?? '', now);
    const offers = cards.map((c) => parseCard(c.text, c.logoAlt)).filter(Boolean);
    return { ...header, offers };
  }

  const api = { parseHeader, parseCard, parsePage };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SncfParser = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
