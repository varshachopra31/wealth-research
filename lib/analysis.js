"use strict";
// Pure analysis functions (no I/O) so every number is testable and explainable.
// Inputs: annual fundamentals (Yahoo, raw INR), weekly price series, industry, CPI.

const CR = 1e7; // 1 crore
const isNum = (x) => typeof x === "number" && isFinite(x);
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const median = (a) => { const s = a.filter(isNum).sort((x, y) => x - y); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const stdev = (a) => { if (a.length < 2) return null; const m = avg(a); return Math.sqrt(avg(a.map((x) => (x - m) ** 2))); };
function cagr(first, last, years) {
  if (!isNum(first) || !isNum(last) || first <= 0 || last <= 0 || years <= 0) return null;
  return Math.pow(last / first, 1 / years) - 1;
}

const FIN_RE = /financial services/i;

// ---------- 1. Metrics ----------
function computeMetrics({ years, price, series, industry }) {
  const ys = (years || []).filter((y) => isNum(y.rev) || isNum(y.ni));
  const m = { years: ys.length, notes: [] };
  if (!ys.length || !isNum(price)) { m.insufficient = true; m.notes.push(!ys.length ? "No annual financials available from the free source." : "No current price."); return m; }
  const L = ys[ys.length - 1], P = ys.length > 1 ? ys[ys.length - 2] : null, F = ys[0];
  const span = ys.length - 1;
  m.fin = FIN_RE.test(industry || "") || (!isNum(L.ebit) && !isNum(L.curLiab));
  m.cyclical = isCyclical(industry);
  m.latestFy = L.fy;
  m.price = price;
  m.shares = L.shares;
  m.mcap = isNum(L.shares) ? price * L.shares : null;
  m.revenue = L.rev; m.netIncome = L.ni;
  m.eps = isNum(L.ni) && isNum(L.shares) && L.shares > 0 ? L.ni / L.shares : null;
  m.pe = m.eps > 0 ? price / m.eps : null;
  // One-off gains (demerger/asset-sale/write-back) make profit exceed operating profit and the P/E look absurdly low.
  m.oneOff = !FIN_RE.test(industry || "") && isNum(L.ni) && L.ni > 0 && ((isNum(L.opInc) && L.opInc > 0 && L.ni > 1.3 * L.opInc) || (m.pe != null && m.pe < 5));
  m.epsNormalised = m.oneOff && isNum(L.opInc) && L.opInc > 0 && L.shares > 0 ? (L.opInc * 0.75) / L.shares : null;
  m.pb = isNum(m.mcap) && L.equity > 0 ? m.mcap / L.equity : null;
  const avgEq = P && isNum(P.equity) && isNum(L.equity) ? (P.equity + L.equity) / 2 : L.equity;
  m.roe = isNum(L.ni) && avgEq > 0 ? L.ni / avgEq : null;
  m.roa = isNum(L.ni) && L.assets > 0 ? L.ni / L.assets : null;
  const capEmp = isNum(L.assets) && isNum(L.curLiab) ? L.assets - L.curLiab : null;
  m.roce = !m.fin && isNum(L.ebit) && capEmp > 0 ? L.ebit / capEmp : null;
  m.opm = isNum(L.opInc) && L.rev > 0 ? L.opInc / L.rev : null;
  m.npm = isNum(L.ni) && L.rev > 0 ? L.ni / L.rev : null;
  m.de = !m.fin && isNum(L.debt) && L.equity > 0 ? L.debt / L.equity : null;
  m.intCover = !m.fin && isNum(L.ebit) && L.intExp > 0 ? L.ebit / L.intExp : (!m.fin && isNum(L.ebit) && (L.intExp === 0 || L.intExp == null) && L.ebit > 0 ? 99 : null);
  const ocfS = ys.filter((y) => isNum(y.ocf) && isNum(y.ni));
  const niSum = ocfS.reduce((s, y) => s + y.ni, 0);
  m.cashConv = !m.fin && ocfS.length >= 2 && niSum > 0 ? ocfS.reduce((s, y) => s + y.ocf, 0) / niSum : null;
  const fcf = isNum(L.fcf) ? L.fcf : (isNum(L.ocf) && isNum(L.capex) ? L.ocf + L.capex : null);
  m.fcfYield = !m.fin && isNum(fcf) && m.mcap > 0 ? fcf / m.mcap : null;
  m.earningsYield = m.pe ? 1 / m.pe : (isNum(m.eps) && m.eps <= 0 ? m.eps / price : null);
  m.divYield = isNum(L.div) && m.mcap > 0 ? Math.abs(L.div) / m.mcap : 0;
  m.payout = isNum(L.div) && L.ni > 0 ? Math.abs(L.div) / L.ni : null;
  m.netCash = isNum(L.cash) && isNum(L.debt) && !m.fin ? L.cash - L.debt : null;
  m.revCagr = cagr(F.rev, L.rev, span);
  m.niCagr = cagr(F.ni, L.ni, span);
  m.revYoy = P ? cagr(P.rev, L.rev, 1) : null;
  m.niYoy = P ? cagr(P.ni, L.ni, 1) : null;
  m.revAccel = isNum(m.revYoy) && isNum(m.revCagr) ? m.revYoy - m.revCagr : null;
  const npms = ys.filter((y) => y.rev > 0 && isNum(y.ni)).map((y) => y.ni / y.rev);
  m.npmTrend = npms.length >= 2 ? npms[npms.length - 1] - npms[0] : null;
  m.npmStd = npms.length >= 3 ? stdev(npms) : null;
  m.recvCagr = cagr(F.recv, L.recv, span);
  m.recvGap = isNum(m.recvCagr) && isNum(m.revCagr) ? m.recvCagr - m.revCagr : null;
  m.shareCagr = cagr(F.shares, L.shares, span);
  m.peg = m.pe && m.niCagr > 0.01 ? m.pe / (m.niCagr * 100) : null;
  m.lossYears = ys.filter((y) => isNum(y.ni) && y.ni < 0).length;
  m.negOcfWhileProfit = !m.fin ? ys.slice(-3).filter((y) => isNum(y.ocf) && y.ocf < 0 && y.ni > 0).length : 0;
  // price-based
  if (Array.isArray(series) && series.length > 10) {
    const last = series[series.length - 1][1];
    const at = (weeksBack) => { const i = series.length - 1 - weeksBack; return i >= 0 ? series[i][1] : null; };
    const p52 = at(52), p156 = at(156);
    m.ret1y = p52 ? last / p52 - 1 : null;
    m.ret3yCagr = p156 ? Math.pow(last / p156, 1 / 3) - 1 : null;
    const win = series.slice(-156).map((x) => x[1]);
    let peak = -Infinity, mdd = 0;
    for (const v of win) { peak = Math.max(peak, v); mdd = Math.min(mdd, v / peak - 1); }
    m.maxDrawdown3y = mdd;
    m.fromHigh3y = last / Math.max(...win) - 1;
  }
  if (ys.length < 3) m.notes.push(`Only ${ys.length} year(s) of financials — growth rates are less reliable.`);
  if (m.fin) m.notes.push("Financial-sector company: ROCE, debt/equity, interest cover and FCF are not meaningful and are excluded; ROE/ROA/P-B used instead. Asset quality (NPAs, capital adequacy) is not in the free data, and the free source's equity figure for banks can differ from the reported net worth — verify ROE against the annual report.");
  return m;
}

// ---------- 2. Red flags ----------
function redFlags(m) {
  const f = [];
  const add = (severity, code, text) => f.push({ severity, code, text });
  if (m.insufficient) return f;
  if (isNum(m.netIncome) && m.netIncome < 0) add("critical", "loss", "Loss-making in the latest year.");
  if (m.lossYears >= 2) add("warn", "loss_hist", `${m.lossYears} loss-making years in the last ${m.years}.`);
  if (m.negOcfWhileProfit >= 2) add("critical", "ocf", "Reported profit but negative operating cash flow in 2+ of the last 3 years — earnings quality concern.");
  if (isNum(m.de) && m.de > 2) add("critical", "debt", `High leverage: debt/equity ${m.de.toFixed(2)}.`);
  else if (isNum(m.de) && m.de > 1) add("warn", "debt", `Elevated debt/equity ${m.de.toFixed(2)}.`);
  if (isNum(m.intCover) && m.intCover < 1.5) add("critical", "intcover", `Interest cover only ${m.intCover.toFixed(1)}x — earnings barely cover interest.`);
  else if (isNum(m.intCover) && m.intCover < 3) add("warn", "intcover", `Thin interest cover ${m.intCover.toFixed(1)}x.`);
  if (isNum(m.cashConv) && m.cashConv < 0.6) add("warn", "cashconv", `Weak cash conversion: operating cash flow is ${(m.cashConv * 100).toFixed(0)}% of profit over the period.`);
  if (isNum(m.recvGap) && m.recvGap > 0.1 && m.revCagr != null) add("warn", "recv", `Receivables growing ${(m.recvGap * 100).toFixed(0)} pts/yr faster than revenue — check collections / revenue recognition.`);
  if (isNum(m.shareCagr) && m.shareCagr > 0.05) add("warn", "dilution", `Share count growing ${(m.shareCagr * 100).toFixed(1)}%/yr — shareholder dilution.`);
  if (isNum(m.npmTrend) && m.npmTrend < -0.05) add("warn", "margin", `Net margin fell ${(-m.npmTrend * 100).toFixed(1)} pts over the period.`);
  if (isNum(m.revCagr) && m.revCagr < 0) add("warn", "shrink", `Revenue shrinking ${(m.revCagr * 100).toFixed(1)}%/yr.`);
  if (isNum(m.pe) && m.pe > 80) add("warn", "valuation", `Very high P/E of ${m.pe.toFixed(0)} — little margin of safety.`);
  if (isNum(m.payout) && m.payout > 1.1) add("warn", "payout", `Paying out ${(m.payout * 100).toFixed(0)}% of profit as dividends — not sustainable long-term.`);
  if (m.oneOff) add("warn", "oneoff", `Latest profit looks inflated by one-off gains (net profit ${m.pe != null && m.pe < 5 ? `gives an implausible P/E of ${m.pe.toFixed(1)}` : "exceeds operating profit by 30%+"}). Scenarios use normalised earnings (operating profit after 25% tax${m.epsNormalised ? `, EPS ₹${m.epsNormalised.toFixed(1)}` : ""}); check the exceptional items in the annual report.`);
  if (m.cyclical) add("info", "cyclical", "Cyclical sector: a low P/E can mean earnings are near a peak, not that the stock is cheap. Scenarios assume no growth above the long-run rate and no re-rating.");
  if (isNum(m.fromHigh3y) && m.fromHigh3y < -0.4) add("info", "drawdown", `Price is ${(-m.fromHigh3y * 100).toFixed(0)}% below its 3-year high — find out why before treating it as cheap.`);
  return f;
}

// ---------- 3. Percentile scoring ----------
// Each factor is ranked within the universe (or within its industry for valuation)
// so scores are relative, explainable, and not tied to arbitrary thresholds.
const FACTORS = {
  quality: [
    { key: "roe", w: 1, dir: 1, label: "Return on equity" },
    { key: "roce", w: 1.2, dir: 1, label: "Return on capital employed", nonFin: true },
    { key: "roa", w: 1, dir: 1, label: "Return on assets", finOnly: true },
    { key: "cashConv", w: 1, dir: 1, label: "Cash conversion (OCF ÷ profit)", nonFin: true },
    { key: "de", w: 0.8, dir: -1, label: "Debt / equity (lower better)", nonFin: true },
    { key: "intCover", w: 0.6, dir: 1, label: "Interest cover", nonFin: true },
    { key: "npmStd", w: 0.5, dir: -1, label: "Margin stability (lower volatility better)" },
  ],
  growth: [
    { key: "revCagr", w: 1, dir: 1, label: "Revenue growth (CAGR)" },
    { key: "niCagr", w: 1, dir: 1, label: "Profit growth (CAGR)" },
    { key: "revAccel", w: 0.4, dir: 1, label: "Growth acceleration (latest yr vs CAGR)" },
    { key: "npmTrend", w: 0.5, dir: 1, label: "Margin trend" },
  ],
  value: [
    { key: "earningsYield", w: 1.2, dir: 1, label: "Earnings yield (1/PE)", peer: true },
    { key: "fcfYield", w: 1, dir: 1, label: "Free-cash-flow yield", nonFin: true, peer: true },
    { key: "pb", w: 0.6, dir: -1, label: "Price / book (lower better)", peer: true },
    { key: "peg", w: 0.6, dir: -1, label: "PEG (P/E ÷ growth, lower better)" },
  ],
  safety: [
    { key: "maxDrawdown3y", w: 1, dir: 1, label: "3-yr max drawdown (shallower better)" },
    { key: "netCashRatio", w: 0.6, dir: 1, label: "Net cash ÷ market cap", nonFin: true },
  ],
};
const WEIGHTS = { quality: 0.35, growth: 0.25, value: 0.25, safety: 0.15 };

function pctRank(sorted, v) {
  if (!sorted.length) return null;
  let lo = 0, hi = sorted.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] < v) lo = mid + 1; else hi = mid; }
  let eq = lo; while (eq < sorted.length && sorted[eq] === v) eq++;
  return ((lo + eq) / 2) / sorted.length * 100;
}

