"use strict";
// Plain-English layer for beginners: a verdict (buy today / buy in parts / wait / don't buy),
// a rule-of-thumb amount, holding guidance, pros & cons, a money summary and news impact.
// Every rule is stated so the reasoning can be checked. This is research, not personal advice.

const isNum = (x) => typeof x === "number" && isFinite(x);
const pct = (x, d = 0) => (isNum(x) ? (x * 100).toFixed(d) + "%" : "n/a");
const rs = (x) => (isNum(x) ? "₹" + Math.round(x).toLocaleString("en-IN") : "n/a");
const crore = (x) => (isNum(x) ? "₹" + Math.round(x / 1e7).toLocaleString("en-IN") + " cr" : "n/a");

const RISK = {
  careful: { pct: 0.03, name: "careful" },
  balanced: { pct: 0.05, name: "balanced" },
  adventurous: { pct: 0.08, name: "adventurous" },
};

// the bear case must not lose more than 5% a year after inflation before we suggest buying
const bearOk = (s) => !!(s && s.bear && s.bear.real >= -0.05);

// ---------------- verdict ----------------
function verdict(a, settings = {}, owned = null) {
  const m = a.metrics || {}, s = a.scenarios, as = a.assumptions;
  const infl = a.inflation || 0.05;
  const targetReal = isFinite(parseFloat(settings.targetReal)) ? parseFloat(settings.targetReal) / 100 : 0.06;
  const targetNom = (1 + targetReal) * (1 + infl) - 1;
  const div = (as && as.divYield) || 0;
  const q = a.score && a.score.groups && a.score.groups.quality && a.score.groups.quality.score;
  const crit = (a.flags || []).filter((f) => f.severity === "critical");
  const tags = (a.tags || []).map((t) => t.code);
  const v = { target: { real: targetReal, nominal: targetNom }, reasons: [], triggers: [] };

  if (m.insufficient) return { ...v, code: "nodata", title: "Not enough data", line: "The free data source doesn't have enough financial history for this company to judge it.", tone: "grey" };

  // prices: buy-below = price at which the base case still earns your target return;
  // stretched = price above which even the base case stops beating inflation.
  if (s && s.base && isNum(s.base.price5)) {
    v.buyBelow = s.base.price5 / Math.pow(1 + Math.max(-0.5, targetNom - div), 5);
    v.stretched = s.base.price5 / Math.pow(1 + Math.max(-0.5, infl - div), 5);
    v.gap = m.price / v.buyBelow - 1; // + means price is above the buy-below price
  }

  if (a.label === "avoid") {
    v.code = "dont"; v.title = "Don't buy"; v.tone = "red";
    v.line = "The business or the price fails too many of the checks.";
    v.reasons = (a.reasons || []).slice(0, 3);
  } else if (crit.length || a.label === "investigate" || !v.buyBelow) {
    v.code = "research"; v.title = "Research before buying"; v.tone = "amber";
    v.line = crit.length ? "There's a serious warning sign to understand first." : !v.buyBelow ? "Its earnings don't allow a reliable price estimate yet." : "Signals are mixed — it needs your own judgement.";
    v.reasons = [...crit.map((f) => f.text), ...(a.reasons || [])].slice(0, 3);
  } else if (a.label === "pass") {
    // no strong signal: for a beginner, "no strong reason to buy" means skip
    v.code = "skip"; v.title = "Skip for now"; v.tone = "grey";
    v.line = "Nothing is badly wrong, but nothing stands out either. There are better-scoring companies to choose from.";
  } else if (bearOk(s) && a.label === "buy" && v.gap <= -0.03) {
    v.code = "buy"; v.title = "Buy today"; v.tone = "green";
    v.line = `It passes every check, and at ${rs(m.price)} it's below the ${rs(v.buyBelow)} price where the expected (base-case) return still beats your ${pct(targetReal)} above-inflation target.`;
  } else if (bearOk(s) && ((a.label === "buy" && v.gap <= 0.10) || (a.label === "watch" && v.gap <= -0.15))) {
    v.code = "parts"; v.title = "Buy in parts"; v.tone = "green";
    v.line = a.label === "buy"
      ? `It passes every check and the price (${rs(m.price)}) is close to the ${rs(v.buyBelow)} buy-below price. Spreading purchases over ~3 months lowers the risk of buying at a short-term high.`
      : `Not a top pick, but the price (${rs(m.price)}) is well below the ${rs(v.buyBelow)} buy-below price. Buy gradually and keep the position modest.`;
  } else if (a.label === "watch" && v.gap <= 0) {
    v.code = "watch"; v.title = "Watch — not compelling yet"; v.tone = "blue";
    v.line = `The price is reasonable but the case isn't strong enough yet (${(a.reasons || [])[0] || "see the scores"}). Keep it on your watchlist.`;
  } else {
    v.code = "wait"; v.title = `Wait — buy below ${rs(v.buyBelow)}`; v.tone = "blue";
    v.line = `At ${rs(m.price)} it's ${pct(v.gap)} above the price that would give you your target return. Add it to your watchlist and you'll get an alert.`;
  }
  if (!v.reasons.length) v.reasons = (a.reasons || []).slice(0, 3);

  // how long to hold
  const compounder = tags.includes("compounder");
  v.hold = compounder ? "5+ years — a quality business tends to reward patience." : tags.includes("emerging") ? "5+ years, but expect big swings along the way." : "3–5 years, reviewing every year.";
  v.triggers = [
    "Profit falls for two years in a row",
    "A new red flag appears (you'll get an alert)",
    v.stretched ? `The price rises above ${rs(v.stretched)} — beyond this even the base case barely beats inflation; consider taking some profit` : null,
    "The promoter / founder sells a large part of their stake",
  ].filter(Boolean);

  // how much: a rule of thumb, never more than a set slice of what you invest
  const invest = parseFloat(settings.investAmount);
  const risk = RISK[settings.riskProfile] || RISK.balanced;
  let mult = 1; const why = [`${(risk.pct * 100).toFixed(0)}% per stock for a ${risk.name} investor`];
  if (!(q >= 65)) { mult *= 0.7; why.push("trimmed because quality is not top-tier"); }
  if (isNum(m.mcap) && m.mcap < 10000e7) { mult *= 0.6; why.push("trimmed because it's a smaller company (more volatile)"); }
  if (isNum(m.maxDrawdown3y) && m.maxDrawdown3y < -0.4) { mult *= 0.8; why.push("trimmed because the price has fallen 40%+ before"); }
  if (a.label === "pass") { mult *= 0.6; why.push("trimmed because there's no strong signal"); }
  v.size = { pct: risk.pct * mult, why };
  if (invest > 0 && ["buy", "parts", "wait", "watch"].includes(v.code)) {
    v.size.amount = Math.round((invest * risk.pct * mult) / 1000) * 1000;
    v.size.shares = m.price > 0 ? Math.floor(v.size.amount / m.price) : 0;
    if (v.size.shares < 1 && m.price > 0) v.size.note = `One share costs ${rs(m.price)}, more than this amount — consider a mutual fund instead, or a larger total budget.`;
    if (v.code === "parts") v.size.plan = `${rs(v.size.amount / 3)} now, then the same amount in each of the next 2 months.`;
    else if (v.code === "buy") v.size.plan = `Can be invested now, or in 2 parts a month apart if you prefer.`;
    else if (v.code === "wait" || v.code === "watch") v.size.plan = `Keep this amount ready; buy if the price drops below ${rs(v.buyBelow)}.`;
    else v.size.plan = "No amount suggested until the concerns are resolved.";
  }

  // if you already own it
  if (owned) {
    if (v.code === "dont") v.owned = { title: "Review — consider exiting", line: "The checks have turned negative. Read the reasons and decide whether your original reason for buying still holds." };
    else if (v.stretched && m.price > v.stretched) v.owned = { title: "Consider trimming", line: `The price is above ${rs(v.stretched)}, where even the base case barely beats inflation. Taking some profit is reasonable; keep the rest if the business stays strong.` };
    else if (v.code === "research") v.owned = { title: "Hold, but check the warning", line: "Don't add more until you've understood the red flag." };
    else v.owned = { title: "Hold", line: v.code === "buy" || v.code === "parts" ? "It still looks good value — you could add more within your per-stock limit." : "Keep holding; there's no reason to sell, but it's not cheap enough to add." };
  }
  return v;
}

