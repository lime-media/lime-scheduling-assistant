export default async function handler(req, res) {
  // Allow requests from your Vercel app
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const PAT_TOKEN    = process.env.DATABRICKS_TOKEN;
  const WAREHOUSE_ID = process.env.DATABRICKS_WAREHOUSE_ID;
  const HOST         = "https://adb-711376066807.europe-west1.azuredatabricks.net";

  const SQL = `
WITH calendar AS (
  SELECT explode(sequence(current_date, date_add(current_date, 60), interval 1 day)) AS calendar_date
),
truck_mappings AS (
  SELECT truck_uid, truck_number, samsara_id
  FROM \`lime-prod-datalake-catalog\`.\`raw\`.\`led_app_trucks\`
  WHERE COALESCE(is_deleted, FALSE) = FALSE
),
future_sched AS (
  SELECT ps.truck_uid, pm.market, pm.state, p.program,
    CAST(ps.start_time AS DATE) AS s_date,
    CASE WHEN EXTRACT(HOUR FROM ps.end_time)=0 AND EXTRACT(MINUTE FROM ps.end_time)=0
         AND EXTRACT(SECOND FROM ps.end_time)=0
         THEN DATE_SUB(CAST(ps.end_time AS DATE),1)
         ELSE CAST(ps.end_time AS DATE) END AS e_date
  FROM \`lime-prod-datalake-catalog\`.\`raw\`.\`led_app_program_schedule\` ps
  JOIN \`lime-prod-datalake-catalog\`.\`raw\`.\`led_app_client_programs\` p ON ps.client_program_uid=p.client_program_uid
  JOIN \`lime-prod-datalake-catalog\`.\`raw\`.\`led_app_client_program_markets\` pm ON ps.client_program_market_uid=pm.client_program_market_uid
),
led_sched_daily AS (
  SELECT fs.truck_uid, fs.market, fs.state, fs.program, d AS calendar_date
  FROM future_sched fs
  LATERAL VIEW explode(sequence(fs.s_date, fs.e_date, interval 1 day)) x AS d
),
intent_mapped AS (
  SELECT tm.truck_uid, tm.truck_number, i.state AS intent_state, i.market AS intent_market,
    i.client AS intent_client, i.status AS intent_status, i.start_date, i.end_date
  FROM \`lime-prod-datalake-catalog\`.\`raw\`.\`led_sales_intent\` i
  JOIN truck_mappings tm ON TRY_CAST(i.truck_number AS INT)=TRY_CAST(tm.truck_number AS INT)
  WHERE i.status IN ('HOLD','COMMITTED')
),
intent_daily AS (
  SELECT im.truck_uid, im.truck_number, im.intent_state, im.intent_market,
    im.intent_client, im.intent_status, d AS calendar_date
  FROM intent_mapped im
  LATERAL VIEW explode(sequence(im.start_date, im.end_date, interval 1 day)) x AS d
),
truck_calendar AS (
  SELECT tm.truck_uid, tm.truck_number, cal.calendar_date
  FROM truck_mappings tm CROSS JOIN calendar cal
),
base AS (
  SELECT tc.truck_number, tc.calendar_date,
    ls.market AS sched_market, ls.state AS sched_state, ls.program AS sched_program,
    id.intent_status, id.intent_client, id.intent_state, id.intent_market
  FROM truck_calendar tc
  LEFT JOIN led_sched_daily ls ON ls.truck_uid=tc.truck_uid AND ls.calendar_date=tc.calendar_date
  LEFT JOIN intent_daily id ON id.truck_uid=tc.truck_uid AND id.calendar_date=tc.calendar_date
)
SELECT truck_number,
  sched_market AS LED_app_market, sched_state AS LED_app_state, sched_program AS program,
  COALESCE(sched_state, intent_state) AS state,
  COALESCE(sched_market, intent_market) AS market,
  calendar_date, intent_status, intent_client, intent_state, intent_market,
  CASE WHEN sched_program IS NOT NULL THEN 'SCHEDULED_LED'
       WHEN intent_status='COMMITTED' THEN 'COMMITTED_NOT_SET'
       WHEN intent_status='HOLD' THEN 'HOLD_TENTATIVE'
       ELSE 'EMPTY' END AS display_status,
  CASE WHEN sched_program IS NOT NULL THEN 3
       WHEN intent_status='COMMITTED' THEN 2
       WHEN intent_status='HOLD' THEN 1
       ELSE 0 END AS status_code
FROM base
ORDER BY truck_number, calendar_date
LIMIT 3000`;

  try {
    // Submit statement
    const submit = await fetch(`${HOST}/api/2.0/sql/statements`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${PAT_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ statement: SQL, warehouse_id: WAREHOUSE_ID, wait_timeout: "50s", on_wait_timeout: "CONTINUE" })
    });
    let result = await submit.json();
    let state  = result.status?.state;
    const sid  = result.statement_id;

    // Poll until done
    while (state === "PENDING" || state === "RUNNING") {
      await new Promise(r => setTimeout(r, 2500));
      const poll = await fetch(`${HOST}/api/2.0/sql/statements/${sid}`, {
        headers: { "Authorization": `Bearer ${PAT_TOKEN}` }
      });
      result = await poll.json();
      state  = result.status?.state;
    }

    if (state !== "SUCCEEDED") throw new Error(result.status?.error?.message || "Query failed");

    const cols = result.manifest?.schema?.columns?.map(c => c.name) || [];
    const rows = (result.result?.data_array || []).map(row =>
      Object.fromEntries(cols.map((c, i) => [c, row[i]]))
    );

    return res.status(200).json({ rows });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