function scoreUniverse(items) {
  // items: [{symbol, industry, m}]
  for (const it of items) if (it.m && !it.m.insufficient) it.m.netCashRatio = isNum(it.m.netCash) && it.m.mcap > 0 ? it.m.netCash / it.m.mcap : null;
  const live = items.filter((x) => x.m && !x.m.insufficient);
  const dist = {}, peerDist = {};
  const keyOf = (f) => f.key;
  for (const g of Object.values(FACTORS)) for (const f of g) {
    dist[keyOf(f)] = live.map((x) => x.m[f.key]).filter(isNum).sort((a, b) => a - b);
    if (f.peer) {
      peerDist[f.key] = {};
      for (const x of live) if (isNum(x.m[f.key])) (peerDist[f.key][x.industry] = peerDist[f.key][x.industry] || []).push(x.m[f.key]);
      for (const k in peerDist[f.key]) peerDist[f.key][k].sort((a, b) => a - b);
    }
  }
  // negative P/E → earnings yield negative ranks at bottom naturally; PEG only defined for positive growth
  const indMedPe = {};
  for (const x of live) if (x.m.pe > 0 && x.m.pe < 200) (indMedPe[x.industry] = indMedPe[x.industry] || []).push(x.m.pe);
  const uniMedPe = median(live.map((x) => x.m.pe).filter((v) => v > 0 && v < 200));
  for (const k in indMedPe) indMedPe[k] = indMedPe[k].length >= 6 ? median(indMedPe[k]) : uniMedPe;

  for (const it of items) {
    const out = { groups: {}, composite: null };
    it.score = out;
    it.peerPe = indMedPe[it.industry] || uniMedPe;
    if (!it.m || it.m.insufficient) continue;
    let comp = 0, compW = 0;
    for (const [g, list] of Object.entries(FACTORS)) {
      let s = 0, w = 0; const parts = [];
      for (const f of list) {
        if (f.nonFin && it.m.fin) continue;
        if (f.finOnly && !it.m.fin) continue;
        const v = it.m[f.key];
        if (!isNum(v)) { parts.push({ key: f.key, label: f.label, value: null, pct: null, weight: f.w }); continue; }
        const usePeer = f.peer && peerDist[f.key] && peerDist[f.key][it.industry] && peerDist[f.key][it.industry].length >= 8;
        let pct = pctRank(usePeer ? peerDist[f.key][it.industry] : dist[f.key], v);
        if (f.dir < 0) pct = 100 - pct;
        parts.push({ key: f.key, label: f.label, value: v, pct, weight: f.w, vs: usePeer ? "industry" : "universe" });
        s += pct * f.w; w += f.w;
      }
      const flagPenalty = g === "safety" ? Math.min(40, (it.flags || []).filter((x) => x.severity !== "info").reduce((a, x) => a + (x.severity === "critical" ? 20 : 7), 0)) : 0;
      const gs = w ? clamp(s / w - flagPenalty, 0, 100) : null;
      out.groups[g] = { score: gs, parts, penalty: flagPenalty };
      if (gs != null) { comp += gs * WEIGHTS[g]; compW += WEIGHTS[g]; }
    }
    out.composite = compW ? comp / compW : null;
  }
  return { uniMedPe, indMedPe };
}

