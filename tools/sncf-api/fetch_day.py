#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = ["playwright", "pytz"]
# ///
"""
fetch_day.py ORIGIN DEST DATE [--direct] [--from-file raw.json]

One day of SNCF Connect trains between two places, as one JSON document on stdout,
for the app to read (step 1 of the SNCF Connect price source).

- stdout carries the JSON and nothing else; the client's progress goes to stderr.
- --from-file converts a saved raw answer (a list of proposals, like trains.json)
  without opening Chrome: for tests and for checking the conversion.
- Times are Paris local time without an offset ("2026-11-10T06:16"), as Trenitalia's are in the app.
- On failure, stdout carries {"schema": 1, "error": {"kind", "message"}} and the exit code says what happened.
"""
from __future__ import annotations

import argparse
import contextlib
import json
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from typing import Any, NoReturn, Optional

SCHEMA = 1

# Exit codes: what the app does about each is in the README
EXIT_OK = 0
EXIT_USAGE = 2      # argparse uses 2 too
EXIT_BROWSER = 3    # Chrome is not reachable
EXIT_BLOCKED = 4    # SNCF refused (HTTP 403 / 429)
EXIT_CHANGED = 5    # SNCF answered in a shape this script does not know, or failed otherwise
EXIT_NO_PLACE = 6   # SNCF knows no place by that name


class ChangedAnswer(Exception):
    """A proposal is not in the shape this script knows."""


class NoChrome(Exception):
    """Chrome is not running with remote debugging on."""


class LostPage(Exception):
    """Chrome was reached, but the tab SNCF Connect was read in failed: closed, reloaded, offline, too slow. Tried again once."""


ATTEMPTS = 2
RETRY_PAUSE_S = 3


# ---------------------------------------------------------------------------
# Conversion: one raw SNCF proposal → one clean train
# ---------------------------------------------------------------------------

def euros(label: Optional[str]) -> Optional[float]:
    """'65,60\\xa0€' → 65.6, '115 €' → 115.0, None or no number → None."""
    m = re.search(r"\d+(?:[.,]\d+)?", (label or "").replace("\xa0", "").replace(" ", ""))
    return float(m.group().replace(",", ".")) if m else None


_DURATION = re.compile(r"\s*(?:(\d+)\s*h)?\s*(?:(\d+)\s*(?:min)?)?\s*")


def minutes(label: str) -> int:
    """'2h48' → 168, '2h' → 120, '45 min' → 45."""
    m = _DURATION.fullmatch(label or "")
    if not m or not any(m.groups()):
        raise ChangedAnswer(f"unknown duration {label!r}")
    hours, mins = m.groups()
    return int(hours or 0) * 60 + int(mins or 0)


def cheapest(block: Optional[dict[str, Any]]) -> Optional[float]:
    """The cheapest offer of a class (secondComfortClassOffers / firstComfortClassOffers), None when none is on sale."""
    prices = [euros(o.get("priceLabel")) for o in (block or {}).get("offers", [])]
    prices = [p for p in prices if p is not None]
    return min(prices) if prices else None


def legs(proposal: dict[str, Any]) -> list[dict[str, Any]]:
    """Each train of the journey, from globalTimeline ('segments' is empty in SNCF's answers). Other steps are skipped."""
    out = []
    for step in (proposal.get("globalTimeline") or {}).get("steps", []):
        train = step.get("train")
        if not train:
            continue
        transporter = train.get("transporter") or {}
        request = ((train.get("tripIv") or {}).get("vehicleDetails") or {}).get("request") or {}
        out.append({
            "from": train["departure"]["stationLabel"],
            "fromCode": uic(request.get("origin")),
            "departs": train["departure"]["timeLabel"],
            "to": train["arrival"]["stationLabel"],
            "toCode": uic(request.get("destination")),
            "arrives": train["arrival"]["timeLabel"],
            "operator": transporter.get("description"),
            "number": re.sub(r"^n°\s*", "", transporter.get("number") or ""),
        })
    return out


def uic(place_id: Optional[str]) -> Optional[str]:
    """
    The station's UIC number, 7 digits, from SNCF's id of it ("RESARAIL_STA_8768600" is Paris Gare de Lyon): where the leg
    boards and leaves (checked on all 32 legs of trains.json). SNCF's open list of stations gives their position by it.
    """
    match = re.fullmatch(r"RESARAIL_STA_(\d{7})", place_id or "")
    return match.group(1) if match else None


def availability(status: Optional[dict[str, Any]]) -> str:
    """
    Why a train can or cannot be booked. SNCF says "not bookable" for two different things, which its label tells apart:
    "Complet" (no seat left) and "En vente prochainement" (sales not open yet for that date).
      bookable | sold-out | not-on-sale | unavailable (any other reason)
    """
    status = status or {}
    if status.get("isBookable"):
        return "bookable"
    words = f"{status.get('label') or ''} {status.get('title') or ''}".lower()
    if "complet" in words:
        return "sold-out"
    if "prochainement" in words or "mis en vente" in words:
        return "not-on-sale"
    return "unavailable"


