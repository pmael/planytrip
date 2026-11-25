// How SNCF Connect's results page is read: content.js adds the button and the preview, sncf-parser.js turns what is read here into the
// payload. Nothing here changes the page.
(() => {
  const CARD_TEXT = /\b([01]?\d|2[0-3]):[0-5]\d\b[\s\S]*\b([01]?\d|2[0-3]):[0-5]\d\b[\s\S]*\d\s?€/;
  const DATE_TEXT = /\b\d{1,2}\s+(janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre)\b/i;

  // Smallest elements that look like one result row: two times and a price,
  // with no child that also matches (so we don't take the whole list). Our own button and preview are not results: the preview
  // lists "07:37 → 11:48 · … · 66 €" lines that look exactly like cards, and was read as such on a second click.
  const ours = (el) => el.closest('#tm-preview, #tm-button') !== null;
  const ROW = '[data-test="proposal-card"]';
  function findCards() {
    // SNCF Connect marks its rows (seen on the saved page): a row is [data-test="proposal-card"], and its summary, the times and the
    // fares, is the [data-test="trip-info"] inside. The summary is read, not the row: once a row is opened, its fare details also
    // carry prices, seats and a list of services ("Presse et contenus sur le Portail TGV INOUI" on an Intercités).
    const rows = [...document.querySelectorAll(ROW)].filter((row) => !ours(row));
    if (rows.length > 0) return rows.map((row) => row.querySelector('[data-test="trip-info"]') ?? row);

    // The markers are gone (SNCF changed its page): fall back on what a row looks like
    const matches = [...document.querySelectorAll('li, article, div, section')].filter((el) => {
      if (ours(el)) return false;
      const t = el.innerText;
      return t && t.length < 800 && CARD_TEXT.test(t);
    });
    return matches.filter((el) => !matches.some((other) => other !== el && el.contains(other)));
  }

  // A card's row is sometimes split into a left (times) and right (prices)
  // part; climb until the element holds both.
  function widen(el) {
    let cur = el;
    while (cur.parentElement && !/€/.test(cur.innerText)) cur = cur.parentElement;
    return cur;
  }

  // What says which train it is when the card's text does not: the logo is an image or a drawing, and may carry its name as its alt text, an
  // aria-label, a title, the name of its file ("inoui.svg") or of the symbol it uses. Everything of the kind, in one string.
  function logoHint(el) {
    const bits = [];
    // Not the buttons: "Détail du trajet : Départ de Toulouse…" is a label, not a logo
    for (const e of el.querySelectorAll('img, svg, use, [aria-label]:not(button), [title]:not(button)')) {
      const tag = e.tagName.toLowerCase();
      bits.push(e.getAttribute('alt'), e.getAttribute('aria-label'), e.getAttribute('title'));
      if (tag === 'svg') bits.push(e.querySelector('title')?.textContent);
      for (const attr of ['src', 'href', 'xlink:href']) {
        const value = e.getAttribute(attr);
        // A data: image has no name to read; a path has, in its last part
        if (value && !value.startsWith('data:')) bits.push(value.split(/[?#]/)[0].split('/').pop(), value.split('#')[1]);
      }
    }
    return [...new Set(bits.filter(Boolean).map((b) => b.trim()))].join(' ').slice(0, 300);
  }

  // The train's type, as the row's hidden title says it: "INTERCITES Départ de Toulouse Matabiau 06:43 à destination de …". The logo is a
  // drawing with no name, so this is the one place the page writes it. A journey with changes is titled "Trajet en correspondance":
  // no type there (it is MIXED anyway).
  function kindOf(el) {
    const title = ((el.closest(ROW) ?? el.closest('li'))?.querySelector('h3')?.textContent ?? '').trim();
    const kind = title.split(/\s+D[ée]part\s+de\s/i)[0].trim();
    return kind === title || /^trajet en correspondance/i.test(kind) ? '' : kind;
  }

  // "Aller : Toulouse - Lyon", and the day, which may sit in another element than the title.
  function headerText() {
    const title = [...document.querySelectorAll('h1, h2, header')]
      .map((e) => e.innerText)
      .find((t) => /(Aller|Retour)\s*:/i.test(t)) ?? document.title;
    // The tab of the day being shown says it with its year ("vendredi 30 octobre 2026"), which the title does not: first, so it is the
    // date that is read
    const picked = document.querySelector('[aria-pressed="true"] abbr[title]')?.getAttribute('title');
    if (picked && DATE_TEXT.test(picked)) return `${picked}\n${title}`;
    if (DATE_TEXT.test(title)) return title;
    const day = [...document.querySelectorAll('p, span, div, h3')]
      .map((e) => e.innerText)
      .find((t) => t && t.length < 120 && DATE_TEXT.test(t));
    return day ? `${title}\n${day}` : title;
  }

  const collect = () => ({
    headerText: headerText(),
    cards: [...new Set(findCards().map(widen))].map((el) => ({ text: el.innerText, logoAlt: `${kindOf(el)} ${logoHint(el)}`.trim() })),
  });

  const read = () => {
    const page = collect();
    console.debug('[Trip Manager] raw cards', page.cards); // copy these into the parser tests
    return SncfParser.parsePage(page);
  };

  globalThis.TripManagerSite = { source: 'sncf-connect', upperLabel: '1re', collect, read };
})();
