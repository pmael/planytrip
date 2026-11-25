"""
SNCF Connect Train Search API Client
=====================================
Reverse-engineered from https://www.sncf-connect.com

Fetches all trains for a given day between two French stations/cities.

This client connects to the user's running Chrome browser via CDP to execute
API calls in a real browser context — this bypasses DataDome bot-protection
completely without requiring any manual cookie setup.

Usage:
    python api_client.py

Requirements:
    pip install playwright pytz
    playwright install chromium

Chrome must be running (the standard macOS Chrome installation is detected
automatically).  If Chrome is not running, the client launches a Playwright
Chromium fallback (slower to warm up and may hit DataDome CAPTCHA the first
time).
"""

import json
import os
import time
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Optional

import pytz
from playwright.sync_api import Browser, Page, sync_playwright

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

BFF_KEY = "ah1MPO-izehIHD-QZZ9y88n-kku876"
BASE_URL = "https://www.sncf-connect.com"

# Request headers sent with every BFF call
BFF_HEADERS: dict[str, str] = {
    "x-bff-key": BFF_KEY,
    "x-client-channel": "web",
    "x-client-app-id": "front-web",
    "x-market-locale": "fr_FR",
    "x-api-env": "production",
    "x-visitor-type": "0",
    "x-con-id": "529796aeeabb4cccb1bca66e743ba3d1",
    "virtual-env-name": "master",
    "x-device-class": "desktop",
    "x-device-os-version": "macOS (10.15.7)",
    "x-app-version": "815b9e79a1",
    "Content-Type": "application/json",
    "Accept": "application/json",
}

# Paris timezone
PARIS_TZ = pytz.timezone("Europe/Paris")

# ---------------------------------------------------------------------------
# Chrome CDP endpoint detection
# ---------------------------------------------------------------------------

# Location of Chrome's DevToolsActivePort file on each OS
_DEVTOOLS_PORT_FILES = [
    # macOS – stable Chrome
    Path.home() / "Library/Application Support/Google/Chrome/DevToolsActivePort",
    # macOS – Chrome Beta
    Path.home() / "Library/Application Support/Google/Chrome Beta/DevToolsActivePort",
    # Linux
    Path.home() / ".config/google-chrome/DevToolsActivePort",
    # Linux – Chrome stable via snap
    Path.home() / "snap/chromium/common/chromium/DevToolsActivePort",
]


def _find_chrome_ws_endpoint() -> Optional[str]:
    """
    Read Chrome's DevToolsActivePort file and return the CDP WebSocket URL,
    or None if no running Chrome is detected.
    """
    for port_file in _DEVTOOLS_PORT_FILES:
        if port_file.exists():
            try:
                lines = port_file.read_text().strip().splitlines()
                if len(lines) >= 2:
                    port = int(lines[0].strip())
                    ws_path = lines[1].strip()
                    return f"ws://localhost:{port}{ws_path}"
            except (ValueError, IOError):
                continue
    return None


# ---------------------------------------------------------------------------
# Well-known station objects (can be used directly instead of autocomplete)
# ---------------------------------------------------------------------------