// ---------- 4. Five-year scenarios ----------
// Long-run anchor for corporate earnings growth ≈ India's nominal GDP growth.
const LONG_RUN_GROWTH = 0.10;
const CYCLICAL_RE = /metals|mining|oil|gas|consumable fuels|construction materials|chemicals|textiles/i;
const isCyclical = (industry) => CYCLICAL_RE.test(industry || "");

function defaultAssumptions(m, peerPe, industry) {
  if (!m || m.insufficient || !(m.eps > 0) || !(m.pe > 0)) return null;
  if (m.oneOff && !(m.epsNormalised > 0)) return null;
  const eps0 = m.oneOff ? m.epsNormalised : m.eps;
  // Revenue growth is steadier than profit growth (profit can triple off a bad base year), so weight it 70/30.
  const hist = isNum(m.niCagr) && isNum(m.revCagr) ? 0.7 * m.revCagr + 0.3 * m.niCagr : (isNum(m.revCagr) ? m.revCagr : (isNum(m.niCagr) ? m.niCagr : 0.08));
  const cyc = isCyclical(industry);
  // Base growth: 60% recent history, 40% long-run anchor (high growth rarely persists); capped at 15%.
  // Cyclicals: recent growth is mostly the cycle, so use at most the long-run anchor.
  let base = clamp(0.6 * hist + 0.4 * LONG_RUN_GROWTH, -0.05, 0.15);
  if (cyc) base = Math.min(base, LONG_RUN_GROWTH * 0.8);
  const bear = clamp(base - Math.max(0.06, Math.abs(base) * 0.6), -0.12, base);
  const bull = clamp(base + Math.max(0.04, base * 0.3), base, 0.22);
  const anchor = isNum(peerPe) && peerPe > 0 ? peerPe : m.pe;
  const pe0 = m.price / eps0;
  // Asymmetric multiple reversion: expensive stocks de-rate halfway to peers; cheap ones re-rate only 30% of the way.
  const baseExit = clamp(pe0 > anchor ? pe0 - 0.5 * (pe0 - anchor) : pe0 + (cyc ? 0 : 0.3) * (anchor - pe0), 5, 60);
  const bearExit = clamp(Math.min(pe0, anchor) * 0.75, 5, 60);
  const bullExit = clamp(pe0 > anchor ? pe0 : Math.max(baseExit, Math.min(anchor, pe0 * 1.5)), 5, 60);
  return {
    growth: { bear: round4(bear), base: round4(base), bull: round4(bull) },
    exitPe: { bear: round2(bearExit), base: round2(Math.min(baseExit, bullExit)), bull: round2(bullExit) },
    divYield: round4(m.divYield || 0),
    eps0: eps0, normalised: !!m.oneOff,
    derivedFrom: { historicGrowth: round4(hist), peerPe: round2(anchor), currentPe: round2(pe0), cyclical: cyc, longRun: LONG_RUN_GROWTH },
  };
}
const round2 = (x) => Math.round(x * 100) / 100;
const round4 = (x) => Math.round(x * 10000) / 10000;

