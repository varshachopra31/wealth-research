"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const A = require("../lib/analysis");

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);
const yr = (fy, o) => ({ fy, shares: 1e8, ...o });
// A steady compounder: revenue 1000→1331 cr (10%/yr), profit 150→199.65 cr
const good = [
  yr("2023-03-31", { rev: 1000e7, ni: 150e7, ocf: 170e7, ebit: 210e7, intExp: 5e7, debt: 50e7, equity: 800e7, assets: 1200e7, curLiab: 200e7, cash: 100e7, recv: 100e7, opInc: 200e7, div: -40e7 }),
  yr("2024-03-31", { rev: 1100e7, ni: 165e7, ocf: 185e7, ebit: 230e7, intExp: 5e7, debt: 50e7, equity: 900e7, assets: 1300e7, curLiab: 210e7, cash: 120e7, recv: 110e7, opInc: 220e7, div: -45e7 }),
  yr("2025-03-31", { rev: 1210e7, ni: 181.5e7, ocf: 200e7, ebit: 250e7, intExp: 5e7, debt: 50e7, equity: 1000e7, assets: 1400e7, curLiab: 220e7, cash: 140e7, recv: 121e7, opInc: 242e7, div: -50e7 }),
  yr("2026-03-31", { rev: 1331e7, ni: 199.65e7, ocf: 220e7, ebit: 275e7, intExp: 5e7, debt: 50e7, equity: 1100e7, assets: 1500e7, curLiab: 230e7, cash: 160e7, recv: 133.1e7, opInc: 266e7, div: -55e7 }),
];

test("metrics: CAGR, EPS, P/E, ROE, ROCE, cash conversion", () => {
  const m = A.computeMetrics({ years: good, price: 400, industry: "Capital Goods" });
  near(m.revCagr, 0.1); near(m.niCagr, 0.1);
  near(m.eps, 199.65e7 / 1e8); near(m.pe, 400 / 19.965);
  near(m.roe, 199.65e7 / ((1000e7 + 1100e7) / 2));
  near(m.roce, 275e7 / (1500e7 - 230e7));
  near(m.cashConv, (170 + 185 + 200 + 220) / (150 + 165 + 181.5 + 199.65));
  near(m.de, 50 / 1100);
  near(m.divYield, 55e7 / (400 * 1e8));
  assert.equal(m.fin, false);
});

test("red flags fire on bad patterns and stay quiet on a clean company", () => {
  const clean = A.redFlags(A.computeMetrics({ years: good, price: 400, industry: "Capital Goods" }));
  assert.equal(clean.filter((f) => f.severity !== "info").length, 0);
  const bad = good.map((y, i) => ({ ...y, ocf: i >= 1 ? -10e7 : y.ocf, debt: 3000e7, recv: 100e7 * Math.pow(1.4, i), shares: 1e8 * Math.pow(1.1, i) }));
  const codes = A.redFlags(A.computeMetrics({ years: bad, price: 400, industry: "Capital Goods" })).map((f) => f.code);
  for (const c of ["ocf", "debt", "recv", "dilution"]) assert.ok(codes.includes(c), "missing " + c);
});

test("financial-sector companies skip ROCE / debt metrics", () => {
  const m = A.computeMetrics({ years: good, price: 400, industry: "Financial Services" });
  assert.equal(m.fin, true); assert.equal(m.roce, null); assert.equal(m.de, null);
});

test("scenario maths matches the stated formula", () => {
  const m = A.computeMetrics({ years: good, price: 400, industry: "Capital Goods" });
  const a = { growth: { bear: 0, base: 0.1, bull: 0.2 }, exitPe: { bear: m.pe, base: m.pe, bull: m.pe }, divYield: 0.01 };
  const s = A.scenarioReturns(m, a, 0.05);
  near(s.base.priceCagr, 0.1, 1e-9);           // constant P/E → price grows with EPS
  near(s.base.nominal, 0.11, 1e-9);
  near(s.base.real, 1.11 / 1.05 - 1, 1e-9);
  near(s.bear.priceCagr, 0, 1e-9);
  const d = A.defaultAssumptions(m, 20);
  assert.ok(d.growth.bear < d.growth.base && d.growth.base < d.growth.bull);
  assert.ok(d.exitPe.bear <= d.exitPe.base && d.exitPe.base <= d.exitPe.bull);
  assert.equal(A.defaultAssumptions({ ...m, eps: -1, pe: null }, 20), null);
});

