"use strict";
// Personal investment research dashboard — local server.
// Run:  node server.js   then open http://127.0.0.1:8095
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { db, now, getSettings, setSetting, kvGet } = require("./lib/db");
const J = require("./lib/jobs");
const A = require("./lib/analysis");
const S = require("./lib/sources");
const AI = require("./lib/ai");
const P = require("./lib/profile");
const B = require("./lib/beginner");

const PORT = +process.env.PORT || 8095;
const PUB = path.join(__dirname, "public");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".ico": "image/x-icon" };

const send = (res, code, obj) => { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); res.end(JSON.stringify(obj)); };
const readBody = (req) => new Promise((resolve, reject) => { let b = ""; req.on("data", (c) => { b += c; if (b.length > 2e6) req.destroy(); }); req.on("end", () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { reject(new Error("Bad JSON body")); } }); });
const parseJ = (s) => (s ? JSON.parse(s) : null);

// ---------- helpers ----------
function allAnalysis() { return db.prepare("SELECT json FROM analysis").all().map((r) => JSON.parse(r.json)); }
function oneAnalysis(sym) { const r = db.prepare("SELECT json FROM analysis WHERE symbol=?").get(sym); return r ? JSON.parse(r.json) : null; }
function slim(a) {
  const m = a.metrics || {};
  return {
    symbol: a.symbol, name: a.name, industry: a.industry, label: a.label, tags: a.tags, flags: (a.flags || []).filter((f) => f.severity !== "info").length,
    critical: (a.flags || []).filter((f) => f.severity === "critical").length,
    composite: a.score && a.score.composite, q: a.score && a.score.groups.quality && a.score.groups.quality.score,
    g: a.score && a.score.groups.growth && a.score.groups.growth.score, v: a.score && a.score.groups.value && a.score.groups.value.score,
    s: a.score && a.score.groups.safety && a.score.groups.safety.score,
    price: m.price, mcapCr: m.mcap ? m.mcap / A.CR : null, pe: m.pe, roe: m.roe, roce: m.roce, revCagr: m.revCagr, niCagr: m.niCagr, de: m.de, divYield: m.divYield,
    baseReal: a.scenarios && a.scenarios.base.real, bearReal: a.scenarios && a.scenarios.bear.real, bullReal: a.scenarios && a.scenarios.bull.real,
    ret1y: m.ret1y, insufficient: !!m.insufficient, reason: (a.reasons || [])[0] || "", action: a.action || null,
  };
}

// ---------- portfolio ----------
function portfolioView() {
  const rows = db.prepare("SELECT * FROM portfolio ORDER BY kind, name").all();
  const infl = J.inflation().value;
  const out = [];
  for (const r of rows) {
    let cur = null, expReal = null, basis = "", sector = null, label = null, priceAsOf = null;
    if (r.kind === "stock") {
      const a = oneAnalysis(r.ref);
      const p = db.prepare("SELECT price, json FROM prices WHERE symbol=?").get(r.ref);
      if (p && p.price) { cur = p.price * r.qty; priceAsOf = parseJ(p.json).asOf; }
      if (a) { sector = a.industry; label = a.label; if (a.scenarios) { expReal = a.scenarios.base.real; basis = "Base-case 5-yr scenario"; } }
    } else if (r.kind === "mf") {
      const s = db.prepare("SELECT * FROM mf_schemes WHERE code=?").get(r.ref);
      if (s) { cur = s.nav * r.qty; priceAsOf = s.nav_date; sector = "MF: " + (s.category || "").replace(/^.*?-\s*/, ""); }
      const h = db.prepare("SELECT json FROM mf_history WHERE code=?").get(r.ref);
      if (h) { const st = A.mfStats(parseJ(h.json).data, infl); if (st) { expReal = st.real5 != null ? st.real5 : st.real3; basis = "Historical " + (st.real5 != null ? "5" : "3") + "-yr real CAGR (not a forecast)"; } }
    } else {
      cur = r.value; sector = r.kind === "cash" ? "Cash / FD" : r.kind === "gold" ? "Gold" : "Other";
      if (r.notes && /@\s*([\d.]+)\s*%/.test(r.notes)) { const rate = parseFloat(r.notes.match(/@\s*([\d.]+)\s*%/)[1]) / 100; expReal = (1 + rate) / (1 + infl) - 1; basis = "Stated rate in notes"; }
    }
    const invested = r.kind === "stock" || r.kind === "mf" ? r.qty * r.cost : (r.cost || r.value);
    out.push({ ...r, current: cur, invested, gain: cur != null && invested ? cur / invested - 1 : null, expReal, basis, sector, label, priceAsOf });
  }
  const total = out.reduce((s, x) => s + (x.current || 0), 0);
  const bySector = {}, byKind = {};
  for (const x of out) { if (!x.current) continue; bySector[x.sector || "Unknown"] = (bySector[x.sector || "Unknown"] || 0) + x.current; byKind[x.kind] = (byKind[x.kind] || 0) + x.current; }
  const withExp = out.filter((x) => x.current && x.expReal != null);
  const expW = withExp.reduce((s, x) => s + x.current, 0);
  const expReal = expW ? withExp.reduce((s, x) => s + x.expReal * x.current, 0) / expW : null;
  const warnings = [];
  for (const [k, v] of Object.entries(bySector)) if (total && v / total > 0.25 && !/^MF:|^Cash|^Gold|^Other/.test(k)) warnings.push(`${k} is ${(v / total * 100).toFixed(0)}% of the portfolio — concentration risk.`);
  const cashShare = total ? (byKind.cash || 0) / total : 0;
  if (cashShare > 0.3) warnings.push(`${(cashShare * 100).toFixed(0)}% is in cash/FDs, which typically earn only ~1–2% above inflation before tax. Fine for an emergency fund or near-term needs; for a 5–10 year goal it drags the overall return.`);
  for (const x of out) if (total && x.current / total > 0.15 && x.kind === "stock") warnings.push(`${x.ref} alone is ${(x.current / total * 100).toFixed(0)}% of the portfolio.`);
  for (const x of out) if (x.label === "avoid") warnings.push(`${x.ref} is currently screened "avoid" — review the reasons.`);
  if (expReal != null && expReal < 0.02) warnings.push(`Estimated real return ${(expReal * 100).toFixed(1)}%/yr is close to or below inflation.`);
  return { holdings: out, total, bySector, byKind, expReal, expCoverage: total ? expW / total : 0, inflation: infl, warnings };
}

function fitFor(a, pv) {
  if (!pv.total) return { text: "Add your holdings in Portfolio to see how this fits.", kind: "neutral" };
  if (pv.holdings.some((h) => h.kind === "stock" && h.ref === a.symbol)) return { text: "Already held.", kind: "held" };
  const share = (pv.bySector[a.industry] || 0) / pv.total;
  if (share > 0.25) return { text: `Adds to ${a.industry}, already ${(share * 100).toFixed(0)}% of your portfolio — increases concentration.`, kind: "concentrates" };
  if (share === 0) return { text: `New sector for you (${a.industry}) — adds diversification.`, kind: "diversifies" };
  return { text: `${a.industry} is ${(share * 100).toFixed(0)}% of your portfolio — moderate addition.`, kind: "neutral" };
}

