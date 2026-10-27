"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const B = require("../lib/beginner");

// minimal analysis record
const rec = (o = {}) => ({
  symbol: "X", label: "buy", inflation: 0.05, tags: [], flags: [], reasons: ["r"], peerPe: 30,
  metrics: { price: 100, mcap: 50000e7, pe: 20, eps: 5, revCagr: 0.15, niCagr: 0.15, roce: 0.25, de: 0.05, cashConv: 1, npm: 0.15, divYield: 0.01, years: 4, maxDrawdown3y: -0.2, revenue: 1000e7, netIncome: 150e7, ...(o.metrics || {}) },
  score: { composite: 70, groups: { quality: { score: 75 } } },
  assumptions: { divYield: 0.01 },
  scenarios: { base: { price5: 200, real: 0.1 }, bear: { real: -0.02 }, ...(o.scenarios || {}) },
  ...o,
});

test("buy-below price: base case exactly meets the target return", () => {
  const v = B.verdict(rec(), { targetReal: "6" });
  const targetNom = 1.06 * 1.05 - 1;
  const cagr = Math.pow(200 / v.buyBelow, 1 / 5) - 1 + 0.01;
  assert.ok(Math.abs(cagr - targetNom) < 1e-9);
});

test("verdict follows the screen: buy / parts / wait / skip / don't", () => {
  assert.equal(B.verdict(rec()).code, "buy");                                          // price well below buy-below
  assert.equal(B.verdict(rec({ metrics: { price: 130 } })).code, "parts");              // within 10% above buy-below (~123)
  assert.equal(B.verdict(rec({ metrics: { price: 180 } })).code, "wait");
  assert.equal(B.verdict(rec({ label: "pass" })).code, "skip");
  assert.equal(B.verdict(rec({ label: "avoid" })).code, "dont");
  assert.equal(B.verdict(rec({ label: "watch" })).code, "parts");                       // watch only if ≥15% below
  assert.equal(B.verdict(rec({ label: "watch", metrics: { price: 118 } })).code, "watch");
  assert.equal(B.verdict(rec({ flags: [{ severity: "critical", text: "bad" }] })).code, "research");
  assert.equal(B.verdict(rec({ label: "watch", metrics: { price: 80 }, scenarios: { base: { price5: 200, real: 0.1 }, bear: { real: -0.2 } } })).code, "watch"); // cheap but poor downside: no buy
});

test("amount only for buyable verdicts, trimmed for small/low-quality", () => {
  const v = B.verdict(rec(), { investAmount: "500000", riskProfile: "balanced" });
  assert.equal(v.size.amount, 25000);
  assert.equal(B.verdict(rec({ label: "avoid" }), { investAmount: "500000" }).size.amount, undefined);
  const small = B.verdict(rec({ metrics: { mcap: 2000e7 } }), { investAmount: "500000" });
  assert.equal(small.size.amount, 15000);
});

test("owned guidance suggests trimming above the stretched price", () => {
  const v = B.verdict(rec({ metrics: { price: 190 } }), {}, { ref: "X" });
  assert.match(v.owned.title, /trim/i);
});

test("news impact classification", () => {
  assert.equal(B.newsImpact("Company bags ₹500 cr order from NHAI").tone, "positive");
  assert.equal(B.newsImpact("SEBI imposes penalty on company").tone, "negative");
  assert.equal(B.newsImpact("Financial Results for quarter").kind, "Results");
});