def clean(proposal: dict[str, Any]) -> dict[str, Any]:
    # travelId: "2026-11-10T06:16_9761, 889317" → the only full date in a proposal
    travel_id = proposal["travelId"].split(",")[0].strip()
    try:
        depart = datetime.fromisoformat(travel_id.split("_")[0])
    except ValueError as exc:
        raise ChangedAnswer(f"unknown travelId {proposal['travelId']!r}") from exc
    duration = minutes(proposal["durationLabel"])
    train_legs = legs(proposal)
    return {
        "id": travel_id,
        "departAt": depart.strftime("%Y-%m-%dT%H:%M"),
        # From the duration, not the French date label: right after midnight too
        "arriveAt": (depart + timedelta(minutes=duration)).strftime("%Y-%m-%dT%H:%M"),
        "durationMin": duration,
        "from": proposal["departure"]["originStationLabel"],
        "to": proposal["arrival"]["destinationStationLabel"],
        "changes": max(len(train_legs) - 1, 0),
        "legs": train_legs,
        "bookable": bool((proposal.get("status") or {}).get("isBookable")),
        "availability": availability(proposal.get("status")),
        "priceEur": {
            # best can be a first-class price when second class is sold out: read "second" for a second-class trip
            "best": (proposal.get("bestPrice") or {}).get("value"),
            "second": cheapest(proposal.get("secondComfortClassOffers")),
            "first": cheapest(proposal.get("firstComfortClassOffers")),
        },
    }


def place(query: str, station: Optional[dict[str, Any]]) -> dict[str, Any]:
    station = station or {}
    return {"query": query, "label": station.get("label"), "id": station.get("id")}


# ---------------------------------------------------------------------------
# Command line
# ---------------------------------------------------------------------------