function scenarioReturns(m, a, inflation) {
  if (!a) return null;
  const out = {};
  for (const k of ["bear", "base", "bull"]) {
    const g = a.growth[k], pe = a.exitPe[k];
    const eps5 = (a.eps0 || m.eps) * Math.pow(1 + g, 5);
    const price5 = eps5 * pe;
    const priceCagr = Math.pow(price5 / m.price, 1 / 5) - 1;
    const nominal = priceCagr + (a.divYield || 0);
    const real = (1 + nominal) / (1 + inflation) - 1;
    out[k] = { eps5, price5, priceCagr, nominal, real, multiple5y: Math.pow(1 + nominal, 5) };
  }
  return out;
}

// ---------- 5. Tags and labels ----------
function tags(m, score) {
  const t = [];
  if (!m || m.insufficient) return t;
  const crore = m.mcap / CR;
  if (m.revCagr >= 0.2 && (m.revAccel == null || m.revAccel >= -0.03) && (m.npmTrend == null || m.npmTrend > 0) && m.netIncome > 0 && crore < 30000)
    t.push({ code: "emerging", text: "Emerging growth" });
  if ((m.fin ? m.roe >= 0.15 : m.roce >= 0.2) && (m.fin || m.cashConv >= 0.8) && m.revCagr >= 0.1 && (m.fin || m.de == null || m.de < 0.5))
    t.push({ code: "compounder", text: "Quality compounder" });
  if (isNum(m.npmTrend) && m.npmTrend > 0.05 && m.netIncome > 0 && m.lossYears >= 1) t.push({ code: "turnaround", text: "Turnaround" });
  if (m.pe > 70 && (m.niCagr == null || m.niCagr < 0.2)) t.push({ code: "hype", text: "Hype risk" });
  if (score && score.groups.value && score.groups.value.score >= 70 && score.groups.quality && score.groups.quality.score >= 55) t.push({ code: "value", text: "Quality at a fair price" });
  return t;
}

