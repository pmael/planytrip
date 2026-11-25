"""Fills a database with made-up price observations, to try the price model before there are real ones.

    python3 tools/price-model/synthetic_db.py --db /tmp/demo.db --rows 170 --seed 1

The prices follow a rule (dearer when close to the day, on a Friday or a Sunday, in the school holidays, at the evening peak; the
per-kilometre rate depends on the type of train) with noise, so a model can learn it and should beat the published range. They are
NOT real prices: never run it on data/trip.db. It creates the table from the app's own migration when the database has none.
"""
import argparse
import json
import random
import sqlite3
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
# (from, to, carrier, crow-flies km, published min, published max)
RANGED = [
    ("Toulouse Matabiau", "Lyon Part Dieu", "TGV INOUI", 360, 25.5, 101.0),
    ("Paris Gare de Lyon", "Lyon Part Dieu", "TGV INOUI", 395, 25.0, 120.0),
    ("Paris Gare de Lyon", "Marseille Saint-Charles", "TGV INOUI", 660, 29.0, 155.0),
    ("Paris Montparnasse", "Bordeaux Saint-Jean", "TGV INOUI", 500, 22.0, 110.0),
    ("Lyon Part Dieu", "Marseille Saint-Charles", "OUIGO", 275, 10.0, 60.0),
    ("Paris Gare de Lyon", "Lille Europe", "OUIGO", 205, 10.0, 70.0),
]
# (from, to, type, km)
PLAIN = [
    ("Toulouse Matabiau", "Perpignan", "TER", 200),
    ("Toulouse Matabiau", "Paris Austerlitz", "INTERCITES", 590),
    ("Lyon Part Dieu", "Grenoble", "TER", 95),
    ("Toulouse Matabiau", "Marseille Saint-Charles", "MIXED", 320),
    ("Bordeaux Saint-Jean", "Nantes", "MIXED", 280),
]
HOLIDAYS = [("2026-12-19", "2027-01-04"), ("2027-02-06", "2027-03-08"), ("2027-04-03", "2027-05-03")]


def season(day: str) -> bool:
    return any(a <= day < b for a, b in HOLIDAYS)


def generate(db: str, rows: int = 170, seed: int = 1) -> tuple[int, int]:
    """Writes the observations; returns how many, and in how many sessions."""
    rng = random.Random(seed)

    con = sqlite3.connect(db)
    if not con.execute("select 1 from sqlite_master where name = 'price_observations'").fetchone():
        for statement in (ROOT / "drizzle" / "0004_price_observations.sql").read_text().split("--> statement-breakpoint"):
            con.execute(statement)

    made, session = 0, 0
    start = datetime(2026, 10, 1, 8, 0, tzinfo=timezone.utc)
    while made < rows:
        session += 1
        captured = start + timedelta(days=rng.randint(0, 40), hours=rng.randint(0, 14))
        travel = date(2026, 11, 1) + timedelta(days=rng.randint(10, 140))
        days = (travel - captured.date()).days
        ranged = rng.random() < 0.65
        for _ in range(rng.randint(4, 8)):
            hour, minute = rng.choice([6, 7, 8, 9, 10, 12, 14, 15, 17, 18, 19, 20]), rng.choice([0, 12, 37, 42, 54])
            peak = 1 if 17 <= hour < 20 else 0
            early = 1 if hour < 8 else 0
            weekend = 1 if travel.weekday() in (4, 6) else 0
            demand = 0.30 + 0.30 * (1 - min(days, 90) / 90) + 0.12 * weekend + 0.10 * season(travel.isoformat()) + 0.08 * peak - 0.10 * early
            if ranged:
                origin, dest, kind, km, low, high = rng.choice(RANGED)
                t = min(1.15, max(0.02, demand + rng.gauss(0, 0.06)))
                price, changes, range_min, range_max = round(low + t * (high - low), 1), 0, low, high
            else:
                origin, dest, kind, km = rng.choice(PLAIN)
                rate = {"TER": 0.09, "INTERCITES": 0.11, "MIXED": 0.15}[kind] * (0.7 + demand)
                price = round(max(8.0, km * (rate + rng.gauss(0, 0.01))), 1)
                changes, range_min, range_max = (0 if kind != "MIXED" else rng.randint(1, 2)), None, None
            duration = int(km * rng.uniform(0.6, 1.1) + 30 * changes)
            arrive = f"{(hour + duration // 60) % 24:02d}:{(minute + duration) % 60:02d}"
            con.execute(
                """insert or ignore into price_observations
                   (id, source, captured_at, travel_date, days_before, direction, origin_label, destination_label, depart_station, arrive_station,
                    depart_time, arrive_time, duration_min, changes, train_type, price_2nd_eur, price_1st_eur, distance_km, range_min_eur,
                    range_max_eur, raw_json) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (f"synthetic{made:05d}", "sncf-connect", captured.isoformat().replace("+00:00", "Z"), travel.isoformat(), days, "out",
                 origin.split()[0], dest.split()[0], origin, dest, f"{hour:02d}:{minute:02d}", arrive, duration, changes, kind, price,
                 round(price * 1.3, 1), km, range_min, range_max, json.dumps({"synthetic": True})),
            )
            made += 1
            if made >= rows:
                break
    con.commit()
    con.close()
    return made, session


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--db", required=True)
    ap.add_argument("--rows", type=int, default=170)
    ap.add_argument("--seed", type=int, default=1)
    args = ap.parse_args()
    made, sessions = generate(args.db, args.rows, args.seed)
    print(f"{made} synthetic observations in {sessions} sessions -> {args.db}")


if __name__ == "__main__":
    main()
