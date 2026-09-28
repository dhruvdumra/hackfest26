"""Seed the role embeddings used by the inclusive matcher.

Run it from the repository root with ``python backend/scripts/seed_role_embeddings.py``
or from ``backend`` with ``python scripts/seed_role_embeddings.py``. Pass
``--regenerate`` to overwrite vectors that were seeded earlier.

The script never needs a model download and never needs SAP HANA: it embeds the
role catalogue with the offline hashing embedder, and when HANA is configured
and reachable it writes one row per role into ``ROLE_EMBEDDINGS`` and then
verifies the row count with ``hana_client.run_scalar``. When HANA is missing or
rejects the statement it logs a warning and writes
``ROLE_EMBEDDINGS_PATH`` instead, which is the file
``app.services.inclusive_matching`` reads for its simulated pathway. That path is
owned by the application module and imported from it, so the two cannot drift.

HANA gotchas this script is written around, both measured on the Hackfest 2026
trial instance (release 2026.14) rather than taken from the manual:

* ``UPSERT`` is ``REPLACE`` on HANA. It deletes every row whose key the
  statement does not match and then inserts, so a loop of 15 upserts leaves
  exactly one row -- the last one written -- while reporting success every
  time. Seeding is therefore ``DELETE FROM ROLE_EMBEDDINGS`` followed by one
  ``INSERT`` per role.
* No multi-row ``VALUES`` list, ever, in an ``INSERT`` or an ``UPSERT``. One
  statement per row is the only shape HANA accepts here.

``init_hana_schema.sql`` creates ``ROLE_EMBEDDINGS`` with ``ROLE_ID`` and
``EMBEDDING`` only. The insert shape is chosen by reading the live column list
from ``SYS.TABLE_COLUMNS`` rather than by catching an error, because a failed
statement is exactly what hides the row loss above. Embeddings are bound as the
plain decimal literal that ``REAL_VECTOR`` columns accept.
"""

import argparse
import json
import logging
import sys
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

BACKEND_ROOT = Path(__file__).resolve().parents[1]
EMBEDDING_PRECISION = 6

if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.services.inclusive_matching import ROLE_EMBEDDINGS_PATH  # noqa: E402

__all__ = ["ROLE_EMBEDDINGS_PATH", "main"]

logger = logging.getLogger("scripts.seed_role_embeddings")

DELETE_ROLE_EMBEDDINGS_SQL = "DELETE FROM ROLE_EMBEDDINGS"
COUNT_ROLE_EMBEDDINGS_SQL = "SELECT COUNT(*) FROM ROLE_EMBEDDINGS"
# The insert shape is read from the live table, never guessed by catching an
# error: a rejected UPSERT on HANA is how rows go missing, so the column list
# is the thing to check up front.
ROLE_EMBEDDING_COLUMNS_SQL = """
SELECT COLUMN_NAME
FROM SYS.TABLE_COLUMNS
WHERE SCHEMA_NAME = CURRENT_SCHEMA AND TABLE_NAME = 'ROLE_EMBEDDINGS'
ORDER BY POSITION
"""
INSERT_ROLE_EMBEDDING_SQL = """
INSERT INTO ROLE_EMBEDDINGS (
    ROLE_ID,
    EMBEDDING
) VALUES (
    :role_id,
    TO_REAL_VECTOR(:embedding)
)
"""
INSERT_WIDE_ROLE_EMBEDDING_SQL = """
INSERT INTO ROLE_EMBEDDINGS (
    ROLE_ID,
    TITLE,
    CITY,
    LANGUAGE,
    COMMUTE_KM,
    WEEKLY_HOURS,
    ANNUAL_PAY,
    REQUIRED_SKILLS,
    EMBEDDING
) VALUES (
    :role_id,
    :title,
    :city,
    :language,
    :commute_km,
    :weekly_hours,
    :annual_pay,
    :required_skills,
    TO_REAL_VECTOR(:embedding)
)
"""
# Column set of the two-column table init_hana_schema.sql creates. A live table
# holding all of these also gets the role attributes written alongside each
# vector, which is what inclusive_matching's wide query reads.
WIDE_ROLE_COLUMNS: frozenset[str] = frozenset(
    {
        "TITLE",
        "CITY",
        "LANGUAGE",
        "COMMUTE_KM",
        "WEEKLY_HOURS",
        "ANNUAL_PAY",
        "REQUIRED_SKILLS",
    }
)