// ---------- mutual funds ----------
async function mfHistory(code, maxAgeH = 20) {
  const r = db.prepare("SELECT json, fetched_at FROM mf_history WHERE code=?").get(code);
  if (r && Date.now() - Date.parse(r.fetched_at) < maxAgeH * 3600e3) return parseJ(r.json);
  const h = await S.getMfHistory(code);
  db.prepare("INSERT INTO mf_history(code,json,fetched_at) VALUES(?,?,?) ON CONFLICT(code) DO UPDATE SET json=excluded.json, fetched_at=excluded.fetched_at").run(code, JSON.stringify(h), now());
  return h;
}
async function mfAnalyse(code) {
  const s = db.prepare("SELECT * FROM mf_schemes WHERE code=?").get(code);
  const h = await mfHistory(code);
  const infl = J.inflation().value;
  const st = A.mfStats(h.data, infl);
  const step = Math.max(1, Math.floor(h.data.length / 260));
  return { scheme: s || { code, name: h.meta && h.meta.scheme_name }, meta: h.meta, stats: st, inflation: infl, chart: h.data.filter((_, i) => i % step === 0 || i === h.data.length - 1), sources: [{ name: "AMFI daily NAV", url: S.SRC.amfi }, { name: "mfapi.in NAV history (mirrors AMFI)", url: h.source }] };
}
async function mfCategoryRank(category) {
  const list = db.prepare("SELECT * FROM mf_schemes WHERE category=? AND name LIKE '%Direct%' AND name LIKE '%Growth%' AND name NOT LIKE '%IDCW%'").all(category);
  const infl = J.inflation().value;
  const out = [];
  for (const s of list.slice(0, 80)) {
    try { const h = await mfHistory(s.code, 72); const st = A.mfStats(h.data, infl); if (st) out.push({ code: s.code, name: s.name, amc: s.amc, nav: s.nav, ...st }); } catch { /* skip */ }
  }
  // consistency-weighted rank: 5y CAGR (or 3y) + rolling-3y median + % rolling periods beating inflation − drawdown
  const key = (x) => (x.cagr5 != null ? x.cagr5 : x.cagr3 != null ? x.cagr3 - 0.03 : -1) * 0.45 + (x.rolling3y ? x.rolling3y.median : 0) * 0.35 + (x.rolling3y ? x.rolling3y.beatInflationPct * 0.05 : 0) + (x.maxDrawdown5y || 0) * 0.1;
  out.forEach((x) => (x.rankScore = key(x)));
  out.sort((a, b) => b.rankScore - a.rankScore);
  return { category, count: list.length, analysed: out.length, funds: out, note: list.length > 80 ? "Only the first 80 schemes were analysed." : "" };
}

