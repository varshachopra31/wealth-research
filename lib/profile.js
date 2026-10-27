"use strict";
// Company profile, ownership and official announcements — fetched on demand for one stock.
//  - Yahoo Finance quoteSummary (assetProfile, majorHoldersBreakdown): needs a session cookie + "crumb"
//  - Wikipedia REST summary: fallback business description
//  - NSE: shareholding-pattern filings (official, quarterly) and corporate announcements (official)
const { fetchText } = require("./net");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const cookieOf = (res) => (res.headers.getSetCookie ? res.headers.getSetCookie() : []).map((c) => c.split(";")[0]).join("; ");

// ---------- Yahoo session ----------
let ySess = null;
async function yahooSession() {
  if (ySess && Date.now() - ySess.at < 6 * 3600e3) return ySess;
  const r = await fetch("https://fc.yahoo.com", { headers: { "User-Agent": UA }, redirect: "manual" }).catch(() => null);
  const cookie = r ? cookieOf(r) : "";
  const crumb = await fetchText("https://query2.finance.yahoo.com/v1/test/getcrumb", { headers: { Cookie: cookie }, retries: 1 });
  if (!crumb || crumb.length > 40 || /</.test(crumb)) throw new Error("Yahoo session failed");
  ySess = { cookie, crumb, at: Date.now() };
  return ySess;
}
async function yahooProfile(sym) {
  const s = await yahooSession();
  const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(sym)}.NS?modules=assetProfile,majorHoldersBreakdown&crumb=${encodeURIComponent(s.crumb)}`;
  let j;
  try { j = JSON.parse(await fetchText(url, { headers: { Cookie: s.cookie }, retries: 1 })); }
  catch (e) { ySess = null; throw e; }
  const r = j.quoteSummary && j.quoteSummary.result && j.quoteSummary.result[0];
  if (!r) return null;
  const p = r.assetProfile || {}, h = r.majorHoldersBreakdown || {};
  return {
    summary: p.longBusinessSummary || "", website: p.website || "", sector: p.sectorDisp || p.sector || "", industry: p.industryDisp || p.industry || "",
    employees: p.fullTimeEmployees || null, city: p.city || "",
    officers: (p.companyOfficers || []).slice(0, 4).map((o) => ({ name: o.name, title: o.title })),
    insidersPct: h.insidersPercentHeld && h.insidersPercentHeld.raw, institutionsPct: h.institutionsPercentHeld && h.institutionsPercentHeld.raw,
    source: `https://finance.yahoo.com/quote/${encodeURIComponent(sym)}.NS/profile`,
  };
}

// ---------- Wikipedia fallback ----------
async function wikiSummary(companyName) {
  const q = companyName.replace(/\b(ltd|limited)\.?$/i, "").trim();
  const s = JSON.parse(await fetchText(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q + " company India")}&format=json&srlimit=1`, { headers: { "User-Agent": "WealthResearch/1.0 (personal use)" }, retries: 1 }));
  const hit = s.query && s.query.search && s.query.search[0];
  if (!hit) return null;
  const first = q.split(/\s+/)[0].toLowerCase();
  if (!hit.title.toLowerCase().includes(first)) return null; // avoid unrelated pages
  const p = JSON.parse(await fetchText(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(hit.title.replace(/ /g, "_"))}`, { headers: { "User-Agent": "WealthResearch/1.0 (personal use)" }, retries: 1 }));
  return p.extract ? { summary: p.extract, source: p.content_urls && p.content_urls.desktop && p.content_urls.desktop.page } : null;
}

// ---------- NSE session ----------
let nSess = null;
async function nseSession() {
  if (nSess && Date.now() - nSess.at < 20 * 60e3) return nSess;
  const r = await fetch("https://www.nseindia.com/", { headers: { "User-Agent": UA, "Accept-Language": "en-IN,en;q=0.9" } });
  await r.text();
  nSess = { cookie: cookieOf(r), at: Date.now() };
  return nSess;
}
async function nseJson(path) {
  for (let i = 0; i < 2; i++) {
    const s = await nseSession();
    try {
      const t = await fetchText("https://www.nseindia.com" + path, { headers: { Cookie: s.cookie, Referer: "https://www.nseindia.com/", Accept: "application/json" }, retries: 1 });
      return JSON.parse(t);
    } catch (e) { nSess = null; if (i) throw e; }
  }
}