@dataclass(frozen=True, slots=True)
class SeedSummary:
    mode: str
    role_count: int
    dimensions: int
    backend: str
    destination: str
    hana_row_count: int | None = None


def build_role_embeddings() -> dict[str, list[float]]:
    """Embed every fixture role once, keyed by role id."""
    from app.mocks.role_fixtures import ROLE_PROFILES, role_embedding_text
    from app.services import embedding_provider

    texts = [role_embedding_text(profile) for profile in ROLE_PROFILES]
    vectors = embedding_provider.embed_texts(texts)
    return {profile.role_id: vector for profile, vector in zip(ROLE_PROFILES, vectors, strict=True)}


def write_role_embeddings(
    embeddings: dict[str, list[float]],
    path: Path | None = None,
) -> Path:
    """Write the local JSON mapping role id to its embedding and return the path.

    One role per line keeps a regenerated file reviewable in a diff.
    """
    target = path if path is not None else ROLE_EMBEDDINGS_PATH
    target.parent.mkdir(parents=True, exist_ok=True)
    rows = ",\n".join(
        f"  {json.dumps(role_id)}: {json.dumps(_rounded(vector))}"
        for role_id, vector in sorted(embeddings.items())
    )
    target.write_text(f"{{\n{rows}\n}}\n", encoding="utf-8")
    return target


def read_role_embeddings(path: Path | None = None) -> dict[str, list[float]]:
    """Read a previously seeded JSON mapping, or an empty mapping when absent."""
    target = path if path is not None else ROLE_EMBEDDINGS_PATH
    if not target.is_file():
        return {}
    payload = json.loads(target.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"{target} does not hold a role id mapping")
    return {str(role_id): list(vector) for role_id, vector in payload.items()}


def seed(overrides: dict[str, Any] | None = None, regenerate: bool = False) -> SeedSummary:
    """Seed HANA when it is configured and reachable, otherwise seed the JSON file."""
    from app.config import Settings
    from app.services import embedding_provider, hana_client

    settings = Settings(**(overrides or {}))
    dimensions = embedding_provider.EMBEDDING_DIMENSIONS
    backend = embedding_provider.active_backend()
    if not regenerate:
        try:
            existing = read_role_embeddings()
        except (OSError, ValueError):
            logger.warning("ignoring an unreadable local seed file", exc_info=True)
            existing = {}
        if existing and all(len(vector) == dimensions for vector in existing.values()):
            logger.info(
                "role embeddings already seeded at %s; pass --regenerate to rebuild them",
                ROLE_EMBEDDINGS_PATH,
            )
            return SeedSummary(
                mode="skipped",
                role_count=len(existing),
                dimensions=dimensions,
                backend=backend,
                destination=str(ROLE_EMBEDDINGS_PATH),
            )
    embeddings = build_role_embeddings()
    if hana_client.is_available(settings):
        try:
            _insert_roles(settings, embeddings)
            row_count = hana_client.run_scalar(settings, COUNT_ROLE_EMBEDDINGS_SQL)
            if row_count is None or int(row_count) != len(embeddings):
                # Do not let a lossy seed report itself as a success. This is
                # the check that would have caught the UPSERT-as-REPLACE
                # collapse on the first run instead of the second.
                raise RuntimeError(
                    f"ROLE_EMBEDDINGS holds {row_count} rows, expected {len(embeddings)}"
                )
            logger.info("seeded %d role embeddings into SAP HANA", len(embeddings))
            return SeedSummary(
                mode="live",
                role_count=len(embeddings),
                dimensions=dimensions,
                backend=backend,
                destination="ROLE_EMBEDDINGS",
                hana_row_count=int(row_count),
            )
        except Exception:
            logger.warning(
                "the SAP HANA role embedding seed failed; seeding the local JSON file instead",
                exc_info=True,
            )
    destination = write_role_embeddings(embeddings)
    return SeedSummary(
        mode="simulated",
        role_count=len(embeddings),
        dimensions=dimensions,
        backend=backend,
        destination=str(destination),
    )


