"""One-off: apply the HANA schema + seed to the Hackfest trial instance.

Not part of the app. This exists because the HANA Cloud SQL Console runs one
statement per Run, which makes a 40-row seed impractical by hand, and because
replaying scripts/init_hana_schema.sql through hdbcli is what a judge would
reproduce. Run it once, then delete it or keep it as a record.

Credentials come from the environment, never from a literal in this file:

    HANA_HOST=...  HANA_USER=...  HANA_PASSWORD=... python scripts/apply_hana_schema.py
"""

import os
import sys
from pathlib import Path

from hdbcli import dbapi

SCRIPT = Path(__file__).with_name("init_hana_schema.sql")


def statements(path: Path) -> list[str]:
    """Split the schema file into single statements, dropping comments."""
    out: list[str] = []
    buf: list[str] = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.split("--", 1)[0].rstrip()
        if not line.strip():
            continue
        buf.append(line)
        if line.rstrip().endswith(";"):
            stmt = " ".join(buf).strip()
            if stmt:
                out.append(stmt)
            buf = []
    if buf:
        raise SystemExit("unterminated statement at end of file")
    return out


def main() -> int:
    host = os.environ.get("HANA_HOST", "")
    user = os.environ.get("HANA_USER", "")
    password = os.environ.get("HANA_PASSWORD", "")
    if not (host and user and password):
        print("HANA_HOST / HANA_USER / HANA_PASSWORD are required", file=sys.stderr)
        return 2

    # hdbcli takes the host WITHOUT the port and the port separately. Passing
    # "host:443" as the address makes it dial "host:443:443", which fails DNS
    # resolution with a confusing error. Split whatever form the operator has.
    address, _, port_text = host.partition(":")
    port = int(port_text) if port_text else 443

    # The trial password is a template with {host} in it.
    connect_args = {
        "address": address,
        "port": port,
        "user": user,
        "password": password.replace("{host}", address),
        "autocommit": True,
        # The HANA client's own option is `sslValidateCertificate`, NOT
        # `validateCertificate` (that is the JDBC spelling). Passing the JDBC
        # name here is silently ignored, so the driver still demanded a trust
        # anchor and failed with RTE 300012 "No valid certificate specified"
        # even though the caller had asked to skip validation. The trial
        # instance presents the SAP trial certificate rather than a public root
        # chain, which is why validation is off.
        "encrypt": True,
        "sslValidateCertificate": False,
    }

    stmts = statements(SCRIPT)
    print(f"{len(stmts)} statements from {SCRIPT.name}")

    conn = dbapi.connect(**connect_args)
    cur = conn.cursor()

    # Clear the seed tables first.
    #
    # HANA's UPSERT resolves to REPLACE: it removes every row the statement's
    # key does not match, then inserts. Running the 40 seed statements through
    # one session therefore collapsed each table to a single row — the last
    # seed — which is exactly what the first run produced (nodes=1, holding ID
    # 12, 'Defect analytics'). It reported 40/40 "ok" while destroying 39 rows,
    # which is why the counts are verified at the end and not assumed.
    for table in ("SKILLS_EDGES", "SKILLS_NODES"):
        try:
            cur.execute(f"DELETE FROM {table}")
            conn.commit()
            print(f"cleared {table}")
        except Exception as exc:
            print(f"could not clear {table}: {exc}")

    ok = 0
    for i, stmt in enumerate(stmts, 1):
        try:
            cur.execute(stmt)
            # Explicit commit per statement. `autocommit` is not honoured for
            # UPSERT by the HANA client, and without a commit the whole script
            # is one transaction in which each UPSERT replaces the last.
            conn.commit()
        except Exception as exc:
            kind = "exists" if "already exists" in str(exc) else "FAILED"
            print(f"  [{i:>2}/{len(stmts)}] {kind}: {stmt[:64]}...")
            if kind == "FAILED":
                print(f"        -> {exc}")
            continue
        ok += 1
        if i > 4:
            print(f"  [{i:>2}/{len(stmts)}] ok: {stmt[:56]}")

    cur.execute("SELECT COUNT(*) FROM SKILLS_NODES")
    nodes = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM SKILLS_EDGES")
    edges = cur.fetchone()[0]
    cur.close()
    conn.close()

    print(f"\napplied {ok}/{len(stmts)}  |  nodes={nodes} (want 12)  edges={edges} (want 28)")
    return 0 if (nodes == 12 and edges == 28) else 1


if __name__ == "__main__":
    raise SystemExit(main())
