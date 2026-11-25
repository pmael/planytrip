// How the Eurostar search page is read: content.js adds the button and the preview, eurostar-parser.js turns what is read here into
// the payload. The page marks its parts with data-testid / data-e2e attributes (made for the site's own tests), which are far steadier
// than its generated class names, so the rows are found through them. Nothing here changes the page.
(() => {
  // "search-results-outbound-item" on the way there; the way back is read the same way ("…-inbound-item", not seen yet)
  const ROW = '[data-testid^="search-results-"][data-testid$="-item"]';
  const text = (el) => el?.innerText ?? '';

  function collect() {
    const all = [...document.querySelectorAll(ROW)];
    // A list that is not showing has nothing to read
    const showing = all.filter((row) => row.getClientRects().length > 0);

    const rows = (showing.length > 0 ? showing : all).map((row) => {
      const tabs = [...row.querySelectorAll('[data-testid$="-tab"]')];
      return {
        way: row.getAttribute('data-testid') ?? '',
        // "9007-2026-10-30-07:05-08:30-tab-0-panel": the train, its day and its times
        id: tabs[0]?.getAttribute('data-e2e') ?? row.querySelector('[id^="train-title-"]')?.id ?? '',
        details: text(row.querySelector('[data-testid$="journey-details"]')),
        // One tab a fare: its price, its seats left, and (hidden) its class
        fares: tabs.map((tab) => ({ id: tab.getAttribute('data-e2e') ?? '', text: text(tab) })),
        // Where the journey starts and ends: the details that open under the fares list each leg's stations, the name being the last line
        stations: [...row.querySelectorAll('[data-testid$="station"]')].map((station) => {
          const lines = station.querySelectorAll('p');
          return text(lines[lines.length - 1]);
        }),
      };
    });

    const header = document.querySelector('[data-testid="journey-direction-header"]');
    return {
      // "Paris → Londres": the title's cities, the arrow between them being drawn
      cities: [...(header?.querySelector('h1') ?? document.querySelector('h1'))?.children ?? []].map(text),
      directionText: text(header),
      dayText: text(document.querySelector('[data-testid="datePickerWrapper"] a[aria-current="page"]')),
      travellersText: text(document.querySelector('[role="search"]')),
      rows,
    };
  }

  const read = () => {
    const page = collect();
    console.debug('[Trip Manager] raw page', page); // copy these into the parser tests
    return EurostarParser.parsePage(page);
  };

  globalThis.TripManagerSite = { source: 'eurostar', upperLabel: 'Plus', collect, read };
})();
