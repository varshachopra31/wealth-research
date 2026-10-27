"use strict";
// Research assistant: a chat panel on every page. Answers from the dashboard's own data
// (the page you're on, companies you name, your portfolio, the radar) with numbered sources.
(() => {
  const C = window.CMP;
  if (!C) return;
  const { api, esc, md, route, go } = C;
  const KEY = "assistant_history";
  let history = [];
  try { history = JSON.parse(sessionStorage.getItem(KEY) || "[]"); } catch { history = []; }
  const save = () => { try { sessionStorage.setItem(KEY, JSON.stringify(history.slice(-30))); } catch { /* private mode */ } };

  document.body.insertAdjacentHTML("beforeend", `
    <button class="ask-fab" id="askFab" title="Ask the research assistant"><span>✦</span> Ask</button>
    <aside class="ask" id="askPanel" hidden aria-label="Research assistant">
      <div class="ask-h"><div><b>Research assistant</b><div class="sm muted" id="askCtx"></div></div>
        <button class="btn ghost sm" id="askClear" title="Start a new conversation">New chat</button><button class="btn ghost sm" id="askClose" title="Close">✕</button></div>
      <div class="ask-body" id="askBody"></div>
      <div class="ask-sugg" id="askSugg"></div>
      <form class="ask-in" id="askForm"><textarea id="askInput" rows="2" placeholder="Ask about a company, an investor, your portfolio…"></textarea><button class="btn pri" id="askSend" type="submit">Send</button></form>
      <div class="ask-foot">Answers use only the dashboard's data, sent to your free Gemini key. Research, not advice — check the sources.</div>
    </aside>`);
  const $ = (s) => document.querySelector(s);
  const panel = $("#askPanel"), body = $("#askBody");

  const pageCtx = () => { const r = route(); return { name: r.name, arg: r.arg }; };
  function ctxLabel() {
    const p = pageCtx();
    const map = { stock: `Looking at ${p.arg}`, investor: "Looking at an investor profile", fund: "Looking at a mutual fund", portfolio: "Looking at your portfolio", smart: "Looking at the smart-money radar", discover: "Looking at Discover", home: "On the home page" };
    return map[p.name] || "Ask about any company, fund or investor";
  }
  function suggestions() {
    const p = pageCtx();
    if (p.name === "stock") return [`Explain ${p.arg} like I'm new to investing`, `What are the biggest risks for ${p.arg}?`, `Should I buy ${p.arg} now or wait?`, `Who is buying or selling ${p.arg}?`];
    if (p.name === "investor") return ["Is this investor worth following?", "What is their investing style?", "Which of their holdings look best right now?"];
    if (p.name === "smart") return ["Which smart-money ideas look strongest and why?", "Which signals have actually worked so far?", "Explain the difference between Investigate and Watch"];
    if (p.name === "portfolio") return ["How is my portfolio doing against inflation?", "Am I too concentrated anywhere?", "What could I add to diversify?"];
    if (p.name === "fund") return ["Is this fund a good long-term choice?", "How consistent has this fund been?"];
    return ["What are the best ideas right now and why?", "Explain P/E and ROCE simply", "How does this app decide 'Buy today'?"];
  }
  function render() {
    $("#askCtx").textContent = ctxLabel();
    body.innerHTML = history.length ? history.map(msgHtml).join("") : `<div class="ask-hello"><b>Hi! Ask me anything about the companies, funds and investors in this dashboard.</b><div class="sm muted" style="margin-top:6px">I know which page you're on, so “is it a good buy?” works here. I only use the app's own data and show sources.</div></div>`;
    $("#askSugg").innerHTML = suggestions().map((s) => `<button class="chip" data-s="${esc(s)}">${esc(s)}</button>`).join("");
    body.scrollTop = body.scrollHeight;
  }
  function msgHtml(m) {
    if (m.role === "user") return `<div class="msg u">${esc(m.text)}</div>`;
    if (m.pending) return `<div class="msg a"><span class="spin"></span> Looking through the data…</div>`;
    if (m.error) return `<div class="msg a err">${esc(m.error)} <a href="#/settings">Settings</a></div>`;
    const links = (m.used || []).map((s) => `<a class="chip" href="#/stock/${encodeURIComponent(s)}">${esc(s)}</a>`).join("");
    return `<div class="msg a">${md(m.text)}${links ? `<div style="margin-top:6px">${links}</div>` : ""}${(m.sources || []).length ? `<details><summary>Sources (${m.sources.length})</summary><div class="srcs">${m.sources.map((s) => `<div><span class="chip">${esc(s.id)}</span> ${s.url && /^https?:/.test(s.url) ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a>` : esc(s.name)}</div>`).join("")}</div></details>` : ""}</div>`;
  }
  async function ask(q) {
    q = q.trim(); if (!q) return;
    const prior = history.filter((m) => !m.pending && !m.error).map((m) => ({ role: m.role, text: m.text }));
    history.push({ role: "user", text: q }, { role: "model", pending: true });
    render(); $("#askInput").value = ""; $("#askSend").disabled = true;
    try {
      const r = await api("/api/ai/chat", { method: "POST", body: { question: q, history: prior, page: pageCtx() } });
      history[history.length - 1] = { role: "model", text: r.text, sources: r.sources, used: r.used };
    } catch (e) { history[history.length - 1] = { role: "model", error: e.message }; }
    save(); render(); $("#askSend").disabled = false; $("#askInput").focus();
  }

  const open = () => { panel.hidden = false; document.body.classList.add("ask-open"); render(); setTimeout(() => $("#askInput").focus(), 50); };
  const close = () => { panel.hidden = true; document.body.classList.remove("ask-open"); };
  $("#askFab").onclick = () => (panel.hidden ? open() : close());
  $("#askClose").onclick = close;
  $("#askClear").onclick = () => { history = []; save(); render(); };
  $("#askForm").onsubmit = (e) => { e.preventDefault(); ask($("#askInput").value); };
  $("#askInput").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask($("#askInput").value); } });
  $("#askSugg").addEventListener("click", (e) => { const b = e.target.closest("[data-s]"); if (b) ask(b.dataset.s); });
  body.addEventListener("click", (e) => { const a = e.target.closest("a[href^='#/']"); if (a && innerWidth < 760) close(); });
  window.addEventListener("hashchange", () => { if (!panel.hidden) { $("#askCtx").textContent = ctxLabel(); $("#askSugg").innerHTML = suggestions().map((s) => `<button class="chip" data-s="${esc(s)}">${esc(s)}</button>`).join(""); } });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !panel.hidden && document.activeElement && document.activeElement.id === "askInput") close(); });
  window.ASSISTANT = { open, ask };
})();