// ---------- VC / startup tracker ----------
function vcView(days = 120) {
  const since = new Date(Date.now() - days * 864e5).toISOString();
  const rows = db.prepare("SELECT * FROM news WHERE feed_kind='startup' AND published >= ? ORDER BY published DESC").all(since);
  const parsed = [], seen = new Map();
  for (const r of rows) {
    const p = A.parseFunding(r.title);
    if (!p) continue;
    // the same round is reported by several outlets: dedupe on company + rounded size
    const first = (p.company.split(/[\s’'(]/)[0] || p.company).toLowerCase().replace(/[^a-z0-9]/g, "");
    const k = first + "|" + (p.usdMn ? Math.round(p.usdMn) : p.company.toLowerCase());
    if (seen.has(k)) {
      const prev = seen.get(k);
      prev.also = (prev.also || []).concat({ source: r.source, link: r.link });
      if (prev.sector === "Other" && p.sector !== "Other") prev.sector = p.sector;
      if (prev.kind === "round" && p.kind !== "round") { prev.kind = p.kind; prev.company = p.company; }
      if (!prev.stage && p.stage) prev.stage = p.stage;
      if (!prev.leadInvestor && p.leadInvestor) prev.leadInvestor = p.leadInvestor;
      continue;
    }
    const d = { ...p, title: r.title, link: r.link, source: r.source, published: r.published };
    seen.set(k, d); parsed.push(d);
  }
  const deals = parsed.filter((d) => d.kind === "round");
  const ipos = parsed.filter((d) => d.kind === "ipo");
  const funds = parsed.filter((d) => d.kind === "fund");
  const sectors = {};
  for (const d of deals) { const s = (sectors[d.sector] = sectors[d.sector] || { sector: d.sector, deals: 0, usdMn: 0, undisclosed: 0, recent30: 0 }); s.deals++; if (d.usdMn) s.usdMn += d.usdMn; else s.undisclosed++; if (Date.now() - Date.parse(d.published) < 30 * 864e5) s.recent30++; }
  const investors = {};
  for (const d of deals) if (d.leadInvestor) for (const inv of d.leadInvestor.split(/\s+and\s+|,\s*/)) { const n = inv.trim().replace(/^(?:existing investors|others|group|family offices?)$/i, ""); if (n.length > 2) investors[n] = (investors[n] || 0) + 1; }
  return { days, deals, ipos, funds, sectors: Object.values(sectors).sort((a, b) => b.usdMn - a.usdMn), investors: Object.entries(investors).sort((a, b) => b[1] - a[1]).slice(0, 20), fromHeadlines: rows.length };
}

// ---------- report ----------
function buildReport() {
  const all = allAnalysis().filter((a) => !a.metrics.insufficient);
  const pv = portfolioView();
  const pick = (lab, n) => all.filter((a) => a.label === lab).sort((x, y) => (y.score.composite || 0) - (x.score.composite || 0)).slice(0, n);
  const em = all.filter((a) => a.tags.some((t) => t.code === "emerging")).sort((x, y) => (y.score.composite || 0) - (x.score.composite || 0)).slice(0, 10);
  const watchSyms = new Set(db.prepare("SELECT symbol FROM watchlist").all().map((x) => x.symbol));
  const meta = kvGet("analysis_meta") || {};
  const fmt = (a) => ({ ...slim(a), reasons: a.reasons, fit: fitFor(a, pv), watched: watchSyms.has(a.symbol) });
  return {
    generatedAt: now(), inflation: J.inflation(), analysedAt: meta.at, universe: all.length,
    counts: all.reduce((o, a) => ((o[a.label] = (o[a.label] || 0) + 1), o), {}),
    buy: pick("buy", 15).map(fmt), watch: pick("watch", 15).map(fmt), investigate: pick("investigate", 12).map(fmt), avoid: pick("avoid", 12).map(fmt),
    emerging: em.map(fmt), portfolio: { total: pv.total, expReal: pv.expReal, warnings: pv.warnings },
    alerts: db.prepare("SELECT * FROM alerts WHERE read=0 ORDER BY id DESC LIMIT 20").all(),
    vc: vcView(90).sectors.slice(0, 6),
  };
}

// ---------- AI prompts (facts + numbered sources) ----------
function stockPrompt(a, newsRows, prof) {
  const m = a.metrics, pct = (x) => (x == null ? "n/a" : (x * 100).toFixed(1) + "%"), cr = (x) => (x == null ? "n/a" : "₹" + (x / A.CR).toFixed(0) + " cr");
  const sources = [
    { id: "S1", name: "Annual financials (Yahoo Finance fundamentals timeseries)", url: a.sources.page || a.sources.fundamentals },
    { id: "S2", name: "Weekly price history (Yahoo Finance chart)", url: a.sources.prices },
    { id: "S3", name: "Dashboard calculations (scores, scenarios — derived from S1, S2 and CPI)", url: "local" },
    { id: "S4", name: "India CPI inflation (World Bank)", url: S.SRC.cpi },
  ];
  newsRows.forEach((n, i) => sources.push({ id: "S" + (5 + i), name: `${n.source}: ${n.title} (${(n.published || "").slice(0, 10)})`, url: n.link }));
  const fin = (m.yearsData || []);
  const facts = [
    `Company: ${a.name} (NSE: ${a.symbol}), industry: ${a.industry}. Latest FY: ${m.latestFy}. [S1]`,
    `Price ₹${m.price}, market cap ${cr(m.mcap)}, P/E ${m.pe ? m.pe.toFixed(1) : "n/a"}, P/B ${m.pb ? m.pb.toFixed(1) : "n/a"}, peer median P/E ${a.peerPe ? a.peerPe.toFixed(1) : "n/a"}, dividend yield ${pct(m.divYield)}. [S1][S2][S3]`,
    `Revenue ${cr(m.revenue)}, net profit ${cr(m.netIncome)}; ${Math.max(1, m.years - 1)}-yr revenue CAGR ${pct(m.revCagr)}, profit CAGR ${pct(m.niCagr)} (growth measured over ${m.years} annual reports; first-year net margin ${m.npmTrend != null && m.npm != null ? pct(m.npm - m.npmTrend) : "n/a"}, latest ${pct(m.npm)}), latest revenue growth ${pct(m.revYoy)}. [S1]`,
    `ROE ${pct(m.roe)}, ROCE ${pct(m.roce)}, operating margin ${pct(m.opm)}, net margin ${pct(m.npm)} (trend ${pct(m.npmTrend)}), debt/equity ${m.de != null ? m.de.toFixed(2) : "n/a"}, interest cover ${m.intCover != null ? m.intCover.toFixed(1) + "x" : "n/a"}, cash conversion ${m.cashConv != null ? (m.cashConv * 100).toFixed(0) + "%" : "n/a"}, FCF yield ${pct(m.fcfYield)}. [S1][S3]`,
    `Share count CAGR ${pct(m.shareCagr)}; receivables CAGR minus revenue CAGR ${pct(m.recvGap)}; 1-yr price return ${pct(m.ret1y)}; 3-yr max drawdown ${pct(m.maxDrawdown3y)}. [S1][S2]`,
    `Scores (percentile, 0-100): composite ${fmtN(a.score.composite)}, quality ${fmtN(g(a, "quality"))}, growth ${fmtN(g(a, "growth"))}, value ${fmtN(g(a, "value"))}, safety ${fmtN(g(a, "safety"))}. Screen label: ${a.label}. [S3]`,
    `Red flags: ${(a.flags || []).map((f) => f.severity + ": " + f.text).join(" | ") || "none detected"}. [S3]`,
    a.scenarios ? `5-yr scenarios with expected inflation ${pct(a.inflation)} [S4]: ` + ["bear", "base", "bull"].map((k) => `${k}: EPS growth ${pct(a.assumptions.growth[k])}, exit P/E ${a.assumptions.exitPe[k]}, nominal ${pct(a.scenarios[k].nominal)}/yr, real ${pct(a.scenarios[k].real)}/yr`).join("; ") + ". [S3]" : "Scenarios: not computable (no positive earnings). [S3]",
    ...(m.notes || []).map((n) => "Data note: " + n),
  ];
  if (prof && prof.profile && prof.profile.summary) { sources.push({ id: "S" + (sources.length + 1), name: "Company profile (Yahoo Finance" + (prof.profile.wiki ? " / Wikipedia" : "") + ")", url: prof.profile.source || prof.profile.wiki }); facts.unshift(`Business description: ${prof.profile.summary.slice(0, 1200)} [S${sources.length}]`); }
  const own = B.ownership(prof);
  if (own) { sources.push({ id: "S" + (sources.length + 1), name: "NSE shareholding pattern filing, quarter ending " + own.asOf, url: own.source }); facts.push(`Ownership (${own.asOf}): ` + own.parts.map((p) => p.label + " " + (p.pct * 100).toFixed(1) + "%").join(", ") + ". Changes vs previous quarter: " + (own.changes.map((c) => c.label + " " + (c.from * 100).toFixed(1) + "%→" + (c.to * 100).toFixed(1) + "%").join(", ") || "none") + ". Named public holders >1%: " + (own.named.map((h) => h.name + " " + (h.pct * 100).toFixed(2) + "%").join(", ") || "none") + ` [S${sources.length}]`); }
  const ann = ((prof && prof.announcements) || []).slice(0, 8);
  if (ann.length) { sources.push({ id: "S" + (sources.length + 1), name: "NSE corporate announcements (official filings)", url: "https://www.nseindia.com/get-quotes/equity?symbol=" + a.symbol }); facts.push("Recent official filings: " + ann.map((x) => x.date.slice(0, 11) + " " + x.title + (x.text ? " — " + x.text.slice(0, 140) : "")).join(" | ") + ` [S${sources.length}]`); }
  try { const v = B.verdict(a, getSettings()); facts.push(`Dashboard verdict: ${v.title}. ${v.line} Suggested holding: ${v.hold} [S3]`); } catch { /* ignore */ }
  return { facts, headlines: newsRows.map((n, i) => `[S${5 + i}] ${n.title}`), prompt: `Write a research note on ${a.name} (${a.symbol}) for a 5-10 year investor.\n\nFACTS:\n${facts.map((f) => "- " + f).join("\n")}\n\nRECENT HEADLINES (titles only):\n${newsRows.map((n, i) => `- [S${5 + i}] ${n.title}`).join("\n") || "- none"}\n\nSOURCES:\n${sources.map((s) => `[${s.id}] ${s.name} — ${s.url}`).join("\n")}\n\nIf web search is available, also check recent results, management commentary, competitive position and governance issues, and cite those URLs.`, sources };
}
const g = (a, k) => a.score && a.score.groups[k] && a.score.groups[k].score;
const fmtN = (x) => (x == null ? "n/a" : x.toFixed(0));

// ---------- routes ----------
const routes = [];
const route = (method, re, fn) => routes.push({ method, re, fn });

route("GET", /^\/api\/status$/, () => {
  const logs = db.prepare("SELECT job, status, finished_at, started_at, message FROM fetch_log WHERE id IN (SELECT MAX(id) FROM fetch_log GROUP BY job)").all();
  const counts = {
    universe: db.prepare("SELECT COUNT(*) n FROM universe WHERE in_index=1 OR user_added=1").get().n,
    fundamentals: db.prepare("SELECT COUNT(*) n FROM fundamentals WHERE json IS NOT NULL").get().n,
    fundErrors: db.prepare("SELECT COUNT(*) n FROM fundamentals WHERE json IS NULL AND error IS NOT NULL").get().n,
    prices: db.prepare("SELECT COUNT(*) n FROM prices WHERE price IS NOT NULL").get().n,
    analysed: db.prepare("SELECT COUNT(*) n FROM analysis WHERE composite IS NOT NULL").get().n,
    mf: db.prepare("SELECT COUNT(*) n FROM mf_schemes").get().n,
    news: db.prepare("SELECT COUNT(*) n FROM news").get().n,
    alertsUnread: db.prepare("SELECT COUNT(*) n FROM alerts WHERE read=0").get().n,
  };
  const s = getSettings();
  return { jobs: J.status(), logs, counts, inflation: J.inflation(), ai: { provider: s.aiProvider, configured: s.aiProvider === "gemini" ? !!s.geminiKey : s.aiProvider === "ollama" }, autoRefresh: s.autoRefresh === "1" };
});
route("POST", /^\/api\/refresh\/(\w+)$/, (req, m, body) => {
  const map = { universe: J.refreshUniverse, cpi: J.refreshCpi, amfi: J.refreshAmfi, news: J.refreshNews, stocks: () => J.refreshStocks({ mode: body.mode || "auto" }), analysis: async () => J.recomputeAnalysis(), smartmoney: J.refreshSmartMoney };
  if (m[1] === "all") { for (const k of ["universe", "cpi", "amfi", "news", "stocks"]) J.runJob(k, map[k]).catch(() => {}); return { started: "all" }; }
  if (!map[m[1]]) throw Object.assign(new Error("Unknown job"), { code: 404 });
  J.runJob(m[1], map[m[1]]).catch(() => {});
  return { started: m[1] };
});

route("GET", /^\/api\/stocks$/, (req, m, body, q) => {
  let list = allAnalysis().map(slim);
  if (q.get("label")) list = list.filter((x) => x.label === q.get("label"));
  if (q.get("tag")) list = list.filter((x) => (x.tags || []).some((t) => t.code === q.get("tag")));
  if (q.get("industry")) list = list.filter((x) => x.industry === q.get("industry"));
  if (q.get("q")) { const s = q.get("q").toLowerCase(); list = list.filter((x) => x.symbol.toLowerCase().includes(s) || (x.name || "").toLowerCase().includes(s)); }
  list.sort((a, b) => (b.composite == null) - (a.composite == null) || (b.composite || 0) - (a.composite || 0));
  const industries = [...new Set(allAnalysis().map((a) => a.industry))].sort();
  return { items: list, industries, meta: kvGet("analysis_meta") };
});
// company profile + ownership + official announcements, cached for 3 days
const profileInflight = new Map();
async function getProfileCached(sym, name, { force = false } = {}) {
  const r = db.prepare("SELECT json, fetched_at FROM profiles WHERE symbol=?").get(sym);
  if (r && !force && Date.now() - Date.parse(r.fetched_at) < 3 * 864e5) return parseJ(r.json);
  if (!profileInflight.has(sym)) {
    profileInflight.set(sym, P.getProfile(sym, name).then((p) => {
      if (p.profile || p.shareholding || (p.announcements && p.announcements.length)) db.prepare("INSERT INTO profiles(symbol,json,fetched_at) VALUES(?,?,?) ON CONFLICT(symbol) DO UPDATE SET json=excluded.json, fetched_at=excluded.fetched_at").run(sym, JSON.stringify(p), now());
      return p;
    }).finally(() => profileInflight.delete(sym)));
  }
  const fresh = profileInflight.get(sym);
  if (r) return parseJ(r.json); // stale copy now; fresh one is saved in the background
  return Promise.race([fresh, new Promise((res) => setTimeout(() => res(null), 12000))]);
}
function beginnerBlock(a, prof, news) {
  const owned = db.prepare("SELECT * FROM portfolio WHERE kind='stock' AND ref=?").get(a.symbol) || null;
  return { verdict: B.verdict(a, getSettings(), owned), money: B.moneySummary(a), prosCons: B.prosCons(a, prof), ownership: B.ownership(prof), feed: B.newsFeed(prof, news), owned: !!owned, settings: { investAmount: getSettings().investAmount, riskProfile: getSettings().riskProfile, targetReal: getSettings().targetReal } };
}

route("GET", /^\/api\/stock\/([A-Z0-9&_-]+)$/, async (req, m) => {
  const sym = decodeURIComponent(m[1]);
  const a = oneAnalysis(sym);
  if (!a) throw Object.assign(new Error("Not analysed yet: " + sym), { code: 404 });
  const prof = await getProfileCached(sym, a.name).catch(() => null);
  const news0 = db.prepare("SELECT title, link, source, published FROM news WHERE (',' || symbols || ',') LIKE ? ORDER BY published DESC LIMIT 15").all("%," + sym + ",%");
  a.profile = prof && prof.profile; a.beginner = beginnerBlock(a, prof, news0); a.profileFetchedAt = prof && prof.fetchedAt; a.profileErrors = prof && prof.errors;
  const f = db.prepare("SELECT json, fetched_at, error FROM fundamentals WHERE symbol=?").get(sym);
  const p = db.prepare("SELECT json, fetched_at, error FROM prices WHERE symbol=?").get(sym);
  const news = db.prepare("SELECT title, link, source, published FROM news WHERE (',' || symbols || ',') LIKE ? ORDER BY published DESC LIMIT 15").all("%," + sym + ",%");
  const notes = db.prepare("SELECT * FROM ai_notes WHERE subject=? ORDER BY id DESC LIMIT 5").all(sym).map((n) => ({ ...n, sources: parseJ(n.sources) }));
  const pj = p && parseJ(p.json);
  return { ...a, years: f && parseJ(f.json) ? parseJ(f.json).years : [], fundFetchedAt: f && f.fetched_at, fundError: f && f.error, priceFetchedAt: p && p.fetched_at, series: pj ? pj.series : [], high52: pj && pj.high52, low52: pj && pj.low52, news, notes, watched: !!db.prepare("SELECT 1 FROM watchlist WHERE symbol=?").get(sym), fit: fitFor(a, portfolioView()) };
});
route("POST", /^\/api\/stock\/([A-Z0-9&_-]+)\/assumptions$/, (req, m, body) => {
  const sym = decodeURIComponent(m[1]);
  if (body.reset) db.prepare("DELETE FROM assumptions WHERE symbol=?").run(sym);
  else {
    const clean = { growth: {}, exitPe: {} };
    for (const k of ["bear", "base", "bull"]) {
      const gv = +body.growth[k], pv = +body.exitPe[k];
      if (!isFinite(gv) || gv < -0.5 || gv > 1) throw new Error("Growth must be between -50% and 100%");
      if (!isFinite(pv) || pv < 1 || pv > 300) throw new Error("Exit P/E must be between 1 and 300");
      clean.growth[k] = gv; clean.exitPe[k] = pv;
    }
    if (body.divYield != null) clean.divYield = Math.max(0, Math.min(0.2, +body.divYield || 0));
    db.prepare("INSERT INTO assumptions(symbol,json,updated_at) VALUES(?,?,?) ON CONFLICT(symbol) DO UPDATE SET json=excluded.json, updated_at=excluded.updated_at").run(sym, JSON.stringify(clean), now());
  }
  J.recomputeAnalysis({ quiet: true });
  return oneAnalysis(sym);
});
route("POST", /^\/api\/stock\/add$/, async (req, m, body) => ({ symbol: await J.addSymbol(body.symbol) }));
route("POST", /^\/api\/stock\/([A-Z0-9&_-]+)\/refresh$/, async (req, m) => { await J.fetchStock(decodeURIComponent(m[1])); J.recomputeAnalysis({ quiet: true }); return { ok: true }; });
route("GET", /^\/api\/compare$/, (req, m, body, q) => {
  const syms = (q.get("s") || "").split(",").map((x) => x.trim().toUpperCase()).filter(Boolean).slice(0, 5);
  return { items: syms.map((s) => oneAnalysis(s)).filter(Boolean) };
});

route("GET", /^\/api\/watchlist$/, () => {
  const rows = db.prepare("SELECT * FROM watchlist ORDER BY added_at DESC").all();
  return { items: rows.map((r) => { const a = oneAnalysis(r.symbol); return { ...r, ...(a ? slim(a) : { symbol: r.symbol }) }; }) };
});
route("POST", /^\/api\/watchlist$/, (req, m, body) => {
  const sym = String(body.symbol || "").toUpperCase();
  if (!sym) throw new Error("symbol required");
  if (body.remove) db.prepare("DELETE FROM watchlist WHERE symbol=?").run(sym);
  else db.prepare("INSERT INTO watchlist(symbol,note,added_at) VALUES(?,?,?) ON CONFLICT(symbol) DO UPDATE SET note=excluded.note").run(sym, body.note || "", now());
  return { ok: true };
});

route("GET", /^\/api\/portfolio$/, () => portfolioView());
route("POST", /^\/api\/portfolio$/, async (req, m, body) => {
  const kind = body.kind;
  if (!["stock", "mf", "cash", "gold", "other"].includes(kind)) throw new Error("Unknown holding type");
  let ref = String(body.ref || "").trim(), name = String(body.name || "").trim();
  const qty = +body.qty || 0, cost = +body.cost || 0, value = +body.value || 0;
  if (kind === "stock") {
    ref = ref.toUpperCase().replace(/\.NS$/, "");
    if (!(qty > 0)) throw new Error("Quantity must be positive");
    if (!db.prepare("SELECT 1 FROM universe WHERE symbol=?").get(ref)) await J.addSymbol(ref);
    else if (!db.prepare("SELECT 1 FROM prices WHERE symbol=? AND price IS NOT NULL").get(ref)) { await J.fetchStock(ref); J.recomputeAnalysis({ quiet: true }); }
    name = name || (db.prepare("SELECT name FROM universe WHERE symbol=?").get(ref) || {}).name || ref;
  } else if (kind === "mf") {
    const s = db.prepare("SELECT * FROM mf_schemes WHERE code=?").get(ref);
    if (!s) throw new Error("Unknown scheme code — pick a fund from the search list");
    if (!(qty > 0)) throw new Error("Units must be positive");
    name = s.name;
    try { await mfHistory(ref); } catch { /* still save */ }
  } else if (!(value > 0)) throw new Error("Current value must be positive");
  if (body.id) db.prepare("UPDATE portfolio SET kind=?, ref=?, name=?, qty=?, cost=?, value=?, notes=? WHERE id=?").run(kind, ref, name, qty, cost, value, body.notes || "", body.id);
  else db.prepare("INSERT INTO portfolio(kind,ref,name,qty,cost,value,notes,added_at) VALUES(?,?,?,?,?,?,?,?)").run(kind, ref, name, qty, cost, value, body.notes || "", now());
  return portfolioView();
});
route("DELETE", /^\/api\/portfolio\/(\d+)$/, (req, m) => { db.prepare("DELETE FROM portfolio WHERE id=?").run(+m[1]); return portfolioView(); });

route("GET", /^\/api\/mf\/search$/, (req, m, body, q) => {
  const s = (q.get("q") || "").trim();
  const directOnly = q.get("direct") !== "0";
  if (s.length < 2) return { items: [] };
  const words = s.split(/\s+/).slice(0, 5);
  const where = words.map(() => "name LIKE ?").join(" AND ") + (directOnly ? " AND name LIKE '%Direct%' AND name LIKE '%Growth%'" : "");
  return { items: db.prepare(`SELECT * FROM mf_schemes WHERE ${where} ORDER BY name LIMIT 40`).all(...words.map((w) => "%" + w + "%")) };
});
route("GET", /^\/api\/mf\/categories$/, () => ({ items: db.prepare("SELECT category, COUNT(*) n FROM mf_schemes GROUP BY category ORDER BY category").all() }));
route("GET", /^\/api\/mf\/scheme\/(\d+)$/, async (req, m) => mfAnalyse(m[1]));
route("GET", /^\/api\/mf\/rank$/, async (req, m, body, q) => mfCategoryRank(q.get("category") || ""));

route("GET", /^\/api\/news$/, (req, m, body, q) => {
  const kind = q.get("kind") || "market";
  const rows = db.prepare("SELECT * FROM news WHERE feed_kind=? ORDER BY published DESC LIMIT 150").all(kind);
  return { items: rows };
});
route("GET", /^\/api\/vc$/, (req, m, body, q) => vcView(+q.get("days") || 120));

route("GET", /^\/api\/alerts$/, () => ({ items: db.prepare("SELECT * FROM alerts ORDER BY id DESC LIMIT 200").all() }));
route("POST", /^\/api\/alerts\/read$/, (req, m, body) => { if (body.id) db.prepare("UPDATE alerts SET read=1 WHERE id=?").run(body.id); else db.exec("UPDATE alerts SET read=1"); return { ok: true }; });

route("GET", /^\/api\/report$/, () => buildReport());

route("GET", /^\/api\/settings$/, () => { const s = getSettings(); return { ...s, geminiKey: s.geminiKey ? "••••" + s.geminiKey.slice(-4) : "" }; });
route("POST", /^\/api\/settings$/, (req, m, body) => {
  const allowed = ["inflationOverride", "aiProvider", "geminiKey", "geminiModel", "geminiGrounding", "ollamaUrl", "ollamaModel", "autoRefresh", "riskProfile", "investAmount", "targetReal"];
  for (const k of allowed) if (k in body) { if (k === "geminiKey" && String(body[k]).startsWith("••••")) continue; setSetting(k, body[k]); }
  if ("inflationOverride" in body || "targetReal" in body || "riskProfile" in body || "investAmount" in body) J.recomputeAnalysis({ quiet: true });
  return { ok: true };
});

route("POST", /^\/api\/ai\/test$/, async () => AI.test(getSettings()));
route("POST", /^\/api\/ai\/stock\/([A-Z0-9&_-]+)$/, async (req, m) => {
  const sym = decodeURIComponent(m[1]);
  const a = oneAnalysis(sym);
  if (!a) throw new Error("Analyse the stock first");
  const news = db.prepare("SELECT title, link, source, published FROM news WHERE (',' || symbols || ',') LIKE ? ORDER BY published DESC LIMIT 8").all("%," + sym + ",%");
  const prof = await getProfileCached(sym, a.name).catch(() => null);
  const { prompt, sources } = stockPrompt(a, news, prof);
  const r = await AI.generate(getSettings(), prompt);
  const allSources = [...sources, ...r.web.map((w, i) => ({ id: "W" + (i + 1), name: w.title, url: w.url }))];
  db.prepare("INSERT INTO ai_notes(subject,kind,provider,text,sources,created_at) VALUES(?,?,?,?,?,?)").run(sym, "stock", r.provider, r.text, JSON.stringify(allSources), now());
  return { text: r.text, sources: allSources, provider: r.provider, note: r.note || null };
});
route("POST", /^\/api\/ai\/brief$/, async () => {
  const rep = buildReport();
  const vc = vcView(90);
  const line = (x) => `${x.symbol} (${x.industry}): composite ${fmtN(x.composite)}, base real ${x.baseReal != null ? (x.baseReal * 100).toFixed(1) + "%" : "n/a"}, bear real ${x.bearReal != null ? (x.bearReal * 100).toFixed(1) + "%" : "n/a"}. ${x.reason}`;
  const prompt = `Write a weekly investment research brief (Markdown, headings: Headline view, Buy candidates, Watchlist, Avoid, Emerging opportunities, Startup & VC trends, Portfolio notes, Missing data & caveats).\nUse only these facts from the dashboard [S1] and, if available, web sources you retrieve.\n\nExpected inflation ${(rep.inflation.value * 100).toFixed(1)}% (${rep.inflation.basis}) [S2].\nBUY CANDIDATES:\n${rep.buy.map(line).join("\n") || "none"}\nWATCH:\n${rep.watch.map(line).join("\n") || "none"}\nAVOID:\n${rep.avoid.map(line).join("\n") || "none"}\nEMERGING GROWTH:\n${rep.emerging.map(line).join("\n") || "none"}\nVC FUNDING BY SECTOR (last 90 days, parsed from news headlines [S3]):\n${vc.sectors.map((s) => `${s.sector}: ${s.deals} deals, ~$${s.usdMn.toFixed(0)}M disclosed`).join("\n")}\nPORTFOLIO: value ₹${Math.round(rep.portfolio.total)}, estimated real return ${rep.portfolio.expReal != null ? (rep.portfolio.expReal * 100).toFixed(1) + "%" : "n/a"}. Warnings: ${rep.portfolio.warnings.join(" | ") || "none"}\n\nSOURCES:\n[S1] Dashboard screens (Yahoo Finance fundamentals & prices, NSE Nifty 500 list)\n[S2] World Bank India CPI — ${S.SRC.cpi}\n[S3] Inc42 / Entrackr / ET Tech RSS headlines\n\nPrioritise. Explain why each buy/watch/avoid matters for a 5-10 year inflation-beating goal. Do not add stocks not listed above unless from a cited web source.`;
  const r = await AI.generate(getSettings(), prompt);
  const sources = [{ id: "S1", name: "Dashboard screens", url: "local" }, { id: "S2", name: "World Bank India CPI", url: S.SRC.cpi }, { id: "S3", name: "Startup news RSS (Inc42, Entrackr, ET Tech)", url: "local" }, ...r.web.map((w, i) => ({ id: "W" + (i + 1), name: w.title, url: w.url }))];
  db.prepare("INSERT INTO ai_notes(subject,kind,provider,text,sources,created_at) VALUES(?,?,?,?,?,?)").run("BRIEF", "brief", r.provider, r.text, JSON.stringify(sources), now());
  return { text: r.text, sources, provider: r.provider, note: r.note || null };
});
// ---------- AI: radar deep-dive, investor profile, chat assistant ----------
const srcList = (sources) => sources.map((s) => `[${s.id}] ${s.name} — ${s.url}`).join("\n");
// merge a context's sources into a shared numbered list, rewriting its [S#] citations to the new numbers
function mergeCtx(global, lines, sources) {
  const map = {};
  for (const s of sources) { const id = "S" + (global.length + 1); map[s.id] = id; global.push({ ...s, id }); }
  return lines.map((l) => l.replace(/\[(S\d+|W\d+)\]/g, (m, x) => (map[x] ? `[${map[x]}]` : m)));
}
async function stockContext(sym) {
  const a = oneAnalysis(sym); if (!a) return null;
  const news = db.prepare("SELECT title, link, source, published FROM news WHERE (',' || symbols || ',') LIKE ? ORDER BY published DESC LIMIT 6").all("%," + sym + ",%");
  const prof = await getProfileCached(sym, a.name).catch(() => null);
  const p = stockPrompt(a, news, prof);
  return { name: a.name, facts: p.facts, headlines: p.headlines, sources: p.sources };
}
const saveNote = (subject, kind, r, sources) => db.prepare("INSERT INTO ai_notes(subject,kind,provider,text,sources,created_at) VALUES(?,?,?,?,?,?)").run(subject, kind, r.provider, r.text, JSON.stringify(sources), now());

route("POST", /^\/api\/ai\/radar\/([A-Z0-9&_-]+)$/, async (req, m) => {
  const sym = decodeURIComponent(m[1]);
  const rd = smCached("radar", () => SG.radar()).find((x) => x.symbol === sym);
  if (!rd) throw new Error("No recent investor activity for " + sym);
  const sources = [], data = [];
  data.push(`Radar label: ${rd.label} (score ${rd.score != null ? rd.score.toFixed(0) : "n/a"}/100, ${rd.confidence} confidence). Reasons: ${rd.reasons.join(" ")} Caveats: ${rd.guards.join(" ")}`);
  data.push(`Investors: ${rd.posInvestors} buying, ${rd.negInvestors} selling; ${rd.repeated} buying repeatedly. Business improving: ${rd.improving ? "yes" : "not clearly"}. 3-month price change: ${rd.ret3m != null ? (rd.ret3m * 100).toFixed(1) + "%" : "n/a"}.`);
  for (const e of rd.evidence) { sources.push({ id: "S" + (sources.length + 1), name: `${e.kind} — ${e.investor} (${e.date})`, url: e.source || "local" }); data.push(`${e.date}: ${e.investor} (${e.type}) — ${e.kind}: ${e.detail} [S${sources.length}]`); }
  const ctx = await stockContext(sym);
  if (ctx) data.push(...mergeCtx(sources, [...ctx.facts, ...ctx.headlines], ctx.sources));
  else data.push("Company fundamentals are not loaded (outside the analysed universe).");
  const r = await AI.generate(getSettings(), `Deep-dive: why are notable investors active in ${rd.name} (${sym}), and does it hold up?\n\nDATA:\n${data.map((d) => "- " + d).join("\n")}\n\nSOURCES:\n${srcList(sources)}`, { system: AI.RADAR_SYSTEM });
  const all = [...sources, ...r.web.map((w, i) => ({ id: "W" + (i + 1), name: w.title, url: w.url }))];
  saveNote("RADAR:" + sym, "radar", r, all);
  return { text: r.text, sources: all, provider: r.provider, note: r.note || null };
});

route("POST", /^\/api\/ai\/investor\/(.+)$/, async (req, m) => {
  const key = decodeURIComponent(m[1]);
  const inv = smCached("inv", () => SG.investors()).find((i) => i.key === key);
  if (!inv) throw new Error("Investor not found");
  const acts = SG.outcomes(SG.activity({ days: 3650, ckey: key, limit: 60 }));
  const sources = [{ id: "S1", name: "NSE shareholding-pattern filings (quarterly, holders above 1%)", url: "https://www.nseindia.com/companies-listing/corporate-filings-shareholding-pattern" }, { id: "S2", name: "Dashboard fundamentals and screens", url: "local" }];
  const data = [`Investor: ${inv.name}; type: ${inv.typeLabel}; inferred style: ${inv.style.join(", ") || "not enough data"}; lesser-known high-conviction: ${inv.lesserKnown ? "yes" : "no"} [S2]`,
    `Disclosed positions: ${inv.nPositions}, total ≈₹${Math.round(inv.totalCr)} cr; buys seen ${inv.buys}, sells ${inv.sells}, ${inv.recentBuys} buys in the last 4 months [S1]`,
    `Track record of past buys vs Nifty 500 after 6 months: ${inv.track && inv.track.n ? `median ${(inv.track.median * 100).toFixed(1)}%, hit rate ${(inv.track.hit * 100).toFixed(0)}%, ${inv.track.n} buys${inv.track.n < 5 ? " (too few to trust)" : ""}` : "not enough history"} [S2]`,
    ...inv.positions.slice(0, 15).map((p) => `Holds ${(p.pct * 100).toFixed(2)}% of ${p.symbol} (${p.name || ""}, ${p.industry || "n/a"}) ≈₹${p.valueCr ? Math.round(p.valueCr) : "?"} cr; dashboard take: ${p.action ? p.action.title : "n/a"}; quality ${p.q != null ? p.q.toFixed(0) : "n/a"}, value ${p.v != null ? p.v.toFixed(0) : "n/a"} (quarter ${p.quarter}) [S1][S2]`)];
  for (const a of acts.slice(0, 20)) { sources.push({ id: "S" + (sources.length + 1), name: `${a.kindLabel} — ${a.symbol} (${a.date})`, url: a.source || "local" }); data.push(`${a.date}: ${a.kindLabel} in ${a.symbol} — ${a.detail}; afterwards vs Nifty 500: 3m ${a.excess["3m"] != null ? (a.excess["3m"] * 100).toFixed(1) + "%" : "pending"}, 6m ${a.excess["6m"] != null ? (a.excess["6m"] * 100).toFixed(1) + "%" : "pending"} [S${sources.length}]`); }
  const r = await AI.generate(getSettings(), `Profile this investor for a beginner deciding whether their moves are worth following.\n\nDATA:\n${data.map((d) => "- " + d).join("\n")}\n\nSOURCES:\n${srcList(sources)}`, { system: AI.INVESTOR_SYSTEM });
  saveNote("INV:" + key, "investor", r, sources);
  return { text: r.text, sources, provider: r.provider };
});

route("POST", /^\/api\/ai\/chat$/, async (req, m, body) => {
  const q = String(body.question || "").trim().slice(0, 1500);
  if (!q) throw new Error("Type a question");
  const page = body.page || {};
  const sources = [], data = [];
  const infl = J.inflation();
  const all = allAnalysis();
  const counts = all.reduce((o, a) => ((o[a.label] = (o[a.label] || 0) + 1), o), {});
  sources.push({ id: "S1", name: "Dashboard screens & calculations (free public data)", url: "local" });
  data.push(`App overview: ${all.length} companies screened; buy candidates ${counts.buy || 0}, watch ${counts.watch || 0}, investigate ${counts.investigate || 0}, avoid ${counts.avoid || 0}. Inflation assumption ${(infl.value * 100).toFixed(1)}% (${infl.basis}). [S1]`);
  const wantsList = /\b(best|top|which|what should|recommend|ideas?|buy|cheap|undervalued|opportunit|compare|portfolio|my holdings|smart money|investors?|radar)\b/i.test(q);
  if (wantsList || page.name === "home" || page.name === "discover") {
    const top = all.filter((a) => a.label === "buy").sort((x, y) => (y.score.composite || 0) - (x.score.composite || 0)).slice(0, 10);
    data.push("Top buy candidates: " + top.map((a) => `${a.symbol} (${a.name}; overall ${a.score.composite.toFixed(0)}/100; take: ${a.action ? a.action.title : "n/a"}; base real ${(a.scenarios.base.real * 100).toFixed(1)}%/yr)`).join("; ") + " [S1]");
  }
  if (/portfolio|my holdings|i own|i hold|my stocks|my funds/i.test(q) || page.name === "portfolio") {
    const pv = portfolioView();
    data.push(pv.holdings.length ? `User's portfolio: total ₹${Math.round(pv.total)}; estimated real return ${pv.expReal != null ? (pv.expReal * 100).toFixed(1) + "%" : "n/a"}; holdings: ${pv.holdings.map((h) => `${h.ref || h.name} ₹${Math.round(h.current || 0)} (${h.kind}${h.label ? ", " + h.label : ""})`).join("; ")}; warnings: ${pv.warnings.join(" ") || "none"} [S1]` : "The user hasn't added any holdings yet. [S1]");
  }
  if (/smart money|investor|radar|promoter|bulk|block|stake|accumulat/i.test(q) || page.name === "smart") {
    const rd = smCached("radar", () => SG.radar()).filter((x) => ["Investigate", "Watch"].includes(x.label)).slice(0, 8);
    data.push("Smart-money radar (top): " + rd.map((x) => `${x.symbol}: ${x.label}, ${x.confidence} confidence — ${x.reasons[0]}`).join(" | ") + " [S1]");
  }
  // the company on screen + any companies named in the question
  const syms = new Set();
  if (page.name === "stock" && page.arg) syms.add(page.arg);
  for (const s of J.matchSymbols(q, J.buildNameMatchers())) syms.add(s);
  // tickers typed in capitals (case-sensitive, so the word "idea" isn't Vodafone Idea)
  for (const tok of q.match(/\b[A-Z][A-Z0-9&-]{2,}\b/g) || []) { if (db.prepare("SELECT 1 FROM analysis WHERE symbol=?").get(tok)) syms.add(tok); }
  for (const s of [...syms].slice(0, 3)) {
    let ctx = null;
    try { ctx = await stockContext(s); } catch (e) { console.error("[chat context]", s, e.message); }
    if (!ctx) { data.push(`${s}: not analysed in the dashboard.`); continue; }
    data.push(`--- ${ctx.name} (${s}) ---`, ...mergeCtx(sources, [...ctx.facts, ...ctx.headlines], ctx.sources));
    const rd = smCached("radar", () => SG.radar()).find((x) => x.symbol === s);
    if (rd) data.push(`Smart-money radar for ${s}: ${rd.label}, ${rd.confidence} confidence. ${rd.reasons.join(" ")} [S1]`);
  }
  if (page.name === "investor" && page.arg) {
    const inv = smCached("inv", () => SG.investors()).find((i) => i.key === page.arg);
    if (inv) data.push(`Investor on screen: ${inv.name} (${inv.typeLabel}); style ${inv.style.join(", ") || "n/a"}; ${inv.nPositions} disclosed positions (${inv.positions.slice(0, 8).map((p) => `${p.symbol} ${(p.pct * 100).toFixed(1)}%`).join(", ")}); track record ${inv.track && inv.track.n ? `median ${(inv.track.median * 100).toFixed(1)}% vs Nifty 500 over 6m, n=${inv.track.n}` : "insufficient"} [S1]`);
  }
  if (page.name === "fund" && page.arg) {
    try { const f = await mfAnalyse(page.arg); const st = f.stats || {}; sources.push({ id: "S" + (sources.length + 1), name: "AMFI / mfapi NAV history", url: S.SRC.mfapi(page.arg) }); data.push(`Fund on screen: ${f.scheme.name} (${f.scheme.category || ""}); CAGR 1y ${(st.cagr1 * 100).toFixed(1)}%, 3y ${st.cagr3 != null ? (st.cagr3 * 100).toFixed(1) + "%" : "n/a"}, 5y ${st.cagr5 != null ? (st.cagr5 * 100).toFixed(1) + "%" : "n/a"}; volatility ${st.volatility != null ? (st.volatility * 100).toFixed(1) + "%" : "n/a"}; max drawdown ${(st.maxDrawdown5y * 100).toFixed(1)}%; rolling 3y beat inflation ${st.rolling3y ? (st.rolling3y.beatInflationPct * 100).toFixed(0) + "% of the time" : "n/a"} [S${sources.length}]`); } catch { /* ignore */ }
  }
  const history = (Array.isArray(body.history) ? body.history : []).slice(-8).map((h) => ({ role: h.role === "model" ? "model" : "user", text: String(h.text || "").slice(0, 3000) }));
  const r = await AI.generate(getSettings(), `QUESTION: ${q}\n\nDATA (from the dashboard, as of now):\n${data.map((d) => "- " + d).join("\n")}\n\nSOURCES:\n${srcList(sources)}`, { system: AI.CHAT_SYSTEM, history, maxTokens: 1500 });
  return { text: r.text, sources: [...sources, ...r.web.map((w, i) => ({ id: "W" + (i + 1), name: w.title, url: w.url }))], provider: r.provider, used: [...syms] };
});

route("GET", /^\/api\/ai\/notes$/, (req, m, body, q) => ({ items: db.prepare("SELECT * FROM ai_notes WHERE subject=? ORDER BY id DESC LIMIT 10").all(q.get("subject") || "BRIEF").map((n) => ({ ...n, sources: parseJ(n.sources) })) }));

route("GET", /^\/api\/sources$/, () => ({ sources: S.SRC, feeds: S.FEEDS, universe: kvGet("universe_meta"), amfi: kvGet("amfi_meta"), cpi: kvGet("cpi") && { source: kvGet("cpi").source, sourceName: kvGet("cpi").sourceName, at: kvGet("cpi").at, latest: kvGet("cpi").series.at(-1) } }));

// ---------- smart money radar ----------
const SMm = require("./lib/smartmoney"), SG = require("./lib/smartsignals");
const smCache = new Map();
function smCached(key, fn, ttl = 90e3) {
  const builtAt = (db.prepare("SELECT finished_at FROM fetch_log WHERE job IN ('smartmoney','analysis','stocks') AND status='ok' ORDER BY id DESC LIMIT 1").get() || {}).finished_at || "";
  const c = smCache.get(key);
  if (c && c.builtAt === builtAt && Date.now() - c.at < ttl) return c.v;
  const v = fn(); smCache.set(key, { v, at: Date.now(), builtAt }); return v;
}
route("GET", /^\/api\/sm\/radar$/, () => ({ items: smCached("radar", () => SG.radar()), coverage: SMm.coverage() }));
route("GET", /^\/api\/sm\/investors$/, () => ({ items: smCached("inv", () => SG.investors()).map((i) => ({ ...i, positions: i.positions.slice(0, 6) })), labels: SMm.TYPE_LABEL }));
route("GET", /^\/api\/sm\/investor\/(.+)$/, (req, m) => {
  const key = decodeURIComponent(m[1]);
  const inv = smCached("inv", () => SG.investors()).find((i) => i.key === key);
  if (!inv) throw Object.assign(new Error("Investor not found"), { code: 404 });
  const acts = SG.outcomes(SG.activity({ days: 3650, ckey: key, limit: 400 }));
  return { ...inv, activity: acts };
});
route("GET", /^\/api\/sm\/activity$/, (req, m, body, q) => ({ items: SG.activity({ days: +q.get("days") || 60, limit: 500 }) }));
route("GET", /^\/api\/sm\/themes$/, () => ({ items: smCached("themes", () => SG.themes()), vc: vcView(120).sectors }));
route("GET", /^\/api\/sm\/track$/, () => smCached("track", () => SG.trackRecord()));
route("GET", /^\/api\/sm\/stock\/([A-Z0-9&_-]+)$/, (req, m) => {
  const sym = decodeURIComponent(m[1]);
  return { radar: smCached("radar", () => SG.radar()).find((r) => r.symbol === sym) || null, activity: SG.outcomes(SG.activity({ days: 730, symbol: sym, limit: 60 })) };
});
route("POST", /^\/api\/sm\/run$/, () => { J.runJob("smartmoney", J.refreshSmartMoney).catch(() => {}); return { started: true }; });

// ---------- server ----------
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://localhost");
  if (u.pathname.startsWith("/api/")) {
    const r = routes.find((x) => x.method === req.method && x.re.test(u.pathname));
    if (!r) return send(res, 404, { error: "Not found" });
    try {
      const body = req.method === "POST" || req.method === "PUT" ? await readBody(req) : {};
      const out = await r.fn(req, u.pathname.match(r.re), body, u.searchParams);
      send(res, 200, out);
    } catch (e) { send(res, e.code === 404 ? 404 : 400, { error: e.message || String(e) }); }
    return;
  }
  let file = path.join(PUB, u.pathname === "/" ? "index.html" : path.normalize(u.pathname).replace(/^(\.\.[\\/])+/, ""));
  if (!file.startsWith(PUB)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(data);
  });
});

if (require.main === module) {
  // a background job failing must never take the whole app down
  process.on("uncaughtException", (e) => console.error("[uncaught]", e && e.stack || e));
  process.on("unhandledRejection", (e) => console.error("[unhandled]", e && e.stack || e));
  const HOST = process.env.HOST || "0.0.0.0";
  server.listen(PORT, HOST, () => {
    console.log(`Investment research dashboard: http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`);
    J.startScheduler();
  });
}
module.exports = { server, portfolioView, vcView, buildReport, stockPrompt };
