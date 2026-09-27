import asyncio
import sqlite3
from pathlib import Path
from typing import Protocol

from app.models import EmployerDecisionRecord


class DecisionStore(Protocol):
    async def initialize(self) -> None: ...

    async def record(self, decision: EmployerDecisionRecord) -> None: ...

    async def latest(self, job_post_id: str) -> EmployerDecisionRecord | None: ...

    async def close(self) -> None: ...


class SqliteDecisionStore:
    """Append-only log of hiring-manager sign-offs on rewritten job posts.

    It shares the session database file but owns its own table, so a decision
    outlives a page reload and every earlier decision stays on record: a
    reversal is a new row, never an overwrite. ``:memory:`` keeps one shared
    in-memory database alive for the store's lifetime, as SqliteSessionStore
    does, so tests need no file.
    """

    def __init__(self, database_path: Path | str) -> None:
        self._database_path = str(database_path)
        self._uses_uri = self._database_path == ":memory:"
        self._database_target = (
            f"file:reroute_decisions_{id(self)}?mode=memory&cache=shared"
            if self._uses_uri
            else self._database_path
        )
        self._keeper: sqlite3.Connection | None = None

    async def initialize(self) -> None:
        await asyncio.to_thread(self._initialize)

    async def record(self, decision: EmployerDecisionRecord) -> None:
        await asyncio.to_thread(self._record, decision)

    async def latest(self, job_post_id: str) -> EmployerDecisionRecord | None:
        return await asyncio.to_thread(self._latest, job_post_id)

    async def close(self) -> None:
        await asyncio.to_thread(self._close)

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self._database_target, timeout=30, uri=self._uses_uri)
        connection.row_factory = sqlite3.Row
        return connection

    def _initialize(self) -> None:
        if self._uses_uri and self._keeper is None:
            self._keeper = sqlite3.connect(
                self._database_target,
                timeout=30,
                uri=True,
                check_same_thread=False,
            )
        elif not self._uses_uri:
            Path(self._database_path).parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS employer_decisions (
                    decision_id TEXT PRIMARY KEY,
                    job_post_id TEXT NOT NULL,
                    decided_at TEXT NOT NULL,
                    payload_json TEXT NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE INDEX IF NOT EXISTS employer_decisions_by_post
                ON employer_decisions (job_post_id, decided_at)
                """
            )

    def _record(self, decision: EmployerDecisionRecord) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO employer_decisions (decision_id, job_post_id, decided_at, payload_json)
                VALUES (?, ?, ?, ?)
                """,
                (
                    decision.decision_id,
                    decision.job_post_id,
                    decision.decided_at.isoformat(),
                    decision.model_dump_json(),
                ),
            )

    def _latest(self, job_post_id: str) -> EmployerDecisionRecord | None:
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT payload_json FROM employer_decisions
                WHERE job_post_id = ?
                ORDER BY decided_at DESC, rowid DESC
                LIMIT 1
                """,
                (job_post_id,),
            ).fetchone()
        if row is None:
            return None
        return EmployerDecisionRecord.model_validate_json(str(row["payload_json"]))

    def _close(self) -> None:
        if self._keeper is not None:
            self._keeper.close()
            self._keeper = None