STATIONS: dict[str, dict[str, Any]] = {
    # Cities (allow multiple stations in that city)
    "PARIS": {
        "label": "Paris",
        "id": "CITY_FR_6455259",
        "codes": [{"type": "RESARAIL", "value": "FRPAR"}],
        "geolocation": False,
    },
    "LYON": {
        "label": "Lyon",
        "id": "CITY_FR_6454573",
        "codes": [{"type": "RESARAIL", "value": "FRLYS"}],
        "geolocation": False,
    },
    "MARSEILLE": {
        "label": "Marseille",
        "id": "CITY_FR_6447142",
        "codes": [{"type": "RESARAIL", "value": "FRMRS"}],
        "geolocation": False,
    },
    "BORDEAUX": {
        "label": "Bordeaux",
        "id": "CITY_FR_6455058",
        "codes": [{"type": "RESARAIL", "value": "FRXSB"}],
        "geolocation": False,
    },
    "TOULOUSE": {
        "label": "Toulouse",
        "id": "CITY_FR_6453974",
        "codes": [{"type": "RESARAIL", "value": "FRTLS"}],
        "geolocation": False,
    },
    "NANTES": {
        "label": "Nantes",
        "id": "CITY_FR_6434483",  # SNCF autocomplete's id; CITY_FR_2990969 gave HTTP 500 on every search
        "codes": [{"type": "RESARAIL", "value": "FRNTE"}],
        "geolocation": False,
    },
    "LILLE": {
        "label": "Lille",
        "id": "CITY_FR_2998324",
        "codes": [{"type": "RESARAIL", "value": "FRLIL"}],
        "geolocation": False,
    },
    "STRASBOURG": {
        "label": "Strasbourg",
        "id": "CITY_FR_2973783",
        "codes": [{"type": "RESARAIL", "value": "FRSXB"}],
        "geolocation": False,
    },
    "NICE": {
        "label": "Nice",
        "id": "CITY_FR_2990440",
        "codes": [{"type": "RESARAIL", "value": "FRNCE"}],
        "geolocation": False,
    },
    "RENNES": {
        "label": "Rennes",
        "id": "CITY_FR_2983990",
        "codes": [{"type": "RESARAIL", "value": "FRRNS"}],
        "geolocation": False,
    },
    # Individual stations
    "PARIS_GARE_DE_LYON": {
        "label": "Paris Gare de Lyon",
        "id": "RESARAIL_STA_8768600",
        "codes": [
            {"type": "RESARAIL", "value": "FRPLY"},
            {"type": "UIC7", "value": "8768600"},
            {"type": "UIC8", "value": "87686006"},
        ],
        "geolocation": False,
    },
    "PARIS_NORD": {
        "label": "Paris Gare du Nord",
        "id": "RESARAIL_STA_8727100",
        "codes": [
            {"type": "RESARAIL", "value": "FRPNO"},
            {"type": "UIC7", "value": "8727100"},
        ],
        "geolocation": False,
    },
    "PARIS_MONTPARNASSE": {
        "label": "Paris Montparnasse",
        "id": "RESARAIL_STA_8775814",
        "codes": [
            {"type": "RESARAIL", "value": "FRPMO"},
            {"type": "UIC7", "value": "8775814"},
        ],
        "geolocation": False,
    },
    "PARIS_SAINT_LAZARE": {
        "label": "Paris Saint-Lazare",
        "id": "RESARAIL_STA_8738400",
        "codes": [
            {"type": "RESARAIL", "value": "FRPSL"},
            {"type": "UIC7", "value": "8738400"},
        ],
        "geolocation": False,
    },
}


# ---------------------------------------------------------------------------
# Browser-based BFF caller
# ---------------------------------------------------------------------------

# JavaScript template for making a POST fetch() call in the browser context.
_FETCH_JS = """
async ([url, payload, headers]) => {
    const resp = await fetch(url, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(payload),
        credentials: 'include'
    });
    let body;
    try { body = await resp.json(); } catch (e) { body = await resp.text(); }
    return { status: resp.status, body: body };
}
"""


