// Adds an "Import to Trip Manager" button on the results pages of the sites this extension reads (SNCF Connect, Eurostar, Iryo).
// It only reads what is already displayed in your own tab, when you click.
// No requests to those sites, no automation, no page navigation.
// What each page looks like is in its own file (site-*.js, loaded before this one, which sets `TripManagerSite`).
(() => {
  // The extension may be injected twice (a page reload in the same tab, an update): one button is enough.
  if (document.getElementById('tm-button')) return;
  const site = globalThis.TripManagerSite;
  if (!site) return;

  function capture() {
    // The previous preview is not a page to read: it lists lines such as "07:37 → 11:48 · … · 66 €", which look exactly like cards (and
    // was read as trains on a second click)
    document.getElementById('tm-preview')?.remove();
    // Who the prices are for is shown to the person, not sent
    const { travellers = null, ...parsed } = site.read();
    return {
      payload: {
        source: site.source,
        // The address of a booking page can be long (Iryo's holds the whole search): the app takes 2000 characters
        pageUrl: location.href.slice(0, 1900),
        capturedAt: new Date().toISOString(),
        ...parsed,
      },
      travellers,
    };
  }

  function el(tag, style, text) {
    const e = document.createElement(tag);
    Object.assign(e.style, style);
    if (text != null) e.textContent = text;
    return e;
  }

  // 41.3 → "41,30", 135 → "135", null → "?"
  const eur = (n) => (n == null ? '?' : Number.isInteger(n) ? String(n) : n.toFixed(2).replace('.', ','));

  // What the app answered, in a few words: its own message when it gave one (a 400 says what was wrong).
  function failure(r) {
    const said = r?.body?.error && r.body.error !== 'validation' ? r.body.error : r?.body?.formErrors?.[0];
    return `Échec (${r?.status ?? r?.error ?? 'app injoignable'})${said ? ` : ${said}` : ''}. ${r?.status ? '' : 'Trip Manager tourne bien sur localhost:3000 ?'}`.trim();
  }

  function showPreview({ payload, travellers }, problem) {
    document.getElementById('tm-preview')?.remove();
    const box = el('div', {
      position: 'fixed', right: '16px', bottom: '72px', zIndex: 2147483647, width: '380px',
      maxHeight: '60vh', overflow: 'auto', background: '#fff', color: '#111', borderRadius: '12px',
      boxShadow: '0 8px 30px rgba(0,0,0,.25)', font: '13px system-ui, sans-serif', padding: '12px',
    });
    box.id = 'tm-preview';
    box.append(el('div', { fontWeight: '600', marginBottom: '6px' },
      `${payload.origin ?? '?'} → ${payload.destination ?? '?'} · ${payload.date ?? 'date ?'} · ${payload.offers.length} trains`));
    if (problem) {
      box.append(el('div', { color: '#b00', marginBottom: '6px' }, `La page n'a pas pu être lue : ${problem}`));
    } else if (payload.offers.length === 0) {
      box.append(el('div', { color: '#b00', marginBottom: '6px' }, 'Aucun train reconnu : affichez la liste des trains (et faites-la défiler) puis recommencez.'));
    } else if (payload.offers.every((o) => o.price2ndEur == null)) {
      // A page in pounds or dollars (Eurostar's UK site) has trains but no price in euros: the app keeps euros only
      box.append(el('div', { color: '#b00', marginBottom: '6px' }, "Aucun prix en euros lu sur cette page : elle n'est peut-être pas en euros (devise du site)."));
    } else if (!payload.date || !payload.origin) {
      box.append(el('div', { color: '#b00', marginBottom: '6px' }, "Trajet ou date non reconnus : l'import sera refusé."));
    }
    // The prices the app learns from are those for one adult: a page that is searched for more may show a total, not a price per person
    if (travellers) {
      const one = /^1\s*adult/i.test(travellers) && !travellers.includes(',');
      box.append(el('div', { color: one ? '#555' : '#9a5b00', marginBottom: '6px' },
        one ? `Voyageurs : ${travellers}` : `Voyageurs : ${travellers}. Les prix sont enregistrés tels que la page les affiche, comme pour un adulte : cherchez pour 1 adulte.`));
    }
    // The list is in order of departure: a time that goes back means another day got in ("Afficher le jour précédent", "les trajets
    // suivants"), and every train is sent with the one date of the page
    const times = payload.offers.map((o) => o.departTime);
    if (times.some((t, i) => i > 0 && t < times[i - 1])) {
      box.append(el('div', { color: '#9a5b00', marginBottom: '6px' },
        `Les heures de départ ne se suivent pas : la liste mêle sans doute plusieurs jours. Tous les trains seraient enregistrés au ${payload.date ?? '?'}.`));
    }
    for (const o of payload.offers) {
      box.append(el('div', { borderTop: '1px solid #eee', padding: '4px 0' },
        `${o.departTime} → ${o.arriveTime} · ${o.trainType ?? '?'} · ${o.changes ?? '?'} corr. · ${eur(o.price2ndEur)} € (${site.upperLabel} ${eur(o.price1stEur)} €)`));
    }
    const status = el('div', { marginTop: '8px' });
    const send = el('button', { marginTop: '8px', marginRight: '8px', padding: '6px 10px', cursor: 'pointer' }, 'Envoyer');
    const cancel = el('button', { padding: '6px 10px', cursor: 'pointer' }, 'Annuler');
    send.disabled = Boolean(problem) || !payload.date || !payload.origin || payload.offers.length === 0 || payload.offers.every((o) => o.price2ndEur == null);
    send.onclick = () => {
      status.textContent = 'Envoi…';
      chrome.runtime.sendMessage({ type: 'trip-manager:import', payload }, (r) => {
        status.textContent = r?.ok
          ? `Importé : ${r.body?.saved ?? payload.offers.length} prix, ${r.body?.matched ?? 0} rattachés à un voyage.`
          : failure(r);
      });
    };
    cancel.onclick = () => box.remove();
    box.append(send, cancel, status);
    document.body.append(box);
  }

  const button = el('button', {
    position: 'fixed', right: '16px', bottom: '16px', zIndex: 2147483647, padding: '10px 14px',
    borderRadius: '999px', border: 'none', background: '#1f7a5c', color: '#fff',
    font: '600 13px system-ui, sans-serif', cursor: 'pointer', boxShadow: '0 4px 14px rgba(0,0,0,.2)',
  }, '→ Trip Manager');
  button.id = 'tm-button';
  button.onclick = () => {
    try {
      showPreview(capture());
    } catch (error) {
      // A page that is not laid out as expected must say so, not leave the button doing nothing
      console.error('[Trip Manager]', error);
      showPreview({ payload: { offers: [] }, travellers: null }, String(error?.message ?? error));
    }
  };
  document.body.append(button);
})();
