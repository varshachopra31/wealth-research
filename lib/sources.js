"use strict";
// All external data sources live here. Each function returns plain data plus
// the source URL so every figure in the app can be traced back.
const { fetchText, fetchJson } = require("./net");

const SRC = {
  nifty500: "https://archives.nseindia.com/content/indices/ind_nifty500list.csv",
  nseEquity: "https://archives.nseindia.com/content/equities/EQUITY_L.csv",
  yahooChart: (s) => `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?range=5y&interval=1wk&events=div`,
  yahooFund: (s, types) => `https://query2.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(s)}?type=${types}&period1=1262304000&period2=${Math.floor(Date.now() / 1000) + 86400 * 400}`,
  yahooPage: (s) => `https://finance.yahoo.com/quote/${encodeURIComponent(s)}/financials`,
  amfi: "https://portal.amfiindia.com/spages/NAVAll.txt",
  mfapi: (c) => `https://api.mfapi.in/mf/${c}`,
  cpi: "https://api.worldbank.org/v2/country/IN/indicator/FP.CPI.TOTL.ZG?format=json&per_page=30",
};

// ---------- CSV ----------
function parseCsv(text) {
  const rows = [];
  let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cur); cur = "";
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
    } else cur += c;
  }
  if (cur !== "" || row.length) { row.push(cur); if (row.some((x) => x.trim() !== "")) rows.push(row); }
  return rows;
}

async function getNifty500() {
  const rows = parseCsv(await fetchText(SRC.nifty500));
  const h = rows[0].map((x) => x.trim().toLowerCase());
  const iN = h.indexOf("company name"), iI = h.indexOf("industry"), iS = h.indexOf("symbol"), iIsin = h.indexOf("isin code");
  return rows.slice(1).map((r) => ({ symbol: r[iS].trim(), name: r[iN].trim(), industry: r[iI].trim(), isin: r[iIsin].trim() })).filter((x) => x.symbol);
}

async function getNseEquityList() {
  const rows = parseCsv(await fetchText(SRC.nseEquity));
  const h = rows[0].map((x) => x.trim().toUpperCase());
  const iS = h.indexOf("SYMBOL"), iN = h.indexOf("NAME OF COMPANY"), iSer = h.indexOf("SERIES"), iIsin = h.indexOf("ISIN NUMBER");
  return rows.slice(1).filter((r) => (r[iSer] || "").trim() === "EQ")
    .map((r) => ({ symbol: r[iS].trim(), name: r[iN].trim(), isin: (r[iIsin] || "").trim() }));
}

// ---------- Yahoo: prices ----------
async function getPriceSeries(nseSymbol) {
  const ysym = nseSymbol + ".NS";
  const url = SRC.yahooChart(ysym);
  const j = await fetchJson(url);
  const r = j && j.chart && j.chart.result && j.chart.result[0];
  if (!r) throw new Error((j.chart && j.chart.error && j.chart.error.description) || "No chart data");
  const ts = r.timestamp || [];
  const q0 = r.indicators && r.indicators.quote && r.indicators.quote[0];
  const close = (q0 && q0.close) || [];
  const vol = (q0 && q0.volume) || [];
  const series = [], volumes = [];
  for (let i = 0; i < ts.length; i++) if (close[i] != null) { series.push([new Date(ts[i] * 1000).toISOString().slice(0, 10), +close[i].toFixed(2)]); volumes.push(vol[i] || 0); }
  const divs = Object.values((r.events && r.events.dividends) || {}).map((d) => [new Date(d.date * 1000).toISOString().slice(0, 10), d.amount]);
  return {
    price: r.meta.regularMarketPrice, currency: r.meta.currency, asOf: new Date((r.meta.regularMarketTime || 0) * 1000).toISOString(),
    high52: r.meta.fiftyTwoWeekHigh, low52: r.meta.fiftyTwoWeekLow, series, volumes, dividends: divs, source: url,
  };
}

// ---------- Yahoo: annual fundamentals ----------
const FUND_FIELDS = {
  rev: "TotalRevenue", ni: "NetIncomeCommonStockholders", ocf: "OperatingCashFlow", capex: "CapitalExpenditure",
  fcf: "FreeCashFlow", ebit: "EBIT", intExp: "InterestExpense", debt: "TotalDebt", equity: "StockholdersEquity",
  assets: "TotalAssets", curLiab: "CurrentLiabilities", cash: "CashAndCashEquivalents", shares: "OrdinarySharesNumber",
  recv: "AccountsReceivable", opInc: "OperatingIncome", pbt: "PretaxIncome", tax: "TaxProvision", div: "CashDividendsPaid",
  inv: "Inventory", gp: "GrossProfit",
};

