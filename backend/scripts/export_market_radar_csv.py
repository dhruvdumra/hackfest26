"""Write the displacement radar fixture as the CSV we upload to SAP Datasphere.

Run from backend/:

    python scripts/export_market_radar_csv.py

It writes docs/datasphere/market_radar.csv. RANK keeps the fixture's order, so
the view returns the same first four Chennai rows the pitch deck quotes
(4 radar rows, 28 openings). tests/test_datasphere.py fails if the committed
CSV and the fixture ever disagree.
"""

import csv
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.mocks.market_fixtures import DISPLACEMENT_RADAR

OUTPUT = Path(__file__).resolve().parents[2] / "docs" / "datasphere" / "market_radar.csv"
COLUMNS = ("RANK", "ROLE", "CITY", "EXPOSURE", "DEMAND", "OPENINGS", "MEDIAN_PAY", "SIGNAL")


def main() -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle, lineterminator="\n")
        writer.writerow(COLUMNS)
        for rank, entry in enumerate(DISPLACEMENT_RADAR, start=1):
            writer.writerow(
                (
                    rank,
                    entry["role"],
                    entry["city"],
                    entry["exposure"],
                    entry["demand"],
                    entry["openings"],
                    entry["median_pay"],
                    entry["signal"],
                )
            )
    print(f"wrote {len(DISPLACEMENT_RADAR)} rows to {OUTPUT}")


if __name__ == "__main__":
    main()
