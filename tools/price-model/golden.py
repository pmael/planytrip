"""Makes the fixtures that hold the app's evaluation of the model (src/core/price-model.ts) to scikit-learn's.

    python3 tools/price-model/golden.py            (needs numpy and scikit-learn: `uv run tools/price-model/golden.py`)

It trains a Ridge and a gradient-boosted forest on synthetic prices (synthetic_db.py), writes each as the app's model file, and
writes, for a set of trains, what scikit-learn itself predicts. tests/price-model.test.ts then checks that the TypeScript gets the
same numbers from the same files. Run it again only when the features or the export change.
"""
# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy", "scikit-learn"]
# ///
import json
import sys
import tempfile
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
import synthetic_db  # noqa: E402
import train  # noqa: E402

OUT = Path(__file__).resolve().parents[2] / "tests" / "fixtures" / "price-model"
PER_KM = {"eurPerKm": 0.15, "minEur": 9.0}
HOLIDAYS = [["2026-12-19", "2027-01-04"], ["2027-02-06", "2027-03-08"], ["2027-04-03", "2027-05-03"]]


def cases() -> list[dict]:
    """Trains that differ in what the model looks at, with the edges of its buckets and a missing duration."""
    base = {"days_before": 41, "travel_date": "2026-12-04", "depart_time": "07:37", "train_type": "TGV INOUI", "changes": 0, "duration_min": 251, "distance_km": 360}
    variants = [
        {}, {"days_before": 0}, {"days_before": 3}, {"days_before": 120}, {"travel_date": "2026-12-05"}, {"travel_date": "2026-12-06"},
        {"travel_date": "2026-12-20"}, {"travel_date": "2027-01-03"}, {"travel_date": "2027-01-04"}, {"depart_time": "07:59"}, {"depart_time": "08:00"},
        {"depart_time": "11:59"}, {"depart_time": "12:00"}, {"depart_time": "15:59"}, {"depart_time": "16:00"}, {"depart_time": "19:59"},
        {"depart_time": "20:00"}, {"depart_time": "23:30"}, {"depart_time": "00:15"}, {"train_type": "OUIGO"}, {"train_type": "TER", "changes": 1},
        {"train_type": "MIXED", "changes": 2, "duration_min": 333}, {"train_type": "INTERCITES"}, {"train_type": "TGV LYRIA"}, {"train_type": None},
        {"train_type": "SOMETHING ELSE"}, {"duration_min": None}, {"distance_km": None}, {"duration_min": None, "distance_km": None},
        {"distance_km": 1200, "duration_min": 420}, {"distance_km": 40, "duration_min": 55, "days_before": 2},
        {"travel_date": "2027-03-07", "depart_time": "18:15", "days_before": 9},
    ]
    return [{**base, **v} for v in variants]


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        db = str(Path(tmp) / "synthetic.db")
        synthetic_db.generate(db, rows=260, seed=7)
        rows = train.load_rows(Path(db))

    ranged = [r for r in rows if r.get("changes") == 0 and train.range_target(r) is not None]
    ranged_ids = {r["id"] for r in ranged}
    plain = [r for r in rows if r["id"] not in ranged_ids and r.get("distance_km")]
    y_range = np.array([train.range_target(r) for r in ranged])
    y_km = np.array([r["price_2nd_eur"] / r["distance_km"] for r in plain])

    expected = {}
    for kind in ("ridge", "gbr"):
        m_range = train.Model(kind, HOLIDAYS).fit(ranged, y_range)
        m_km = train.Model(kind, HOLIDAYS).fit(plain, y_km)
        (OUT / f"{kind}.json").write_text(json.dumps({
            "version": train.VERSION, "trainedAt": "2026-10-24T12:00:00Z", "observations": len(rows), "sessions": 40, "baseline": PER_KM,
            "featureNames": train.FEATURE_NAMES, "holidays": HOLIDAYS,
            "models": {"range": m_range.export(len(ranged)), "perKm": m_km.export(len(plain))},
        }))
        # What scikit-learn itself says, for each case: the target the model predicts (a place in the range, a price per km)
        expected[kind] = {
            "range": [float(m_range.predict([c])[0]) for c in cases()],
            "perKm": [float(m_km.predict([c])[0]) for c in cases()],
        }
    (OUT / "cases.json").write_text(json.dumps({"cases": cases(), "expected": expected}, indent=1))
    print(f"wrote {OUT} ({len(ranged)} ranged and {len(plain)} plain rows, {len(cases())} cases)")


if __name__ == "__main__":
    main()