// ---------------- money summary in plain English ----------------
function moneySummary(a) {
  const m = a.metrics || {};
  if (m.insufficient) return [];
  const t = [];
  t.push({ k: "Sales (revenue)", v: crore(m.revenue), sub: isNum(m.revYoy) ? `${m.revYoy >= 0 ? "+" : ""}${pct(m.revYoy)} vs last year · ${pct(m.revCagr)}/yr over ${m.years - 1} yrs` : "",
    tone: m.revCagr >= 0.12 ? "good" : m.revCagr >= 0.05 ? "ok" : "bad", explain: "Total money customers paid the company in a year." });
  t.push({ k: "Profit", v: crore(m.netIncome), sub: isNum(m.niYoy) ? `${m.niYoy >= 0 ? "+" : ""}${pct(m.niYoy)} vs last year` : "",
    tone: m.netIncome <= 0 ? "bad" : m.niCagr >= 0.12 ? "good" : "ok", explain: "What's left after every cost and tax — this belongs to shareholders." });
  if (isNum(m.npm)) t.push({ k: "Profit margin", v: pct(m.npm, 1), sub: `Keeps ₹${(m.npm * 100).toFixed(0)} of every ₹100 of sales as profit`, tone: m.npm >= 0.15 ? "good" : m.npm >= 0.07 ? "ok" : "bad", explain: "Higher margins usually mean pricing power or efficiency." });
  const r = m.fin ? m.roe : m.roce;
  if (isNum(r)) t.push({ k: m.fin ? "Return on equity" : "Return on capital", v: pct(r, 1), sub: `Earns ₹${(r * 100).toFixed(0)} a year for every ₹100 ${m.fin ? "of shareholders' money" : "invested in the business"}`, tone: r >= 0.2 ? "good" : r >= 0.12 ? "ok" : "bad", explain: "The best single sign of a good business: how much profit it squeezes out of the money tied up in it. Above 15–20% is strong." });
  if (m.fin) t.push({ k: "Debt", v: "Lender", sub: "Borrowing and lending is its business, so debt isn't judged the usual way", tone: "ok", explain: "For banks and finance companies, check loan quality (NPAs) in the annual report instead." });
  else if (isNum(m.de)) t.push({ k: "Debt", v: m.de < 0.05 ? "Almost none" : (m.de).toFixed(2) + "× equity", sub: m.de < 0.3 ? "Comfortable — little risk from borrowing" : m.de <= 1 ? "Moderate borrowing" : "Heavy borrowing — risky if business slows", tone: m.de < 0.3 ? "good" : m.de <= 1 ? "ok" : "bad", explain: "Debt compared with the owners' money. Low debt means the company can survive bad years." });
  if (isNum(m.cashConv)) t.push({ k: "Cash generation", v: (m.cashConv * 100).toFixed(0) + "%", sub: m.cashConv >= 0.9 ? "Profits turn into real cash" : m.cashConv >= 0.6 ? "Some profit is stuck in unpaid bills or stock" : "Profits aren't turning into cash — a warning sign", tone: m.cashConv >= 0.9 ? "good" : m.cashConv >= 0.6 ? "ok" : "bad", explain: "Cash actually collected compared with reported profit. Accounting profit can be flattered; cash is harder to fake." });
  if (isNum(m.pe)) {
    const rel = isNum(a.peerPe) && a.peerPe > 0 ? m.pe / a.peerPe : null;
    t.push({ k: "Price tag (P/E)", v: m.pe.toFixed(1) + "×", sub: `You pay ₹${m.pe.toFixed(0)} for each ₹1 of yearly profit${isNum(a.peerPe) ? `; similar companies: ₹${a.peerPe.toFixed(0)}` : ""}`, tone: rel == null ? "ok" : rel < 0.85 ? "good" : rel <= 1.2 ? "ok" : "bad", explain: "How many years of today's profit you're paying for. Lower is cheaper — but cheap can mean the market expects problems." });
  }
  t.push({ k: "Dividend", v: m.divYield > 0 ? pct(m.divYield, 1) + " a year" : "None", sub: m.divYield > 0 ? `≈ ${rs(m.divYield * 100000)} a year on ₹1 lakh invested` : "Reinvests profits instead of paying them out", tone: "ok", explain: "Cash paid to shareholders. Not essential — growing companies often reinvest instead." });
  if (isNum(m.avgDailyTurnoverCr)) t.push({ k: "Liquidity", v: m.avgDailyTurnoverCr < 1 ? "Very low" : m.avgDailyTurnoverCr < 5 ? "Low" : m.avgDailyTurnoverCr < 20 ? "Moderate" : "Good", sub: `≈₹${m.avgDailyTurnoverCr < 10 ? m.avgDailyTurnoverCr.toFixed(1) : Math.round(m.avgDailyTurnoverCr)} cr traded per day on average`, tone: m.avgDailyTurnoverCr < 1 ? "bad" : m.avgDailyTurnoverCr < 5 ? "bad" : m.avgDailyTurnoverCr < 20 ? "ok" : "good", explain: "How much trading happens each day. Low liquidity means your buy or sell order could move the price against you, especially for amounts above a few lakhs." });
  return t;
}