function label({ m, score, flags, scen }) {
  const reasons = [];
  if (!m || m.insufficient) return { label: "investigate", reasons: ["Not enough free data to analyse — check filings manually."] };
  const crit = flags.filter((f) => f.severity === "critical");
  const q = score.groups.quality && score.groups.quality.score;
  const g = score.groups.growth && score.groups.growth.score;
  const v = score.groups.value && score.groups.value.score;
  const c = score.composite;
  const base = scen && scen.base.real, bear = scen && scen.bear.real;
  const pct = (x) => (x * 100).toFixed(1) + "%";
  if (crit.length) {
    reasons.push(...crit.map((f) => f.text));
    if ((q != null && q < 45) || c < 40) return { label: "avoid", reasons };
    return { label: "investigate", reasons: [...reasons, "Strong elsewhere — resolve the red flag before acting."] };
  }
  if (!scen) return { label: "investigate", reasons: ["Scenario returns not computable (no positive earnings)."] };
  if (m.oneOff) return { label: "investigate", reasons: ["Latest profit includes one-off gains, so headline P/E and growth are misleading. Base-case real return on normalised earnings: " + pct(base) + "/yr."] };
  if (c >= 60 && q >= 55 && base >= 0.05 && bear >= -0.05) {
    reasons.push(`Composite score ${c.toFixed(0)}/100 with quality ${q.toFixed(0)}.`, `Base-case real return ${pct(base)}/yr; bear case ${pct(bear)}/yr.`);
    return { label: "buy", reasons };
  }
  // A strong business that is merely expensive is a "watch", not an "avoid".
  if (q >= 60 && (v < 40 || bear < -0.12)) return { label: "watch", reasons: [`High-quality business (quality ${q.toFixed(0)}) but the price leaves little margin of safety (value ${v.toFixed(0)}; bear case ${pct(bear)}/yr real). Wait for a better entry.`, `Base-case real return ${pct(base)}/yr.`] };
  if (c < 35 || bear < -0.12) {
    if (c < 35) reasons.push(`Weak composite score ${c.toFixed(0)}/100.`);
    if (bear < -0.12) reasons.push(`Bear case loses ${pct(-bear)}/yr after inflation and the business quality (${q.toFixed(0)}) does not justify the risk.`);
    return { label: "avoid", reasons };
  }
  if (g >= 75 && q < 50) return { label: "investigate", reasons: [`Fast growth (growth ${g.toFixed(0)}) but weaker quality (${q.toFixed(0)}). Check whether growth is durable and funded sensibly.`] };
  if (c >= 50 && base >= 0.02) return { label: "watch", reasons: [`Decent overall (composite ${c.toFixed(0)}), base-case real return ${pct(base)}/yr — not compelling enough yet.`] };
  return { label: "pass", reasons: [`No strong signal (composite ${c.toFixed(0)}, base real return ${pct(base)}/yr).`] };
}

