"""
Tests for fetch_day.py, on the saved answer trains.json (Paris → Lyon, 10 Nov 2026, 31 trains).

Run:  python3 -m unittest discover -s tools/sncf-api -v
Needs nothing beyond Python: Chrome and playwright are replaced by a fake client.
"""
from __future__ import annotations

import contextlib
import io
import json
import subprocess
import sys
import tempfile
import types
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCRIPT = HERE / "fetch_day.py"
SAMPLE = HERE / "trains.json"

sys.path.insert(0, str(HERE))
import fetch_day  # noqa: E402


def run_cli(*args: str) -> tuple[int, str, str]:
    """Runs fetch_day.py as the app will: a separate process, JSON read from stdout."""
    done = subprocess.run([sys.executable, str(SCRIPT), *args], capture_output=True, text=True, timeout=60)
    return done.returncode, done.stdout, done.stderr


def run_main(*args: str) -> tuple[int, str, str]:
    """Runs main() in this process, so that a fake api_client can stand in for Chrome."""
    out, err = io.StringIO(), io.StringIO()
    code = 0
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        try:
            fetch_day.main(list(args))
        except SystemExit as exc:
            code = exc.code if isinstance(exc.code, int) else 1
    return code, out.getvalue(), err.getvalue()


class TargetClosedError(Exception):
    """Playwright's, when the tab it reads through is closed or navigated away"""


def fake_api_client(*, chrome: bool = True, raw=None, error: Exception | None = None, page_error: Exception | None = None, known=None,
                    connect_error: Exception | None = None, lose_tab: int = 0) -> types.ModuleType:
    """
    A stand-in for api_client: prints progress to stdout like the real one, then answers or fails. `page_error` fails a page
    the way the real client does: it prints a warning and returns what it had, as if the day ended there. `known` is the
    names its autocomplete knows (all by default). `connect_error` fails before Chrome is reached; `lose_tab` is how many
    runs lose their tab halfway, as when the person closes it.
    """
    module = types.ModuleType("api_client")
    module.BASE_URL = "https://www.sncf-connect.com"
    module.started = False
    module.asked = []
    module.read_through = []
    module.runs = 0

    class Client:
        def __init__(self):
            self._browser = "the person's Chrome"
            self._page = None

        def _find_or_open_sncf_page(self):
            return "the person's own SNCF Connect tab"

        def __enter__(self):
            module.started = True
            print("[browser] Connecting to running Chrome via CDP …")
            if connect_error is not None:
                raise connect_error
            self._page = self._find_or_open_sncf_page()
            return self

        def __exit__(self, *_):
            return False

        def autocomplete(self, name):
            if known is not None and name not in known:
                return []
            return [{"autocompleteItemType": "PLACE", "label": name.title(), "id": f"CITY_FR_{name.upper()}", "codes": [{"type": "RESARAIL", "value": "FRXXX"}]}]

        def search_trains(self, origin, destination, departure_dt, direct_only=False):
            module.asked.append((origin["id"], destination["id"]))
            if page_error is not None:
                raise page_error
            return {"longDistance": {"proposals": {"proposals": raw or []}}}

        def get_all_trains_for_day(self, origin, destination, date, direct_only=False):
            print("[page 1] querying from 00:00 Paris … got 8 proposals, 8 new (total 8)")
            module.runs += 1
            module.read_through.append(self._page)
            if module.runs <= lose_tab:
                raise TargetClosedError("Page.evaluate: Target page, context or browser has been closed")
            if error is not None:
                raise error
            try:
                self.search_trains(origin, destination, None, direct_only=direct_only)
            except ValueError as exc:
                print(f"\n[WARN] {exc}; stopping pagination.")
                return []
            return raw

    module._find_chrome_ws_endpoint = lambda: "ws://127.0.0.1:9222/devtools/browser/x" if chrome else None
    module.SNCFConnectClient = Client
    return module


class FakeTab:
    def __init__(self, browser, url):
        self.browser, self.url, self.closed = browser, url, False

    def close(self):
        self.closed = True


