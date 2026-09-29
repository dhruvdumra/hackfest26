"""Load the displacement radar into SAP HANA Cloud for Market Intelligence.

Run from backend/ with the HANA_* values in backend/.env:

    python scripts/load_market_radar_hana.py

It creates the MARKET_RADAR table in the connected user's schema if it is not
there, replaces its rows with docs/datasphere/market_radar.csv (the same file
the Datasphere guide uploads, which tests/test_datasphere.py pins to the
fixture), and checks that the first four Chennai rows still add up to the
deck's 28 openings. Safe to re-run. It never prints a credential.

Then set USE_MOCK_MARKET=false (MARKET_PROVIDER defaults to hana).
"""

import csv
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import Settings, hana_is_configured
from app.services import hana_client
from app.services.datasphere import safe_identifier

CSV_PATH = Path(__file__).resolve().parents[2] / "docs" / "datasphere" / "market_radar.csv"
COLUMNS = ("RANK", "ROLE", "CITY", "EXPOSURE", "DEMAND", "OPENINGS", "MEDIAN_PAY", "SIGNAL")
INTEGER_COLUMNS = {"RANK", "OPENINGS", "MEDIAN_PAY"}


def main() -> int:
    settings = Settings()
    if not hana_is_configured(settings):
        print("HANA_HOST / HANA_USER / HANA_PASSWORD are not set (backend/.env)", file=sys.stderr)
        return 2
    table = safe_identifier(settings.hana_market_table)

    with CSV_PATH.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        if tuple(reader.fieldnames or ()) != COLUMNS:
            print(f"unexpected CSV header: {reader.fieldnames}", file=sys.stderr)
            return 2
        rows = [
            tuple(int(row[c]) if c in INTEGER_COLUMNS else row[c] for c in COLUMNS)
            for row in reader
        ]

    connection = hana_client.get_connection(settings)
    cursor = connection.cursor()
    try:
        cursor.execute(
            "SELECT COUNT(*) FROM SYS.TABLES "
            f"WHERE SCHEMA_NAME = CURRENT_SCHEMA AND TABLE_NAME = '{table}'"
        )
        exists = cursor.fetchone()[0] > 0
        if not exists:
            cursor.execute(
                f'CREATE COLUMN TABLE "{table}" ('
                '"RANK" INTEGER PRIMARY KEY, "ROLE" NVARCHAR(80) NOT NULL, '
                '"CITY" NVARCHAR(40) NOT NULL, "EXPOSURE" NVARCHAR(12) NOT NULL, '
                '"DEMAND" NVARCHAR(12) NOT NULL, "OPENINGS" INTEGER NOT NULL, '
                '"MEDIAN_PAY" INTEGER NOT NULL, "SIGNAL" NVARCHAR(200))'
            )
        cursor.execute(f'DELETE FROM "{table}"')
        placeholders = ", ".join("?" for _ in COLUMNS)
        quoted = ", ".join(f'"{c}"' for c in COLUMNS)
        cursor.executemany(f'INSERT INTO "{table}" ({quoted}) VALUES ({placeholders})', rows)
        cursor.execute(
            f'SELECT COUNT(*), SUM("OPENINGS") FROM (SELECT TOP 4 "OPENINGS" FROM "{table}" '
            'WHERE "CITY" = \'Chennai\' ORDER BY "RANK")'
        )
        chennai_rows, chennai_openings = cursor.fetchone()
        cursor.execute(f'SELECT COUNT(*) FROM "{table}"')
        total = cursor.fetchone()[0]
    finally:
        cursor.close()

    print(f"{'created' if not exists else 'reused'} table {table} in the current schema")
    print(f"loaded {total} rows; first {chennai_rows} Chennai rows = {chennai_openings} openings")
    if (total, chennai_rows, chennai_openings) != (len(rows), 4, 28):
        print("the loaded radar does not match the deck (4 rows, 28 openings)", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