def fail(code: int, kind: str, message: str) -> NoReturn:
    json.dump({"schema": SCHEMA, "error": {"kind": kind, "message": message}}, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")
    sys.exit(code)


def iso_date(value: str) -> str:
    try:
        datetime.strptime(value, "%Y-%m-%d")
    except ValueError as exc:
        raise argparse.ArgumentTypeError(f"not a date in the form YYYY-MM-DD: {value!r}") from exc
    return value


def fetch(origin_query: str, destination_query: str, date: str, direct: bool):
    """Asks SNCF Connect through the running Chrome. Returns (origin, destination, raw proposals)."""
    import api_client  # needs playwright: imported only when Chrome is really used

    # Only the user's running Chrome: never the client's fallback, which launches a Chromium of its own
    # (raised, not fail(): stdout is still redirected to stderr here)
    if not api_client._find_chrome_ws_endpoint():
        raise NoChrome("Chrome is not running with remote debugging on")

    # The client reads through an SNCF Connect tab the person already has open: when they browse in it, the page goes
    # away under the script (TargetClosedError, 2026-11-12). It reads through a tab of its own instead, closed at the end.
    client = api_client.SNCFConnectClient()
    reached = False

    def own_tab() -> Any:
        nonlocal reached
        reached = True
        return open_own_tab(client._browser, api_client.BASE_URL)

    client._find_or_open_sncf_page = own_tab
    try:
        with client:
            try:
                return read_day(client, origin_query, destination_query, date, direct)
            finally:
                with contextlib.suppress(Exception):
                    client._page.close()
    except ValueError:
        raise
    except Exception as exc:
        if reached:
            raise LostPage(f"{type(exc).__name__}: {exc}") from exc
        raise


def open_own_tab(browser: Any, url: str) -> Any:
    """
    A new tab on SNCF Connect in the person's Chrome, opened behind the one they are looking at (CDP's background
    target; Playwright's new_page would bring it to the front). The page has to be on sncf-connect.com for the
    client's requests to carry the site's cookies.
    """
    context = browser.contexts[0] if browser.contexts else browser.new_context()
    page = None
    try:
        try:
            with context.expect_page(timeout=10_000) as opened:
                browser.new_browser_cdp_session().send("Target.createTarget", {"url": url, "background": True})
            page = opened.value
        except Exception:
            page = context.new_page()  # in front, when Chrome would not open one behind
            page.goto(url, wait_until="domcontentloaded", timeout=30_000)
        page.wait_for_load_state("domcontentloaded", timeout=30_000)
        time.sleep(2)  # the site's own scripts set its cookies
        return page
    except Exception:
        if page is not None:
            with contextlib.suppress(Exception):
                page.close()
        raise


def read_day(client: Any, origin_query: str, destination_query: str, date: str, direct: bool):
    """The places, then the day's trains, through the client's tab."""
    origin = resolve(client, origin_query)
    destination = resolve(client, destination_query)

    # The client stops paging at the first failed page and returns what it had, as if the day ended there (an HTTP 500
    # gave "0 trains, all fine"). Each failure is noted, and the day is not believed when one happened.
    failures: list[ValueError] = []
    search = client.search_trains

    def noting(*args: Any, **kwargs: Any) -> Any:
        try:
            return search(*args, **kwargs)
        except ValueError as exc:
            failures.append(exc)
            raise

    client.search_trains = noting
    raw = client.get_all_trains_for_day(origin, destination, date, direct_only=direct)
    if failures:
        raise failures[0]
    return origin, destination, raw


def fetch_again_once(origin_query: str, destination_query: str, date: str, direct: bool):
    """A lost tab is a passing thing (the person closed it, the Wi-Fi dropped): asked again once, in a new tab."""
    for attempt in range(1, ATTEMPTS + 1):
        try:
            return fetch(origin_query, destination_query, date, direct)
        except LostPage as exc:
            if attempt == ATTEMPTS:
                raise
            print(f"[retry] {exc}; asking again in a new tab", file=sys.stderr)
            time.sleep(RETRY_PAUSE_S)


def resolve(client: Any, name: str) -> dict[str, Any]:
    """
    The place SNCF's own autocomplete gives for a name. The client's built-in list (STATIONS) is not used: some of its ids
    are not SNCF's (its Nantes, CITY_FR_2990969, made every search to Nantes fail with an HTTP 500; SNCF's is CITY_FR_6434483).
    """
    for item in client.autocomplete(name):
        if item.get("autocompleteItemType") == "PLACE":
            return {
                "label": item.get("label", name),
                "id": item.get("galileoId", item.get("id", "")),
                "codes": item.get("codes", []),
                "geolocation": False,
            }
    raise ValueError(f"No PLACE result for: {name!r}")


def main(argv: Optional[list[str]] = None) -> None:
    ap = argparse.ArgumentParser(description="One day of SNCF Connect trains, as JSON on stdout.")
    ap.add_argument("origin", help='a city or station, e.g. "Paris"')
    ap.add_argument("destination", help='a city or station, e.g. "Lyon"')
    ap.add_argument("date", type=iso_date, help="Paris local date, YYYY-MM-DD")
    ap.add_argument("--direct", action="store_true", help="non-stop trains only")
    ap.add_argument("--from-file", help="convert a saved list of raw proposals instead of asking SNCF")
    args = ap.parse_args(argv)

    origin: Optional[dict[str, Any]] = None
    destination: Optional[dict[str, Any]] = None

    if args.from_file:
        try:
            with open(args.from_file, encoding="utf-8") as fh:
                raw = json.load(fh)
        except (OSError, json.JSONDecodeError) as exc:
            fail(EXIT_USAGE, "usage", f"cannot read {args.from_file}: {exc}")
    else:
        try:
            # The client prints its progress: it goes to stderr, so stdout carries only the JSON
            with contextlib.redirect_stdout(sys.stderr):
                origin, destination, raw = fetch_again_once(args.origin, args.destination, args.date, args.direct)
        except LostPage as exc:
            offline = "ERR_INTERNET_DISCONNECTED" in str(exc)
            fail(EXIT_CHANGED, "error", f"{'Chrome has no internet connection' if offline else 'Chrome lost the SNCF Connect tab'}: {exc}")
        except NoChrome as exc:
            fail(EXIT_BROWSER, "browser", str(exc))
        except ValueError as exc:  # api_client raises "HTTP 403 from …" and "No station found for: …"
            message = str(exc)
            if re.search(r"HTTP (403|429)\b", message):
                fail(EXIT_BLOCKED, "blocked", message)
            if re.match(r"No (station found|PLACE result) for", message):
                fail(EXIT_NO_PLACE, "no-place", message)
            fail(EXIT_CHANGED, "error", message)
        except Exception as exc:  # Chrome / CDP connection, Playwright
            fail(EXIT_BROWSER, "browser", f"{type(exc).__name__}: {exc}")

    try:
        if not isinstance(raw, list):
            raise ChangedAnswer("the proposals are not a list")
        trains = [clean(p) for p in raw]
    except (ChangedAnswer, KeyError, TypeError, AttributeError) as exc:
        fail(EXIT_CHANGED, "changed", f"unexpected answer shape: {exc!r}")

    json.dump({
        "schema": SCHEMA,
        "source": "sncf-connect",
        "date": args.date,
        "origin": place(args.origin, origin),
        "destination": place(args.destination, destination),
        "fetchedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "trains": trains,
    }, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
