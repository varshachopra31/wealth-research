"use strict";
// Turns disclosures into signals, profiles investors, ranks opportunities and measures outcomes.
// Core rule: an investor buying (or a price surge) is NEVER a buy signal on its own. A stock only
// ranks as "Investigate" when the business and the valuation also check out.
const { db, now } = require("./db");
const SM = require("./smartmoney");

const DAY = 864e5;
const isNum = (x) => typeof x === "number" && isFinite(x);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const median = (a) => { const s = a.filter(isNum).sort((x, y) => x - y); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mean = (a) => { const s = a.filter(isNum); return s.length ? s.reduce((x, y) => x + y, 0) / s.length : null; };

db.exec(`
CREATE TABLE IF NOT EXISTS sm_signals ( id TEXT PRIMARY KEY, date TEXT, symbol TEXT, ckey TEXT, investor TEXT, itype TEXT, kind TEXT, dir INTEGER, weight REAL, value_cr REAL, pct_change REAL, pct_after REAL, source TEXT, detail TEXT );
CREATE INDEX IF NOT EXISTS sm_sig_sym ON sm_signals(symbol); CREATE INDEX IF NOT EXISTS sm_sig_ck ON sm_signals(ckey); CREATE INDEX IF NOT EXISTS sm_sig_date ON sm_signals(date);
CREATE TABLE IF NOT EXISTS sm_snap ( id TEXT PRIMARY KEY, seen_at TEXT, label TEXT, composite REAL, quality REAL, value REAL );
`);

const KIND = {
  PROMOTER_BUY: "Promoter bought from the market", PROMOTER_SELL: "Promoter sold in the market", PROMOTER_PREF: "Promoter subscribed to new shares",
  SAST_BUY: "Crossed/added to a 5%+ stake", SAST_SELL: "Cut a 5%+ stake", PREF_ALLOT: "Got shares in a preferential issue",
  NEW_STAKE: "New stake above 1%", STAKE_UP: "Raised stake", STAKE_DOWN: "Cut stake", STAKE_EXIT: "Dropped below 1% / exited",
  BULK_BUY: "Bulk-deal purchase", BULK_SELL: "Bulk-deal sale", BLOCK_BUY: "Block-deal purchase", BLOCK_SELL: "Block-deal sale",
  PLEDGE: "Shares pledged / encumbered (lender recorded)",
};

// ---------------------------------------------------------------- context
function analysisMap() {
  const m = new Map();
  for (const r of db.prepare("SELECT symbol, json FROM analysis").all()) { try { m.set(r.symbol, JSON.parse(r.json)); } catch { /* skip */ } }
  return m;
}
function seriesMap() {
  const m = new Map();
  for (const r of db.prepare("SELECT symbol, json FROM prices WHERE json IS NOT NULL").all()) { try { m.set(r.symbol, JSON.parse(r.json).series); } catch { /* skip */ } }
  return m;
}
const bench = () => db.prepare("SELECT date, close FROM sm_bench ORDER BY date").all().map((r) => [r.date, r.close]);
// first weekly close on/after a date (index)
function idxOnOrAfter(series, date) { let lo = 0, hi = series.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (series[mid][0] < date) lo = mid + 1; else hi = mid; } return lo < series.length ? lo : -1; }

// traders: buy and sell the same stock on the same day, again and again (behavioural, not a name list)
function detectTraders() {
  const rows = db.prepare("SELECT ckey, client, date, symbol, side, SUM(qty) q FROM sm_deals GROUP BY ckey, date, symbol, side").all();
  const by = new Map();
  for (const r of rows) { const k = r.ckey; if (!by.has(k)) by.set(k, new Map()); const d = by.get(k); const dk = r.date + "|" + r.symbol; if (!d.has(dk)) d.set(dk, {}); d.get(dk)[r.side] = r.q; }
  const traders = new Set();
  for (const [k, days] of by) {
    let both = 0; for (const v of days.values()) if (v.BUY && v.SELL && Math.min(v.BUY, v.SELL) / Math.max(v.BUY, v.SELL) >= 0.6) both++;
    if (days.size >= 2 && both / days.size >= 0.5) traders.add(k);
    if (both >= 3) traders.add(k);
  }
  return traders;
}