test("one-off gains are detected and scenarios use normalised EPS", () => {
  const spiky = good.map((y, i) => (i === 3 ? { ...y, ni: 900e7 } : y)); // profit 3.4x operating profit
  const m = A.computeMetrics({ years: spiky, price: 400, industry: "Capital Goods" });
  assert.equal(m.oneOff, true);
  near(m.epsNormalised, (266e7 * 0.75) / 1e8);
  assert.ok(A.redFlags(m).some((f) => f.code === "oneoff"));
  const d = A.defaultAssumptions(m, 20, "Capital Goods");
  near(d.eps0, m.epsNormalised);
  assert.equal(A.computeMetrics({ years: good, price: 400, industry: "Capital Goods" }).oneOff, false);
});

test("percentile scoring ranks better metrics higher", () => {
  const mk = (sym, roe) => ({ symbol: sym, industry: "X", flags: [], m: { roe, roce: roe, cashConv: 1, de: 0.1, intCover: 10, npmStd: 0.01, revCagr: 0.1, niCagr: 0.1, earningsYield: 0.05, mcap: 1, price: 1 } });
  const items = [mk("A", 0.05), mk("B", 0.15), mk("C", 0.30)];
  A.scoreUniverse(items);
  assert.ok(items[2].score.groups.quality.score > items[0].score.groups.quality.score);
});

test("labels: quality-but-expensive is watch, not avoid", () => {
  const m = { price: 100, eps: 1, pe: 100 };
  const score = { composite: 55, groups: { quality: { score: 75 }, growth: { score: 50 }, value: { score: 10 }, safety: { score: 50 } } };
  const scen = { base: { real: 0.01 }, bear: { real: -0.15 }, bull: { real: 0.1 } };
  assert.equal(A.label({ m, score, flags: [], scen }).label, "watch");
  const weak = { ...score, composite: 30, groups: { ...score.groups, quality: { score: 30 } } };
  assert.equal(A.label({ m, score: weak, flags: [], scen }).label, "avoid");
  assert.equal(A.label({ m, score, flags: [{ severity: "critical", text: "x" }], scen }).label, "investigate");
});

test("mutual fund stats: CAGR, real return, rolling windows", () => {
  const data = []; const start = new Date("2016-01-01");
  for (let d = 0; d <= 3653; d += 1) { const t = new Date(start.getTime() + d * 864e5); data.push([t.toISOString().slice(0, 10), 10 * Math.pow(1.12, d / 365.25)]); }
  const s = A.mfStats(data, 0.05);
  near(s.cagr5, 0.12, 0.002); near(s.real5, 1.12 / 1.05 - 1, 0.002);
  assert.ok(s.rolling3y.beatInflationPct === 1);
  near(s.maxDrawdown5y, 0, 1e-9);
});

test("funding headline parser", () => {
  const a = A.parseFunding("RapidCanvas raises $29 Mn in Series B round led by Vertex Ventures");
  assert.equal(a.company, "RapidCanvas"); assert.equal(a.usdMn, 29); assert.equal(a.stage, "Series B"); assert.equal(a.leadInvestor, "Vertex Ventures"); assert.equal(a.sector, "Other");
  const b = A.parseFunding("D2C skincare brand Foxtale bags Rs 150 Cr from Kae Capital");
  assert.equal(b.currency, "INR"); assert.equal(b.amount, 150); assert.equal(b.sector, "Consumer / D2C");
  assert.equal(A.parseFunding("Sensex falls 500 points as IT stocks drag"), null);
});
