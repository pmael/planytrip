// How the Iryo booking page is read: content.js adds the button and the preview, iryo-parser.js turns what is read here into the
// payload. The page is an Angular one that draws its schedule as rows of `ilsa-schedule__*` elements, in the layout of a wide window:
// that is the one read here. Nothing here changes the page.
(() => {
  // textContent, not innerText: the page uppercases and lowercases with CSS, and a short value needs no layout to be read
  const text = (el) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

  // The dates of the search, with their year, from the address: ...&travels=[{"origin":"X0000","destination":"03216","direction":"outbound","departure":"2026-10-31"},{…"inbound"…}]
  function addressDates() {
    try {
      const travels = JSON.parse(new URL(location.href).searchParams.get('travels') ?? '[]');
      return Object.fromEntries(travels.filter((t) => t?.direction && /^\d{4}-\d{2}-\d{2}$/.test(t.departure ?? '')).map((t) => [t.direction, t.departure]));
    } catch {
      return {};
    }
  }

  function collect() {
    const tabs = [...document.querySelectorAll('.ilsa-tabs__row .navbar__item')];
    // The schedule of the tab that is showing (the other one is kept in the page, hidden and empty)
    const panel = [...document.querySelectorAll('ilsa-tabs-tab > .ilsa-tabs-tab')].find((p) => !p.hasAttribute('hidden')) ?? document;

    const rows = [...panel.querySelectorAll('.ilsa-schedule__row[data-qa]')].map((row) => ({
      id: row.getAttribute('data-qa') ?? '',
      originStation: text(row.querySelector('.ilsa-schedule__travelstations__station__origin')),
      destinationStation: text(row.querySelector('.ilsa-schedule__travelstations__station__destination')),
      duration: text(row.querySelector('.ilsa-schedule__traveltime__totaltime')),
      times: [...row.querySelectorAll('.ilsa-schedule__traveltime__hour')].map(text),
      text: text(row),
      // One cell per fare. A price that was cut is struck through ("--original") above the one to pay
      cells: [...row.querySelectorAll('.ilsa-schedule__cellbundle')].map((cell) => ({
        id: cell.getAttribute('data-qa') ?? '',
        paid: text(cell.querySelector('.ilsa-schedule__bundle__price p:not([class*="--original"])')),
        original: text(cell.querySelector('.ilsa-schedule__bundle__price [class*="--original"]')),
        text: text(cell),
      })),
    }));

    return {
      active: Math.max(0, tabs.findIndex((tab) => tab.classList.contains('navbar__item--active'))),
      tabs: tabs.map((tab) => ({ date: text(tab.querySelector('.item__description')) })),
      cities: text(document.querySelector('.ilsa-travel-summary__departureCity')),
      stations: text(document.querySelector('.ilsa-travel-summary__station')),
      travellersText: text(document.querySelector('.ilsa-travel-summary__passenger')),
      addressDates: addressDates(),
      columns: [...panel.querySelectorAll('.ilsa-schedule__celltitle .ilsa-schedule__title')].map(text),
      rows,
    };
  }

  const read = () => {
    const page = collect();
    console.debug('[Trip Manager] raw page', page); // copy these into the parser tests
    return IryoParser.parsePage(page);
  };

  globalThis.TripManagerSite = { source: 'iryo', upperLabel: 'Infinita', collect, read };
})();