// ---------------------------------------------------------------- build signals
function buildSignals() {
  SM.rekey(); // keep investor identities consistent as the learned fund-house list grows
  const A = analysisMap();
  const traders = detectTraders();
  const sig = [];
  const add = (s) => sig.push(s);
  const sharesOf = (sym) => { const a = A.get(sym); return a && a.metrics && a.metrics.shares; };
  const typeOf = (name, grp, promoter) => (promoter ? "promoter" : SM.classify(name, grp));

  // promoter-group members of each company, from its own shareholding filings and SAST promoter flags
  const promoters = new Map();
  for (const r of db.prepare("SELECT DISTINCT symbol, ckey FROM sm_holdings WHERE promoter=1 UNION SELECT DISTINCT symbol, ckey FROM sm_sast WHERE promoter=1").all()) {
    if (!promoters.has(r.symbol)) promoters.set(r.symbol, new Set()); promoters.get(r.symbol).add(r.ckey);
  }
  const isPromoter = (sym, k) => !!(promoters.get(sym) && promoters.get(sym).has(k));

  // 1) bulk / block deals (net per investor per day, traders excluded)
  const deals = db.prepare("SELECT date, symbol, name, client, ckey, kind, side, SUM(qty) q, SUM(qty*price)/SUM(qty) p, MAX(source) src FROM sm_deals GROUP BY date, symbol, ckey, kind, side").all();
  // NSE also lists block deals in the bulk file: drop a bulk row that duplicates a block row exactly
  const blockKeys = new Set(deals.filter((d) => d.kind === "block").map((d) => [d.date, d.symbol, d.ckey, d.side, d.q].join("|")));
  const net = new Map();
  for (const d of deals) {
    if (d.kind === "bulk" && blockKeys.has([d.date, d.symbol, d.ckey, d.side, d.q].join("|"))) continue;
    const k = d.date + "|" + d.symbol + "|" + d.ckey + "|" + d.kind; const o = net.get(k) || { ...d, buy: 0, sell: 0 }; if (d.side === "BUY") o.buy += d.q; else o.sell += d.q; o.p = d.p; net.set(k, o);
  }
  // days on which a promoter sold: the buyers that day are absorbing a promoter's stake sale, not making a fresh call
  const promoterSaleDays = new Set([...net.values()].filter((d) => d.sell > d.buy && isPromoter(d.symbol, d.ckey)).map((d) => d.date + "|" + d.symbol));
  for (const d of net.values()) {
    const promo = isPromoter(d.symbol, d.ckey);
    const itype = promo ? "promoter" : traders.has(d.ckey) ? "broker" : typeOf(d.client);
    const n = d.buy - d.sell; if (!n) continue;
    const valueCr = (Math.abs(n) * d.p) / 1e7;
    const sh = sharesOf(d.symbol), pctEq = sh ? Math.abs(n) / sh : null;
    const base = 1 + Math.min(1, (pctEq || 0) * 100 * 0.5);
    const absorb = n > 0 && !promo && promoterSaleDays.has(d.date + "|" + d.symbol);
    const kind = promo ? (n > 0 ? "PROMOTER_BUY" : "PROMOTER_SELL") : (d.kind === "block" ? "BLOCK_" : "BULK_") + (n > 0 ? "BUY" : "SELL");
    const w = promo ? (n > 0 ? 2.5 : -2) : Math.sign(n) * base * (SM.TYPE_WEIGHT[itype] ?? 1) * (absorb ? 0.4 : 1);
    add({ id: "D|" + d.date + "|" + d.symbol + "|" + d.ckey + "|" + d.kind, date: d.date, symbol: d.symbol, ckey: d.ckey, investor: d.client, itype, kind, dir: Math.sign(n),
      weight: w, value_cr: valueCr, pct_change: pctEq != null ? Math.sign(n) * pctEq : null, pct_after: null, source: d.src,
      detail: `${n > 0 ? "Bought" : "Sold"} ${Math.abs(n).toLocaleString("en-IN")} shares at ≈₹${d.p.toFixed(2)} (≈₹${valueCr.toFixed(1)} cr${pctEq ? ", " + (pctEq * 100).toFixed(2) + "% of the company" : ""}) in a ${d.kind} deal${promo ? " — promoter group" : ""}${absorb ? " — bought from a promoter's stake sale, so counted at reduced weight" : ""}` });
  }

  // 2) SAST disclosures
  for (const s of db.prepare("SELECT * FROM sm_sast").all()) {
    const mode = s.mode || "";
    if (/inter-?se/i.test(mode)) continue; // transfers within the promoter group — not a market signal
    let itype = typeOf(s.acquirer, "", s.promoter);
    let kind, w;
    if (SM.classify(s.acquirer) === "pledge" || (/others/i.test(mode) && /trustee|bank|financ/i.test(s.acquirer))) { itype = "pledge"; kind = "PLEDGE"; w = -1.5; }
    else if (s.side === "BUY" && /preferential/i.test(mode)) { kind = s.promoter ? "PROMOTER_PREF" : "PREF_ALLOT"; w = s.promoter ? 1.5 : 1.2; }
    else if (s.side === "BUY") { kind = s.promoter ? "PROMOTER_BUY" : "SAST_BUY"; w = s.promoter ? (/open market/i.test(mode) ? 3 : 1.2) : (/open market/i.test(mode) ? 2 : 1); }
    else if (s.side === "SELL") { kind = s.promoter ? "PROMOTER_SELL" : "SAST_SELL"; w = s.promoter ? (/open market/i.test(mode) ? -2 : -1) : -1.5; }
    else continue;
    const tw = itype === "promoter" || itype === "pledge" ? 1 : SM.TYPE_WEIGHT[itype] ?? 1;
    add({ id: "S|" + s.id, date: s.date, symbol: s.symbol, ckey: s.ckey, investor: s.acquirer, itype, kind, dir: Math.sign(w), weight: w * tw, value_cr: null,
      pct_change: s.pct_change != null ? s.pct_change / 100 : null, pct_after: s.pct_after != null ? s.pct_after / 100 : null, source: s.attachment || "https://www.nseindia.com/companies-listing/corporate-filings-regulation-29",
      detail: `${s.side === "SELL" ? "Sold" : "Acquired"} ${s.shares ? Number(s.shares).toLocaleString("en-IN") + " shares " : ""}via ${mode || "n/a"}${s.pct_after != null ? `; now holds ${s.pct_after}%` : ""} (SAST Reg 29 filing)` });
  }

  // 3) quarterly shareholding changes (named holders >1%, schemes rolled up to the fund house)
  const H = db.prepare("SELECT symbol, quarter, published, ckey, MAX(name) name, SUM(pct) pct, MAX(grp) grp, MAX(promoter) promoter, MAX(xbrl) xbrl FROM sm_holdings GROUP BY symbol, quarter, ckey").all();
  const bySym = new Map();
  for (const h of H) { if (!bySym.has(h.symbol)) bySym.set(h.symbol, new Map()); const q = bySym.get(h.symbol); if (!q.has(h.quarter)) q.set(h.quarter, []); q.get(h.quarter).push(h); }
  for (const [sym, qs] of bySym) {
    const quarters = [...qs.keys()].sort();
    for (let i = 1; i < quarters.length; i++) {
      const prev = new Map(qs.get(quarters[i - 1]).map((h) => [h.ckey, h])), cur = new Map(qs.get(quarters[i]).map((h) => [h.ckey, h]));
      const pub = qs.get(quarters[i])[0].published, xbrl = qs.get(quarters[i])[0].xbrl;
      for (const [k, h] of cur) {
        if (h.promoter) continue; // promoter moves come through SAST
        const itype = typeOf(h.name, h.grp, 0); if (itype === "passive" || itype === "pledge") continue;
        const p = prev.get(k), d = h.pct - (p ? p.pct : 0);
        let kind, w;
        if (!p) { kind = "NEW_STAKE"; w = 2; } else if (d >= 0.0025) { kind = "STAKE_UP"; w = 1 + Math.min(1, d * 100); } else if (d <= -0.0025) { kind = "STAKE_DOWN"; w = -1; } else continue;
        add({ id: `H|${sym}|${quarters[i]}|${k}`, date: pub, symbol: sym, ckey: k, investor: h.name, itype, kind, dir: Math.sign(w), weight: w * (SM.TYPE_WEIGHT[itype] ?? 1), value_cr: null, pct_change: d, pct_after: h.pct, source: xbrl,
          detail: `${p ? `${(p.pct * 100).toFixed(2)}% → ` : "New: "}${(h.pct * 100).toFixed(2)}% (quarter ending ${quarters[i]})` });
      }
      for (const [k, h] of prev) {
        if (cur.has(k) || h.promoter) continue;
        const itype = typeOf(h.name, h.grp, 0); if (itype === "passive" || itype === "pledge") continue;
        add({ id: `H|${sym}|${quarters[i]}|${k}|x`, date: pub, symbol: sym, ckey: k, investor: h.name, itype, kind: "STAKE_EXIT", dir: -1, weight: -1.2 * (SM.TYPE_WEIGHT[itype] ?? 1), value_cr: null, pct_change: -h.pct, pct_after: null, source: xbrl,
          detail: `${(h.pct * 100).toFixed(2)}% → below 1% or exited (quarter ending ${quarters[i]}; holders under 1% aren't named)` });
      }
    }
  }

  // save (derived table, rebuilt each time) + snapshot fundamentals the first time a signal is seen
  const ins = db.prepare("INSERT INTO sm_signals(id,date,symbol,ckey,investor,itype,kind,dir,weight,value_cr,pct_change,pct_after,source,detail) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
  const snap = db.prepare("INSERT INTO sm_snap(id,seen_at,label,composite,quality,value) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING");
  db.exec("BEGIN");
  try {
    db.exec("DELETE FROM sm_signals");
    for (const s of sig) {
      ins.run(s.id, s.date, s.symbol, s.ckey, s.investor, s.itype, s.kind, s.dir, s.weight, s.value_cr, s.pct_change, s.pct_after, s.source, s.detail);
      const a = A.get(s.symbol), g = a && a.score && a.score.groups;
      snap.run(s.id, now(), a ? a.label : null, a && a.score ? a.score.composite : null, g && g.quality ? g.quality.score : null, g && g.value ? g.value.score : null);
    }
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }
  return { signals: sig.length, traders: traders.size };
}

// ---------------------------------------------------------------- outcomes (forward returns vs Nifty 500)
const HORIZONS = [["1m", 4], ["3m", 13], ["6m", 26], ["1y", 52]];
function outcomes(sigs, S = seriesMap(), B = bench()) {
  return sigs.map((s) => {
    const ser = S.get(s.symbol); const o = { ...s, ret: {}, excess: {} };
    if (!ser || !B.length) return o;
    const i = idxOnOrAfter(ser, s.date), j = idxOnOrAfter(B, s.date);
    if (i < 0 || j < 0) return o;
    o.entry = ser[i][1];
    const before = ser[i - 26]; o.pre6m = before ? ser[i][1] / before[1] - 1 : null; // price move in the 6 months before the signal
    for (const [h, w] of HORIZONS) {
      if (i + w < ser.length && j + w < B.length) { o.ret[h] = ser[i + w][1] / ser[i][1] - 1; o.excess[h] = o.ret[h] - (B[j + w][1] / B[j][1] - 1); }
    }
    return o;
  });
}
// many filings by one investor in one company in one month are ONE decision, not many independent signals
function dedupe(list) {
  const seen = new Set();
  return list.filter((o) => { const k = o.symbol + "|" + o.ckey + "|" + o.dir + "|" + String(o.date).slice(0, 7); if (seen.has(k)) return false; seen.add(k); return true; });
}
function statsOf(list, h = "6m") {
  const d = dedupe(list).filter((o) => isNum(o.excess[h]));
  const ex = d.map((o) => o.excess[h] * o.dir); // for sell signals, "useful" = stock underperformed
  if (!ex.length) return { n: 0 };
  // a result driven by a handful of companies is weak evidence, however many events it has
  return { n: ex.length, stocks: new Set(d.map((o) => o.symbol)).size, mean: mean(ex), median: median(ex), hit: ex.filter((x) => x > 0).length / ex.length };
}
function trackRecord() {
  const sigs = outcomes(db.prepare("SELECT s.*, n.label snap_label, n.quality snap_q, n.seen_at snap_seen FROM sm_signals s LEFT JOIN sm_snap n USING(id) WHERE itype NOT IN ('broker','passive')").all());
  const group = (keyFn) => { const m = new Map(); for (const o of sigs) { const k = keyFn(o); if (k == null) continue; if (!m.has(k)) m.set(k, []); m.get(k).push(o); } return m; };
  const table = (m) => [...m].map(([k, l]) => ({ key: k, count: l.length, events: dedupe(l).length, s1m: statsOf(l, "1m"), s3m: statsOf(l, "3m"), s6m: statsOf(l, "6m"), s1y: statsOf(l, "1y") })).sort((a, b) => b.events - a.events);
  const pos = sigs.filter((o) => o.dir > 0);
  // fundamentals are snapshotted when a signal is first seen; signals older than their snapshot use later data (look-ahead)
  const fair = pos.filter((o) => o.snap_seen && Date.parse(o.snap_seen) - Date.parse(o.date) < 10 * DAY);
  const biased = pos.filter((o) => !(o.snap_seen && Date.parse(o.snap_seen) - Date.parse(o.date) < 10 * DAY));
  return {
    byKind: table(group((o) => o.kind)),
    byType: table(group((o) => (o.dir > 0 ? o.itype : null))),
    byFundamentals: table(new Map([
      ["Buy + good fundamentals at the time (fair test)", fair.filter((o) => ["buy", "watch"].includes(o.snap_label))],
      ["Buy + weak fundamentals at the time (fair test)", fair.filter((o) => ["avoid", "investigate"].includes(o.snap_label))],
      ["Buy + good fundamentals today (look-ahead biased)", biased.filter((o) => ["buy", "watch"].includes(o.snap_label))],
      ["Buy + weak fundamentals today (look-ahead biased)", biased.filter((o) => ["avoid", "investigate"].includes(o.snap_label))],
      ["All smart-money buys", pos]])),
    fairCount: fair.length,
    byPrior: table(new Map([["Bought after price fell (6m before < −10%)", pos.filter((o) => o.pre6m < -0.1)], ["Bought after price rose (6m before > +30%)", pos.filter((o) => o.pre6m > 0.3)], ["Other buys", pos.filter((o) => o.pre6m != null && o.pre6m >= -0.1 && o.pre6m <= 0.3)]])),
    measured: sigs.filter((o) => Object.keys(o.excess).length).length, total: sigs.length,
    from: sigs.reduce((m, o) => (o.date < m ? o.date : m), "9999"),
  };
}

// ---------------------------------------------------------------- investors
function investors() {
  const A = analysisMap();
  const S = seriesMap(), B = bench();
  const sigs = outcomes(db.prepare("SELECT * FROM sm_signals WHERE itype NOT IN ('broker','passive','pledge')").all(), S, B);
  const latestQ = new Map(db.prepare("SELECT symbol, MAX(quarter) q FROM sm_holdings GROUP BY symbol").all().map((r) => [r.symbol, r.q]));
  const hold = db.prepare("SELECT symbol, quarter, ckey, MAX(name) name, SUM(pct) pct, MAX(grp) grp, MAX(promoter) promoter FROM sm_holdings GROUP BY symbol, quarter, ckey").all().filter((h) => latestQ.get(h.symbol) === h.quarter);
  const inv = new Map();
  const get = (k, name) => { if (!inv.has(k)) inv.set(k, { key: k, names: new Map(), positions: [], signals: [], promoterOf: 0 }); const o = inv.get(k); o.names.set(name, (o.names.get(name) || 0) + 1); return o; };
  for (const h of hold) {
    const o = get(h.ckey, h.name);
    if (h.promoter) { o.promoterOf++; continue; }
    if (SM.classify(h.name, h.grp) === "passive") continue; // index-fund holdings aren't a conviction call
    o.positions.push({ symbol: h.symbol, pct: h.pct, quarter: h.quarter, grp: h.grp });
  }
  // listed companies holding stakes in other companies are strategic/group holdings, not investment calls
  const listed = new Set(db.prepare("SELECT name FROM universe").all().map((r) => SM.canon(r.name).replace(/\b(INDIA)\b/g, "").trim()));
  for (const s of sigs) get(s.ckey, s.investor).signals.push(s);
  const out = [];
  for (const o of inv.values()) {
    const name = [...o.names].sort((a, b) => b[1] - a[1])[0][0];
    const types = o.signals.map((s) => s.itype);
    let itype = o.promoterOf && !o.positions.length ? "promoter" : SM.classify(name, (o.positions[0] || {}).grp);
    if (types.filter((t) => t === "promoter").length > types.length / 2) itype = "promoter"; // a group entity buying its own company
    if (types.includes("broker") && itype !== "promoter") itype = "broker";
    if (itype === "company" && listed.has(o.key.replace(/\b(INDIA)\b/g, "").trim())) itype = "listed_company";
    if (["passive", "pledge", "broker"].includes(itype)) continue;
    if (!o.positions.length && !o.signals.length) continue;
    const pos = o.positions.map((p) => { const a = A.get(p.symbol), m = a && a.metrics; return { ...p, name: a && a.name, valueCr: m && m.mcap ? (p.pct * m.mcap) / 1e7 : null, mcapCr: m && m.mcap ? m.mcap / 1e7 : null, label: a && a.label, q: a && a.score && a.score.groups.quality && a.score.groups.quality.score, v: a && a.score && a.score.groups.value && a.score.groups.value.score, g: a && a.score && a.score.groups.growth && a.score.groups.growth.score, industry: a && a.industry, tags: a ? a.tags.map((t) => t.code) : [], action: a && a.action }; });
    const buys = o.signals.filter((s) => s.dir > 0), sells = o.signals.filter((s) => s.dir < 0);
    const tr = statsOf(buys, "6m");
    const medCap = median(pos.map((p) => p.mcapCr));
    const style = [];
    if (median(pos.map((p) => p.v)) >= 60) style.push("Value");
    if (median(pos.map((p) => p.q)) >= 60) style.push("Quality");
    if (median(pos.map((p) => p.g)) >= 60) style.push("Growth");
    if (medCap != null && medCap < 5000) style.push("Small-cap specialist");
    const institution = ["mutual_fund", "foreign_institution", "insurer", "government"].includes(itype);
    // big institutions hold hundreds of stocks; a short list for them only means our coverage is still partial
    if (!institution && pos.length && pos.length <= 6 && mean(pos.map((p) => p.pct)) >= 0.02) style.push("Concentrated");
    if (pos.filter((p) => p.tags.includes("turnaround")).length >= Math.max(1, pos.length * 0.3)) style.push("Turnaround hunter");
    const pre = buys.map((s) => s.pre6m).filter(isNum);
    if (pre.length >= 3) { const mp = median(pre); if (mp < -0.1) style.push("Buys on weakness"); else if (mp > 0.3) style.push("Buys momentum"); }
    const steps = new Map(); buys.forEach((s) => steps.set(s.symbol, (steps.get(s.symbol) || 0) + 1));
    const repeated = [...steps].filter(([, n]) => n >= 2).map(([s]) => s);
    if (repeated.length) style.push("Accumulates in steps");
    // lesser-known & high-conviction: not a big institution, meaningful stakes, and either several positions or real recent buying
    const lesserKnown = ["individual", "company", "pe_vc"].includes(itype) && pos.length >= 1 && pos.length <= 15 && (medCap == null || medCap < 20000)
      && mean(pos.map((p) => p.pct)) >= 0.012 && (pos.length >= 2 || buys.filter((s) => Date.now() - Date.parse(s.date) < 365 * DAY).length >= 1);
    out.push({ key: o.key, name, itype, typeLabel: SM.TYPE_LABEL[itype] || itype, positions: pos.sort((a, b) => (b.valueCr || 0) - (a.valueCr || 0)), nPositions: pos.length,
      totalCr: pos.reduce((t, p) => t + (p.valueCr || 0), 0), medianCapCr: medCap, style, lesserKnown, highConviction: lesserKnown,
      buys: buys.length, sells: sells.length, recentBuys: buys.filter((s) => Date.now() - Date.parse(s.date) < 120 * DAY).length, repeated, track: tr,
      lastActivity: o.signals.reduce((m, s) => (s.date > m ? s.date : m), "") });
  }
  return out.sort((a, b) => b.recentBuys - a.recentBuys || b.totalCr - a.totalCr);
}

// ---------------------------------------------------------------- opportunity ranking
function radar({ days = 180 } = {}) {
  const A = analysisMap(), S = seriesMap();
  const invs = new Map(investors().map((i) => [i.key, i]));
  const since = new Date(Date.now() - days * DAY).toISOString().slice(0, 10);
  const sigs = db.prepare("SELECT * FROM sm_signals WHERE date >= ? AND itype NOT IN ('broker','passive') ORDER BY date DESC").all(since);
  const bySym = new Map(); for (const s of sigs) { if (!bySym.has(s.symbol)) bySym.set(s.symbol, []); bySym.get(s.symbol).push(s); }
  const out = [];
  for (const [sym, list] of bySym) {
    const a = A.get(sym), m = a && a.metrics;
    // smart-money strength: recency-decayed, investor-track-record adjusted
    let posW = 0, negW = 0; const posInv = new Set(), negInv = new Set(), sources = new Set(), steps = new Map();
    // one investor can't dominate: their weight in a company is capped (many small filings ≠ many signals)
    const perInv = new Map();
    for (const s of list) {
      const age = (Date.now() - Date.parse(s.date)) / DAY, decay = Math.pow(0.5, age / 90);
      const iv = invs.get(s.ckey), tr = iv && iv.track && iv.track.n >= 3 ? 1 + clamp(iv.track.mean * 2, -0.3, 0.3) : 1;
      perInv.set(s.ckey, (perInv.get(s.ckey) || 0) + s.weight * decay * (s.dir > 0 ? tr : 1));
      if (s.dir > 0) steps.set(s.ckey, (steps.get(s.ckey) || 0) + (steps.has(s.ckey + "|" + s.date.slice(0, 7)) ? 0 : 1)), steps.set(s.ckey + "|" + s.date.slice(0, 7), 1);
      sources.add(s.id[0]);
    }
    for (const [k, w0] of perInv) {
      const w = clamp(w0, -4, 4);
      const isPledge = list.some((s) => s.ckey === k && s.itype === "pledge");
      if (w > 0) { posW += w; if (w >= 0.5) posInv.add(k); } else if (w < 0) { negW += w; if (!isPledge) negInv.add(k); } // small/absorbing buys don't count as a "buyer"
    }
    const promoSells = list.filter((s) => s.kind === "PROMOTER_SELL");
    const promoSoldCr = promoSells.reduce((t, s) => t + (s.value_cr || 0), 0);
    for (const k of [...steps.keys()]) if (k.includes("|")) steps.delete(k); // keep only per-investor month counts
    const repeated = [...steps].filter(([, n]) => n >= 2).map(([k]) => k);
    if (repeated.length) posW += 0.8 * repeated.length;
    if (posInv.size >= 3) posW += 1;
    const netW = posW + negW;
    const pledged = list.some((s) => s.kind === "PLEDGE");
    // business & valuation
    const g = a && a.score && a.score.groups;
    const q = g && g.quality ? g.quality.score : null, gr = g && g.growth ? g.growth.score : null, val = g && g.value ? g.value.score : null;
    const crit = a ? a.flags.filter((f) => f.severity === "critical") : [];
    const improving = m && ((m.revAccel > 0 && m.revYoy > 0.08) || m.npmTrend > 0.02 || (m.niYoy > 0.15 && m.revYoy > 0.05));
    const ser = S.get(sym); const ret3m = ser && ser.length > 14 ? ser[ser.length - 1][1] / ser[ser.length - 14][1] - 1 : null;
    const surge = isNum(ret3m) && ret3m > 0.4 && !improving;
    const loss = m && m.netIncome < 0;
    let score = null, label, reasons = [], guards = [];
    const evidence = list.slice(0, 12).map((s) => ({ date: s.date, investor: s.investor, type: SM.TYPE_LABEL[s.itype] || s.itype, kind: SM_KIND(s.kind), dir: s.dir, detail: s.detail, source: s.source }));
    if (!a || m.insufficient) {
      label = netW >= 1.5 ? "Needs data" : "Low signal";
      reasons.push(a ? "Not enough financial history to judge the business." : "Outside the analysed universe — fundamentals not loaded yet (it is queued for analysis if the signal is strong).");
    } else {
      const smartPts = clamp(netW * 10, -20, 40);
      const fundPts = 0.35 * (0.65 * (q || 0) + 0.35 * (gr || 0)) + (improving ? 5 : 0);
      const valPts = 0.25 * (val || 0);
      const pen = (crit.length ? 25 : 0) + (loss ? 15 : 0) + (surge ? 15 : 0) + (pledged ? 10 : 0);
      score = clamp(smartPts + fundPts + valPts - pen, 0, 100);
      const verdict = a.action && a.action.code;
      if (netW <= -1.5) { label = "Smart money selling"; reasons.push(`Net selling by ${negInv.size} investor(s) — find out why before buying.`); }
      else if (netW < 1.5) { label = "Low signal"; reasons.push("Investor activity is too small or mixed to mean much."); }
      else if (crit.length || (q != null && q < 40) || loss || surge) {
        label = "Avoid";
        if (crit.length) reasons.push("Smart money is buying, but there's a serious red flag: " + crit[0].text);
        if (q != null && q < 40) reasons.push(`Smart money is buying, but business quality is weak (${q.toFixed(0)}/100).`);
        if (loss) reasons.push("The company is loss-making.");
        if (surge) reasons.push(`The price is up ${(ret3m * 100).toFixed(0)}% in 3 months without matching business improvement — likely chasing.`);
      } else if ((val != null && val < 35) || verdict === "wait") { label = "Watch"; reasons.push(`Good activity and a decent business, but the price is stretched (value ${val != null ? val.toFixed(0) : "n/a"}/100${a.action && a.action.buyBelow ? `; buy-below ≈ ₹${Math.round(a.action.buyBelow)}` : ""}).`); }
      else if (q >= 50) { label = "Investigate"; reasons.push(`Smart money buying, business quality ${q.toFixed(0)}/100${improving ? " and improving" : ""}, valuation reasonable (${val != null ? val.toFixed(0) : "n/a"}/100).`); }
      else { label = "Watch"; reasons.push(`Activity is positive but business quality is only average (${q != null ? q.toFixed(0) : "n/a"}/100).`); }
    }
    if (posInv.size) reasons.push(`${posInv.size} distinct investor(s) buying${repeated.length ? `; ${repeated.length} buying repeatedly` : ""}.`);
    if (promoSells.length) reasons.push(`The promoter group sold shares in this period${promoSoldCr ? ` (≈₹${Math.round(promoSoldCr).toLocaleString("en-IN")} cr disclosed)` : ""} — some institutional buying was simply absorbing that sale. Find out why the founders sold.`);
    if (pledged) reasons.push("Lender/trustee filings show shares pledged or encumbered — a governance risk to check.");
    guards.push("An investor's purchase is not a reason to buy on its own — they may have different goals, costs, information or time horizons, and disclosures arrive days or weeks late.");
    if (isNum(ret3m) && ret3m > 0.25) guards.push(`The price already rose ${(ret3m * 100).toFixed(0)}% in 3 months; some of the news may be priced in.`);
    // confidence
    let c = 0; if (sources.size >= 2) c++; if (posInv.size >= 2) c++; if (a && !m.insufficient && m.years >= 3) c++; if (a && a.industry && !/Unclassified/.test(a.industry)) c++;
    if (promoSells.length) c--; // insiders selling while outsiders buy = mixed evidence
    const confidence = c >= 3 ? "High" : c === 2 ? "Medium" : "Low";
    const sc = a && a.scenarios;
    out.push({ symbol: sym, name: a ? a.name : list[0].symbol, industry: a ? a.industry : "Not analysed", label, score, confidence, netW, posInvestors: posInv.size, negInvestors: negInv.size, repeated: repeated.length,
      q, g: gr, v: val, improving: !!improving, surge, ret3m, pledged, action: a && a.action, upside: sc ? { bear: sc.bear.real, base: sc.base.real, bull: sc.bull.real } : null,
      reasons, guards, evidence, lastDate: list[0].date, inUniverse: !!a });
  }
  const order = { Investigate: 0, Watch: 1, "Needs data": 2, Avoid: 3, "Smart money selling": 4, "Low signal": 5 };
  return out.sort((x, y) => order[x.label] - order[y.label] || (y.score ?? -1) - (x.score ?? -1) || y.netW - x.netW);
}
const SM_KIND = (k) => KIND[k] || k;

// ---------------------------------------------------------------- themes
function themes() {
  const A = analysisMap();
  const recent = new Date(Date.now() - 120 * DAY).toISOString().slice(0, 10), older = new Date(Date.now() - 240 * DAY).toISOString().slice(0, 10);
  const sigs = db.prepare("SELECT * FROM sm_signals WHERE date >= ? AND itype NOT IN ('broker','passive','pledge')").all(older);
  const ind = new Map();
  for (const s of sigs) {
    const a = A.get(s.symbol); const k = a ? a.industry : "Not analysed (smaller companies)";
    if (!ind.has(k)) ind.set(k, { industry: k, now: { buyers: new Set(), sellers: new Set(), net: 0, syms: new Set() }, before: { buyers: new Set(), net: 0 }, types: {} });
    const o = ind.get(k), bucket = s.date >= recent ? o.now : o.before;
    if (s.dir > 0) { bucket.buyers.add(s.ckey); if (bucket.syms) bucket.syms.add(s.symbol); if (s.date >= recent) o.types[s.itype] = (o.types[s.itype] || 0) + 1; } else if (bucket.sellers) bucket.sellers.add(s.ckey);
    bucket.net += s.weight;
  }
  return [...ind.values()].map((o) => {
    const syms = [...o.now.syms];
    const imp = syms.map((x) => A.get(x)).filter(Boolean).map((a) => a.metrics && a.metrics.revAccel).filter(isNum);
    return { industry: o.industry, buyers: o.now.buyers.size, sellers: o.now.sellers.size, net: o.now.net, prevBuyers: o.before.buyers.size, accelerating: o.now.buyers.size >= 3 && o.now.buyers.size > o.before.buyers.size * 1.3,
      companies: syms.slice(0, 8), byType: o.types, avgRevAccel: mean(imp) };
  }).filter((t) => t.buyers + t.sellers > 0).sort((a, b) => b.net - a.net);
}

function activity({ days = 60, symbol = null, ckey = null, limit = 300 } = {}) {
  const since = new Date(Date.now() - days * DAY).toISOString().slice(0, 10);
  let q = "SELECT * FROM sm_signals WHERE date >= ?"; const p = [since];
  if (symbol) { q += " AND symbol = ?"; p.push(symbol); } if (ckey) { q += " AND ckey = ?"; p.push(ckey); }
  q += " ORDER BY date DESC, ABS(weight) DESC LIMIT " + limit;
  const A = analysisMap();
  return db.prepare(q).all(...p).map((s) => ({ ...s, kindLabel: SM_KIND(s.kind), typeLabel: SM.TYPE_LABEL[s.itype] || s.itype, name: A.get(s.symbol) ? A.get(s.symbol).name : s.symbol, inUniverse: A.has(s.symbol) }));
}

// candidates outside the universe worth loading fundamentals for
function addCandidates(limit = 20) {
  const since = new Date(Date.now() - 90 * DAY).toISOString().slice(0, 10);
  const inU = new Set(db.prepare("SELECT symbol FROM universe").all().map((r) => r.symbol));
  return db.prepare("SELECT symbol, SUM(weight) w, COUNT(DISTINCT ckey) n FROM sm_signals WHERE date >= ? AND dir > 0 AND itype NOT IN ('broker','passive','pledge') GROUP BY symbol HAVING w >= 2 ORDER BY w DESC").all(since)
    .filter((r) => !inU.has(r.symbol) && /^[A-Z0-9&-]+$/.test(r.symbol)).slice(0, limit).map((r) => r.symbol);
}

module.exports = { buildSignals, detectTraders, outcomes, statsOf, trackRecord, investors, radar, themes, activity, addCandidates, KIND };
