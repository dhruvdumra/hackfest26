-- ReRoute: one-time SAP HANA Cloud schema setup.
--
-- Run once against the trial instance, e.g.
--   hdbcli -i <instance> "<host>" -u <user> -p '<password>' -e "true" -E "false" -I init_hana_schema.sql
--
-- The seeds are plain INSERTs, so this file is NOT idempotent on its own: run
-- the two DELETEs above the seed, or use scripts/apply_hana_schema.py, which
-- clears the tables and verifies the counts.
--
-- The seeds are INSERT rather than UPSERT because of a MEASURED behaviour of
-- this database. UPSERT on HANA resolves to REPLACE: three consecutive
-- UPSERTs in one session left SKILLS_NODES holding exactly ONE row -- the
-- last one -- while every statement reported success. A 40-statement UPSERT
-- seed therefore destroys 39 of its own rows and still reports 40/40 ok.
-- INSERT has no such semantics and behaves as written.
--
-- IF YOU ARE RUNNING THIS IN THE HANA CLOUD SQL CONSOLE: that console executes
-- ONE statement per Run, so select-all-and-run applies only the first. Run each
-- line on its own there. hdbcli has no such limit and applies the whole file.
--
-- HANA's UPSERT takes exactly ONE row. Multi-row VALUES is INSERT INTO syntax,
-- which is not replayable, so the seeds stay one statement per row.
--
-- Four corrections were made to this file after it was first run against a
-- live 2026.14 instance. It had never been executed against a real database,
-- so nothing had caught them:
--
--   1. The graph workspace omitted `KEY COLUMN` on the edge table. HANA does
--      not infer the edge key from the table's PRIMARY KEY; without the clause
--      it fails with [257] "mandatory key of the edge table is missing". This
--      was the actual cause, and it was invisible in review because the vertex
--      table below had its `KEY COLUMN` and the omission sat beside it.
--   2. The edge table needs a SINGLE-column primary key. HANA restricts a graph
--      workspace to one key column plus one source and one target column, so
--      the original composite PRIMARY KEY (SOURCE, TARGET) could never be
--      referenced. A surrogate ID column is that key.
--   3. SOURCE and TARGET must be NOT NULL, or the workspace fails with [260]
--      "the source column ... has no NOT NULL constraint".
--   4. The seeds cannot be applied as a batch on HANA, and must not use
--      UPSERT at all. See the notes above.

-- Skills graph vertices. One row per skill in the seeded pathway.
CREATE COLUMN TABLE SKILLS_NODES (ID INT PRIMARY KEY, NAME NVARCHAR(50));

-- Skills graph edges. HOURS is the investment needed to move SOURCE -> TARGET.
-- ID is the workspace's mandatory single-column key; SOURCE and TARGET are
-- declared on the workspace and must be NOT NULL so no edge can dangle.
CREATE COLUMN TABLE SKILLS_EDGES (
  ID INT PRIMARY KEY,
  SOURCE INT NOT NULL,
  TARGET INT NOT NULL,
  HOURS INT
);

-- Graph workspace wrapping the two column tables above. The workspace is what
-- learning_pathway.py reads to solve the least-hours path.
CREATE GRAPH WORKSPACE SKILLS_GRAPH
  EDGE TABLE SKILLS_EDGES KEY COLUMN ID SOURCE COLUMN SOURCE TARGET COLUMN TARGET
  VERTEX TABLE SKILLS_NODES KEY COLUMN ID;

-- Role embeddings for inclusive matching, written by the configured encoder
-- (the offline hashing embedder by default, MiniLM when REROUTE_EMBEDDING_BACKEND
-- selects it). ROLE_ID is the primary key so scripts/seed_role_embeddings.py can
-- write one row per role.
--
-- ROLE_ID is NVARCHAR(32), not the NVARCHAR(20) this file originally declared.
-- Measured against the live 2026.14 instance: the seed died with [274]
-- "inserted value too large for column" on the third role,
-- `qa-automation-engineer` (22 chars). The catalogue's two longest ids are
-- `performance-test-engineer` and `manual-testing-technician`, both 25 chars,
-- so 20 was never wide enough and 32 clears the catalogue with room to spare.
-- Widen an existing table with:
--   ALTER TABLE ROLE_EMBEDDINGS ALTER (ROLE_ID NVARCHAR(32));
CREATE COLUMN TABLE ROLE_EMBEDDINGS (
  ROLE_ID NVARCHAR(32) PRIMARY KEY,
  EMBEDDING REAL_VECTOR(384)
);