class WithFakeClient(unittest.TestCase):
    def use(self, module: types.ModuleType) -> None:
        previous = sys.modules.get("api_client")
        sys.modules["api_client"] = module
        self.addCleanup(lambda: sys.modules.__setitem__("api_client", previous) if previous else sys.modules.pop("api_client", None))
        # The script's own tab, in place of Chrome's; no pause before asking again
        self.tabs: list[FakeTab] = []
        open_own_tab, pause = fetch_day.open_own_tab, fetch_day.RETRY_PAUSE_S
        fetch_day.open_own_tab = lambda browser, url: self.tabs.append(FakeTab(browser, url)) or self.tabs[-1]
        fetch_day.RETRY_PAUSE_S = 0
        self.addCleanup(lambda: (setattr(fetch_day, "open_own_tab", open_own_tab), setattr(fetch_day, "RETRY_PAUSE_S", pause)))


class Helpers(unittest.TestCase):
    def test_euros(self):
        self.assertEqual(fetch_day.euros("65,60\xa0€"), 65.6)
        self.assertEqual(fetch_day.euros("115\xa0€"), 115.0)
        self.assertEqual(fetch_day.euros("1 234,50 €"), 1234.5)
        self.assertIsNone(fetch_day.euros(None))
        self.assertIsNone(fetch_day.euros("Complet"))

    def test_minutes(self):
        self.assertEqual(fetch_day.minutes("2h48"), 168)
        self.assertEqual(fetch_day.minutes("2h05"), 125)
        self.assertEqual(fetch_day.minutes("2h"), 120)
        self.assertEqual(fetch_day.minutes("45 min"), 45)
        self.assertEqual(fetch_day.minutes("45min"), 45)
        with self.assertRaises(fetch_day.ChangedAnswer):
            fetch_day.minutes("deux heures")

    def test_availability_tells_a_full_train_from_one_not_on_sale_yet(self):
        self.assertEqual(fetch_day.availability({"isBookable": True}), "bookable")
        self.assertEqual(fetch_day.availability({"isBookable": False, "label": "Complet", "title": "Complet"}), "sold-out")
        # What SNCF answered for Montauban → Nantes on 7 Jan 2027, asked on 11 Nov 2026
        self.assertEqual(fetch_day.availability({"isBookable": False, "label": "En vente prochainement", "title": "Billets mis en vente prochainement"}), "not-on-sale")
        self.assertEqual(fetch_day.availability({"isBookable": False, "label": "Train supprimé"}), "unavailable")
        self.assertEqual(fetch_day.availability(None), "unavailable")

    def test_uic_number_of_a_station(self):
        self.assertEqual(fetch_day.uic("RESARAIL_STA_8768600"), "8768600")
        self.assertIsNone(fetch_day.uic("CITY_FR_6455259"))
        self.assertIsNone(fetch_day.uic(None))

    def test_arrival_after_midnight_comes_from_the_duration(self):
        proposal = {
            "travelId": "2026-11-10T23:30_5000",
            "durationLabel": "1h05",
            "departure": {"originStationLabel": "A"},
            "arrival": {"destinationStationLabel": "B"},
        }
        train = fetch_day.clean(proposal)
        self.assertEqual(train["arriveAt"], "2026-11-11T00:35")
        self.assertEqual(train["changes"], 0)
        self.assertEqual(train["priceEur"], {"best": None, "second": None, "first": None})
        self.assertFalse(train["bookable"])