// ---------- 6. Mutual fund stats ----------
function mfStats(data, inflation) {
  // data: [[isoDate, nav]] ascending
  if (!data || data.length < 30) return null;
  const last = data[data.length - 1];
  const lastDate = new Date(last[0]);
  const navAt = (yearsBack) => {
    const target = new Date(lastDate); target.setFullYear(target.getFullYear() - yearsBack);
    const t = target.toISOString().slice(0, 10);
    if (data[0][0] > t) return null;
    let lo = 0, hi = data.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (data[mid][0] <= t) lo = mid; else hi = mid - 1; }
    return data[lo][1];
  };
  const r = {};
  for (const y of [1, 3, 5, 10]) { const n = navAt(y); r["cagr" + y] = n ? Math.pow(last[1] / n, 1 / y) - 1 : null; r["real" + y] = r["cagr" + y] != null ? (1 + r["cagr" + y]) / (1 + inflation) - 1 : null; }
  // monthly series for volatility + rolling returns
  const monthly = [];
  let curM = "";
  for (const [d, v] of data) { const mk = d.slice(0, 7); if (mk !== curM) { monthly.push([d, v]); curM = mk; } else monthly[monthly.length - 1] = [d, v]; }
  const rets = []; for (let i = 1; i < monthly.length; i++) rets.push(monthly[i][1] / monthly[i - 1][1] - 1);
  const last36 = rets.slice(-36);
  r.volatility = last36.length >= 12 ? stdev(last36) * Math.sqrt(12) : null;
  let peak = -Infinity, mdd = 0;
  for (const [, v] of data.slice(-Math.min(data.length, 252 * 5))) { peak = Math.max(peak, v); mdd = Math.min(mdd, v / peak - 1); }
  r.maxDrawdown5y = mdd;
  const roll = [];
  for (let i = 36; i < monthly.length; i++) roll.push(Math.pow(monthly[i][1] / monthly[i - 36][1], 1 / 3) - 1);
  r.rolling3y = roll.length ? { count: roll.length, min: Math.min(...roll), median: median(roll), max: Math.max(...roll), beatInflationPct: roll.filter((x) => x > inflation).length / roll.length } : null;
  r.sharpeLike = r.cagr3 != null && r.volatility ? (r.cagr3 - 0.065) / r.volatility : null; // vs ~6.5% risk-free assumption
  r.historyFrom = data[0][0]; r.navDate = last[0]; r.nav = last[1];
  return r;
}

