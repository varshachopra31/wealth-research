"use strict";
// SQLite storage via Node's built-in node:sqlite (no install needed).
const path = require("node:path");
const fs = require("node:fs");
const { DatabaseSync } = require("node:sqlite");

// The code lives in OneDrive, but the live database must NOT: OneDrive syncing a file while
// SQLite writes to it can lock or corrupt it. It stays on this PC; a daily copy goes to OneDrive (backupDb in jobs.js).
const DATA_DIR = process.env.IR_DATA_DIR || (process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "WealthResearch") : path.join(__dirname, "..", "data"));
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, "research.db"));
db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=10000;"); // wait for locks instead of failing

db.exec(`
CREATE TABLE IF NOT EXISTS universe (
  symbol TEXT PRIMARY KEY, name TEXT, industry TEXT, isin TEXT,
  in_index INTEGER DEFAULT 0, user_added INTEGER DEFAULT 0, added_at TEXT
);
CREATE TABLE IF NOT EXISTS fundamentals (
  symbol TEXT PRIMARY KEY, json TEXT, fetched_at TEXT, error TEXT
);
CREATE TABLE IF NOT EXISTS prices (
  symbol TEXT PRIMARY KEY, price REAL, currency TEXT, json TEXT, fetched_at TEXT, error TEXT
);
CREATE TABLE IF NOT EXISTS analysis (
  symbol TEXT PRIMARY KEY, json TEXT, label TEXT, composite REAL, computed_at TEXT
);
CREATE TABLE IF NOT EXISTS assumptions (
  symbol TEXT PRIMARY KEY, json TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS mf_schemes (
  code TEXT PRIMARY KEY, name TEXT, amc TEXT, category TEXT, nav REAL, nav_date TEXT
);
CREATE TABLE IF NOT EXISTS mf_history (
  code TEXT PRIMARY KEY, json TEXT, fetched_at TEXT
);
CREATE TABLE IF NOT EXISTS portfolio (
  id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT, ref TEXT, name TEXT,
  qty REAL, cost REAL, value REAL, notes TEXT, added_at TEXT
);
CREATE TABLE IF NOT EXISTS watchlist (
  symbol TEXT PRIMARY KEY, note TEXT, added_at TEXT
);
CREATE TABLE IF NOT EXISTS news (
  id TEXT PRIMARY KEY, title TEXT, link TEXT, source TEXT, feed_kind TEXT,
  published TEXT, summary TEXT, symbols TEXT, fetched_at TEXT
);
CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT, kind TEXT, symbol TEXT,
  severity TEXT, title TEXT, detail TEXT, dedupe TEXT UNIQUE, read INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS ai_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, subject TEXT, kind TEXT, provider TEXT,
  text TEXT, sources TEXT, created_at TEXT
);
CREATE TABLE IF NOT EXISTS settings ( key TEXT PRIMARY KEY, value TEXT );
CREATE TABLE IF NOT EXISTS fetch_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, job TEXT, started_at TEXT, finished_at TEXT,
  status TEXT, message TEXT
);
CREATE TABLE IF NOT EXISTS kv ( key TEXT PRIMARY KEY, value TEXT, updated_at TEXT );
CREATE TABLE IF NOT EXISTS profiles ( symbol TEXT PRIMARY KEY, json TEXT, fetched_at TEXT );
`);

const now = () => new Date().toISOString();

const DEFAULT_SETTINGS = {
  inflation: null,            // null = derive from official CPI history
  inflationOverride: "",      // user-set expected inflation %, blank = use derived
  aiProvider: "off",          // off | gemini | ollama
  geminiKey: "",
  geminiModel: "gemini-flash-latest",
  geminiGrounding: "0",       // Google Search grounding (often no free quota; auto-disabled on 429)
  ollamaUrl: "http://127.0.0.1:11434",
  ollamaModel: "llama3.2:3b",
  autoRefresh: "1",
  riskProfile: "balanced",   // careful | balanced | adventurous
  investAmount: "",          // total you plan to invest in stocks (₹), for the amount guide
  targetReal: "6",            // return you want above inflation (% a year)
};

function getSettings() {
  const out = { ...DEFAULT_SETTINGS };
  for (const r of db.prepare("SELECT key, value FROM settings").all()) out[r.key] = r.value;
  return out;
}
function setSetting(key, value) {
  db.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .run(key, value == null ? "" : String(value));
}
function kvGet(key, fallback = null) {
  const r = db.prepare("SELECT value FROM kv WHERE key=?").get(key);
  if (!r) return fallback;
  try { return JSON.parse(r.value); } catch { return fallback; }
}
function kvSet(key, value) {
  db.prepare("INSERT INTO kv(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at")
    .run(key, JSON.stringify(value), now());
}
function logStart(job) {
  return db.prepare("INSERT INTO fetch_log(job, started_at, status) VALUES(?,?,?)").run(job, now(), "running").lastInsertRowid;
}
function logEnd(id, status, message) {
  db.prepare("UPDATE fetch_log SET finished_at=?, status=?, message=? WHERE id=?").run(now(), status, String(message || "").slice(0, 2000), id);
}
function addAlert({ kind, symbol = null, severity = "info", title, detail = "", dedupe }) {
  try {
    db.prepare("INSERT INTO alerts(created_at,kind,symbol,severity,title,detail,dedupe) VALUES(?,?,?,?,?,?,?)")
      .run(now(), kind, symbol, severity, title, detail, dedupe || `${kind}|${symbol}|${title}|${now().slice(0, 10)}`);
    return true;
  } catch { return false; } // duplicate
}

module.exports = { db, now, getSettings, setSetting, kvGet, kvSet, logStart, logEnd, addAlert, DATA_DIR };
