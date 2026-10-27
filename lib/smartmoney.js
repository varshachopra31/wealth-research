"use strict";
// Smart Money & Hidden Opportunities Radar.
// Collects public disclosures, discovers investors dynamically (no hard-coded list of names),
// turns disclosures into signals, cross-checks them against fundamentals, and tracks outcomes.
//
// Free, official sources (NSE):
//  - Bulk & block deals: daily CSV files (complete) + per-symbol 1-year history API (backfill)
//  - SAST Reg 29 disclosures: substantial acquisitions/sales (≥5% holders and promoters)
//  - Shareholding pattern XBRL (quarterly): every named holder above 1%
// Not available free: insider-trading (PIT) feed (NSE API returns nothing), MF monthly portfolios
// (per-AMC files), BSE deals (blocks automated access).

const { db, now, kvGet, kvSet } = require("./db");
const { fetchText, sleep } = require("./net");
const { parseShp } = require("./profile");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const DAY = 864e5;

db.exec(`
CREATE TABLE IF NOT EXISTS sm_deals ( id TEXT PRIMARY KEY, date TEXT, symbol TEXT, name TEXT, client TEXT, ckey TEXT, side TEXT, qty REAL, price REAL, kind TEXT, source TEXT );
CREATE INDEX IF NOT EXISTS sm_deals_sym ON sm_deals(symbol); CREATE INDEX IF NOT EXISTS sm_deals_ck ON sm_deals(ckey);
CREATE TABLE IF NOT EXISTS sm_sast ( id TEXT PRIMARY KEY, date TEXT, symbol TEXT, company TEXT, acquirer TEXT, ckey TEXT, side TEXT, mode TEXT, shares REAL, pct_after REAL, pct_change REAL, promoter INTEGER, attachment TEXT );
CREATE INDEX IF NOT EXISTS sm_sast_sym ON sm_sast(symbol); CREATE INDEX IF NOT EXISTS sm_sast_ck ON sm_sast(ckey);
CREATE TABLE IF NOT EXISTS sm_holdings ( symbol TEXT, quarter TEXT, published TEXT, name TEXT, ckey TEXT, pct REAL, grp TEXT, promoter INTEGER, xbrl TEXT, PRIMARY KEY(symbol, quarter, name) );
CREATE INDEX IF NOT EXISTS sm_hold_ck ON sm_holdings(ckey);
CREATE TABLE IF NOT EXISTS sm_cats ( symbol TEXT, quarter TEXT, published TEXT, json TEXT, xbrl TEXT, PRIMARY KEY(symbol, quarter) );
CREATE TABLE IF NOT EXISTS sm_crawl ( symbol TEXT, what TEXT, done_at TEXT, note TEXT, PRIMARY KEY(symbol, what) );
CREATE TABLE IF NOT EXISTS sm_bench ( date TEXT PRIMARY KEY, close REAL );
`);