// ---------- 7. Startup funding parsing ----------
const SECTORS = [
  ["AI / Deeptech", /\b(ai|artificial intelligence|genai|llm|machine learning|deeptech|robot\w*|semiconductor\w*|chips?|drones?|space|defen[cs]e|imaging)\b/i],
  ["Fintech", /\b(fintech|lending|lender|payments?|neobank|insurtech|wealthtech|credit|nbfc|upi|broking|stockbroking|investment app)\b|pay\b/i],
  ["Industrial / Manufacturing", /\b(manufactur\w*|chemicals?|metals?|industrial|supply chain|factory|factories|steel|electronics)\b/i],
  ["Consumer / D2C", /\b(d2c|brand|apparel|beauty|skincare|fashion|food|beverage|snack|personal care|jewell?ery|footwear|coffee|tea|pet)\b/i],
  ["Quick & e-commerce", /\b(quick commerce|e-?commerce|marketplace|grocery|retail)\b/i],
  ["EV / Mobility", /\b(ev|electric vehicle|mobility|battery|charging|two-wheeler|logistics|fleet)\b/i],
  ["Climate / Energy", /\b(climate|solar|renewable|clean ?tech|green|carbon|energy|recycl)/i],
  ["Healthtech", /\b(health|healthtech|medtech|pharma|diagnostic|hospital|clinic|biotech|wellness)/i],
  ["SaaS / Enterprise", /\b(saas|b2b|enterprise|software|cloud|cybersecurity|devops|platform)\b/i],
  ["Edtech", /\b(edtech|education|learning|upskilling|school)\b/i],
  ["Agritech", /\b(agri|agritech|farm|dairy)/i],
  ["Real estate / Proptech", /\b(proptech|real estate|housing|co-?living|construction)\b/i],
  ["Gaming / Media", /\b(gaming|games?|media|content|creator|ott|music)\b/i],
];
// "AI agent startup RapidCanvas" -> "RapidCanvas"; "Nilekani-backed X" -> "X"
function cleanCompany(s) {
  let c = s.replace(/^(?:exclusive|breaking)\s*[:|-]\s*/i, "").replace(/^[^A-Za-z0-9]+/, "").trim();
  c = c.replace(/^(?:\S+-(?:backed|bound|based)\s+)+/i, "");
  const m = c.match(/^(?:.*\s)?(?:startup|start-up|platform|brand|marketplace|maker|company|firm|player|app|parent|unicorn|provider|venture)\s+(.+)$/i);
  if (m && m[1].split(/\s+/).length <= 5) c = m[1];
  return c.replace(/['’]s\b/g, "").trim();
}
function parseFunding(title) {
  const t = String(title || "");
  const m = t.match(/^(.{2,80}?)\s+(?:raises|raised|bags|secures|lands|nets|mops up|gets|picks up|closes|announces)\s+(?:its\s+)?(?:an?\s+)?(?:undisclosed\s+(?:amount|funding)|(?:USD|US\$|\$|Rs\.?|INR|₹)\s?([\d.,]+)\s*(Mn|M|Million|Cr|Crore|Bn|B|Billion|Lakh|K)?)/i);
  if (!m) return null;
  const company = cleanCompany(m[1]);
  // kind: a startup round, an IPO anchor allocation, or a VC firm raising its own fund
  const kind = /anchor investors|ahead of (?:its )?ipo|pre-?ipo/i.test(t) ? "ipo"
    : /\b(fund|capital|ventures|partners|advisors|amc)\b/i.test(company) || /\b(?:first|second|third|new|maiden)\s+fund\b|\bfund\s+(?:i|ii|iii|iv|v)\b|\bcorpus\b/i.test(t) ? "fund" : "round";
  const cur = /\$|USD|US\$/i.test(t.slice(m.index, m.index + m[0].length)) ? "USD" : (m[2] ? "INR" : null);
  let amt = m[2] ? parseFloat(m[2].replace(/,/g, "")) : null;
  const unit = (m[3] || "").toLowerCase();
  let usdMn = null;
  if (amt != null) {
    if (cur === "USD") usdMn = unit.startsWith("b") ? amt * 1000 : unit === "k" ? amt / 1000 : amt;
    else { const cr = unit.startsWith("cr") ? amt : unit.startsWith("lakh") ? amt / 100 : unit.startsWith("m") ? amt / 10 : unit.startsWith("b") ? amt * 100 : amt; usdMn = cr * 10 / 88; } // ≈ ₹88/$ (approx, shown as estimate)
  }
  const stage = (t.match(/\b(pre-?seed|seed|pre-series [a-e]|series [a-h]|growth|bridge|debt|ipo|pre-ipo)\b/i) || [])[1] || null;
  const led = (t.match(/\bled by ([^,;|]+?)(?:,| and others|$| to | for )/i) || [])[1] || null;
  const sector = (SECTORS.find(([, re]) => re.test(t)) || ["Other"])[0];
  return { company, kind, currency: cur, amount: amt, unit: m[3] || null, usdMn: usdMn != null ? Math.round(usdMn * 100) / 100 : null, stage: stage && stage.replace(/\b\w/g, (c) => c.toUpperCase()), leadInvestor: led && led.trim(), sector };
}

module.exports = { computeMetrics, redFlags, scoreUniverse, defaultAssumptions, scenarioReturns, tags, label, mfStats, parseFunding, cagr, median, FACTORS, WEIGHTS, CR };
