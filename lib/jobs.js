"use strict";
const path = require("path");
const { db, now, getSettings, kvGet, kvSet, logStart, logEnd, addAlert, DATA_DIR } = require("./db");
const S = require("./sources");
const A = require("./analysis");
const B = require("./beginner");

// ---------- serial job queue (one job at a time, progress visible in UI) ----------
let running = null;
const queue = [];
function progress(job, done, total, note) { kvSet("progress", { job, done, total, note: note || "", at: now() }); }
function runJob(name, fn) {
  return new Promise((resolve, reject) => {
    if (running === name || queue.some((q) => q.name === name)) return resolve({ skipped: "already queued" });
    queue.push({ name, fn, resolve, reject });
    pump();
  });
}
async function pump() {
  if (running || !queue.length) return;
  const { name, fn, resolve, reject } = queue.shift();
  running = name;
  const id = logStart(name);
  try { const r = await fn(); logEnd(id, "ok", typeof r === "string" ? r : JSON.stringify(r || {})); resolve(r); }
  catch (e) { logEnd(id, "error", e.message); reject(e); }
  finally { running = null; try { kvSet("progress", null); } catch { /* ignore */ } setTimeout(pump, 0); }
}
const status = () => ({ running, queued: queue.map((q) => q.name), progress: kvGet("progress") });

// ---------- inflation ----------
function inflation() {
  const s = getSettings();
  if (s.inflationOverride !== "" && isFinite(parseFloat(s.inflationOverride))) return { value: parseFloat(s.inflationOverride) / 100, basis: "Your override in Settings" };
  const cpi = kvGet("cpi");
  if (cpi && cpi.series && cpi.series.length >= 3) {
    const last5 = cpi.series.slice(-5);
    const v = last5.reduce((a, r) => a + r.value, 0) / last5.length / 100;
    return { value: v, basis: `Average of India CPI inflation ${last5[0].year}–${last5[last5.length - 1].year} (${last5.map((r) => r.value.toFixed(1)).join(", ")}%)`, source: cpi.source, sourceName: cpi.sourceName };
  }
  return { value: 0.05, basis: "Fallback 5% (CPI not fetched yet)" };
}

// ---------- refresh jobs ----------
async function refreshUniverse() {
  const list = await S.getNifty500();
  const up = db.prepare(`INSERT INTO universe(symbol,name,industry,isin,in_index,added_at) VALUES(?,?,?,?,1,?)
    ON CONFLICT(symbol) DO UPDATE SET name=excluded.name, industry=excluded.industry, isin=excluded.isin, in_index=1`);
  db.exec("UPDATE universe SET in_index=0");
  for (const x of list) up.run(x.symbol, x.name, x.industry, x.isin, now());
  kvSet("universe_meta", { count: list.length, source: S.SRC.nifty500, at: now() });
  return `Nifty 500 universe: ${list.length} companies`;
}

async function refreshCpi() {
  const c = await S.getCpi();
  kvSet("cpi", { ...c, at: now() });
  return `CPI series ${c.series.length} years, latest ${c.series.at(-1).year}: ${c.series.at(-1).value.toFixed(2)}%`;
}

async function refreshAmfi() {
  const { schemes, source } = await S.getAmfiNav();
  const up = db.prepare(`INSERT INTO mf_schemes(code,name,amc,category,nav,nav_date) VALUES(?,?,?,?,?,?)
    ON CONFLICT(code) DO UPDATE SET name=excluded.name, amc=excluded.amc, category=excluded.category, nav=excluded.nav, nav_date=excluded.nav_date`);
  db.exec("BEGIN");
  try { for (const x of schemes) up.run(x.code, x.name, x.amc, x.category, x.nav, x.nav_date); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; }
  kvSet("amfi_meta", { count: schemes.length, source, at: now() });
  // alert: held funds lagging inflation
  return `AMFI: ${schemes.length} schemes`;
}

