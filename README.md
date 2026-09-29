# ReRoute

**An agentic career orchestrator that makes a hiring decision auditable.**

A worker displaced by AI automation has skills. Nobody can prove which ones, the
shortlist filters are opaque, and the one number that governs the transition —
a score — is a black box. ReRoute recovers the evidence, plans a credible route,
and then **proves the ranking is fair by attacking it**.

> **Team ReRoute** · SRM University-AP · SAP Hackfest 2026 · `github.com/mevarx/hackfest26`

---

## The 60-second version

A worker says what they actually did. Seven agents run in sequence and stream
every decision to the browser. The final agent is the one that matters:

**The Ghost Twin Audit.** For each protected attribute — career gap, gender, age,
college tier, city — it builds a counterfactual twin that differs *only* in that
one attribute, re-scores the twin through the same engine, and reports the delta.
If changing who you are changes your score, the screen is biased.

This is a real differential, not a claim. One candidate (Kavya: 29, tier-3
college, Chennai, 18-month caregiving gap, skill score 86), two screening models:

| Screening model | Score | Verdict | Career-gap delta |
|---|---|---|---|
| Fair merit | 86 | `PASS` | ±0 |
| Legacy biased | 91 | **`FLAGGED`** | **+6** |

Her twin with no career gap scores six points more on the legacy screen, and
that gap is the problem. Eighteen months out of work is worth six points to a
legacy ATS, and the audit names it. Flip one field in the UI and re-run; the
verdict moves.

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
  `career_gap +6, city +4, age +3, college_tier +3, gender 0`, so the fix is
  specific: rewrite the age, college-tier and gender wording, and replace
  pedigree with evidence. (The age twin moves her 16 years, 29 → 45: far enough
  to cross the legacy screen's age bands, so an age bias can actually show.)
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
| Orchestration, 7 agents | **Real.** LangGraph, with a sequential fallback |
| Event streaming | **Real.** WebSocket, replay on reconnect, `Last-Event-ID` resume |
| Session store | **Real.** SQLite, atomic versioned updates |
| Two-Key consent | **Real.** The run waits for Kavya's yes/no (`POST /session/{id}/consent`); no answer in 10 min closes it with nothing shared |
| Hiring-manager sign-off | **Real.** Approve / reject the rewritten post (`POST /employer/rewrite-filter/{id}/decision`), kept in process memory |
| Inclusive matching (`/match`) | **Live on SAP HANA Cloud**, verified on a real instance: vector engine (`REAL_VECTOR`, `COSINE_SIMILARITY`). Embeddings come from a deterministic hashing embedder, not a model |
| Learning pathway (`/route`) | Reads the skills graph from SAP HANA Cloud when configured; the least-hours path is computed in Python (no HANA Graph yet) |
| Skills extraction, work-sample scoring, employer rewrite | A live LLM behind one interface (`GENAI_PROVIDER`): **the Gemini API**, or an OpenAI-compatible gateway (OpenCode Zen, OpenRouter, NVIDIA NIM); otherwise labelled fixtures. The SAP AI Core client (XSUAA OAuth) is built and waits for an AI Core service key, which a BTP trial does not carry |
| Market radar (pipeline agent) | **Live on SAP HANA Cloud** (`MARKET_RADAR` table, a sample dataset loaded by `scripts/load_market_radar_hana.py`), or an **SAP Datasphere** view with `MARKET_PROVIDER=datasphere`; otherwise the fixture, labelled `simulated` |
| Market radar (HR console block) | Static fixture, labelled `simulated` |
| Hosting | Manifests for **SAP BTP Cloud Foundry** (backend and frontend); see `docs/BTP_DEPLOY.md` |

Every response carries `source: live | simulated | local`, and every agent event
repeats it. **If a badge says `simulated`, it is a fixture.** We do not dress
fixtures as SAP results, and `/health` names the GenAI provider (`"gemini"`)
so a Gemini answer is never read as SAP AI Core.

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
   7  two_key_wait      ── human gate, the orchestrator's node, not an agent
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

**Turn on the live services** (in `backend/.env`; `backend/.env.example` documents every variable):

```bash
USE_MOCK_HANA=false            # + HANA_HOST, HANA_USER, HANA_PASSWORD
USE_MOCK_GENAI=false
GENAI_PROVIDER=gemini          # + GEMINI_API_KEY (backend only, never VITE_)
USE_MOCK_MARKET=false          # HANA table by default; MARKET_PROVIDER=datasphere + DATASPHERE_*
```

`GENAI_PROVIDER` is `auto | gemini | compatible | sap`: `compatible` uses
`LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL`, and `sap` the `GENAI_HUB_*`
values. Before a demo, `python scripts/check_providers.py` makes the real calls
and says which paths would answer live.

Verify the posture at any time — this is the honest self-report:

```bash
curl http://127.0.0.1:8000/health
```

```json
{"status":"ok",
 "hana":  {"mode":"mock","source":"simulated","integration_status":"not_implemented"},
 "genai": {"mode":"mock","source":"simulated","integration_status":"not_implemented"},
 "market":{"mode":"mock","source":"simulated","integration_status":"not_implemented"}}
```

---

## The demo, in five moves

1. **Press `RUN PIPELINE`.** The hero is a live agent console, not a video. The
   six agents report in real time (`6/6 agents done`), then the orchestrator
   **stops and asks Kavya**: *share her Skill Passport with employers?* Nothing
   is shared until she answers; in demo mode the answer stays on screen and says
   so.
2. **Score a work sample** for a skill that needs proof; a credential is issued at 70+.
3. **The route map:** 3 skills, 45 hours, 4.5 weeks at 10 h/week.
4. **Scroll to Stage 06 · Bias Audit.** You land on `PASS`, every twin delta at
   `±0`. That is the control. **Flip `SIMULATE LEGACY ATS` and re-run.** Same
   candidate, same score. The verdict goes amber, `max delta 6 > threshold 5`,
   and the offending rows light up. *This is the moment the project exists for.*
5. **The HR console:** the rewritten job post and the 12 candidates it had
   hidden. The hiring manager **approves** it, and it is published.

> **Lead with move 4.** A judge who only presses the default button sees a clean
> pass and concludes the audit found nothing. The bias is behind a toggle.

---

## Verification

```bash
cd backend  && .venv/Scripts/python -m pytest    # 326 passed
             .venv/Scripts/python -m ruff check .
             .venv/Scripts/python -m mypy
cd frontend && npm test                          # 139 passed
             npm run lint && npm run typecheck && npm run build
```

**465 tests, all passing.** The suites cover the parts that matter to a judge:
the audit's threshold boundary and the exact legacy-screen numbers the deck
quotes, the guardrail's blocking rule, the consent wait (yes, no, timeout, a
second answer), orchestrator failures that must not abort a run, WebSocket
replay, and every live service falling back to its labelled fixture.

