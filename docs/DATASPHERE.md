# Market Intelligence from SAP Datasphere

Moves the displacement radar the Market Intelligence agent reads into an SAP
Datasphere view. About 45 minutes once you can log in. The data is our sample
radar (`docs/datasphere/market_radar.csv`), so the deck's numbers do not
change: **4 radar rows, 28 openings in Chennai**.

What changes on stage: the agent says *"4 radar rows from SAP Datasphere · 28
openings in Chennai"* with a **live** badge, instead of *"4 simulated radar rows"*.

## 0. Get a tenant

Use the SAP Datasphere trial from sap.com (search "SAP Datasphere trial"). It
is 30 days and emails you a tenant URL. Provisioning can take a while, so start
it first. Until it is ready, the backend keeps serving the fixture with the
**simulated** label, so nothing breaks while you wait.

## 1. Create the space

1. **Space Management → Create**.
2. Business name `ReRoute`, Space ID **`REROUTE`**. The ID becomes the SQL schema name.
3. Under **Members**, add yourself.
4. Choose **Save**, then **Deploy**.

## 2. Upload the radar

1. **Data Builder**, then pick the `REROUTE` space.
2. **Import → Import CSV File**, and choose `C:\Users\dhruv\hackfest26\docs\datasphere\market_radar.csv`.
3. Check the columns: `RANK`, `OPENINGS` and `MEDIAN_PAY` should be **Integer**; the rest **String**.
4. Name the table `MARKET_RADAR` and choose **Deploy**.
5. Open the table's data preview. It should show 8 rows.

## 3. Make a view and expose it

1. **Data Builder → New Graphical View**.
2. Drag `MARKET_RADAR` onto the canvas.
3. Select the output node:
   - Technical name **`MARKET_RADAR_V`**
   - Semantic usage **Relational Dataset**
   - Switch on **Expose for Consumption**
4. Choose **Deploy**.

## 4. Create a read-only database user

1. **Space Management → REROUTE → Database Access → Database Users → Create**.
2. Suffix `READER`, which makes the user **`REROUTE#READER`**.
3. Tick **Enable Read Access (SQL)**, then **Create**, then **Deploy** the space.
4. Open the user's **info (i)** icon and copy:
   - **Host Name**, into `DATASPHERE_HOST`
   - **Port** (443), into `DATASPHERE_PORT`
   - **Database User Name** (`REROUTE#READER`), into `DATASPHERE_USER`
   - **Request New Password**, into `DATASPHERE_PASSWORD`. It is shown once, so copy it straight away.

## 5. Let the backend in (IP allowlist)

**System → Configuration → IP Allowlist → Trusted IPs → Add**:

- Your laptop's public IP (search "what is my IP"), for local testing.
- For the Cloud Foundry backend, either the BTP egress IPs for your region, or
  `0.0.0.0/0` for the demo. It is a trial with sample data; remove it afterwards.

## 6. Point the backend at it

Local (`backend/.env`):

```
USE_MOCK_MARKET=false
DATASPHERE_HOST=<host name>
DATASPHERE_USER=REROUTE#READER
DATASPHERE_PASSWORD=<password>
DATASPHERE_SCHEMA=REROUTE
DATASPHERE_VIEW=MARKET_RADAR_V
```

On BTP (Git Bash). `USE_MOCK_MARKET=false` is already in the manifest.

```bash
cf set-env reroute-backend DATASPHERE_HOST <host name>
cf set-env reroute-backend DATASPHERE_USER 'REROUTE#READER'
cf set-env reroute-backend DATASPHERE_PASSWORD '<password>'
cf set-env reroute-backend DATASPHERE_SCHEMA REROUTE
cf set-env reroute-backend DATASPHERE_VIEW MARKET_RADAR_V
cf restage reroute-backend
```

## 7. Check it

1. `curl <backend>/health` should show `"market": {"mode":"live", ..., "integration_status":"configured", "provider":"sap_datasphere"}`.
2. Run the pipeline. Market Intelligence should say *"4 radar rows from SAP Datasphere · 28 openings in Chennai"* with a **live** badge.
3. If it still says *simulated*, the read failed and the fixture answered. Look at
   `cf logs reroute-backend --recent` (or the uvicorn console) for
   `SAP Datasphere radar read failed`. The usual causes are the IP allowlist,
   the password, or a view that isn't exposed for consumption.

## Optional: an SAP Analytics Cloud story

In SAP Analytics Cloud, create a story on `MARKET_RADAR_V`: a bar chart of
`OPENINGS` by `ROLE`, filtered to Chennai and coloured by `EXPOSURE`.
Screenshot it for the deck, or keep it open for 20 seconds in the demo.

## Honest wording

*"Market Intelligence reads from SAP Datasphere (Business Data Cloud). The
dataset is a sample today; SuccessFactors workforce data products come in
Phase 2."*

The HR console's standalone radar block still reads the bundled fixture and
says **simulated**. Only the pipeline agent reads Datasphere.