// ---------------- pros & cons ----------------
function prosCons(a, prof) {
  const m = a.metrics || {}, pros = [], cons = [];
  if (m.insufficient) return { pros, cons: ["Not enough financial history in the free data to judge."] };
  const r = m.fin ? m.roe : m.roce;
  if (r >= 0.2) pros.push(`Very profitable business: earns ${pct(r)} a year on the money invested in it.`);
  else if (isNum(r) && r < 0.1 && !m.fin) cons.push(`Low returns: earns only ${pct(r)} on the money invested in it.`);
  if (!m.fin && isNum(m.de) && m.de < 0.1) pros.push("Almost no debt — can ride out a bad year.");
  if (m.revCagr >= 0.15) pros.push(`Growing fast: sales up ${pct(m.revCagr)} a year.`);
  else if (isNum(m.revCagr) && m.revCagr < 0.05) cons.push(`Slow growth: sales up only ${pct(m.revCagr)} a year — barely keeping up with inflation.`);
  if (m.cashConv >= 0.9) pros.push("Profits are backed by real cash coming in.");
  if (isNum(m.npmTrend) && m.npmTrend > 0.03) pros.push(`Margins improving: net margin up ${(m.npmTrend * 100).toFixed(1)} points over ${m.years - 1} years.`);
  if (isNum(m.pe) && isNum(a.peerPe) && m.pe < a.peerPe * 0.8) pros.push(`Cheaper than similar companies (P/E ${m.pe.toFixed(0)} vs ${a.peerPe.toFixed(0)}).`);
  if (isNum(m.pe) && isNum(a.peerPe) && m.pe > a.peerPe * 1.3) cons.push(`Expensive compared with similar companies (P/E ${m.pe.toFixed(0)} vs ${a.peerPe.toFixed(0)}) — less room for error.`);
  if (m.divYield >= 0.02) pros.push(`Pays a dividend of about ${pct(m.divYield, 1)} a year.`);
  if (isNum(m.niCagr) && isNum(m.revCagr) && m.niCagr > m.revCagr * 2 && m.niCagr > 0.3) cons.push(`Profit growth (${pct(m.niCagr)}/yr) far outpaced sales growth — partly a recovery from a weak year; don't expect it to repeat.`);
  if (isNum(m.maxDrawdown3y) && m.maxDrawdown3y < -0.35) cons.push(`Volatile: the share price fell ${pct(-m.maxDrawdown3y)} from a peak in the last 3 years.`);
  const expensive = cons.some((c) => c.startsWith("Expensive"));
  for (const f of a.flags || []) if (f.severity !== "info" && !(expensive && f.code === "valuation") && !cons.some((c) => c.includes(f.text.slice(0, 20)))) cons.push(f.text);
  for (const f of a.flags || []) if (f.code === "cyclical") cons.push("Cyclical industry: profits rise and fall with the economy.");
  const sh = prof && prof.shareholding, L = sh && sh.latest;
  if (L) {
    if (L.cats.promoter >= 0.5) pros.push(`Founders/promoters own ${pct(L.cats.promoter)} — they have a lot at stake.`);
    else if (L.cats.promoter > 0 && L.cats.promoter < 0.3) cons.push(`Promoters own only ${pct(L.cats.promoter)}.`);
    for (const c of sh.changes || []) {
      if (c.cat === "promoter" && c.delta <= -0.01) cons.push(`Promoters reduced their stake from ${pct(c.from, 1)} to ${pct(c.to, 1)} last quarter — find out why.`);
      if ((c.cat === "mf" || c.cat === "fii") && c.delta >= 0.01) pros.push(`${c.cat === "mf" ? "Mutual funds" : "Foreign investors"} increased their stake (${pct(c.from, 1)} → ${pct(c.to, 1)}) last quarter.`);
      if ((c.cat === "mf" || c.cat === "fii") && c.delta <= -0.015) cons.push(`${c.cat === "mf" ? "Mutual funds" : "Foreign investors"} cut their stake (${pct(c.from, 1)} → ${pct(c.to, 1)}) last quarter.`);
    }
  }
  if (m.fin) cons.push("It's a financial company: the quality of its loans or investments isn't in the free data — check the annual report.");
  return { pros: pros.slice(0, 7), cons: cons.slice(0, 7) };
}