// ---------------------------------------------------------------- NSE access
let nSess = null;
const lastNse = { t: 0 };
async function nseGap() { const w = lastNse.t + 1100 - Date.now(); lastNse.t = Math.max(Date.now(), lastNse.t + 1100); if (w > 0) await sleep(w); }
async function nseSession() {
  if (nSess && Date.now() - nSess.at < 15 * 60e3) return nSess;
  const r = await fetch("https://www.nseindia.com/", { headers: { "User-Agent": UA, "Accept-Language": "en-IN,en;q=0.9" } });
  await r.text();
  nSess = { cookie: (r.headers.getSetCookie ? r.headers.getSetCookie() : []).map((c) => c.split(";")[0]).join("; "), at: Date.now() };
  return nSess;
}
async function nseJson(path) {
  for (let i = 0; i < 3; i++) {
    await nseGap();
    const s = await nseSession();
    try {
      const t = await fetchText("https://www.nseindia.com" + path, { headers: { Cookie: s.cookie, Referer: "https://www.nseindia.com/", Accept: "application/json" }, retries: 0, timeout: 40000 });
      return JSON.parse(t);
    } catch (e) { nSess = null; if (i === 2) throw e; await sleep(2000 * (i + 1)); }
  }
}
const ddmmyyyy = (d) => `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;
function parseDate(s) { // "16-OCT-2026", "16-Oct-2026 12:07", "30-SEP-2026"
  const m = String(s || "").match(/(\d{1,2})-([A-Za-z]{3})-(\d{4})/);
  if (!m) return null;
  const d = new Date(`${m[2]} ${m[1]}, ${m[3]} UTC`);
  return isNaN(d) ? null : d.toISOString().slice(0, 10);
}
function parseCsv(text) {
  const rows = []; for (const line of text.split(/\r?\n/)) { if (!line.trim()) continue; const out = []; let cur = "", q = false;
    for (let i = 0; i < line.length; i++) { const c = line[i]; if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; } else if (c === '"') q = true; else if (c === ",") { out.push(cur); cur = ""; } else cur += c; }
    out.push(cur); rows.push(out.map((x) => x.trim())); }
  return rows;
}

// ---------------------------------------------------------------- investor identity & classification (no fixed name list)
const CORP = /\b(LIMITED|LTD|PRIVATE|PVT|LLP|LLC|INC|CORP(ORATION)?|COMPANY|CO|PLC|PTE|BV|GMBH|SA|AG|NV|LP|TRUST|FUND|FUNDS|CAPITAL|PARTNERS|VENTURES|INVESTMENTS?|HOLDINGS?|SECURITIES|FINANCE|FINANCIAL|INSURANCE|BANK|ASSET|MANAGEMENT|SCHEME|PORTFOLIO|INDUSTRIES|ENTERPRISES|GROUP|FOUNDATION|ADVISORS?|MASTER|OPPORTUNIT(Y|IES)|EQUITY|GROWTH)\b/;
const PASSIVE = /\b(ETF|EXCHANGE TRADED|INDEX FUND|INDEX|NIFTY|SENSEX|BEES|PASSIVE|TRACKER)\b/;
const MF = /\b(MUTUAL FUND|TRUSTEE|MF\b|UNDER ITS VARIOUS SCHEMES|A\/C .*FUND|FLEXI ?CAP|LARGE ?CAP|MID ?CAP|SMALL ?CAP|MULTI ?CAP|ELSS|TAX SAVER|FOCUSED|HYBRID|VALUE FUND|BALANCED ADVANTAGE)\b/;
const INSURER = /\b(INSURANCE|ASSURANCE|LIFE CORPORATION|LIFE INSURANCE)\b/;
const GOVT = /\b(GOVERNMENT|PRESIDENT OF INDIA|GOVERNOR|NPS TRUST|PENSION|PROVIDENT FUND|EMPLOYEES' STATE)\b/;
const FOREIGN = /\b(MAURITIUS|SINGAPORE|PTE|CAYMAN|LUXEMBOURG|SICAV|IRELAND|DUBLIN|DELAWARE|LLC|L\.?P\.?|B\.?V\.?|GMBH|S\.?A\.?R\.?L|PLC|NORGES|ABU DHABI|KUWAIT|QATAR|SAUDI|AUSTRALIA|CANADA|VANGUARD|BLACKROCK|ISHARES|FIDELITY|GOLDMAN|MORGAN STANLEY|JP ?MORGAN|NOMURA|SOCIETE GENERALE|BNP|CITIGROUP|UBS|INVESCO|NATIONAL PENSION|SOVEREIGN|EMERGING MARKETS)\b/;
const PEVC = /\b(VENTURES?|PRIVATE EQUITY|GROWTH (FUND|PARTNERS)|CAPITAL PARTNERS|AIF|ALTERNATIVE INVESTMENT|OPPORTUNITIES FUND|OPPORTUNITY FUND|FUND PC|SPECIAL SITUATIONS|INVESTMENT TRUST)\b/;
const TRUSTEE_PLEDGE = /\b(TRUSTEESHIP|DEBENTURE|SECURITY TRUSTEE|AS TRUSTEE|TRUSTEE SERVICES|FOR THE BENEFIT OF|LENDERS?)\b|\bBANK\b.*BRANCH/;
const BROKER = /\b(SECURITIES|BROKING|STOCK ?BROKERS?|STOCKS? LTD|SHARE ?(BROKERS?|AND STOCK)|COMMODIT(Y|IES)|TRADING|CAPITAL MARKETS|DERIVATIVES|ARBITRAGE|QUANT|ALGO)\b/;

const MF_SCHEME = /\b(LARGE ?(AND|&) ?MID ?CAP|LARGE ?CAP|MID ?CAP|SMALL ?CAP|FLEXI ?CAP|MULTI ?CAP|FOCUSED|ELSS|TAX SAVER|VALUE|CONTRA|DIVIDEND YIELD|HYBRID|BALANCED|EQUITY SAVINGS|ARBITRAGE|BLUECHIP|EMERGING|INFRASTRUCTURE|BANKING|PHARMA|TECHNOLOGY|CONSUMPTION|MANUFACTURING|INNOVATION|BUSINESS CYCLE|CHILDREN|RETIREMENT)\b/;
// fund-house brands learned from the filings themselves ("X MUTUAL FUND", "X TRUSTEE ...") — no hand-made list
let BRANDS = [];
function learnBrands(names) {
  const set = new Set();
  for (const raw of names) {
    const n = String(raw || "").toUpperCase().replace(/[.,'"]/g, " ").replace(/\s+/g, " ").trim();
    const m = n.match(/^(.+?)\s*(?:MUTUAL FUND|TRUSTEE|ASSET MANAGEMENT)\b/);
    if (m) { const b = m[1].replace(/\b(LIMITED|LTD|COMPANY|CO|PRIVATE|PVT|INDIA)\b/g, "").replace(/\s+/g, " ").trim(); if (b.length >= 2 && b.split(" ").length <= 4) set.add(b); }
  }
  // also accept the first word of a multi-word brand ("KOTAK FLEXICAP FUND" → "KOTAK MAHINDRA") when unambiguous
  const first = new Map();
  for (const b of set) { const w = b.split(" ")[0]; if (w.length >= 3) first.set(w, first.has(w) && first.get(w) !== b ? null : b); }
  ALIAS = new Map([...first].filter(([w, b]) => b && b !== w && !set.has(w)));
  // "KOTAK" and "KOTAK MAHINDRA" are the same house: map a short brand to the only longer brand that starts with it
  for (const b of [...set]) { const longer = [...set].filter((x) => x.startsWith(b + " ")); if (longer.length === 1) { set.delete(b); ALIAS.set(b, longer[0]); } }
  BRANDS = [...set].sort((a, b) => b.length - a.length); // longest first
  return BRANDS.length;
}
let ALIAS = new Map();
function canon(name) {
  let n = String(name || "").toUpperCase().replace(/&AMP;/g, "&").replace(/\(.*?\)/g, " ").replace(/[.,'"]/g, " ").replace(/\s+/g, " ").trim();
  if (TRUSTEE_PLEDGE.test(n)) return n.split(/\s+(?:ACTING|AS|FOR)\b/)[0].replace(/\b(LIMITED|LTD)\b/g, "").trim();
  // a scheme of a fund house we've seen in the filings → that fund house
  if (/\b(FUND|SCHEME|ETF)\b/.test(n) && !FOREIGN.test(n)) {
    const b = BRANDS.find((x) => n.startsWith(x + " ")) || ALIAS.get(n.split(" ")[0]);
    if (b) return b + " MUTUAL FUND";
  }
  {
    const m0 = n.match(/^(.+?)\s*(?:TRUSTEE|MUTUAL FUND|ASSET MANAGEMENT|AMC)\b/);
    if (m0 && MF.test(n)) { const b0 = m0[1].replace(/\b(LIMITED|LTD|COMPANY|CO|PRIVATE|PVT|INDIA)\b/g, "").replace(/\s+/g, " ").trim(); if (ALIAS.has(b0)) return ALIAS.get(b0) + " MUTUAL FUND"; }
  }
  // a scheme name without the word TRUSTEE ("MOTILAL OSWAL MIDCAP FUND") → its fund house
  const sch = n.match(MF_SCHEME);
  if (sch && /\b(FUND|SCHEME)\b/.test(n) && !/MUTUAL FUND|TRUSTEE/.test(n) && sch.index > 2 && !FOREIGN.test(n) && !/\b(OPPORTUNIT|FUND-\d|AIF|PC)\b/.test(n))
    return n.slice(0, sch.index).replace(/\s*\b(INDIA|LIMITED|LTD)\s*$/, "").trim() + " MUTUAL FUND";
  // mutual fund schemes → fund house ("HDFC TRUSTEE COMPANY LIMITED-HDFC FLEXI CAP FUND" → "HDFC MUTUAL FUND")
  const mf = n.match(/^(.+?)\s*(?:TRUSTEE|MUTUAL FUND|ASSET MANAGEMENT|AMC)\b/);
  if (mf && MF.test(n)) return mf[1].replace(/\b(LIMITED|LTD|COMPANY|CO|PRIVATE|PVT)\b/g, "").replace(/\s+/g, " ").trim() + " MUTUAL FUND";
  const ac = n.match(/A\/C\s+(.+)$/); if (ac) n = ac[1];
  n = n.split(/\s+-\s+|\s*-\s*(?=[A-Z ]*(?:FUND|SCHEME|PLAN))/)[0];
  return n.replace(/\b(LIMITED|LTD|PRIVATE|PVT|THE|M\/S|MR|MRS|MS|DR|SHRI|SMT)\b/g, "").replace(/\s+/g, " ").trim();
}
function classify(name, grp) {
  const n = String(name || "").toUpperCase();
  if (TRUSTEE_PLEDGE.test(n)) return "pledge";
  if (PASSIVE.test(n)) return "passive";
  if (GOVT.test(n) || /Government/.test(grp || "")) return "government";
  if (INSURER.test(n) || /Insurance/.test(grp || "")) return "insurer";
  if (MF.test(n) || /MutualFund/.test(grp || "")) return "mutual_fund";
  if (PEVC.test(n) || /AlternativeInvestment/.test(grp || "")) return "pe_vc";
  if (/Foreign/.test(grp || "") || FOREIGN.test(n)) return "foreign_institution";
  if (/\bFUNDS?\b/.test(n)) return "pe_vc"; // any other named investment fund
  if (BROKER.test(n)) return "broker";
  if (!CORP.test(n) && /^[A-Z][A-Z ]{3,60}$/.test(n.trim()) && n.trim().split(/\s+/).length >= 2 && n.trim().split(/\s+/).length <= 5) return "individual";
  return "company";
}
const TYPE_LABEL = { individual: "Individual investor", mutual_fund: "Mutual fund", foreign_institution: "Foreign institution", pe_vc: "Fund / PE / VC / AIF", insurer: "Insurer", government: "Government / pension", company: "Company / family office", broker: "Broker / trader", passive: "Index / ETF (passive)", pledge: "Lender / trustee (pledge)", promoter: "Promoter", listed_company: "Listed company (strategic stake)" };
// how much a buy by this type says about conviction (passive funds buy mechanically; traders flip)
const TYPE_WEIGHT = { individual: 1.3, pe_vc: 1.3, mutual_fund: 1.1, foreign_institution: 1.0, insurer: 0.9, company: 0.9, government: 0.6, promoter: 1.6, listed_company: 0.6, broker: 0, passive: 0, pledge: 0 };

// ---------------------------------------------------------------- collectors
const universe = () => db.prepare("SELECT symbol FROM universe WHERE in_index=1 OR user_added=1").all().map((r) => r.symbol);
const insDeal = () => db.prepare("INSERT INTO sm_deals(id,date,symbol,name,client,ckey,side,qty,price,kind,source) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING");
function saveDeal(st, d) {
  const id = [d.date, d.symbol, d.client, d.side, d.qty, d.price, d.kind].join("|");
  return st.run(id, d.date, d.symbol, d.name, d.client, canon(d.client), d.side, d.qty, d.price, d.kind, d.source).changes;
}

async function collectDailyDeals() {
  const st = insDeal(); let n = 0;
  for (const kind of ["bulk", "block"]) {
    const url = `https://archives.nseindia.com/content/equities/${kind}.csv`;
    const rows = parseCsv(await fetchText(url, { headers: { "User-Agent": UA } }));
    for (const r of rows.slice(1)) {
      if (!r[1] || /NO RECORDS/i.test(r[0])) continue;
      const date = parseDate(r[0]); if (!date) continue;
      n += saveDeal(st, { date, symbol: r[1], name: r[2], client: r[3], side: r[4].toUpperCase(), qty: +r[5], price: +r[6], kind, source: url });
    }
  }
  return n;
}
async function backfillDealsFor(sym) {
  const st = insDeal(); let n = 0;
  const to = new Date(), from = new Date(Date.now() - 365 * DAY);
  for (const kind of ["bulk_deals", "block_deals"]) {
    const j = await nseJson(`/api/historicalOR/bulk-block-short-deals?optionType=${kind}&symbol=${encodeURIComponent(sym)}&from=${ddmmyyyy(from)}&to=${ddmmyyyy(to)}`);
    for (const x of (j && j.data) || []) {
      const date = parseDate(x.BD_DT_DATE); if (!date) continue;
      n += saveDeal(st, { date, symbol: x.BD_SYMBOL, name: x.BD_SCRIP_NAME, client: x.BD_CLIENT_NAME, side: String(x.BD_BUY_SELL).toUpperCase(), qty: +x.BD_QTY_TRD, price: +x.BD_TP_WATP, kind: kind.replace("_deals", ""), source: "https://www.nseindia.com/report-detail/display-bulk-and-block-deals" });
    }
  }
  return n;
}
async function collectSast(fromDate, toDate) {
  const j = await nseJson(`/api/corporate-sast-reg29?index=equities&from_date=${ddmmyyyy(fromDate)}&to_date=${ddmmyyyy(toDate)}`);
  const st = db.prepare(`INSERT INTO sm_sast(id,date,symbol,company,acquirer,ckey,side,mode,shares,pct_after,pct_change,promoter,attachment) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`);
  let n = 0;
  for (const x of (j && j.data) || []) {
    const side = /sale/i.test(x.acqSaleType) ? "SELL" : /acq/i.test(x.acqSaleType) ? "BUY" : "BOTH";
    const chg = side === "SELL" ? -(parseFloat(x.totSaleShare) || 0) : parseFloat(x.totAcqShare) || 0;
    const date = parseDate(x.timestamp || x.time); if (!date || !x.symbol) continue;
    n += st.run(String(x.application_no || x.symbol + x.timestamp + x.acquirerName), date, x.symbol, x.company, x.acquirerName, canon(x.acquirerName), side, x.acquisitionMode || "", side === "SELL" ? +x.noOfShareSale || 0 : +x.noOfShareAcq || 0, parseFloat(x.totAftShare) || null, chg, x.promoterType === "Y" ? 1 : 0, x.attachement || "").changes;
  }
  return n;
}

