# ReRoute

**An agentic career orchestrator that makes a hiring decision auditable.**

A worker displaced by AI automation has skills. Nobody can prove which ones, the
shortlist filters are opaque, and the one number that governs the transition —
a score — is a black box. ReRoute recovers the evidence, plans a credible route,
and then **proves the ranking is fair by attacking it**.

> **Team ReRoute** · SAP Hackfest 2026 · `github.com/mevarx/hackfest26`

---

## The 60-second version

A worker says what they actually did. Seven agents run in sequence and stream
every decision to the browser. The final agent is the one that matters:

**The Ghost Twin Audit.** For each protected attribute — career gap, gender, age,
college tier, city — it builds a counterfactual twin that differs *only* in that
one attribute, re-scores the twin through the same engine, and reports the delta.
If changing who you are changes your score, the screen is biased.

This is a real differential, not a claim. One candidate, two screening models:

| Screening model | Score | Verdict | Career-gap delta |
|---|---|---|---|
| Fair merit | 86 | `PASS` | ±0 |
| Legacy biased | 91 | **`FLAGGED`** | **+6** |

The biased model scores her **higher** — and that gap is the problem. Eighteen
months out of work is worth six points to a legacy ATS, and the audit names it.
Flip one field in the UI and re-run; the verdict moves.

---

## Why this is worth judging

Most candidate-ranking demos show a score. This one **disagrees with the score on
demand** and shows its working.

- **The audit is deterministic and pure Python.** No LLM in the verdict. It is
  reproducible, and the repo tests the boundary: a delta exactly equal to the
  threshold is `PASS`, one point above it is `FLAGGED`. The threshold itself is
  server-governed — the API rejects a client-supplied value, so a caller cannot
  move the goalposts to make a result look clean.
- **It does not stop at the verdict.** It attributes the bias. Our run reports
  `career_gap +6, college_tier −3, city +4` — so the fix is specific: rewrite the
  age, college-tier and gender wording, and replace pedigree with evidence.
- **The employer gets a rewrite, not a lecture.** `POST /employer/rewrite-filter`
  returns the before/after job post with the restrictive phrases removed and a
  count of candidates the original filter would have hidden.
- **The guardrail has teeth, and says so.** Matching a passport against the role
  catalogue returns 14 ranked roles; the two that pay a 31–36% cut are blocked and
  sorted below every allowed role, each with a reason a human can read —
  *"Pay cut of 36.4% exceeds the 15% wage-scar guardrail."* A fairness feature
  that only warns is a fairness feature nobody can act on.

---

## What is real, and what is not

Stated plainly, because a judge should not have to guess.

| Capability | Status |
|---|---|
| Ghost Twin bias audit | **Real.** Pure Python, deterministic, fully tested |
| Wage-Scar Guardrail | **Real.** Blocks roles that pay below the candidate's floor |
| Orchestration, 7 agents | **Real.** LangGraph, with a sequential fallback. The run stops at the human gate and waits |
| Two-Key consent (Kavya) | **Real.** `POST /session/{id}/consent` stores a revocable receipt, labelled `local` |
| Two-Key sign-off (HR) | **Real** decision on a **fixture** post: stored in SQLite, labelled `simulated` |
| EMI bug hunt | **Real.** Five planted bugs; every reported reproduction is re-run and graded, labelled `local` |
| Event streaming | **Real.** WebSocket, replay on reconnect, `Last-Event-ID` resume |
| Session store | **Real.** SQLite, atomic versioned updates |
| Skills extraction | SAP AI Core **client written, never executed** — no credential has ever been supplied |
| Learning pathway | SAP HANA **client written, never executed** — same |
| Market radar, employer filter | Static fixtures, labelled `simulated` |

Every response carries `source: live | simulated | local`, and every agent event
repeats it. **If a badge says `simulated`, it is a fixture.** We do not dress
fixtures as SAP results.

The SAP clients are real code — real HTTP, real OAuth, real response parsing,
real failure handling. They are one environment variable away from running. That
is the single largest gap in this submission and it is stated first for that
reason.

