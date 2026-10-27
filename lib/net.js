"use strict";
// Polite HTTP helper: browser-like UA, timeout, retry, and a per-host throttle
// so bulk refreshes never hammer a free data source.
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const lastHit = new Map();
const MIN_GAP = { "query2.finance.yahoo.com": 650, "query1.finance.yahoo.com": 650, "api.mfapi.in": 250 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function throttle(host) {
  const gap = MIN_GAP[host] || 0;
  if (!gap) return;
  const prev = lastHit.get(host) || 0;
  const wait = prev + gap - Date.now();
  lastHit.set(host, Math.max(Date.now(), prev + gap));
  if (wait > 0) await sleep(wait);
}

async function fetchText(url, { timeout = 25000, retries = 2, headers = {}, method = "GET", body } = {}) {
  const host = new URL(url).host;
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    await throttle(host);
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeout);
    try {
      const res = await fetch(url, { method, body, signal: ctl.signal, headers: { "User-Agent": UA, "Accept-Language": "en-IN,en;q=0.9", ...headers }, redirect: "follow" });
      const text = await res.text();
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) { const e = new Error(`HTTP ${res.status}: ${text.slice(0, 160)}`); e.fatal = true; throw e; }
      return text;
    } catch (e) {
      lastErr = e;
      if (e.fatal) break;
      await sleep(800 * (i + 1) * (i + 1));
    } finally { clearTimeout(t); }
  }
  throw lastErr;
}

async function fetchJson(url, opts) {
  const t = await fetchText(url, opts);
  try { return JSON.parse(t); } catch { throw new Error("Bad JSON from " + new URL(url).host + ": " + t.slice(0, 120)); }
}

module.exports = { fetchText, fetchJson, sleep };