// quarterly shareholding: named holders >1% for the last N filings of a company
async function crawlShareholding(sym, depth = 4) {
  const list = await nseJson(`/api/corporate-share-holdings-master?index=equities&symbol=${encodeURIComponent(sym)}`);
  if (!Array.isArray(list)) return 0;
  const have = new Set(db.prepare("SELECT quarter FROM sm_cats WHERE symbol=?").all(sym).map((r) => r.quarter));
  const insH = db.prepare("INSERT INTO sm_holdings(symbol,quarter,published,name,ckey,pct,grp,promoter,xbrl) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(symbol,quarter,name) DO UPDATE SET pct=excluded.pct");
  const insC = db.prepare("INSERT INTO sm_cats(symbol,quarter,published,json,xbrl) VALUES(?,?,?,?,?) ON CONFLICT(symbol,quarter) DO NOTHING");
  let n = 0;
  for (const q of list.slice(0, depth)) {
    const quarter = parseDate(q.date); if (!quarter || have.has(quarter) || !q.xbrl) continue;
    // revised filings carry a later broadcast date; use the earliest date the data was public
    const cands = [parseDate(q.submissionDate), parseDate(q.broadcastDate)].filter(Boolean).sort();
    let published = cands[0] || quarter;
    if (Date.parse(published) - Date.parse(quarter) > 75 * DAY) published = new Date(Date.parse(quarter) + 21 * DAY).toISOString().slice(0, 10); // approx original filing (due within 21 days)
    let parsed;
    try { await sleep(400); parsed = parseShp(await fetchText(q.xbrl, { headers: { "User-Agent": UA }, timeout: 40000, retries: 1 })); } catch { continue; }
    db.exec("BEGIN");
    try {
      for (const h of parsed.holders) insH.run(sym, quarter, published, h.name, canon(h.name), h.pct, h.group, h.promoter ? 1 : 0, q.xbrl);
      insC.run(sym, quarter, published, JSON.stringify(parsed.cats), q.xbrl);
      db.exec("COMMIT"); n++;
    } catch (e) { db.exec("ROLLBACK"); throw e; }
  }
  return n;
}