---

## Architecture

```text
                    ┌─────────────────────────────────────────┐
   transcript ─────▶│  LangGraph · 7 nodes · one event stream   │
                    └─────────────────────────────────────────┘
                                       │
   1  skills_discovery  ── recover durable skills, flag proof gaps
   2  market_intelligence ── displacement + paid bridge demand
   3  learning_pathway  ── skills graph: current role → target role
   4  inclusive_matching ── vector rank + Wage-Scar Guardrail
   5  employer_readiness ── rewrite the shortlist filter
   6  bias_audit        ── counterfactual twins · PASS | FLAGGED
   7  two_key_wait      ── human gate: parks the session in `waiting` until Kavya answers
                                       │
                    ┌──────────────────┴──────────────────┐
                    ▼                                     ▼
              FastAPI  +  SQLite              WebSocket  ·  replay
                    │                                     │
                    └──────────────┬──────────────────────┘
                                   ▼
                        React 19  ·  live agent console
```

**Why LangGraph matters here:** the run is a graph, not a script. A node that
raises emits a terminal event carrying its failure and **the graph keeps going** —
only a session that cannot be read at all fails. That is what lets the demo
survive a dead SAP service on stage.

---

## Run it

Requires Python 3.11+ and Node 22+.

```bash
# backend  →  http://127.0.0.1:8000   (docs at /docs)
cd backend
python -m venv .venv && .venv/Scripts/python -m pip install -e ".[dev]"
.venv/Scripts/python -m uvicorn app.main:app --reload

# frontend  →  http://127.0.0.1:5173
cd frontend
npm install && npm run dev
```

No configuration is required. With no `.env` at all the service starts
**mock-first**: everything is served locally and labelled `simulated` or `local`,
and nothing leaves the machine. Copy `backend/.env.example` to `backend/.env` to
change anything.

**Enable real SAP AI Core:**

```bash
USE_MOCK_GENAI=false
GENAI_HUB_ENDPOINT=...        # SAP AI Core orchestration endpoint
GENAI_HUB_CLIENT_ID=...       # from your SAP BTP keyspace
GENAI_HUB_CLIENT_SECRET=...
GENAI_HUB_MODEL=...
```

Verify the posture at any time — this is the honest self-report:

```bash
curl http://127.0.0.1:8000/health
```

```json
{"status":"ok",
 "genai":{"mode":"mock","source":"simulated","integration_status":"not_implemented"},
 "hana": {"mode":"mock","source":"simulated","integration_status":"not_implemented"}}
```

---

## The demo, in five steps

The page runs in the order the pitch deck promises the jury (slide 9). A
presenter bar pinned to the bottom names the step on screen and jumps between
them; the left and right arrow keys do the same.

1. **Voice note in.** Press `RUN PIPELINE`. Nothing plays before that. The
   agent console fills as the seven agents report, and Kavya's Skill Passport
   lands in step 01.
2. **Prove it.** The EMI bug hunt: a loan calculator with five planted bugs.
   Log what looks wrong, or press *Load a recorded hunt* (four bugs, 80/100),
   and submit. The server re-runs every reproduction; the credential
   *Defect reproduction* appears on the passport. Leave the fifth bug (a loan
   of a crore or more) for a judge to find.
3. **Route and fair match.** The displacement radar, the skill route, and 15
   ranked roles with the two that cut pay 31–36% **blocked** by the wage-scar
   guardrail. *Why not me?* on any role gives the reason and the shortest route
   to qualify.
4. **Ghost Twins.** You land on `PASS`, every twin delta `±0`. Flip
   `SIMULATE LEGACY ATS` and re-run: `FLAGGED`, max delta 6 > threshold 5, the
   career-gap row in red. *This is the moment the project exists for.*
5. **Two keys.** The run is waiting for Kavya: approve (or decline) sharing her
   passport, and the receipt lands on the live stream. Then the hiring manager
   approves the rewritten job post that reaches 12 hidden candidates.

