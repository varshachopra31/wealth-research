# Wealth Research — personal investment research dashboard

A local web app that discovers, scores and tracks Indian stocks, mutual funds and startup/VC trends for a
5–10 year, inflation-beating goal. **Free data only, no paid services, no installs beyond Node.js.**

> Research tool, not investment advice. Scenario returns illustrate stated assumptions; they are not forecasts.

## Start

Double-click **`Start Wealth Research.cmd`** (or run `node server.js`) and open http://127.0.0.1:8095.
The first data load (Nifty 500 prices + 4 years of financials, ~14,000 mutual funds, CPI, news) takes ~10–20 minutes
and runs in the background. After that the app refreshes itself while it is open:

| Data | Schedule |
|---|---|
| Stock prices | daily |
| Company financials | weekly (stalest first) |
| Mutual-fund NAVs | daily |
| News & startup feeds | every 2 hours |
| Inflation (CPI), Nifty 500 list | monthly |

Run tests: `npm test`.

## What it does

- **Discover** — every Nifty 500 company (plus any NSE symbol you add) scored 0–100 on Quality (35%), Growth (25%),
  Value (25%, ranked within industry) and Safety (15%), with red flags and a screen label:
  *Buy candidate / Watch / Investigate / Avoid*. Thematic screens: emerging growth, quality compounders,
  quality at a fair price, turnarounds, hype risk.
- **Stock page** — reasons for the label, factor-by-factor score breakdown, red flags, 4-year financials,
  5-year price chart, news, sources, and **editable bear/base/bull 5-year scenarios** with real (after-inflation) returns.
- **Compare** up to 5 companies side by side.
- **Mutual funds** — any scheme's 1/3/5/10-year CAGR (nominal and real), volatility, drawdown, rolling 3-year consistency;
  rank a whole category.
- **Portfolio** (manual entry, stored locally) — value, allocation, estimated real return, concentration warnings,
  and a "portfolio fit" note on every stock.
- **Startups & VC** — funding rounds parsed from Inc42/Entrackr/ET Tech headlines, money by sector, active investors,
  upcoming IPOs, new VC funds, and links to listed companies in hot sectors.
- **Alerts** — label changes, new red flags, sharp price falls and news for stocks you hold or watch.
- **Report** — printable buy / watch / investigate / avoid report, plus an optional AI weekly brief.

## Free AI (optional)

Settings → *Free AI provider*:

- **Google Gemini (free tier)** — get a key at https://aistudio.google.com/apikey (no card). Optional Google Search
  grounding returns real web citations. Free-tier limits apply; Google may use free-tier prompts to improve its products.
- **Ollama (local)** — fully private; install from ollama.com and `ollama pull llama3.2:3b`. Slow on a CPU-only laptop.

The AI is given the app's own computed facts with numbered sources and told to cite them and never invent numbers.
All scoring and scenarios work without AI.

## Data sources

| What | Source | Status |
|---|---|---|
| Universe | NSE Nifty 500 constituents CSV | official |
| Prices | Yahoo Finance chart API | unofficial, delayed |
| Financials | Yahoo Finance fundamentals timeseries (4 annual years) | unofficial |
| Mutual funds | AMFI NAVAll.txt + mfapi.in history | official / AMFI mirror |
| Inflation | World Bank India CPI (annual) | official |
| News | ET, Mint, Inc42, Entrackr RSS | public feeds |

## Limitations (read these)

- Free financials are unofficial and only 4 years deep; bank equity figures in particular can differ from the annual report.
- Not checked: promoter pledging, related-party transactions, auditor changes, contingent liabilities, NPAs, quarterly results
  (BSE's filing API blocks automated access).
- Mutual funds: no free expense ratio, holdings, AUM or manager data.
- VC data is headline-based and approximate; proper deal databases (Tracxn, Venture Intelligence, PrivateCircle) are paid.
- Taxes, costs and your personal situation are not modelled.

Data lives in `data/research.db` (SQLite). Delete it to start fresh.

## Where things are kept
- **Code** — this folder, in OneDrive (`OneDrive - BMP & Co.LLP\Wealth Research`).
- **Live database** — `%LOCALAPPDATA%\WealthResearch\research.db` on this PC. It is kept out of OneDrive on purpose: OneDrive syncing a database while the app writes to it can lock or corrupt it.
- **Backups** — `backups\research-YYYY-MM-DD.db` in this folder, written once a day while the app runs (the last 14 are kept). To restore, stop the app and copy a backup over `%LOCALAPPDATA%\WealthResearch\research.db`.
- On another PC, run the app from this folder and copy the latest backup into `%LOCALAPPDATA%\WealthResearch\research.db` first.
