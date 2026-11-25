# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy", "scikit-learn"]
# ///
"""Trains the train-price model on the prices seen on SNCF Connect (price-model.md, P3; task.md T7.9).

Run it with:  uv run tools/price-model/train.py        (uv reads the dependencies above and installs them on its own)
or, with scikit-learn already installed:  python3 tools/price-model/train.py

It reads the `price_observations` table of the app's database (data/trip.db, or --db), only the rows seen on SNCF Connect: the app uses
the model for SNCF's own trains (src/server/priceModel.ts), so the prices of Eurostar and Iryo that the extension also stores teach it
nothing it can use, and must not count towards its thresholds. It writes
  data/price-model.json          the model, in a form the app evaluates in TypeScript (src/core/price-model.ts)
  data/price-model-report.json   how well it does on data it was not trained on, and the same for the simple methods

Two models, because two kinds of train are priced differently:
  range   a direct TGV INOUI or OUIGO, whose published fare range is known. The target is where the price falls in the
          range, t = (price - min) / (max - min), so that one model serves every route.
  per_km  any other train. The target is the price per kilometre.

Each is a Ridge regression; a gradient-boosted model of at most 50 trees of depth 3 is kept instead only when it beats the Ridge
by more than 2 euros of mean absolute error. Both are judged on data they were not trained on, by cross-validation grouped by
ROUTE AND DAY (Toulouse - Lyon on 4 December, whichever page or hour it was read at): the cards of one page are alike, and so are
two readings of the same day, and none may be split between training and test. Leave-one-group-out below 30 groups, 5 folds above.
A "session" is one page read (every train of a page shares the instant it was captured at): that is what the app counts to decide
whether there is enough data, so thirty searches made in one afternoon are thirty sessions. Whether the app *uses* a model is decided by the app, from the report (config.priceModel.activation).

The features, in the order the app computes them, are described by FEATURE_NAMES below and implemented twice, here and in
src/core/price-model.ts; tests/price-model.test.ts holds the two to each other.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sqlite3
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.linear_model import RidgeCV
from sklearn.model_selection import GroupKFold, LeaveOneGroupOut
from sklearn.preprocessing import StandardScaler

ROOT = Path(__file__).resolve().parents[2]
VERSION = 1

# What the extension calls a train's type (core/priceObservations.ts), and one more for what it does not name
TRAIN_TYPES = ["TGV INOUI", "OUIGO", "INTERCITES", "TER", "TGV LYRIA", "EUROSTAR", "TRENITALIA", "MIXED", "OTHER"]
HOUR_BUCKETS = [("h_lt8", 0, 8), ("h_8_12", 8, 12), ("h_12_16", 12, 16), ("h_16_20", 16, 20), ("h_ge20", 20, 24)]
FEATURE_NAMES = (
    ["days_before", "log1p_days_before", "changes", "duration_per_km"]
    + [f"wd_{i}" for i in range(7)]
    + [name for name, _, _ in HOUR_BUCKETS]
    + ["is_friday_or_sunday", "school_holiday"]
    + [f"tt_{t}" for t in TRAIN_TYPES]
)
HOLIDAYS_URL = (
    "https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets/fr-en-calendrier-scolaire/exports/json"
    "?select=description,start_date,end_date,zones,population&where=population%20in%20(%22-%22,%22%C3%89l%C3%A8ves%22)"
)


# ── The features ────────────────────────────────────────────────────────────

def train_type_of(raw: str | None) -> str:
    return raw if raw in TRAIN_TYPES else "OTHER"


def in_holidays(date: str, ranges: list[list[str]]) -> bool:
    """A school holiday in at least one zone: [start, end), the end being the day classes resume."""
    return any(start <= date < end for start, end in ranges)


def features(row: dict, holidays: list[list[str]], duration_per_km_fallback: float) -> list[float]:
    days = max(float(row["days_before"]), 0.0)
    distance = row.get("distance_km")
    duration = row.get("duration_min")
    per_km = duration / distance if duration is not None and distance and distance > 0 else duration_per_km_fallback
    weekday = datetime.strptime(row["travel_date"], "%Y-%m-%d").weekday()  # Monday is 0
    hour = int(row["depart_time"][:2])
    values = [days, math.log1p(days), float(row.get("changes") or 0), float(per_km)]
    values += [1.0 if weekday == i else 0.0 for i in range(7)]
    values += [1.0 if lo <= hour < hi else 0.0 for _, lo, hi in HOUR_BUCKETS]
    values += [1.0 if weekday in (4, 6) else 0.0, 1.0 if in_holidays(row["travel_date"], holidays) else 0.0]
    # A journey with changes is MIXED, as the app calls one it prices: the page names it by its first logo, which says little of the rest
    kind = "MIXED" if (row.get("changes") or 0) > 0 else train_type_of(row.get("train_type"))
    values += [1.0 if kind == t else 0.0 for t in TRAIN_TYPES]
    return values


# ── The models ──────────────────────────────────────────────────────────────

class Model:
    """Standardised features, then a Ridge or a boosted forest: the whole of what the app needs to evaluate it."""

    def __init__(self, kind: str, holidays: list[list[str]]):
        self.kind = kind
        self.holidays = holidays

    def fit(self, rows: list[dict], y: np.ndarray) -> "Model":
        known = [r["duration_min"] / r["distance_km"] for r in rows if r.get("duration_min") is not None and r.get("distance_km")]
        self.duration_per_km = float(np.median(known)) if known else 0.0
        X = self._matrix(rows)
        self.scaler = StandardScaler().fit(X)
        Xs = self.scaler.transform(X)
        if self.kind == "ridge":
            self.estimator = RidgeCV(alphas=[0.1, 1.0, 10.0, 100.0]).fit(Xs, y)
        else:
            self.estimator = GradientBoostingRegressor(n_estimators=50, max_depth=3, learning_rate=0.1, min_samples_leaf=3, random_state=0).fit(Xs, y)
        return self

    def _matrix(self, rows: list[dict]) -> np.ndarray:
        return np.array([features(r, self.holidays, self.duration_per_km) for r in rows], dtype=float)

    def predict(self, rows: list[dict]) -> np.ndarray:
        return self.estimator.predict(self.scaler.transform(self._matrix(rows)))

    def export(self, n_rows: int) -> dict:
        scale = np.where(self.scaler.scale_ == 0, 1.0, self.scaler.scale_)
        out = {
            "kind": self.kind,
            "rows": n_rows,
            "impute": {"duration_per_km": self.duration_per_km},
            "scaler": {"mean": self.scaler.mean_.tolist(), "scale": scale.tolist()},
        }
        if self.kind == "ridge":
            out["estimator"] = {"intercept": float(self.estimator.intercept_), "coef": self.estimator.coef_.tolist(), "alpha": float(self.estimator.alpha_)}
        else:
            trees = []
            for stage in self.estimator.estimators_[:, 0]:
                t = stage.tree_
                trees.append({
                    "left": t.children_left.tolist(), "right": t.children_right.tolist(), "feature": t.feature.tolist(),
                    "threshold": t.threshold.tolist(), "value": t.value[:, 0, 0].tolist(),
                })
            out["estimator"] = {"init": float(self.estimator.init_.constant_[0][0]), "learning_rate": float(self.estimator.learning_rate), "trees": trees}
        return out


def evaluate_export(exported: dict, rows: list[dict], holidays: list[list[str]]) -> np.ndarray:
    """What the app computes from the exported model, written as plainly as it is there."""
    mean, scale = exported["scaler"]["mean"], exported["scaler"]["scale"]
    out = []
    for row in rows:
        x = features(row, holidays, exported["impute"]["duration_per_km"])
        xs = [(v - m) / s for v, m, s in zip(x, mean, scale)]
        e = exported["estimator"]
        if exported["kind"] == "ridge":
            out.append(e["intercept"] + sum(c * v for c, v in zip(e["coef"], xs)))
        else:
            total = e["init"]
            for tree in e["trees"]:
                node = 0
                while tree["left"][node] != -1:
                    node = tree["left"][node] if xs[tree["feature"][node]] <= tree["threshold"][node] else tree["right"][node]
                total += e["learning_rate"] * tree["value"][node]
            out.append(total)
    return np.array(out)


# ── Data ────────────────────────────────────────────────────────────────────

def load_rows(db_path: Path) -> list[dict]:
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    rows = [dict(r) for r in con.execute("select * from price_observations where price_2nd_eur is not null and source = 'sncf-connect' order by captured_at, id")]
    con.close()
    return rows


def session_of(row: dict) -> str:
    """One page read: all its cards share the instant it was captured at."""
    return f"{row['source']}|{row['captured_at']}"


def group_of(row: dict) -> str:
    """What must stay together when data is held out: one route on one day, however many times it was read."""
    return f"{row['origin_label']}|{row['destination_label']}|{row['travel_date']}"


def spans_of(raw: list[dict]) -> list[list[str]]:
    """School holidays of any zone, as local [start, end) dates, the overlapping ones merged."""
    paris = ZoneInfo("Europe/Paris")
    spans = set()
    for item in raw:
        if not item.get("start_date") or not item.get("end_date") or not (item.get("zones") or "").startswith("Zone"):
            continue
        start = datetime.fromisoformat(item["start_date"]).astimezone(paris).date().isoformat()
        end = datetime.fromisoformat(item["end_date"]).astimezone(paris).date().isoformat()
        spans.add((start, end))
    merged: list[list[str]] = []
    for start, end in sorted(spans):
        if merged and start <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end])
    return merged


def fetch_holidays(cache: Path) -> tuple[list[list[str]], str]:
    """The school holidays, downloaded (and a copy kept); the old copy serves when the network does not."""
    raw = None
    try:
        with urllib.request.urlopen(urllib.request.Request(HOLIDAYS_URL, headers={"User-Agent": "planytrip-price-model/1.0 (personal use)"}), timeout=30) as r:
            raw = json.load(r)
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_text(json.dumps(raw))
        status = "downloaded"
    except Exception as error:  # noqa: BLE001 - any failure falls back to the copy
        if cache.exists():
            raw, status = json.loads(cache.read_text()), f"old copy ({error})"
        else:
            return [], f"unavailable ({error})"
    return spans_of(raw), status


def range_target(row: dict) -> float | None:
    low, high = row.get("range_min_eur"), row.get("range_max_eur")
    if low is None or high is None or high <= low:
        return None
    return float(np.clip((row["price_2nd_eur"] - low) / (high - low), 0.0, 1.2))


def metrics(errors: np.ndarray) -> dict:
    """Errors are estimate - real, in euros."""
    a = np.abs(errors)
    return {"n": int(len(errors)), "mae": float(a.mean()), "median": float(np.median(a)), "within10": float((a <= 10).mean()), "bias": float(errors.mean())}


# ── One model: cross-validated, then fitted on everything ───────────────────

def cross_validate(rows: list[dict], y: np.ndarray, groups: list[str], kind: str, holidays: list[list[str]]) -> tuple[np.ndarray, np.ndarray]:
    """Out-of-fold predictions of the target, one per row, and the fold each row was held out in."""
    unique = len(set(groups))
    splitter = LeaveOneGroupOut() if unique < 30 else GroupKFold(n_splits=5)
    predictions = np.zeros(len(rows))
    fold_of = np.zeros(len(rows), dtype=int)
    for fold, (train, test) in enumerate(splitter.split(np.zeros(len(rows)), y, groups)):
        model = Model(kind, holidays).fit([rows[i] for i in train], y[train])
        predictions[test] = model.predict([rows[i] for i in test])
        fold_of[test] = fold
    return predictions, fold_of


def train_submodel(name: str, rows: list[dict], holidays: list[list[str]], per_km: dict, min_rows: int, force_kind: str = "auto"):
    """Returns (exported model or None, report entry, {row id: held-out price})."""
    sessions = len({session_of(r) for r in rows})
    groups = [group_of(r) for r in rows]
    n_groups = len(set(groups))
    entry = {"rows": len(rows), "sessions": sessions, "groups": n_groups, "routes": len({(r["origin_label"], r["destination_label"]) for r in rows})}
    if len(rows) < min_rows or n_groups < 2:
        entry["status"] = f"not trained: {len(rows)} rows from {n_groups} routes and days (needs {min_rows} rows from at least 2)"
        return None, entry, {}

    prices = np.array([r["price_2nd_eur"] for r in rows])
    if name == "range":
        y = np.array([range_target(r) for r in rows])
        low = np.array([r["range_min_eur"] for r in rows])
        span = np.array([r["range_max_eur"] - r["range_min_eur"] for r in rows])
        to_price = lambda t: np.maximum(0.0, low + t * span)  # noqa: E731
        baselines = {"range_mid": low + 0.5 * span, "range_max": low + span}
        main_baseline = "range_mid"
    else:
        distance = np.array([float(r["distance_km"]) for r in rows])
        y = prices / distance
        to_price = lambda t: np.maximum(per_km["minEur"], t * distance)  # noqa: E731
        baselines = {"per_km": np.maximum(per_km["minEur"], distance * per_km["eurPerKm"])}
        main_baseline = "per_km"

    candidates, fold_of = {}, None
    for kind in ("ridge", "gbr"):
        target, fold_of = cross_validate(rows, y, groups, kind, holidays)
        candidates[kind] = to_price(target)
    mae = {kind: float(np.abs(p - prices).mean()) for kind, p in candidates.items()}
    # The forest only when it clearly wins: with a few hundred rows a Ridge is as good, and can be explained
    selected = force_kind if force_kind != "auto" else ("gbr" if mae["ridge"] - mae["gbr"] > 2.0 else "ridge")
    oof = candidates[selected]

    model = Model(selected, holidays).fit(rows, y)
    exported = model.export(len(rows))
    # The export is what the app will run: it must say what scikit-learn says
    check = to_price(evaluate_export(exported, rows, holidays)) - to_price(model.predict(rows))
    if float(np.abs(check).max()) > 1e-6:
        raise SystemExit(f"{name}: the exported model does not predict like scikit-learn (off by {np.abs(check).max()})")

    # Per fold, on the same rows: the model and each simple method (the folds are the same for both candidates)
    folds = []
    for fold in sorted(set(fold_of.tolist())):
        at = fold_of == fold
        folds.append({
            "fold": int(fold), "n": int(at.sum()), "groups": len({g for g, keep in zip(groups, at) if keep}),
            "mae": {"model": float(np.abs(oof - prices)[at].mean()), **{k: float(np.abs(b - prices)[at].mean()) for k, b in baselines.items()}},
        })

    entry.update({
        "status": "trained",
        "folds": folds,
        "selected": selected,
        "candidates": {k: {"mae": v} for k, v in mae.items()},
        "heldOut": {"model": metrics(oof - prices), **{k: metrics(b - prices) for k, b in baselines.items()}},
        "improvement": float(1 - mae[selected] / np.abs(baselines[main_baseline] - prices).mean()),
        "against": main_baseline,
        "cv": "leave-one-group-out" if n_groups < 30 else "group-5-fold",
    })
    return exported, entry, {r["id"]: float(p) for r, p in zip(rows, oof)}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--db", default=os.environ.get("TRIP_DB_PATH") or str(ROOT / "data" / "trip.db"))
    parser.add_argument("--out", default=str(ROOT / "data"))
    parser.add_argument("--per-km", type=float, default=0.15, help="the rate the app estimates with (config.trains.distanceEstimate)")
    parser.add_argument("--min-eur", type=float, default=9.0)
    parser.add_argument("--min-rows", type=int, default=30, help="rows a model needs before it is trained at all")
    parser.add_argument("--kind", choices=["auto", "ridge", "gbr"], default="auto", help="auto keeps the Ridge unless the forest wins by 2 euros; the others are for trying and testing")
    parser.add_argument("--holidays", default=None, help="a school-holidays file to use instead of downloading one: [[start, end], ...] or the calendar's own records")
    args = parser.parse_args()

    out = Path(args.out)
    rows = load_rows(Path(args.db))
    per_km = {"eurPerKm": args.per_km, "minEur": args.min_eur}
    sessions = len({session_of(r) for r in rows})
    print(f"{len(rows)} observations from {sessions} sessions", file=sys.stderr)

    if args.holidays:
        given = json.loads(Path(args.holidays).read_text())
        # Either the dates themselves, or the records the calendar's site gives
        holidays, holiday_status = (spans_of(given) if given and isinstance(given[0], dict) else given), "file given"
    else:
        holidays, holiday_status = fetch_holidays(out / "school-holidays.json")
    print(f"school holidays: {len(holidays)} periods, {holiday_status}", file=sys.stderr)

    # A direct TGV INOUI or OUIGO with a known range; every other train with a known distance is priced by the kilometre
    with_range = [r for r in rows if r.get("changes") == 0 and range_target(r) is not None]
    ranged = {r["id"] for r in with_range}
    with_distance = [r for r in rows if r["id"] not in ranged and r.get("distance_km")]
    models, report_models, oof = {}, {}, {}
    for name, subset in (("range", with_range), ("perKm", with_distance)):
        exported, entry, held_out = train_submodel("range" if name == "range" else "per_km", subset, holidays, per_km, args.min_rows, args.kind)
        models[name], report_models[name] = exported, entry
        oof.update(held_out)
        print(f"{name}: {entry.get('status')}" + (f", held-out MAE {entry['heldOut']['model']['mae']:.2f} EUR vs {entry['heldOut'][entry['against']]['mae']:.2f} for {entry['against']} ({entry['improvement']:+.0%})" if "heldOut" in entry else ""), file=sys.stderr)

    trained_at = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    out.mkdir(parents=True, exist_ok=True)
    (out / "price-model.json").write_text(json.dumps({
        "version": VERSION, "trainedAt": trained_at, "observations": len(rows), "sessions": sessions, "baseline": per_km,
        "featureNames": FEATURE_NAMES, "holidays": holidays, "models": models,
    }))
    (out / "price-model-report.json").write_text(json.dumps({
        "version": VERSION, "trainedAt": trained_at, "observations": len(rows), "sessions": sessions, "baseline": per_km,
        "holidays": {"periods": len(holidays), "status": holiday_status}, "models": report_models, "oof": oof,
    }, indent=1))
    print(f"wrote {out / 'price-model.json'} and {out / 'price-model-report.json'}", file=sys.stderr)


if __name__ == "__main__":
    main()