async function fetchBenchmark() {
  const j = JSON.parse(await fetchText("https://query1.finance.yahoo.com/v8/finance/chart/%5ECRSLDX?range=10y&interval=1wk"));
  const r = j.chart.result[0], st = db.prepare("INSERT INTO sm_bench(date,close) VALUES(?,?) ON CONFLICT(date) DO UPDATE SET close=excluded.close");
  db.exec("BEGIN"); r.timestamp.forEach((t, i) => { const c = r.indicators.quote[0].close[i]; if (c != null) st.run(new Date(t * 1000).toISOString().slice(0, 10), c); }); db.exec("COMMIT");
  return r.timestamp.length;
}

// ---------------------------------------------------------------- crawl orchestration (rolling, polite)
async function crawlTick({ maxSymbols = 30, onProgress } = {}) {
  const syms = universe();
  const out = { shp: 0, deals: 0, sast: 0, daily: 0 };
  // 1) daily files + recent SAST (cheap)
  if (Date.now() - Date.parse(kvGet("sm_daily_at") || 0) > 6 * 3600e3) {
    try { out.daily = await collectDailyDeals(); } catch (e) { out.dailyErr = e.message; }
    try { out.sast += await collectSast(new Date(Date.now() - 10 * DAY), new Date()); } catch (e) { out.sastErr = e.message; }
    try { await fetchBenchmark(); } catch { /* ignore */ }
    kvSet("sm_daily_at", now());
  }
  // 2) one-time SAST backfill, 1 year in 15-day windows
  const sb = kvGet("sm_sast_backfill") || { done: 0 };
  if (sb.done < 24) {
    for (let i = sb.done; i < Math.min(24, sb.done + 6); i++) {
      const to = new Date(Date.now() - i * 15 * DAY), from = new Date(to.getTime() - 15 * DAY);
      try { out.sast += await collectSast(from, to); sb.done = i + 1; } catch (e) { out.sastErr = e.message; break; }
    }
    kvSet("sm_sast_backfill", sb);
  }
  // 3) rolling per-company work: shareholding (refresh after ~80 days) and 1-year deal history (once, then every 30 days)
  const done = Object.fromEntries(db.prepare("SELECT symbol||'|'||what k, done_at FROM sm_crawl").all().map((r) => [r.k, r.done_at]));
  const due = syms.map((s) => ({ s, shp: done[s + "|shp"], deals: done[s + "|deals"] }))
    .filter((x) => !x.shp || Date.now() - Date.parse(x.shp) > 30 * DAY || !x.deals || Date.now() - Date.parse(x.deals) > 30 * DAY)
    .sort((a, b) => String(a.shp || "").localeCompare(String(b.shp || ""))).slice(0, maxSymbols);
  const mark = db.prepare("INSERT INTO sm_crawl(symbol,what,done_at,note) VALUES(?,?,?,?) ON CONFLICT(symbol,what) DO UPDATE SET done_at=excluded.done_at, note=excluded.note");
  let k = 0;
  for (const x of due) {
    if (onProgress) onProgress(k++, due.length, x.s);
    if (!x.shp || Date.now() - Date.parse(x.shp) > 30 * DAY) { try { out.shp += await crawlShareholding(x.s); mark.run(x.s, "shp", now(), ""); } catch (e) { mark.run(x.s, "shp", new Date(Date.now() - 29 * DAY).toISOString(), "error: " + e.message); } }
    if (!x.deals || Date.now() - Date.parse(x.deals) > 30 * DAY) { try { out.deals += await backfillDealsFor(x.s); mark.run(x.s, "deals", now(), ""); } catch (e) { mark.run(x.s, "deals", new Date(Date.now() - 29 * DAY).toISOString(), "error: " + e.message); } }
  }
  out.symbols = due.length;
  return out;
}
function coverage() {
  const syms = universe().length;
  const c = (w) => db.prepare("SELECT COUNT(*) n FROM sm_crawl WHERE what=? AND (note IS NULL OR note='')").get(w).n;
  const range = (t) => db.prepare(`SELECT MIN(date) a, MAX(date) b, COUNT(*) n FROM ${t}`).get();
  return { universe: syms, shareholding: c("shp"), dealHistory: c("deals"), deals: range("sm_deals"), sast: range("sm_sast"), holdings: db.prepare("SELECT COUNT(*) n, COUNT(DISTINCT ckey) i, COUNT(DISTINCT quarter) q FROM sm_holdings").get(), sastBackfill: (kvGet("sm_sast_backfill") || { done: 0 }).done / 24, dailyAt: kvGet("sm_daily_at") };
}

// recompute investor keys for everything stored (after the brand list or rules improve)
function rekey() {
  learnBrands([...db.prepare("SELECT DISTINCT name FROM sm_holdings").all().map((r) => r.name), ...db.prepare("SELECT DISTINCT acquirer name FROM sm_sast").all().map((r) => r.name)]);
  let n = 0;
  db.exec("BEGIN");
  try {
    for (const [t, col] of [["sm_holdings", "name"], ["sm_sast", "acquirer"], ["sm_deals", "client"]]) {
      const up = db.prepare("UPDATE " + t + " SET ckey=? WHERE " + col + "=? AND ckey<>?");
      for (const r of db.prepare("SELECT DISTINCT " + col + " v FROM " + t).all()) n += up.run(canon(r.v), r.v, canon(r.v)).changes;
    }
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }
  return { brands: BRANDS.length, rekeyed: n };
}

module.exports = { rekey, learnBrands, canon, classify, TYPE_LABEL, TYPE_WEIGHT, parseDate, collectDailyDeals, backfillDealsFor, collectSast, crawlShareholding, fetchBenchmark, crawlTick, coverage, universe };