async function fetchStock(symbol, { prices = true, fundamentals = true } = {}) {
  if (prices) {
    try {
      const p = await S.getPriceSeries(symbol);
      db.prepare(`INSERT INTO prices(symbol,price,currency,json,fetched_at,error) VALUES(?,?,?,?,?,NULL)
        ON CONFLICT(symbol) DO UPDATE SET price=excluded.price, currency=excluded.currency, json=excluded.json, fetched_at=excluded.fetched_at, error=NULL`)
        .run(symbol, p.price, p.currency, JSON.stringify(p), now());
    } catch (e) {
      db.prepare(`INSERT INTO prices(symbol,fetched_at,error) VALUES(?,?,?) ON CONFLICT(symbol) DO UPDATE SET fetched_at=excluded.fetched_at, error=excluded.error`).run(symbol, now(), e.message);
    }
  }
  if (fundamentals) {
    try {
      const f = await S.getFundamentals(symbol);
      db.prepare(`INSERT INTO fundamentals(symbol,json,fetched_at,error) VALUES(?,?,?,NULL)
        ON CONFLICT(symbol) DO UPDATE SET json=excluded.json, fetched_at=excluded.fetched_at, error=NULL`).run(symbol, JSON.stringify(f), now());
    } catch (e) {
      db.prepare(`INSERT INTO fundamentals(symbol,fetched_at,error) VALUES(?,?,?) ON CONFLICT(symbol) DO UPDATE SET fetched_at=excluded.fetched_at, error=excluded.error`).run(symbol, now(), e.message);
    }
  }
}

async function refreshStocks({ mode = "auto", limit = 0 } = {}) {
  // mode: prices | fundamentals | auto (prices for all, fundamentals for the stalest)
  const syms = db.prepare(`SELECT u.symbol, f.fetched_at AS ff, f.json IS NULL AS nofund FROM universe u LEFT JOIN fundamentals f USING(symbol)
    WHERE u.in_index=1 OR u.user_added=1 OR u.symbol IN (SELECT symbol FROM watchlist) OR u.symbol IN (SELECT ref FROM portfolio WHERE kind='stock')
    ORDER BY nofund DESC, ff ASC`).all();
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
  let list = syms;
  if (limit) list = list.slice(0, limit);
  let n = 0;
  for (const r of list) {
    const needFund = mode === "fundamentals" || (mode === "auto" && (r.nofund || !r.ff || r.ff < weekAgo));
    progress("stocks", n, list.length, r.symbol);
    await fetchStock(r.symbol, { prices: mode !== "fundamentals", fundamentals: needFund });
    n++;
    if (n % 25 === 0) recomputeAnalysis({ quiet: true });
  }
  const r = recomputeAnalysis();
  return `Updated ${n} stocks (${mode}); analysed ${r.analysed}`;
}

