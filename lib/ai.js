"use strict";
// Free AI layer. Two providers, both zero-cost:
//  - gemini : Google Gemini API free tier (needs a free API key from aistudio.google.com).
//             Optional Google Search grounding returns real web citations.
//             Free-tier prompts may be used by Google to improve its products.
//  - ollama : a local model on this PC (fully private, slow on a CPU-only laptop).
// The AI never invents numbers: it is given the app's own computed facts and told
// to cite only the numbered sources supplied (plus any web sources it retrieves).
const { fetchText } = require("./net");

const SYSTEM = `You are a careful equity and fund research analyst for a long-term (5-10 year) Indian investor whose goal is to beat inflation.
Rules:
- Use ONLY the facts provided in the FACTS block and, if available, web sources you retrieve. Never invent numbers.
- Anything you state from your own background knowledge (products, customers, history, management) must be marked "(general knowledge — unverified)" and never presented as sourced.
- When profit growth far exceeds revenue growth, check the starting margin: growth off a depressed base or from one-off margin expansion is not repeatable — say so explicitly.
- Cite facts inline as [S1], [S2] … matching the numbered SOURCES list. Web facts must be cited with their URL.
- If something important is unknown or not in the data, say so plainly under "Missing data".
- Separate genuine business strength from hype. Be balanced; state the bear case seriously.
- This is research, not personalised financial advice; never promise returns.
The reader is a BEGINNER investor: use plain English, explain any jargon in a few words the first time, keep sentences short, and use Indian number formats (₹ crore/lakh).
Write concise Markdown with these headings: In one line, What the company does, How it makes money, Is the business strong?, Is the price fair?, Who owns it, News that matters, Pros, Cons, What could go wrong, Bottom line (restate the dashboard verdict in plain words and what to watch — do not invent a different price target), Missing data.`;

// opts.system overrides the default analyst instructions; opts.history adds earlier chat turns
// shared ground rules for every AI task
const RULES = `You work inside a personal research dashboard for a long-term (5-10 year) Indian investor who is a BEGINNER and wants to beat inflation.
Rules:
- Use ONLY the facts in the DATA block (and web sources if you retrieve any). Never invent numbers, holdings, dates or events.
- Cite facts inline as [S1], [S2] … matching the numbered SOURCES list. Only cite numbered sources — never cite these instructions or rules.
- Anything from your own background knowledge must be marked "(general knowledge — unverified)".
- If the data doesn't answer something, say so plainly instead of guessing.
- An investor buying, or a share price rising, is never a reason to buy on its own — always weigh the business and the price.
- Research, not personalised financial advice; never promise returns. Plain English, short sentences, Indian number formats (₹ crore/lakh).`;

const RADAR_SYSTEM = RULES + `
Task: a deep-dive on why notable investors are active in one company. Markdown headings: In one line, What the investors did, Why they might be buying (possible reasons — label them as possibilities), Does the business back it up?, Is the price reasonable?, What could go wrong, What to check before acting, Bottom line (restate the radar label and the dashboard's take; do not invent a price target).`;

const INVESTOR_SYSTEM = RULES + `
Task: a profile of one investor based only on their disclosed holdings and trades. Markdown headings: Who they appear to be, Investing style, What they've been doing lately, How their past moves worked out, Is following them sensible?, Limits of this picture. Stress that disclosures are partial (only stakes above 1%) and late.`;

const CHAT_SYSTEM = RULES + `
Task: answer the user's question as a friendly, concise research assistant. Answer directly first, then explain.
- For "should I buy / sell / hold" questions: never open with "yes" or "no". Say what the dashboard rates it ("The dashboard rates it …"), give the main reasons, then ALWAYS give at least two concrete risks or counter-points taken from the DATA (cons, red flags, investors selling, price swings, profit growth from a weak base), and end with what to check before deciding. The decision is the user's.
- Use short paragraphs or bullets; no fixed headings. Keep answers under about 250 words unless asked for detail. If the question is about a company or investor not in the DATA, say you don't have it loaded and suggest adding it (any NSE symbol can be added from the search box).`;

async function generate(settings, prompt, opts = {}) {
  const provider = settings.aiProvider;
  const o = { system: opts.system || SYSTEM, history: opts.history || [], maxTokens: opts.maxTokens || 4096 };
  if (provider === "gemini") return gemini(settings, prompt, o);
  if (provider === "ollama") return ollama(settings, prompt, o);
  throw new Error("AI is switched off. Choose a free provider in Settings.");
}

// Google retires model versions; these aliases always point at the current model.
const FALLBACK_MODELS = ["gemini-flash-latest", "gemini-flash-lite-latest"];

