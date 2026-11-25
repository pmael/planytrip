// An airline's two-letter code, and its logo: on Google Flights' own image server, where the flights come from. The logos
// are the companies' trademarks: they are shown from there, not kept in the project.

/** For a flight whose number is not known (read off the page's text, the test dataset): by the name it was stored under */
const CODES: Record<string, string> = {
  aegean: "A3",
  "aer-lingus": "EI",
  "air-austral": "UU",
  "air-dolomiti": "EN",
  "air-europa": "UX",
  "air-france": "AF",
  austrian: "OS",
  "british-airways": "BA",
  "brussels-airlines": "SN",
  condor: "DE",
  "corsair": "SS",
  "discover-airlines": "4Y",
  easyjet: "U2",
  eurowings: "EW",
  finnair: "AY",
  "french-bee": "BF",
  iberia: "IB",
  ita: "AZ",
  klm: "KL",
  lot: "LO",
  lufthansa: "LH",
  "lufthansa-city-airlines": "VL",
  norwegian: "DY",
  ryanair: "FR",
  sas: "SK",
  smartwings: "QS",
  swiss: "LX",
  "tap-air-portugal": "TP",
  transavia: "TO",
  tunisair: "TU",
  "turkish-airlines": "TK",
  volotea: "V7",
  vueling: "VY",
  "wizz-air": "W6",
};

/** "BA319 CDG-LHR" is British Airways (BA); without a flight number, from the company's name. Null when it is not known. */
export function airlineCode(provider: string, firstFlight?: unknown): string | null {
  const code = typeof firstFlight === "string" ? /^([A-Z][A-Z0-9]|[0-9][A-Z])\d/.exec(firstFlight)?.[1] : undefined;
  return code ?? CODES[provider] ?? null;
}

export const airlineLogoUrl = (code: string) => `https://www.gstatic.com/flights/airline_logos/70px/${code}.png`;