// shareholding XBRL → categories + named holders
const CAT = {
  promoter: ["ShareholdingOfPromoterAndPromoterGroup"],
  fii: ["InstitutionsForeign"],
  mf: ["MutualFundsOrUTI"],
  insurance: ["InsuranceCompanies"],
  otherDomestic: ["AlternativeInvestmentFunds", "Banks", "ProvidentFundsOrPensionFunds", "OtherFinancialInstitutions", "NBFCsRegisteredWithRBI", "SovereignWealthFundsDomestic"],
  retail: ["ResidentIndividualShareholdersHoldingNominalShareCapitalUpToRsTwoLakh", "ResidentIndividualShareholdersHoldingNominalShareCapitalInExcessOfRsTwoLakh"],
  nri: ["NonResidentIndians"],
  corporate: ["BodiesCorporate"],
  government: ["CentralGovernmentOrPresidentOfIndia", "StateGovernmentOrGovernor"],
};
function parseShp(xml) {
  const pct = {}, name = {}, promo = {};
  for (const m of xml.matchAll(/<in-bse-shp:ShareholdingAsAPercentageOfTotalNumberOfShares[^>]*contextRef="([^"]+)"[^>]*>([^<]+)</g)) pct[m[1]] = +m[2];
  for (const m of xml.matchAll(/<in-bse-shp:NameOfTheShareholder[^>]*contextRef="([^"]+)"[^>]*>([^<]+)</g)) name[m[1]] = m[2].replace(/&amp;/g, "&").trim();
  for (const m of xml.matchAll(/<in-bse-shp:TypeOfPromoterShareholding[^>]*contextRef="([^"]+)"/g)) promo[m[1]] = true;
  const cats = {};
  for (const [k, list] of Object.entries(CAT)) cats[k] = list.reduce((s, c) => s + (pct[c + "_ContextI"] || 0), 0);
  cats.total = pct.ShareholdingPattern_ContextI || 1;
  const holders = [];
  for (const [ctx, n] of Object.entries(name)) {
    const p = pct[ctx.replace(/^D_/, "")];
    if (!isFinite(p)) continue;
    const group = ctx.replace(/^D_/, "").replace(/_Context\d+$/, "");
    holders.push({ name: n, pct: p, promoter: !!promo[ctx], group });
  }
  holders.sort((a, b) => b.pct - a.pct);
  return { cats, holders };
}
async function shareholding(sym) {
  const list = await nseJson(`/api/corporate-share-holdings-master?index=equities&symbol=${encodeURIComponent(sym)}`);
  if (!Array.isArray(list) || !list.length) return null;
  const quarters = list.slice(0, 8).map((x) => ({ date: x.date, promoter: parseFloat(x.pr_and_prgrp), public: parseFloat(x.public_val), xbrl: x.xbrl })).filter((q) => isFinite(q.promoter));
  const getX = async (q) => (q && q.xbrl ? parseShp(await fetchText(q.xbrl, { timeout: 30000, retries: 1 })) : null);
  const [cur, prev] = await Promise.all([getX(quarters[0]).catch(() => null), getX(quarters[1]).catch(() => null)]);
  const changes = [];
  if (cur && prev) {
    for (const k of Object.keys(CAT)) { const d = cur.cats[k] - prev.cats[k]; if (Math.abs(d) >= 0.002) changes.push({ cat: k, from: prev.cats[k], to: cur.cats[k], delta: d }); }
    const prevMap = Object.fromEntries(prev.holders.map((h) => [h.name.toLowerCase(), h.pct]));
    cur.holders.filter((h) => !h.promoter).forEach((h) => { const p = prevMap[h.name.toLowerCase()]; h.prevPct = p == null ? null : p; h.isNew = p == null; });
  }
  return { quarters, latest: cur, previous: prev && { cats: prev.cats }, changes, asOf: quarters[0] && quarters[0].date, source: `https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(sym)}` };
}

// official announcements, filtered to the ones that matter for an investor
const BORING = /newspaper publication|certificate under|trading window|loss of share|duplicate share|investor (meet|presentation) intimation|regulation 74|closure of trading|change in rta|copy of newspaper|book closure|record date|updates? -? ?(sast|esop)|esop|esos|allotment of equity shares under esop/i;
async function announcements(sym) {
  const a = await nseJson(`/api/corporate-announcements?index=equities&symbol=${encodeURIComponent(sym)}`);
  if (!Array.isArray(a)) return [];
  return a.filter((x) => !BORING.test((x.desc || "") + " " + (x.attchmntText || "")))
    .slice(0, 25).map((x) => ({ date: x.an_dt, title: x.desc, text: (x.attchmntText || "").replace(/\s+/g, " ").trim().slice(0, 400), link: x.attchmntFile || "" }));
}

async function getProfile(sym, name) {
  const out = { symbol: sym, fetchedAt: new Date().toISOString(), errors: [] };
  const tasks = [
    yahooProfile(sym).then((p) => (out.profile = p)).catch((e) => out.errors.push("profile: " + e.message)),
    shareholding(sym).then((s) => (out.shareholding = s)).catch((e) => out.errors.push("shareholding: " + e.message)),
    announcements(sym).then((a) => (out.announcements = a)).catch((e) => out.errors.push("announcements: " + e.message)),
  ];
  await Promise.all(tasks);
  if (!out.profile || !out.profile.summary) {
    try { const w = await wikiSummary(name || sym); if (w) out.profile = { ...(out.profile || {}), summary: w.summary, wiki: w.source }; } catch (e) { out.errors.push("wikipedia: " + e.message); }
  }
  return out;
}

module.exports = { getProfile, parseShp, yahooProfile, shareholding, announcements };
