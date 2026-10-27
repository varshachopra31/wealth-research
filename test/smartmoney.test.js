"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
process.env.IR_DATA_DIR = require("node:path").join(require("node:os").tmpdir(), "ir-sm-test-" + process.pid);
const SM = require("../lib/smartmoney");
const G = require("../lib/smartsignals");

test("investors are classified from their names and filing category, not a fixed list", () => {
  const c = (n, g) => SM.classify(n, g);
  assert.equal(c("SBI NIFTY 50 ETF"), "passive");
  assert.equal(c("HDFC TRUSTEE COMPANY LIMITED-HDFC FLEXI CAP FUND"), "mutual_fund");
  assert.equal(c("LIFE INSURANCE CORPORATION OF INDIA"), "insurer");
  assert.equal(c("CTL Trusteeship Limited acting as Common Security Trustee for the benefit of debenture holders"), "pledge");
  assert.equal(c("IRAGE BROKING SERVICES LLP"), "broker");
  assert.equal(c("Ketan Ratilal Patel"), "individual");
  assert.equal(c("Nalanda India Equity Fund Limited"), "pe_vc");
  assert.equal(c("Saif Iii Mauritius Company Limited", "InstitutionsForeign"), "foreign_institution");
});

test("fund-house roll-up is learned from the filings", () => {
  SM.learnBrands(["KOTAK MAHINDRA TRUSTEE CO LTD", "Kotak Mutual Fund", "HDFC TRUSTEE COMPANY LIMITED", "SBI Mutual fund under its Various Schemes"]);
  assert.equal(SM.canon("Kotak Flexicap Fund"), "KOTAK MAHINDRA MUTUAL FUND");
  assert.equal(SM.canon("KOTAK MAHINDRA TRUSTEE CO LTD A/C KOTAK SMALL CAP FUND"), "KOTAK MAHINDRA MUTUAL FUND");
  assert.equal(SM.canon("HDFC TRUSTEE COMPANY LIMITED-HDFC FLEXI CAP FUND"), "HDFC MUTUAL FUND");
  assert.equal(SM.canon("Sbi Aggressive Hybrid Fund"), "SBI MUTUAL FUND");
});

test("SAST dates parse", () => {
  assert.equal(SM.parseDate("16-Oct-2026 12:07"), "2026-10-16");
  assert.equal(SM.parseDate("30-SEP-2026"), "2026-09-30");
});

test("outcomes measure forward returns vs the benchmark", () => {
  const S = new Map([["X", [["2026-01-05", 100], ["2026-01-12", 101], ...Array.from({ length: 60 }, (_, i) => [new Date(Date.UTC(2026, 0, 19 + i * 7)).toISOString().slice(0, 10), 100 + (i + 2) * 2])]]]);
  const B = S.get("X").map(([d], i) => [d, 1000 + i * 5]);
  const [o] = G.outcomes([{ symbol: "X", ckey: "A", dir: 1, date: "2026-01-06" }], S, B);
  assert.ok(o.entry === 101);
  assert.ok(Math.abs(o.ret["3m"] - (S.get("X")[14][1] / 101 - 1)) < 1e-9);
  assert.ok(Math.abs(o.excess["3m"] - (o.ret["3m"] - (B[14][1] / B[1][1] - 1))) < 1e-9);
});

test("repeat filings in the same month count once; sell signals score when the stock lags", () => {
  const mk = (date, ex, dir = 1, sym = "X") => ({ symbol: sym, ckey: "A", dir, date, excess: { "6m": ex } });
  const s = G.statsOf([mk("2026-01-05", 0.1), mk("2026-01-20", 0.1), mk("2026-01-25", 0.1), mk("2026-03-01", -0.05)], "6m");
  assert.equal(s.n, 2);          // 3 January filings collapse to 1
  assert.equal(s.stocks, 1);
  const sells = G.statsOf([mk("2026-01-05", -0.2, -1, "Y")], "6m");
  assert.ok(sells.mean > 0);     // stock fell 20% vs market after a sell signal → the warning was useful
});