@unittest.skipUnless(SAMPLE.exists(), "trains.json is not there")
class OnTheSavedAnswer(unittest.TestCase):
    """The whole command, as a separate process, on the 31 saved trains."""

    @classmethod
    def setUpClass(cls):
        cls.code, cls.stdout, cls.stderr = run_cli("Paris", "Lyon", "2026-11-10", "--from-file", str(SAMPLE))
        cls.doc = json.loads(cls.stdout) if cls.code == 0 else None
        cls.by_time = {t["departAt"][11:]: t for t in (cls.doc or {}).get("trains", [])}

    def test_stdout_is_one_json_document(self):
        self.assertEqual(self.code, 0, self.stderr)
        self.assertEqual(self.doc["schema"], 1)
        self.assertEqual(self.doc["source"], "sncf-connect")
        self.assertEqual(self.doc["date"], "2026-11-10")
        self.assertEqual(self.doc["origin"], {"query": "Paris", "label": None, "id": None})
        self.assertRegex(self.doc["fetchedAt"], r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$")
        self.assertEqual(len(self.doc["trains"]), 31)

    def test_a_train_with_a_change(self):
        self.assertEqual(self.doc["trains"][0], {
            "id": "2026-11-10T06:16_9761",
            "departAt": "2026-11-10T06:16",
            "arriveAt": "2026-11-10T09:04",
            "durationMin": 168,
            "from": "Paris - Gare De Lyon - Hall 1 & 2",
            "to": "Lyon Part Dieu",
            "changes": 1,
            "legs": [
                {"from": "Paris - Gare De Lyon - Hall 1 & 2", "fromCode": "8768600", "departs": "06:16", "to": "Bourg-En-Bresse",
                 "toCode": "8774300", "arrives": "08:09", "operator": "LYRIA", "number": "9761"},
                {"from": "Bourg-En-Bresse", "fromCode": "8774300", "departs": "08:14", "to": "Lyon Part Dieu",
                 "toCode": "8772319", "arrives": "09:04", "operator": "Train TER", "number": "889317"},
            ],
            "bookable": True,
            "availability": "bookable",
            "priceEur": {"best": 70.6, "second": 70.6, "first": 78.6},
        })

    def test_every_train_is_on_the_day_and_arrives_after_it_leaves(self):
        for t in self.doc["trains"]:
            self.assertTrue(t["departAt"].startswith("2026-11-10"), t["id"])
            self.assertGreater(t["arriveAt"], t["departAt"], t["id"])
            self.assertEqual(t["changes"], len(t["legs"]) - 1, t["id"])

    def test_sold_out_trains_stay_listed_without_a_price(self):
        sold_out = [t for t in self.doc["trains"] if not t["bookable"]]
        self.assertEqual([t["departAt"][11:] for t in sold_out], ["15:52", "17:00", "17:26", "18:26", "19:00", "21:00"])
        for t in sold_out:
            self.assertEqual(t["priceEur"], {"best": None, "second": None, "first": None}, t["id"])
            # They said "Complet": full, not "not on sale yet"
            self.assertEqual(t["availability"], "sold-out", t["id"])

    def test_only_first_class_left(self):
        tgv = self.by_time["15:00"]
        self.assertTrue(tgv["bookable"])
        self.assertEqual(tgv["priceEur"], {"best": 180, "second": None, "first": 180.0})

    def test_ouigo_keeps_the_cheaper_of_its_two_fares(self):
        self.assertEqual(self.by_time["08:55"]["priceEur"]["second"], 25.0)  # 34 € OUIGO PLUS, 25 € Essentiel

    def test_one_train_boarded_at_two_stations_comes_twice(self):
        ouigo = [t for t in self.doc["trains"] if t["legs"] and t["legs"][0]["number"] == "7867"]
        self.assertEqual(len(ouigo), 2)
        self.assertEqual({t["from"] for t in ouigo}, {"Aeroport Charles De Gaulle 2 TGV", "Marne-La-Vallee - Chessy"})
        self.assertEqual({t["arriveAt"] for t in ouigo}, {"2026-11-10T11:03"})


class CommandLineErrors(unittest.TestCase):
    def test_a_bad_date_is_refused(self):
        code, stdout, _ = run_cli("Paris", "Lyon", "10/11/2026", "--from-file", str(SAMPLE))
        self.assertEqual(code, fetch_day.EXIT_USAGE)
        self.assertEqual(stdout, "")

    def test_a_missing_file(self):
        code, stdout, _ = run_cli("Paris", "Lyon", "2026-11-10", "--from-file", "/nonexistent/raw.json")
        self.assertEqual(code, fetch_day.EXIT_USAGE)
        self.assertEqual(json.loads(stdout)["error"]["kind"], "usage")

    def test_an_answer_in_an_unknown_shape(self):
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as fh:
            json.dump([{"travelId": "2026-11-10T06:16_9761"}], fh)
        self.addCleanup(Path(fh.name).unlink)
        code, stdout, _ = run_cli("Paris", "Lyon", "2026-11-10", "--from-file", fh.name)
        self.assertEqual(code, fetch_day.EXIT_CHANGED)
        self.assertEqual(json.loads(stdout)["error"]["kind"], "changed")


class ThroughTheClient(WithFakeClient):
    """main() as it runs with Chrome, the client replaced by a fake."""

    def test_the_clients_progress_goes_to_stderr_and_stdout_stays_json(self):
        raw = json.loads(SAMPLE.read_text(encoding="utf-8"))[:3]
        self.use(fake_api_client(raw=raw))
        code, stdout, stderr = run_main("Paris", "Lyon", "2026-11-10")
        self.assertEqual(code, 0, stderr)
        doc = json.loads(stdout)
        self.assertEqual(len(doc["trains"]), 3)
        self.assertEqual(doc["origin"], {"query": "Paris", "label": "Paris", "id": "CITY_FR_PARIS"})
        self.assertIn("[page 1] querying", stderr)
        self.assertNotIn("[page 1]", stdout)

    def test_no_chrome_means_no_browser_of_its_own(self):
        module = fake_api_client(chrome=False, raw=[])
        self.use(module)
        code, stdout, _ = run_main("Paris", "Lyon", "2026-11-10")
        self.assertEqual(code, fetch_day.EXIT_BROWSER)
        self.assertEqual(json.loads(stdout)["error"]["kind"], "browser")
        self.assertFalse(module.started)

    def test_a_refusal_is_reported_as_blocked(self):
        self.use(fake_api_client(error=ValueError('HTTP 403 from /bff/api/v1/itineraries: {"url": "captcha"}')))
        code, stdout, _ = run_main("Paris", "Lyon", "2026-11-10")
        self.assertEqual(code, fetch_day.EXIT_BLOCKED)
        self.assertEqual(json.loads(stdout)["error"]["kind"], "blocked")

    def test_an_unknown_place(self):
        self.use(fake_api_client(raw=[], known={"Lyon"}))
        code, stdout, _ = run_main("Xyzville", "Lyon", "2026-11-10")
        self.assertEqual(code, fetch_day.EXIT_NO_PLACE)
        self.assertEqual(json.loads(stdout)["error"], {"kind": "no-place", "message": "No PLACE result for: 'Xyzville'"})

    def test_places_come_from_sncfs_autocomplete_not_the_clients_built_in_list(self):
        # The client's built-in Nantes (CITY_FR_2990969) made every search to Nantes fail
        module = fake_api_client(raw=[])
        self.use(module)
        code, stdout, _ = run_main("Montauban Ville Bourbon", "Nantes", "2027-01-07")
        self.assertEqual(code, 0)
        self.assertEqual(module.asked, [("CITY_FR_MONTAUBAN VILLE BOURBON", "CITY_FR_NANTES")])
        self.assertEqual(json.loads(stdout)["destination"], {"query": "Nantes", "label": "Nantes", "id": "CITY_FR_NANTES"})

    def test_a_page_that_failed_is_an_error_not_an_empty_day(self):
        # The real client prints a warning and returns [] when SNCF answers HTTP 500: that is not "no train that day"
        self.use(fake_api_client(raw=[], page_error=ValueError('HTTP 500 from /bff/api/v1/itineraries: {"title": "TECHNICAL_EXCEPTION"}')))
        code, stdout, stderr = run_main("Montauban Ville Bourbon", "Nantes", "2027-01-07")
        self.assertEqual(code, fetch_day.EXIT_CHANGED)
        self.assertEqual(json.loads(stdout)["error"]["kind"], "error")
        self.assertIn("HTTP 500", json.loads(stdout)["error"]["message"])
        self.assertIn("[WARN]", stderr)

    def test_a_refused_page_is_blocked_even_when_the_client_swallowed_it(self):
        self.use(fake_api_client(raw=[], page_error=ValueError("HTTP 403 from /bff/api/v1/itineraries: {}")))
        code, stdout, _ = run_main("Paris", "Lyon", "2026-12-04")
        self.assertEqual(code, fetch_day.EXIT_BLOCKED)
        self.assertEqual(json.loads(stdout)["error"]["kind"], "blocked")

    def test_a_connection_failure(self):
        module = fake_api_client(connect_error=ConnectionError("CDP connection closed"))
        self.use(module)
        code, stdout, _ = run_main("Paris", "Lyon", "2026-11-10")
        self.assertEqual(code, fetch_day.EXIT_BROWSER)
        self.assertEqual(json.loads(stdout)["error"]["kind"], "browser")
        self.assertIn("CDP connection closed", json.loads(stdout)["error"]["message"])
        self.assertEqual(module.runs, 0)

    def test_it_reads_through_a_tab_of_its_own_and_closes_it(self):
        # It used to borrow the person's open SNCF Connect tab: browsing in it closed the page under the script (2026-11-12)
        module = fake_api_client(raw=[])
        self.use(module)
        code, _, stderr = run_main("Toulouse", "Paris", "2026-12-26")
        self.assertEqual(code, 0, stderr)
        self.assertEqual(module.read_through, self.tabs)
        self.assertEqual([(tab.browser, tab.url, tab.closed) for tab in self.tabs], [("the person's Chrome", "https://www.sncf-connect.com", True)])

    def test_its_tab_is_closed_when_the_search_fails_too(self):
        self.use(fake_api_client(error=ValueError("HTTP 403 from /bff/api/v1/itineraries: {}")))
        code, _, _ = run_main("Paris", "Lyon", "2026-11-10")
        self.assertEqual(code, fetch_day.EXIT_BLOCKED)
        self.assertTrue(all(tab.closed for tab in self.tabs))

    def test_a_lost_tab_is_asked_again_once_in_a_new_tab(self):
        module = fake_api_client(raw=json.loads(SAMPLE.read_text(encoding="utf-8"))[:2], lose_tab=1)
        self.use(module)
        code, stdout, stderr = run_main("Toulouse", "Paris", "2026-12-26")
        self.assertEqual(code, 0, stderr)
        self.assertEqual(len(json.loads(stdout)["trains"]), 2)
        self.assertEqual(module.runs, 2)
        self.assertEqual(len(self.tabs), 2)
        self.assertIn("[retry] TargetClosedError", stderr)

    def test_a_tab_lost_twice_is_an_error_to_try_later_not_chrome_missing(self):
        module = fake_api_client(raw=[], lose_tab=5)
        self.use(module)
        code, stdout, _ = run_main("Toulouse", "Paris", "2026-12-26")
        self.assertEqual(code, fetch_day.EXIT_CHANGED)
        self.assertEqual(module.runs, fetch_day.ATTEMPTS)
        error = json.loads(stdout)["error"]
        self.assertEqual(error["kind"], "error")
        self.assertTrue(error["message"].startswith("Chrome lost the SNCF Connect tab: TargetClosedError"), error["message"])

    def test_no_internet_says_so(self):
        self.use(fake_api_client(error=RuntimeError("Page.goto: net::ERR_INTERNET_DISCONNECTED at https://www.sncf-connect.com/")))
        code, stdout, _ = run_main("Lyon", "Toulouse", "2026-12-22")
        self.assertEqual(code, fetch_day.EXIT_CHANGED)
        self.assertTrue(json.loads(stdout)["error"]["message"].startswith("Chrome has no internet connection: RuntimeError"))


if __name__ == "__main__":
    unittest.main()