async function getFundamentals(nseSymbol) {
  const ysym = nseSymbol + ".NS";
  const types = Object.values(FUND_FIELDS).map((t) => "annual" + t).join(",");
  const url = SRC.yahooFund(ysym, types);
  const j = await fetchJson(url);
  const res = (j && j.timeseries && j.timeseries.result) || [];
  const byYear = {};
  for (const x of res) {
    const t = x.meta && x.meta.type && x.meta.type[0];
    if (!t) continue;
    const key = Object.keys(FUND_FIELDS).find((k) => "annual" + FUND_FIELDS[k] === t);
    for (const e of x[t] || []) {
      if (!e || !e.asOfDate || !e.reportedValue) continue;
      (byYear[e.asOfDate] = byYear[e.asOfDate] || { fy: e.asOfDate })[key] = e.reportedValue.raw;
    }
  }
  const years = Object.values(byYear).sort((a, b) => a.fy.localeCompare(b.fy));
  return { years, source: url, page: SRC.yahooPage(ysym), currency: "INR" };
}

// ---------- Mutual funds ----------
async function getAmfiNav() {
  const text = await fetchText(SRC.amfi, { timeout: 60000 });
  const out = [];
  let category = "", amc = "";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("Scheme Code")) continue;
    if (!line.includes(";")) {
      const m = line.match(/^(Open|Close|Interval)[^(]*\((.*)\)$/i);
      if (m) category = m[2].trim(); else amc = line;
      continue;
    }
    const p = line.split(";").map((x) => x.trim());
    if (p.length < 6) continue;
    // New format (2026): Code;ISIN1;ISIN2;Name;Plan;Option;NAV;Date. Old format: Code;ISIN1;ISIN2;Name;NAV;Date.
    const modern = p.length >= 8;
    const nav = parseFloat(modern ? p[6] : p[4]);
    if (!isFinite(nav)) continue;
    const name = modern ? [p[3], p[4], p[5]].filter((x) => x && x !== "-").join(" - ") : p[3];
    out.push({ code: p[0], name, amc, category, nav, nav_date: modern ? p[7] : p[5] });
  }
  return { schemes: out, source: SRC.amfi };
}

async function getMfHistory(code) {
  const url = SRC.mfapi(code);
  const j = await fetchJson(url);
  if (!j || !Array.isArray(j.data)) throw new Error("No NAV history");
  const data = j.data.map((d) => { const [dd, mm, yy] = d.date.split("-"); return [`${yy}-${mm}-${dd}`, parseFloat(d.nav)]; })
    .filter((d) => isFinite(d[1]) && d[1] > 0).sort((a, b) => a[0].localeCompare(b[0]));
  return { meta: j.meta, data, source: url };
}

// ---------- Inflation ----------
async function getCpi() {
  const j = await fetchJson(SRC.cpi);
  const rows = (j[1] || []).filter((r) => r.value != null).map((r) => ({ year: +r.date, value: r.value })).sort((a, b) => a.year - b.year);
  return { series: rows, source: SRC.cpi, sourceName: "World Bank WDI, FP.CPI.TOTL.ZG (consumer price inflation, India, annual %)" };
}

// ---------- News / startup feeds ----------
const FEEDS = [
  { kind: "market", name: "Economic Times – Markets", url: "https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms" },
  { kind: "market", name: "Economic Times – Stocks", url: "https://economictimes.indiatimes.com/markets/stocks/rssfeeds/2146842.cms" },
  { kind: "market", name: "Mint – Markets", url: "https://www.livemint.com/rss/markets" },
  { kind: "market", name: "Mint – Companies", url: "https://www.livemint.com/rss/companies" },
  { kind: "startup", name: "Inc42", url: "https://inc42.com/feed/" },
  { kind: "startup", name: "Entrackr", url: "https://entrackr.com/rss" },
  { kind: "startup", name: "ET – Tech/Startups", url: "https://economictimes.indiatimes.com/tech/startups/rssfeeds/78570540.cms" },
];

function decodeEntities(s) {
  return String(s || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ").trim();
}

function parseRss(xml) {
  const items = [];
  const re = /<item[\s>][\s\S]*?<\/item>/gi;
  let m;
  while ((m = re.exec(xml))) {
    const block = m[0];
    const get = (tag) => { const r = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i").exec(block); return r ? r[1] : ""; };
    const title = decodeEntities(get("title"));
    let link = decodeEntities(get("link"));
    if (!link) { const g = /<guid[^>]*>([\s\S]*?)<\/guid>/i.exec(block); link = g ? decodeEntities(g[1]) : ""; }
    const pub = get("pubDate") || get("dc:date");
    const d = new Date(decodeEntities(pub));
    items.push({ title, link, published: isNaN(d) ? null : d.toISOString(), summary: decodeEntities(get("description")).slice(0, 400) });
  }
  return items.filter((x) => x.title && x.link);
}

async function getFeed(feed) {
  return parseRss(await fetchText(feed.url, { timeout: 20000, retries: 1 }));
}

module.exports = { SRC, FEEDS, parseCsv, parseRss, getNifty500, getNseEquityList, getPriceSeries, getFundamentals, getAmfiNav, getMfHistory, getCpi, getFeed };
