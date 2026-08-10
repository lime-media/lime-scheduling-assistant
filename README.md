# Lime Media Scheduling Assistant

A chat-based internal tool for querying truck scheduling data. Built as a static Vercel app with a serverless API backend that pulls live data from Databricks.

## How It Works

1. User asks a scheduling question via the chat UI
2. The `/api/query` serverless function runs a SQL query against the Databricks SQL Warehouse to fetch the next 60 days of truck scheduling data
3. The scheduling data is sent to the Claude API along with the question
4. Claude interprets the data and returns a natural-language answer

## Status Types

| Status | Color | Code | Meaning |
|--------|-------|------|---------|
| `SCHEDULED_LED` | Green | 3 | Truck confirmed and active via LED app |
| `COMMITTED_NOT_SET` | Red | 2 | Truck locked for a client, not yet in LED app |
| `HOLD_TENTATIVE` | Yellow | 1 | Tentatively held, not confirmed |
| `EMPTY` | Grey | 0 | No booking — truck is available |

## Environment Variables

Set these in Vercel project settings:

| Variable | Description |
|----------|-------------|
| `DATABRICKS_TOKEN` | Databricks personal access token |
| `DATABRICKS_WAREHOUSE_ID` | SQL Warehouse ID |
| `ANTHROPIC_KEY` | Anthropic API key (set in client-side code) |

## Deployment

Deployed on Vercel. Push to `main` to deploy.

```bash
vercel
```

## Project Structure

```
index.html        # Chat UI (HTML + vanilla JS)
api/
  query.js        # Vercel serverless function — queries Databricks SQL Warehouse
vercel.json       # Rewrite rules
```