-- Seed: same fixtures as app/mocks/hana_fixtures.py, in the same order. The
-- edge seeds carry an explicit ID because that column is the workspace key.
-- Clear the seed tables so the file can be re-applied. HANA graph workspaces
-- hold no data of their own, so dropping the rows is safe.
DELETE FROM SKILLS_EDGES;

DELETE FROM SKILLS_NODES;

-- Seed: same fixtures as app/mocks/hana_fixtures.py, in the same order. The
-- edge seeds carry an explicit ID because that column is the workspace key.
INSERT INTO SKILLS_NODES VALUES (1, 'Manual testing');
INSERT INTO SKILLS_NODES VALUES (2, 'Regression testing');
INSERT INTO SKILLS_NODES VALUES (3, 'API testing');
INSERT INTO SKILLS_NODES VALUES (4, 'Test automation');
INSERT INTO SKILLS_NODES VALUES (5, 'SQL data validation');
INSERT INTO SKILLS_NODES VALUES (6, 'CI maintenance');
INSERT INTO SKILLS_NODES VALUES (7, 'QA analytics');
INSERT INTO SKILLS_NODES VALUES (8, 'Stakeholder communication');
INSERT INTO SKILLS_NODES VALUES (9, 'Requirements analysis');
INSERT INTO SKILLS_NODES VALUES (10, 'Defect triage');
INSERT INTO SKILLS_NODES VALUES (11, 'Release verification');
INSERT INTO SKILLS_NODES VALUES (12, 'Defect analytics');

INSERT INTO SKILLS_EDGES VALUES (1, 1, 2, 30);
INSERT INTO SKILLS_EDGES VALUES (2, 1, 3, 25);
INSERT INTO SKILLS_EDGES VALUES (3, 1, 10, 15);
INSERT INTO SKILLS_EDGES VALUES (4, 2, 3, 20);
INSERT INTO SKILLS_EDGES VALUES (5, 2, 4, 80);
INSERT INTO SKILLS_EDGES VALUES (6, 2, 8, 30);
INSERT INTO SKILLS_EDGES VALUES (7, 2, 10, 10);
INSERT INTO SKILLS_EDGES VALUES (8, 2, 11, 20);
INSERT INTO SKILLS_EDGES VALUES (9, 3, 4, 60);
INSERT INTO SKILLS_EDGES VALUES (10, 3, 5, 25);
INSERT INTO SKILLS_EDGES VALUES (11, 4, 5, 35);
INSERT INTO SKILLS_EDGES VALUES (12, 4, 6, 40);
INSERT INTO SKILLS_EDGES VALUES (13, 5, 4, 45);
INSERT INTO SKILLS_EDGES VALUES (14, 5, 7, 20);
INSERT INTO SKILLS_EDGES VALUES (15, 5, 8, 20);
INSERT INTO SKILLS_EDGES VALUES (16, 6, 5, 20);
INSERT INTO SKILLS_EDGES VALUES (17, 6, 7, 30);
INSERT INTO SKILLS_EDGES VALUES (18, 7, 8, 25);
INSERT INTO SKILLS_EDGES VALUES (19, 8, 7, 18);
INSERT INTO SKILLS_EDGES VALUES (20, 8, 9, 25);
INSERT INTO SKILLS_EDGES VALUES (21, 9, 1, 20);
INSERT INTO SKILLS_EDGES VALUES (22, 10, 11, 12);
INSERT INTO SKILLS_EDGES VALUES (23, 10, 12, 18);
INSERT INTO SKILLS_EDGES VALUES (24, 11, 5, 30);
INSERT INTO SKILLS_EDGES VALUES (25, 11, 6, 25);
INSERT INTO SKILLS_EDGES VALUES (26, 11, 8, 28);
INSERT INTO SKILLS_EDGES VALUES (27, 12, 2, 20);
INSERT INTO SKILLS_EDGES VALUES (28, 12, 7, 45);