def main(argv: Sequence[str] | None = None) -> int:
    """Seed the role embeddings and report where they landed."""
    if str(BACKEND_ROOT) not in sys.path:
        sys.path.insert(0, str(BACKEND_ROOT))
    parser = argparse.ArgumentParser(description="Seed role embeddings for the matcher")
    parser.add_argument(
        "--regenerate",
        action="store_true",
        help="rebuild the embeddings even when a local seed file already exists",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="log the seeding steps",
    )
    arguments = parser.parse_args(argv)
    logging.basicConfig(
        level=logging.INFO if arguments.verbose else logging.WARNING,
        format="%(levelname)s %(name)s %(message)s",
    )
    summary = seed(regenerate=arguments.regenerate)
    print(
        f"seeded {summary.role_count} role embeddings "
        f"({summary.dimensions} dimensions, {summary.backend} embedder) -> {summary.destination}"
    )
    return 0


def _insert_roles(settings: Any, embeddings: dict[str, list[float]]) -> None:
    """Replace the ROLE_EMBEDDINGS contents with one row per role.

    DELETE then INSERT, never UPSERT: on HANA UPSERT is REPLACE, so a loop of
    one upsert per role collapses the table to a single row and still reports
    success for every statement. Measured on the Hackfest trial instance --
    3 upserts left 1 row. The delete also makes --regenerate idempotent.
    """
    from app.mocks.role_fixtures import ROLE_PROFILES_BY_ID
    from app.services import hana_client

    columns = {
        str(row.get("COLUMN_NAME", row.get("column_name", ""))).upper()
        for row in hana_client.run_query(settings, ROLE_EMBEDDING_COLUMNS_SQL)
    }
    if not columns:
        raise RuntimeError("ROLE_EMBEDDINGS has no columns; did init_hana_schema.sql run?")
    wide = WIDE_ROLE_COLUMNS.issubset(columns)
    logger.info("ROLE_EMBEDDINGS columns: %s", ", ".join(sorted(columns)))

    hana_client.run_query(settings, DELETE_ROLE_EMBEDDINGS_SQL)
    for role_id, vector in embeddings.items():
        profile = ROLE_PROFILES_BY_ID[role_id]
        parameters: dict[str, Any] = {
            "role_id": profile.role_id,
            "embedding": _vector_literal(vector),
        }
        if wide:
            parameters.update(
                {
                    "title": profile.title,
                    "city": profile.city,
                    "language": profile.language,
                    "commute_km": profile.commute_km,
                    "weekly_hours": profile.weekly_hours,
                    "annual_pay": profile.annual_pay,
                    "required_skills": json.dumps(profile.required_skills),
                }
            )
        hana_client.run_query(
            settings,
            INSERT_WIDE_ROLE_EMBEDDING_SQL if wide else INSERT_ROLE_EMBEDDING_SQL,
            parameters,
        )


def _vector_literal(vector: Sequence[float]) -> str:
    from app.services import embedding_provider

    return embedding_provider.hana_vector_literal(vector)


def _rounded(vector: Sequence[float]) -> list[float]:
    return [round(value, EMBEDDING_PRECISION) for value in vector]


if __name__ == "__main__":
    raise SystemExit(main())