**Demo mode** replays a recording of the backend's own mock-mode run in the
console and still calls the backend at `http://127.0.0.1:8000` for the panels,
so run the backend on the presenting laptop. With demo mode off, the console
streams the real run over the WebSocket.

---

## Verification

```bash
cd backend  && .venv/Scripts/python -m pytest    # 204 tests
             .venv/Scripts/python -m ruff check .
             .venv/Scripts/python -m mypy
cd frontend && npm test                          # 157 passed
             npm run lint && npm run typecheck && npm run build
```

**361 tests.** The suites cover the parts that matter to a judge: the
audit's threshold boundary, the guardrail's blocking rule, orchestrator
failures that must not abort a run, the consent gate, the bug-hunt grader,
and WebSocket replay. One backend test,
`test_sap_hana_client_is_unavailable_without_the_hdbcli_driver`, fails
wherever `hdbcli` is installed, and `pyproject.toml` installs it: the test
assumes the driver is absent.

---

## API

| Method | Path | Source |
|---|---|---|
| `GET` | `/health` | reports live/simulated posture per integration |
| `POST` | `/session/start` | opens a session, returns immediately |
| `GET` | `/session/{id}` | full state, with replayable event history |
| `WS` | `/session/{id}/stream` | agent events; `Last-Event-ID` resumes |
| `POST` | `/session/{id}/consent` | `local` — Kavya approves or revokes; stores a receipt |
| `POST` | `/audit/ghost-twin` | `local` — the counterfactual audit |
| `POST` | `/skills/extract` | `simulated` → `live` with SAP credentials |
| `POST` | `/skills/work-sample` | `simulated` → `live` with SAP credentials |
| `GET` | `/route` | `simulated` → `live` with SAP HANA |
| `POST` | `/match` | `simulated` → `live` with SAP HANA |
| `GET` | `/market/displacement-radar` | `simulated` fixture, with disclaimer |
| `POST` | `/employer/rewrite-filter` | `simulated` fixture, with disclaimer |
| `POST` | `/employer/rewrite-filter/{id}/decision` | hiring manager approves or rejects; stored |
| `GET` | `/employer/rewrite-filter/{id}/decision` | the latest decision, or 404 |

---

## Stack

**Backend** — Python 3.11, FastAPI, Pydantic Settings, LangGraph, SQLite,
httpx, optional `hdbcli` for SAP HANA Cloud, pytest/ruff/mypy.
**Frontend** — React 19, Vite 8, Tailwind 4, Vitest + Testing Library, ESLint.

## Repo map

```text
backend/
  app/orchestrator.py      the 7-node graph
  app/domain/ghost_twin.py the audit — no LLM, pure Python
  app/services/            genai_hub.py · hana_client.py · inclusive_matching.py
  app/api/                 12 endpoints
  tests/                   187 tests
frontend/
  src/components/          AgentConsole · GhostTwinPanel · MatchPanel · EmiBugHunt
                           ConsentCard · HiringDecision · PresenterBar
  src/pages/               WorkerApp · RouteMap · HRConsole
  src/styles/tokens.css    the design tokens, and why each value is what it is
ReRoute_PRD.md              product requirements
ReRoute_Style_Reference.md the ported design system
```

## Known gaps

- **No SAP credential has ever been supplied.** The AI Core and HANA clients have
  never run against a live service. They are guarded by mock flags, and the
  resilience suite proves the *fallbacks*, not the live responses.
- Demo mode forces the panels to `http://127.0.0.1:8000`, so a deployed
  frontend in demo mode needs a backend on the presenting machine. Rehearse
  with the same laptop.
- `learning_pathway.py` calls `graph.shortest_path`, which networkx does not
  have, so every route falls back to the built-in Dijkstra (same answer, a
  logged traceback).
- Role embeddings come from a deterministic hashing embedder, not a model.
- `.gitignore` does not ignore `.env`. Add that rule before creating one, and
  check `git status` before committing. Any `VITE_`-prefixed variable is inlined
  into the built bundle and is publicly readable — no secret belongs there.

## Licence

Team ReRoute · SRM University AP
