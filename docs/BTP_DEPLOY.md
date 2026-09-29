# Host ReRoute on SAP BTP Cloud Foundry

Step by step, from a Windows laptop. About 45 minutes the first time. You type
every password yourself; nothing secret goes into a file that is committed.

What you end up with:

| Piece | Where | How |
| --- | --- | --- |
| Backend (FastAPI) | `https://reroute-backend-<random>.cfapps.<region>.hana.ondemand.com` | `backend/manifest.yml`, Python buildpack |
| Frontend (Vite build) | `https://reroute-frontend-<random>.cfapps.<region>.hana.ondemand.com` | `frontend/manifest.yml`, staticfile buildpack |
| Backup | the laptop: `uvicorn` + `npm run dev` | unchanged |

## 0. Tools (already on this laptop)

- Cloud Foundry CLI v8: open a **new** terminal and run `cf version`.
- Python 3.11 venv: `C:\Users\dhruv\.venvs\reroute311`.
- Node 24 for the frontend build.

Use **Git Bash** for the `cf set-env` commands below that contain JSON. Windows
PowerShell 5.1 strips the inner double quotes when it calls `cf.exe`.

## 1. Find your Cloud Foundry API endpoint

1. Open <https://account.hanatrial.ondemand.com> and choose **Go To Your Trial Account**.
2. Open the subaccount (usually `trial`).
3. On its **Overview** page, find the **Cloud Foundry Environment** block. Note:
   - **API Endpoint**, e.g. `https://api.cf.us10-001.hana.ondemand.com`
   - **Org Name**
   - The space, normally `dev`. If there is no space, choose **Create Space** and name it `dev`.

If the block says Cloud Foundry is not enabled, choose **Enable Cloud
Foundry**, then create the `dev` space.

## 2. Log in

```bash
cf login -a https://api.cf.us10-001.hana.ondemand.com
```

Use your own API endpoint. Enter your SAP ID email and password when asked, then
pick the org and the `dev` space. If your account uses single sign-on, run
`cf login -a <endpoint> --sso` and paste the one-time passcode it links to.

## 3. Push the backend

```bash
cd C:/Users/dhruv/hackfest26/backend
cf push
```

This takes 3–5 minutes. It ends with `requested state: started` and a
`routes:` line. Copy that route, which is your **backend URL**:

```bash
cf app reroute-backend
```

Check it:

```bash
curl https://<backend-route>/health
```

At this point `hana` and `genai` say `live` but the calls fall back to the
simulated fixtures, because no credentials are set yet. That is expected.

## 4. Give the backend its secrets

Run these in **Git Bash**, one per line, with your real values. They persist
across later `cf push` runs.

```bash
cf set-env reroute-backend HANA_HOST <hana-host-without-https>
cf set-env reroute-backend HANA_USER <hana-user>
cf set-env reroute-backend HANA_PASSWORD '<hana-password>'
cf set-env reroute-backend GEMINI_API_KEY '<gemini-key>'
```

These come from the same values as your local `backend/.env`. Then apply them:

```bash
cf restage reroute-backend
```

**HANA Cloud must accept connections from BTP.** In SAP HANA Cloud Central, open
the instance, choose **Manage Configuration → Connections**, and allow **All
IP addresses** (or at least BTP). If you allowed only your laptop's IP,
Cloud Foundry cannot reach it and `/match` quietly serves the simulated result.

## 5. Build and push the frontend

In **PowerShell**:

```powershell
cd C:\Users\dhruv\hackfest26\frontend
$env:VITE_API_BASE_URL = "https://<backend-route>"
$env:VITE_DEMO_MODE_DEFAULT = "false"
npm run build
cf push
cf app reroute-frontend
```

Copy the frontend route. `VITE_DEMO_MODE_DEFAULT=false` makes the hosted page
start with demo mode **off**. Otherwise a fresh browser would send every call
to `127.0.0.1`.

## 6. Let the frontend call the backend (CORS)

In **Git Bash**, list every origin that will call the API: the hosted frontend
and the laptop backup (dev server on 5173, `vite preview` on 4173).

```bash
cf set-env reroute-backend CORS_ORIGINS '["https://<frontend-route>","http://localhost:5173","http://127.0.0.1:5173","http://localhost:4173"]'
cf restage reroute-backend
```

Add the SAP Build Apps preview origin here too if you do section E.

## 7. Check the whole thing

1. `curl https://<backend-route>/health` should show:
   - `"hana": {"mode":"live","integration_status":"configured"}`
   - `"genai": {..., "provider":"gemini"}`
   - `market` as `mock`, or live if you did Datasphere.
2. Open `https://<frontend-route>` and choose **Run pipeline**. You should see
   14 events, and then the Two-Key question.
3. Answer it, then run the Ghost Twin panel with **Simulate legacy ATS**
   switched on. It should come out FLAGGED.

Logs, if anything misbehaves:

```bash
cf logs reroute-backend --recent
```

## Finale morning

- Start HANA Cloud (and Datasphere) first. Trial instances stop every night.
- Run `cf apps`. If an app shows `stopped`, run `cf start reroute-backend`, then
  `cf start reroute-frontend`.
- Open `/health` once. The first request after idle can take a few seconds.

## If something breaks

| Symptom | Fix |
| --- | --- |
| Push fails on the Python version | Edit `backend/runtime.txt` to `python-3.12.x` and push again |
| `cf push` crashes with out-of-memory | In `backend/manifest.yml`, set `memory: 768M` |
| Browser console says **CORS** | The origin it names is missing from `CORS_ORIGINS` (step 6) |
| Page loads but calls go to `127.0.0.1` | Demo mode is on: turn it off in the header, or rebuild with step 5's variables |
| Sessions vanish after a restart | Expected: SQLite on Cloud Foundry is wiped on restart |

Honest wording for the deck: *"Backend and frontend run on SAP BTP Cloud
Foundry; one instance, sessions reset on restart."*