async function refreshNews() {
  const names = buildNameMatchers();
  const ins = db.prepare(`INSERT INTO news(id,title,link,source,feed_kind,published,summary,symbols,fetched_at) VALUES(?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO NOTHING`);
  let added = 0, errors = [];
  for (const f of S.FEEDS) {
    try {
      const items = await S.getFeed(f);
      for (const it of items) {
        const id = it.link.replace(/[?#].*$/, "");
        const syms = matchSymbols(it.title + " " + (it.summary || "").slice(0, 200), names);
        const r = ins.run(id, it.title, it.link, f.name, f.kind, it.published || now(), it.summary, syms.join(","), now());
        if (r.changes) {
          added++;
          for (const s of syms) {
            const watched = db.prepare("SELECT 1 FROM watchlist WHERE symbol=? UNION SELECT 1 FROM portfolio WHERE kind='stock' AND ref=?").get(s, s);
            if (watched) addAlert({ kind: "news", symbol: s, severity: "info", title: `News: ${s}`, detail: it.title + " — " + f.name + " " + it.link, dedupe: "news|" + id + "|" + s });
          }
        }
      }
    } catch (e) { errors.push(f.name + ": " + e.message); }
  }
  db.prepare("DELETE FROM news WHERE published < ?").run(new Date(Date.now() - 120 * 864e5).toISOString());
  return `News: +${added} items` + (errors.length ? `; feed errors: ${errors.join(" | ")}` : "");
}

const STOP = new Set(["IPO", "GST", "RBI", "SEBI", "NSE", "BSE", "FII", "FIIS", "DII", "DIIS", "USA", "CEO", "CFO", "GDP", "EV", "AI", "IT", "US", "UK", "THE", "NEW", "FPI", "FPIS", "MSCI", "ETF", "SIP", "NAV", "EMI", "LIC", "PSU", "Q1", "Q2", "Q3", "Q4", "FY", "EBITDA", "PAT", "YOY", "QOQ", "NCLT", "CCI", "MCA", "ITC"]);
function buildNameMatchers() {
  const rows = db.prepare("SELECT symbol, name FROM universe").all();
  return rows.map((r) => {
    const short = r.name.replace(/\b(limited|ltd\.?|india|\(india\)|& co\.?|co\.?|corporation|corp\.?|company)\b/gi, "").replace(/[.,()]/g, " ").replace(/\s+/g, " ").trim();
    const nameRe = short.length >= 5 ? new RegExp("\\b" + short.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+") + "\\b", "i") : null;
    const symRe = /^[A-Z][A-Z&]{2,}$/.test(r.symbol) && !STOP.has(r.symbol) ? new RegExp("\\b" + r.symbol.replace(/&/g, "\\&") + "\\b") : null;
    return { symbol: r.symbol, nameRe, symRe };
  });
}
function matchSymbols(text, matchers) {
  const out = [];
  for (const m of matchers) if ((m.nameRe && m.nameRe.test(text)) || (m.symRe && m.symRe.test(text))) out.push(m.symbol);
  return out.slice(0, 6);
}

// ---------- analysis ----------
function loadInputs() {
  return db.prepare(`SELECT u.symbol, u.name, u.industry, u.in_index, u.user_added, f.json AS fj, p.json AS pj, p.price, a.json AS aj, s.json AS uj
    FROM universe u LEFT JOIN fundamentals f USING(symbol) LEFT JOIN prices p USING(symbol) LEFT JOIN analysis a USING(symbol) LEFT JOIN assumptions s USING(symbol)
    WHERE u.in_index=1 OR u.user_added=1`).all();
}

function recomputeAnalysis({ quiet = false } = {}) {
  const infl = inflation().value;
  const rows = loadInputs();
  const items = rows.map((r) => {
    const f = r.fj ? JSON.parse(r.fj) : null, p = r.pj ? JSON.parse(r.pj) : null;
    const m = A.computeMetrics({ years: f && f.years, price: r.price, series: p && p.series, industry: r.industry });
    return { symbol: r.symbol, name: r.name, industry: r.industry, m, flags: A.redFlags(m), prev: r.aj ? JSON.parse(r.aj) : null, userA: r.uj ? JSON.parse(r.uj) : null, sources: { fundamentals: f && f.source, page: f && f.page, prices: p && p.source, priceAsOf: p && p.asOf } };
  });
  const ctx = A.scoreUniverse(items);
  const up = db.prepare(`INSERT INTO analysis(symbol,json,label,composite,computed_at) VALUES(?,?,?,?,?)
    ON CONFLICT(symbol) DO UPDATE SET json=excluded.json, label=excluded.label, composite=excluded.composite, computed_at=excluded.computed_at`);
  const watched = new Set(db.prepare("SELECT symbol FROM watchlist UNION SELECT ref FROM portfolio WHERE kind='stock'").all().map((x) => x.symbol));
  let analysed = 0;
  db.exec("BEGIN");
  try {
    for (const it of items) {
      const defA = A.defaultAssumptions(it.m, it.peerPe, it.industry);
      const assumptions = defA && it.userA ? { ...defA, ...it.userA, derivedFrom: defA.derivedFrom, eps0: defA.eps0, normalised: defA.normalised, overridden: true } : defA;
      const scen = A.scenarioReturns(it.m, assumptions, infl);
      const tags = A.tags(it.m, it.score);
      const lab = A.label({ m: it.m, score: it.score, flags: it.flags, scen });
      const rec = { symbol: it.symbol, name: it.name, industry: it.industry, metrics: it.m, flags: it.flags, score: it.score, peerPe: it.peerPe, assumptions, defaultAssumptions: defA, scenarios: scen, inflation: infl, tags, label: lab.label, reasons: lab.reasons, sources: it.sources };
      try { const v = B.verdict(rec, getSettings()); rec.action = { code: v.code, title: v.title, buyBelow: v.buyBelow, gap: v.gap, tone: v.tone }; } catch { /* keep going */ }
      up.run(it.symbol, JSON.stringify(rec), lab.label, it.score && it.score.composite, now());
      if (!it.m.insufficient) analysed++;
      if (!quiet && it.prev && it.prev.label !== lab.label && !it.m.insufficient) {
        const important = watched.has(it.symbol) || lab.label === "buy" || (it.prev.label === "buy");
        if (important) addAlert({ kind: "label", symbol: it.symbol, severity: lab.label === "avoid" ? "warn" : "info", title: `${it.symbol}: ${it.prev.label} → ${lab.label}`, detail: lab.reasons.join(" "), dedupe: `label|${it.symbol}|${it.prev.label}|${lab.label}|${now().slice(0, 10)}` });
      }
      if (!quiet && watched.has(it.symbol)) {
        const prevCodes = new Set(((it.prev && it.prev.flags) || []).map((f) => f.code));
        for (const f of it.flags) if (f.severity === "critical" && !prevCodes.has(f.code)) addAlert({ kind: "flag", symbol: it.symbol, severity: "critical", title: `${it.symbol}: new red flag`, detail: f.text, dedupe: `flag|${it.symbol}|${f.code}|${it.m.latestFy}` });
        const p = it.m;
        const series = it.sources && rows.find((r) => r.symbol === it.symbol);
        const pj = series && series.pj ? JSON.parse(series.pj).series : null;
        if (pj && pj.length > 5) {
          const chg = pj[pj.length - 1][1] / pj[pj.length - 5][1] - 1;
          if (chg < -0.1) addAlert({ kind: "price", symbol: it.symbol, severity: "warn", title: `${it.symbol} down ${(-chg * 100).toFixed(0)}% in ~4 weeks`, detail: `Price ₹${p.price}. Check news and whether the thesis changed.`, dedupe: `price|${it.symbol}|${pj[pj.length - 1][0]}` });
        }
      }
    }
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }
  kvSet("analysis_meta", { at: now(), analysed, total: items.length, uniMedPe: ctx.uniMedPe, inflation: infl });
  return { analysed, total: items.length };
}

// ---------- add any NSE stock outside the Nifty 500 ----------
async function addSymbol(symbol) {
  symbol = String(symbol || "").trim().toUpperCase().replace(/\.NS$/, "");
  if (!/^[A-Z0-9&-]{1,20}$/.test(symbol)) throw new Error("Invalid NSE symbol");
  let row = db.prepare("SELECT * FROM universe WHERE symbol=?").get(symbol);
  if (!row) {
    let list = kvGet("nse_equity");
    if (!list || !list.at || Date.now() - Date.parse(list.at) > 7 * 864e5) { list = { items: await S.getNseEquityList(), at: now() }; kvSet("nse_equity", list); }
    const hit = list.items.find((x) => x.symbol === symbol);
    if (!hit) throw new Error(symbol + " is not in NSE's equity (EQ series) list");
    db.prepare("INSERT INTO universe(symbol,name,industry,isin,in_index,user_added,added_at) VALUES(?,?,?,?,0,1,?)").run(symbol, hit.name, "Unclassified (outside Nifty 500)", hit.isin, now());
  } else db.prepare("UPDATE universe SET user_added=1 WHERE symbol=?").run(symbol);
  await fetchStock(symbol);
  recomputeAnalysis({ quiet: true });
  return symbol;
}

// ---------- scheduler ----------
function lastOk(job) { const r = db.prepare("SELECT finished_at FROM fetch_log WHERE job=? AND status='ok' ORDER BY id DESC LIMIT 1").get(job); return r ? Date.parse(r.finished_at) : 0; }
const H = 3600e3;
async function tick() {
  if (getSettings().autoRefresh !== "1") return;
  const t = Date.now();
  const due = [];
  if (t - lastOk("universe") > 30 * 24 * H) due.push(["universe", refreshUniverse]);
  if (t - lastOk("cpi") > 20 * 24 * H) due.push(["cpi", refreshCpi]);
  if (t - lastOk("amfi") > 20 * H) due.push(["amfi", refreshAmfi]);
  if (t - lastOk("news") > 2 * H) due.push(["news", refreshNews]);
  if (t - lastOk("stocks") > 20 * H) due.push(["stocks", () => refreshStocks({ mode: "auto" })]);
  if (t - lastOk("smartmoney") > 1 * H) due.push(["smartmoney", refreshSmartMoney]);
  if (t - lastOk("backup") > 20 * H) due.push(["backup", async () => backupDb()]);
  for (const [n, fn] of due) runJob(n, fn).catch((e) => console.error("[job]", n, e.message));
}
function startScheduler() {
  setTimeout(tick, 3000);
  setInterval(tick, 15 * 60e3);
}

// ---------- smart money: rolling crawl → signals → load fundamentals for strong outside-universe signals ----------
async function refreshSmartMoney() {
  const SM = require("./smartmoney"), G = require("./smartsignals");
  const r = await SM.crawlTick({ maxSymbols: 40, onProgress: (d, t, s) => progress("smartmoney", d, t, s) });
  let s = G.buildSignals(), added = [];
  if (Date.now() - Date.parse(kvGet("sm_autoadd_at") || 0) > 20 * H) {
    for (const sym of G.addCandidates(15)) { try { progress("smartmoney", added.length, 15, "loading " + sym); await addSymbol(sym); added.push(sym); } catch { /* not on NSE EQ list etc. */ } }
    kvSet("sm_autoadd_at", now());
    if (added.length) { recomputeAnalysis({ quiet: true }); s = G.buildSignals(); }
  }
  for (const a of G.radar().filter((x) => x.label === "Investigate" && Date.now() - Date.parse(x.lastDate) < 7 * 864e5).slice(0, 5))
    addAlert({ kind: "smartmoney", symbol: a.symbol, severity: "info", title: `Smart money: ${a.symbol} worth investigating`, detail: a.reasons.join(" "), dedupe: `sm|${a.symbol}|${a.lastDate}` });
  return `Crawled ${r.symbols} companies (+${r.shp} shareholding quarters, +${r.deals} historical deals, +${r.sast} SAST, +${r.daily} today's deals); ${s.signals} signals; ${s.traders} traders filtered${added.length ? "; loaded " + added.join(", ") : ""}`;
}

// ---------- daily backup: a consistent snapshot of the live database into OneDrive ----------
// VACUUM INTO writes a complete, self-contained copy even while the app is using the database,
// so OneDrive only ever syncs a finished file. The last 14 copies are kept.
function backupDb(dir = path.join(__dirname, "..", "backups"), keep = 14) {
  const fsx = require("fs");
  fsx.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const file = path.join(dir, "research-" + stamp + ".db"), tmp = file + ".part";
  try { fsx.unlinkSync(tmp); } catch { /* none */ }
  db.exec("VACUUM INTO '" + tmp.replace(/'/g, "''") + "'");
  fsx.renameSync(tmp, file);
  const old = fsx.readdirSync(dir).filter((f) => /^research-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort().reverse().slice(keep);
  for (const f of old) fsx.unlinkSync(path.join(dir, f));
  return "Backed up the database to " + file + " (live copy stays in " + DATA_DIR + ")";
}

module.exports = { backupDb, refreshSmartMoney, runJob, status, inflation, refreshUniverse, refreshCpi, refreshAmfi, refreshStocks, refreshNews, recomputeAnalysis, addSymbol, fetchStock, startScheduler, matchSymbols, buildNameMatchers };