async function gemini(settings, prompt, o) {
  if (!settings.geminiKey) throw new Error("No Gemini API key. Get a free key at aistudio.google.com and paste it in Settings.");
  const tried = [];
  for (const model of [settings.geminiModel || FALLBACK_MODELS[0], ...FALLBACK_MODELS]) {
    if (tried.includes(model)) continue;
    tried.push(model);
    try {
      let r;
      try { r = await geminiCall(settings, prompt, model, o); }
      catch (e) {
        // Google Search grounding has no free quota on many keys: retry the same model without it.
        if (!e.quota || settings.geminiGrounding !== "1") throw e;
        r = await geminiCall({ ...settings, geminiGrounding: "0" }, prompt, model, o);
        r.note = "Web search grounding isn't available on this key's free tier, so this note uses only the app's own data and news sources.";
        try { require("./db").setSetting("geminiGrounding", "0"); } catch { /* ignore */ }
      }
      if (model !== settings.geminiModel) { try { require("./db").setSetting("geminiModel", model); } catch { /* ignore */ } }
      return r;
    } catch (e) {
      if (!e.modelGone) throw e; // only a retired/unknown model triggers the fallback
    }
  }
  throw new Error("No available Gemini model responded (tried " + tried.join(", ") + ").");
}

async function geminiCall(settings, prompt, model, o) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const body = {
    systemInstruction: { parts: [{ text: o.system }] },
    contents: [...o.history.map((h) => ({ role: h.role === "model" ? "model" : "user", parts: [{ text: h.text }] })), { role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.3, maxOutputTokens: o.maxTokens },
  };
  if (settings.geminiGrounding === "1") body.tools = [{ google_search: {} }];
  let text;
  try {
    text = await fetchText(url, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json", "x-goog-api-key": settings.geminiKey }, timeout: 120000, retries: 1 });
  } catch (e) {
    const msg = String(e.message || e);
    if (/429|quota|RESOURCE_EXHAUSTED/i.test(msg)) { const err = new Error("Gemini free-tier limit reached for now — wait a minute and try again."); err.quota = true; throw err; }
    if (/HTTP 503|UNAVAILABLE|overloaded/i.test(msg)) { const err = new Error(`Model "${model}" is busy right now.`); err.modelGone = true; throw err; } // try the next model
    const inner = (msg.match(/"message":\s*"([^"]+)"/) || [])[1];
    if (/API key not valid|API_KEY_INVALID/i.test(msg)) throw new Error("Gemini rejected the API key. Copy it again from aistudio.google.com/apikey.");
    if (/HTTP 404|no longer available|not found for API version|is not supported/i.test(msg)) { const err = new Error(`Model "${model}" is not available: ${(inner || msg).slice(0, 200)}`); err.modelGone = true; throw err; }
    throw new Error("Gemini error: " + (inner || msg).slice(0, 300));
  }
  const j = JSON.parse(text);
  const cand = j.candidates && j.candidates[0];
  const out = ((cand && cand.content && cand.content.parts) || []).map((p) => p.text || "").join("").trim();
  const chunks = (cand && cand.groundingMetadata && cand.groundingMetadata.groundingChunks) || [];
  const web = chunks.map((c) => c.web).filter(Boolean).map((w) => ({ title: w.title, url: w.uri }));
  if (!out) throw new Error("Gemini returned no text" + (cand && cand.finishReason ? " (" + cand.finishReason + ")" : ""));
  return { text: out, web, provider: "gemini:" + model };
}

async function ollama(settings, prompt, o) {
  const base = (settings.ollamaUrl || "http://127.0.0.1:11434").replace(/\/$/, "");
  let text;
  try {
    const messages = [{ role: "system", content: o.system }, ...o.history.map((h) => ({ role: h.role === "model" ? "assistant" : "user", content: h.text })), { role: "user", content: prompt }];
    text = await fetchText(base + "/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: settings.ollamaModel, messages, stream: false, options: { temperature: 0.3 } }), timeout: 600000, retries: 0 });
  } catch (e) {
    throw new Error("Could not reach Ollama at " + base + ". Install it from ollama.com, run `ollama pull " + settings.ollamaModel + "`, and keep it running. (" + String(e.message).slice(0, 120) + ")");
  }
  const j = JSON.parse(text);
  return { text: ((j.message && j.message.content) || j.response || "").trim(), web: [], provider: "ollama:" + settings.ollamaModel };
}

async function test(settings) {
  const r = await generate({ ...settings, geminiGrounding: "0" }, "Reply with exactly: OK");
  return { ok: true, provider: r.provider, reply: r.text.slice(0, 80) };
}

module.exports = { generate, test, SYSTEM, RULES, RADAR_SYSTEM, INVESTOR_SYSTEM, CHAT_SYSTEM };