// ---------------- ownership in plain English ----------------
const CAT_NAMES = { promoter: "Founders / promoters", fii: "Foreign investors (FIIs)", mf: "Mutual funds", insurance: "Insurance companies", otherDomestic: "Other Indian institutions", retail: "Individual investors", nri: "NRIs", corporate: "Companies", government: "Government" };
function ownership(prof) {
  const sh = prof && prof.shareholding;
  if (!sh || !sh.latest) return null;
  const c = sh.latest.cats;
  const parts = Object.keys(CAT_NAMES).map((k) => ({ key: k, label: CAT_NAMES[k], pct: c[k] || 0 })).filter((x) => x.pct > 0.001);
  const named = sh.latest.holders.filter((h) => !h.promoter).slice(0, 10);
  const changes = (sh.changes || []).map((x) => ({ ...x, label: CAT_NAMES[x.cat] || x.cat }));
  const trend = sh.quarters.map((q) => ({ date: q.date, promoter: q.promoter / 100 }));
  return { asOf: sh.asOf, parts, named, changes, trend, source: sh.source };
}

// ---------------- news impact ----------------
const POS = /\b(order|contract|wins?|bags|acquisitions?|acquires?|record (high|sales|profit|revenue)|profit (rises|jumps|up|surges|grows)|revenue (rises|jumps|up|grows)|upgrade[ds]?|dividend|bonus|buyback|expan\w+|launch\w*|approv\w+|capacity|raises stake|beats? estimates|strong (results|growth|demand))\b/i;
const NEG = /\b(penalt\w+|fined?|raid\w*|fraud|resign\w*|downgrade[ds]?|net loss|loss widens|profit (falls|drops|declines|down|slumps)|revenue (falls|declines|drops)|default\w*|pledg\w+|show.cause|sebi order|fire|strike|recall\w*|lawsuit|litigation|tax demand|gst demand|insolvency|probe|cuts? guidance|sells? stake|stake sale|misses estimates|plunges?|slumps?|crash\w*)\b/i;
const KINDS = [
  [/financial results|quarterly results|results for the|q[1-4] results|earnings/i, "Results", "Shows whether sales and profit are growing as expected — the most important regular update."],
  [/outcome of board meeting/i, "Board decision", "Board meetings approve results, dividends, fund-raising or big investments."],
  [/acqui|merger|amalgamation|scheme of arrangement|demerger/i, "Deal", "Buying or merging businesses can change growth and risk a lot."],
  [/order|contract/i, "New business", "New orders show demand for the company's products."],
  [/credit rating|rating/i, "Rating", "A rating change affects how cheaply it can borrow."],
  [/resign|appointment|cessation|change in (director|management|auditor|kmp)/i, "Management", "Changes at the top — an auditor or CFO resigning deserves attention."],
  [/dividend|bonus|split|buyback/i, "Shareholder reward", "Cash or extra shares returned to shareholders."],
  [/extraordinary general meeting|egm|postal ballot/i, "Shareholder vote", "Shareholders are being asked to approve something significant — read what."],
  [/fund rais|qip|preferential|rights issue|ncd|debentures/i, "Fund-raising", "New shares can dilute your stake; new debt adds risk."],
  [/monthly business|sales (volume|update)|production/i, "Business update", "Monthly sales/volume figures give an early read on demand."],
];
function newsImpact(title, text = "") {
  const t = title + " " + text;
  const kind = (KINDS.find(([re]) => re.test(t)) || [null, "Update", "General company update."]);
  const pos = POS.test(t), neg = NEG.test(t);
  const tone = pos && !neg ? "positive" : neg && !pos ? "negative" : "neutral";
  const important = /Results|Deal|Rating|Management|Fund-raising|Shareholder vote/.test(kind[1]) || tone !== "neutral";
  return { kind: kind[1], why: kind[2], tone, important };
}
function newsFeed(prof, news) {
  const out = [];
  for (const a of (prof && prof.announcements) || []) {
    const imp = newsImpact(a.title, a.text);
    out.push({ date: parseNseDate(a.date), title: a.title, detail: a.text.replace(/^.*?has (informed|submitted)[^.]*?(regarding|about)\s*/i, "").slice(0, 220), link: a.link, source: "NSE filing (official)", official: true, ...imp });
  }
  for (const n of news || []) { const imp = newsImpact(n.title); out.push({ date: n.published, title: n.title, detail: "", link: n.link, source: n.source, official: false, ...imp }); }
  // drop near-duplicate official filings (same title on the same day)
  const seen = new Set();
  return out.filter((x) => { const k = (x.date || "").slice(0, 10) + x.title; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((x, y) => String(y.date).localeCompare(String(x.date))).slice(0, 20);
}
function parseNseDate(s) { const d = new Date(String(s || "").replace(/(\d{2})-(\w{3})-(\d{4})/, "$2 $1, $3")); return isNaN(d) ? s : d.toISOString(); }

module.exports = { verdict, moneySummary, prosCons, ownership, newsImpact, newsFeed, RISK };
