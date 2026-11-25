// Checks, from your own connection, which train sellers answer a normal request
// without a bot challenge. One request per site, no retries, nothing bypassed.
// Usage: node tools/train-probe/probe.mjs   (Node 18+)

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

const sites = [
  { name: 'Renfe', country: 'ES', url: 'https://www.renfe.com/es/es' },
  { name: 'Renfe venta', country: 'ES', url: 'https://venta.renfe.com/vol/home.do' },
  { name: 'Iryo', country: 'ES', url: 'https://iryo.eu/es/home' },
  { name: 'Ouigo España', country: 'ES', url: 'https://www.ouigo.com/es/' },
  { name: 'Ouigo France', country: 'FR', url: 'https://www.ouigo.com/' },
  { name: 'Trenitalia France', country: 'FR', url: 'https://www.trenitalia.com/fr.html' },
  { name: 'Le Frecce API', country: 'IT/FR', url: 'https://www.lefrecce.it/Channels.Website.BFF.WEB/website/locations/search?name=Paris&limit=5' },
  { name: 'Eurostar', country: 'EU', url: 'https://www.eurostar.com/fr-fr' },
  { name: 'SNCF Connect (control: known DataDome)', country: 'FR', url: 'https://www.sncf-connect.com/' },
];

const challengeSignals = [
  [/datadome/i, 'DataDome'],
  [/captcha/i, 'CAPTCHA'],
  [/_abck|akamai/i, 'Akamai'],
  [/px-captcha|perimeterx|_px\d/i, 'PerimeterX'],
  [/cf-chl|challenge-platform|cf_clearance/i, 'Cloudflare challenge'],
  [/incapsula|_incap_/i, 'Imperva'],
];

for (const s of sites) {
  try {
    const res = await fetch(s.url, { headers: { 'User-Agent': UA, 'Accept-Language': 'fr-FR,fr;q=0.9' }, redirect: 'follow' });
    const body = (await res.text()).slice(0, 200_000);
    const cookies = res.headers.get('set-cookie') ?? '';
    const hits = challengeSignals.filter(([re]) => re.test(body) || re.test(cookies)).map(([, n]) => n);
    const blocked = res.status === 403 || res.status === 429 || (hits.length > 0 && body.length < 20_000);
    const verdict = blocked ? 'BLOCKED' : hits.length ? 'PROTECTED (page served)' : 'OPEN';
    console.log(`${verdict.padEnd(24)} ${s.name} [${s.country}] HTTP ${res.status}${hits.length ? ' — ' + hits.join(', ') : ''}`);
  } catch (e) {
    console.log(`${'ERROR'.padEnd(24)} ${s.name} [${s.country}] ${e.message}`);
  }
}