---

## API

| Method | Path | Source |
|---|---|---|
| `GET` | `/health` | reports live/simulated posture per integration, and the GenAI provider |
| `POST` | `/session/start` | opens a session, returns immediately |
| `GET` | `/session/{id}` | full state, with replayable event history |
| `WS` | `/session/{id}/stream` | agent events; `Last-Event-ID` resumes |
| `POST` | `/session/{id}/consent` | Kavya's Two-Key answer `{accepted: bool}`; 409 if not waiting |
| `POST` | `/audit/ghost-twin` | `local` — the counterfactual audit |
| `POST` | `/skills/extract` | `simulated` → `live` with an LLM (Gemini or SAP AI Core) |
| `POST` | `/skills/work-sample` | `simulated` → `live` with an LLM (Gemini or SAP AI Core) |
| `GET` | `/route` | `simulated` → `live` with SAP HANA |
| `POST` | `/match` | `simulated` → `live` with SAP HANA |
| `GET` | `/market/displacement-radar` | `simulated` fixture, with disclaimer |
| `POST` | `/employer/rewrite-filter` | fixture, or `live` LLM rewrite derived from a flagged audit |
| `POST` | `/employer/rewrite-filter/{id}/decision` | hiring manager approves `{approved: bool}` or rejects |
| `GET` | `/employer/rewrite-filter/{id}/decision` | the latest decision, 404 if none |

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
  app/services/            genai_hub.py · gemini_client.py · openai_compatible.py · hana_client.py
                           datasphere.py · inclusive_matching.py · consent.py
                           employer_rewrite.py (the LLM-backed filter rewrite)
  app/api/                 the endpoints above
  manifest.yml             SAP BTP Cloud Foundry
frontend/
  src/components/          AgentConsole · ConsentCard · GhostTwinPanel · PipelineAgentGrid
  src/pages/               WorkerApp · RouteMap · HRConsole
  src/styles/tokens.css    the design system: every value and why it is that one
  src/styles/classes.js    the shared class map
  manifest.yml             SAP BTP Cloud Foundry (staticfile)
docs/                      BTP_DEPLOY · DATASPHERE · BUILD_APPS guides, the Datasphere CSV
ReRoute_PRD.md             product requirements
```

The design system lives in `frontend/src/styles/tokens.css` rather than in a
separate specification document. Each token carries the measurement behind it —
a contrast ratio, a luminance ladder, the reason a value was changed — so the
justification cannot drift away from the value it justifies.

## Known gaps

- **SAP AI Core has never run live.** We have no AI Core service key, so the LLM
  answers come from the Gemini API; `/health` says so. HANA Cloud is verified
  live for `/match`. The tests prove the *fallbacks*, not the live responses.
- The live agent stream needs demo mode off. In demo mode the console plays a
  recorded run of the real backend, message for message. Rehearse the toggle.
- Sessions and hiring-manager decisions do not survive a restart (SQLite and
  process memory; on Cloud Foundry the disk is ephemeral). Run one instance.
- Role embeddings come from a deterministic hashing embedder, not a model.
- Any `VITE_`-prefixed variable is inlined into the built bundle and is publicly
  readable, so no secret belongs there. (`.env` files *are* git-ignored, in
  `backend/.gitignore` and `frontend/.gitignore`, with `.env.example` kept.)

## Licence

Team ReRoute · SRM University-AP