class SNCFConnectClient:
    """
    API client for the SNCF Connect BFF.

    Strategy (in order):
    1. Connect to the user's running Chrome browser via CDP — this uses the
       real browser's DataDome-verified session and never gets blocked.
    2. If Chrome is not running, fall back to a Playwright Chromium browser
       with stealth settings; navigate to sncf-connect.com so DataDome JS
       can initialise, then make all API calls via page.evaluate().

    Typical usage::

        with SNCFConnectClient() as client:
            trains = client.get_all_trains_for_day("Paris", "Lyon", "2026-11-10")

    Or manually::

        client = SNCFConnectClient()
        client.start()
        trains = client.get_all_trains_for_day("Paris", "Lyon", "2026-11-10")
        client.stop()
    """

    def __init__(self, headless: bool = True) -> None:
        self._headless = headless
        self._playwright = None
        self._browser: Optional[Browser] = None
        self._page: Optional[Page] = None
        self._owns_browser = False   # True when WE launched the browser

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def start(self) -> "SNCFConnectClient":
        """Connect to Chrome (or launch one) and prepare the SNCF page."""
        self._playwright = sync_playwright().start()

        ws_endpoint = _find_chrome_ws_endpoint()
        if ws_endpoint:
            print(f"[browser] Connecting to running Chrome via CDP …")
            self._browser = self._playwright.chromium.connect_over_cdp(ws_endpoint)
            self._owns_browser = False
            self._page = self._find_or_open_sncf_page()
        else:
            print("[browser] No running Chrome found — launching Playwright Chromium …")
            self._browser = self._playwright.chromium.launch(
                headless=self._headless,
                args=[
                    "--no-sandbox",
                    "--disable-blink-features=AutomationControlled",
                ],
            )
            self._owns_browser = True
            ctx = self._browser.new_context(
                user_agent=(
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/156.0.0.0 Safari/537.36"
                ),
                locale="fr-FR",
                viewport={"width": 1280, "height": 800},
                extra_http_headers={
                    "Accept-Language": "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7",
                },
            )
            # Apply stealth patches to minimise DataDome detection signals
            try:
                from playwright_stealth import Stealth  # type: ignore
                Stealth().apply_stealth_sync(ctx)
                print("[browser] playwright-stealth applied.")
            except ImportError:
                pass

            self._page = ctx.new_page()
            print("[browser] Navigating to sncf-connect.com …")
            self._page.goto(BASE_URL, wait_until="domcontentloaded", timeout=30_000)
            time.sleep(3)   # Give DataDome JS time to run

        print("[browser] Ready.")
        return self

    def _find_or_open_sncf_page(self) -> Page:
        """
        Find the existing SNCF Connect page in the connected browser,
        or open a new one.
        """
        assert self._browser is not None
        for ctx in self._browser.contexts:
            for pg in ctx.pages:
                if "sncf-connect.com" in pg.url:
                    return pg

        # No SNCF page found — open one
        print("[browser] No SNCF page found — opening one …")
        ctx = self._browser.contexts[0] if self._browser.contexts else self._browser.new_context()
        page = ctx.new_page()
        page.goto(BASE_URL, wait_until="domcontentloaded", timeout=30_000)
        time.sleep(2)
        return page

    def stop(self) -> None:
        """Close the browser if we launched it, disconnect otherwise."""
        if self._page and not self._owns_browser:
            # Don't close pages we didn't open in the user's real browser
            pass
        elif self._page:
            self._page.close()

        if self._browser and self._owns_browser:
            self._browser.close()
        elif self._browser:
            self._browser.close()   # disconnect (doesn't kill Chrome)

        if self._playwright:
            self._playwright.stop()

        self._page = None
        self._browser = None
        self._playwright = None

    def __enter__(self) -> "SNCFConnectClient":
        return self.start()

    def __exit__(self, *_: Any) -> None:
        self.stop()

    # ------------------------------------------------------------------
    # Low-level helpers
    # ------------------------------------------------------------------

    def _post(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        """
        Execute a POST request inside the browser and return the parsed JSON.

        Raises:
            RuntimeError: if the browser is not started.
            ValueError: if the response status indicates an error.
        """
        if self._page is None:
            raise RuntimeError("Call start() (or use as a context manager) before making requests.")

        url = f"{BASE_URL}{path}"
        result = self._page.evaluate(_FETCH_JS, [url, payload, BFF_HEADERS])

        status: int = result.get("status", 0)
        body = result.get("body", {})

        if status >= 400:
            body_preview = json.dumps(body)[:300] if body else "(empty)"
            raise ValueError(f"HTTP {status} from {path}: {body_preview}")

        return body  # type: ignore[return-value]

    # ------------------------------------------------------------------
    # Station autocomplete
    # ------------------------------------------------------------------

    def autocomplete(
        self,
        search_term: str,
        result_types: Optional[list[str]] = None,
    ) -> list[dict[str, Any]]:
        """
        Return location suggestions matching *search_term*.

        Args:
            search_term: Partial city/station name (e.g. "Paris", "Lyon P").
            result_types: Filter on result categories (default: PLACE only).

        Returns:
            List of place objects from the API.
        """
        if result_types is None:
            result_types = ["PLACE"]

        data = self._post(
            "/bff/api/v2/autocomplete",
            {
                "searchTerm": search_term,
                "resultTypes": result_types,
                "recentSearchTypes": ["ORIGIN", "ITINERARY"],
            },
        )

        places: list[dict[str, Any]] = []
        for section in data.get("places", []):
            places.extend(section.get("results", []))
        return places

    def get_station(self, search_term: str) -> dict[str, Any]:
        """
        Resolve a human-readable station/city name to a location object.

        First checks the local STATIONS dict, then falls back to autocomplete.

        Args:
            search_term: Station or city name (e.g. "Paris", "Bordeaux").

        Returns:
            Location object ready for use in search_trains().
        """
        key = search_term.upper().replace(" ", "_").replace("-", "_")
        if key in STATIONS:
            return STATIONS[key]

        results = self.autocomplete(search_term)
        if not results:
            raise ValueError(f"No station found for: {search_term!r}")

        for item in results:
            if item.get("autocompleteItemType") == "PLACE":
                desc = item.get("description", "")
                if isinstance(desc, dict):
                    desc = desc.get("label", "")
                return {
                    "label": item.get("label", search_term),
                    "id": item.get("galileoId", item.get("id", "")),
                    "codes": item.get("codes", []),
                    "geolocation": False,
                }

        raise ValueError(f"No PLACE result for: {search_term!r}")

    # ------------------------------------------------------------------
    # Train search (single page, ~8 results)
    # ------------------------------------------------------------------

    def search_trains(
        self,
        origin: dict[str, Any],
        destination: dict[str, Any],
        departure_dt: datetime,
        arrival_at: bool = False,
        direct_only: bool = False,
    ) -> dict[str, Any]:
        """
        Search for trains between *origin* and *destination*.

        Args:
            origin: Location object (from get_station / STATIONS dict).
            destination: Location object (from get_station / STATIONS dict).
            departure_dt: Departure datetime (naive = Paris local, or tz-aware).
            arrival_at: If True, *departure_dt* is treated as desired arrival time.
            direct_only: Restrict to non-stop services.

        Returns:
            Raw API response dict.  Key fields:
                result["longDistance"]["proposals"]["proposals"] – list of trips
                result["longDistance"]["status"]                – "OK" / "NO_RESULT"
        """
        if departure_dt.tzinfo is None:
            departure_dt = PARIS_TZ.localize(departure_dt)

        utc_dt = departure_dt.astimezone(pytz.utc)
        date_str = utc_dt.strftime("%Y-%m-%dT%H:%M:%S.000Z")

        payload: dict[str, Any] = {
            "schedule": {
                "outward": {
                    "date": date_str,
                    "arrivalAt": arrival_at,
                }
            },
            "mainJourney": {
                "origin": origin,
                "destination": destination,
            },
            "passengers": [
                {
                    "id": str(uuid.uuid4()),
                    "discountCards": [],
                    "typology": "ADULT",
                    "displayName": "30 - 59 ans",
                    "withoutSeatAssignment": False,
                    "hasDisability": False,
                    "hasWheelchair": False,
                }
            ],
            "pets": [],
            "itineraryId": str(uuid.uuid4()),
            "branch": "SHOP",
            "forceDisplayResults": True,
            "trainExpected": True,
            "wishBike": False,
            "strictMode": False,
            "directJourney": direct_only,
            "transporterLabels": [],
            "metadataY": {},
            "shortItineraryFilters": {
                "excludableLineCategories": [],
                "includibleTransportTypes": [],
                "excludableConnections": [],
                "wheelchairAccessible": "NOT_SELECTED",
            },
            "userNavigation": ["IS_NOT_BUSINESS"],
        }

        return self._post("/bff/api/v1/itineraries", payload)

    # ------------------------------------------------------------------
    # Full-day train listing (pagination loop)
    # ------------------------------------------------------------------

    def get_all_trains_for_day(
        self,
        origin: "str | dict[str, Any]",
        destination: "str | dict[str, Any]",
        date: str,
        delay_between_calls: float = 0.3,
        direct_only: bool = False,
    ) -> list[dict[str, Any]]:
        """
        Retrieve **all** train proposals departing on *date* between
        *origin* and *destination*.

        The API returns ~8 proposals per call; this method paginates
        automatically by advancing the cursor to the minute after the
        last returned departure.

        Args:
            origin: Station name string (e.g. "Paris") or location-object dict.
            destination: Station name string (e.g. "Lyon") or location-object dict.
            date: ISO date string "YYYY-MM-DD" (Paris local date).
            delay_between_calls: Seconds to wait between paginated API calls.
            direct_only: Restrict to non-stop services.

        Returns:
            List of proposal dicts, one per train.  Each proposal has:
                - travelId            : unique trip identifier
                - departure           : {originStationLabel, timeLabel, dateLabel}
                - arrival             : {destinationStationLabel, timeLabel}
                - durationLabel       : e.g. "2h11"
                - bestPriceLabel      : e.g. "16 €"
                - transporterDescription : train type / connections
        """
        # Resolve station names to location objects
        if isinstance(origin, str):
            origin = self.get_station(origin)
        if isinstance(destination, str):
            destination = self.get_station(destination)

        target_date = datetime.strptime(date, "%Y-%m-%d").date()

        # Start cursor at midnight Paris time
        cursor = PARIS_TZ.localize(
            datetime(target_date.year, target_date.month, target_date.day, 0, 0, 0)
        )

        all_proposals: list[dict[str, Any]] = []
        seen_ids: set[str] = set()
        max_pages = 50  # guard against infinite loops
        prev_cursor: Optional[datetime] = None

        for page in range(max_pages):
            if page > 0:
                time.sleep(delay_between_calls)

            # Guard against stuck cursor
            if prev_cursor is not None and cursor == prev_cursor:
                break
            prev_cursor = cursor

            print(
                f"[page {page + 1}] querying from "
                f"{cursor.strftime('%H:%M')} Paris …",
                end=" ",
                flush=True,
            )

            try:
                resp = self.search_trains(
                    origin, destination, cursor, direct_only=direct_only
                )
            except ValueError as exc:
                print(f"\n[WARN] {exc}; stopping pagination.")
                break

            ld = resp.get("longDistance", {})
            proposals: list[dict[str, Any]] = (
                ld.get("proposals", {}).get("proposals", [])
            )

            print(f"got {len(proposals)} proposals", end="")

            if not proposals:
                print()
                break  # no more trains

            last_departure: Optional[datetime] = None
            new_count = 0

            for prop in proposals:
                # Use travelId as dedup key
                # Format: "2026-11-10T06:16_9761, 889317" → dedup on "2026-11-10T06:16_9761"
                travel_id = prop.get("travelId", "")
                dedup_key = travel_id.split(",")[0].strip()
                if not dedup_key or dedup_key in seen_ids:
                    continue

                # Parse departure datetime from travelId
                dep_str = dedup_key.split("_")[0].strip()
                try:
                    dep_naive = datetime.fromisoformat(dep_str)
                    dep_paris = PARIS_TZ.localize(dep_naive)
                except (ValueError, AttributeError):
                    dep_paris = None

                if dep_paris is None:
                    continue
                if dep_paris.date() > target_date:
                    print(f", {new_count} new → day boundary reached")
                    return all_proposals
                if dep_paris.date() < target_date:
                    continue

                seen_ids.add(dedup_key)
                all_proposals.append(prop)
                last_departure = dep_paris
                new_count += 1

            print(f", {new_count} new (total {len(all_proposals)})")

            if new_count == 0:
                break

            if last_departure is None:
                break

            # Advance cursor past the last returned departure
            cursor = last_departure + timedelta(minutes=1)

            end_of_day = PARIS_TZ.localize(
                datetime(target_date.year, target_date.month, target_date.day, 23, 59, 59)
            )
            if cursor > end_of_day:
                break

        return all_proposals


# ---------------------------------------------------------------------------
# Simple output helpers
# ---------------------------------------------------------------------------


def print_trains(proposals: list[dict[str, Any]]) -> None:
    """Pretty-print a list of train proposals."""
    if not proposals:
        print("No trains found.")
        return

    print(f"\n{'─' * 75}")
    print(f"{'DEP':>5}  {'ARR':>5}  {'DUR':>6}  {'TYPE':<30}  {'PRICE'}")
    print(f"{'─' * 75}")
    for p in proposals:
        dep = p.get("departure", {}).get("timeLabel", "?")
        arr = p.get("arrival", {}).get("timeLabel", "?")
        dur = p.get("durationLabel", "?")
        typ = p.get("transporterDescription", "?")[:30]
        price = p.get("bestPriceLabel", "-")
        print(f"{dep:>5}  {arr:>5}  {dur:>6}  {typ:<30}  {price}")
    print(f"{'─' * 75}")
    print(f"Total: {len(proposals)} trains\n")


# ---------------------------------------------------------------------------
# Main – example usage
# ---------------------------------------------------------------------------


def main() -> None:
    with SNCFConnectClient() as client:

        # ── Example 1: quick autocomplete lookup ─────────────────────────
        print("\n=== Autocomplete: 'Nantes' ===")
        places = client.autocomplete("Nantes")
        for p in places[:5]:
            desc = p.get("description", "")
            if isinstance(desc, dict):
                desc = desc.get("label", "")
            print(f"  {p.get('label')} – {desc}")

        # ── Example 2: search trains for a full day ───────────────────────
        ORIGIN      = "Paris"        # or "Paris Gare de Lyon", "Bordeaux", etc.
        DESTINATION = "Lyon"
        DATE        = "2026-11-10"   # target date (Paris local), format YYYY-MM-DD

        print(f"\n=== All trains: {ORIGIN} → {DESTINATION} on {DATE} ===")
        trains = client.get_all_trains_for_day(ORIGIN, DESTINATION, DATE)
        print_trains(trains)

        # ── Save full JSON result to disk ─────────────────────────────────
        out_path = "/Users/pmael/.reverse-api/runs/scripts/56ffea817d11/trains.json"
        with open(out_path, "w", encoding="utf-8") as fh:
            json.dump(trains, fh, ensure_ascii=False, indent=2)
        print(f"Saved {len(trains)} trains to {out_path}")


if __name__ == "__main__":
    main()
