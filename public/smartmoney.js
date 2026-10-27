"use strict";
// Smart Money & Hidden Opportunities Radar — UI module (uses helpers exported by app.js as window.CMP)
(() => {
  const C = window.CMP;
  if (!C) return;
  const { V, api, esc, isNum, pct, sp, num, dt, ago, head, ring, hbars, actPill, toast, go, live, $, $$, setTitle, view, disc, noteHtml } = C;

  // shared AI block: show the saved note if there is one, otherwise write a new one
  async function aiBlock(host, subject, endpoint) {
    const run = async () => {
      host.innerHTML = '<div class="empty"><span class="spin"></span> Writing — usually 20–60 seconds on the free tier…</div>';
      try { const n = await api(endpoint, { method: "POST", body: {} }); show({ ...n, created_at: new Date().toISOString() }); }
      catch (e) { host.innerHTML = `<div class="note warn">${esc(e.message)} <a href="#/settings">Settings</a></div>`; }
    };
    const show = (n) => { host.innerHTML = noteHtml(n) + '<button class="btn sm" data-regen style="margin-top:10px">↻ Write a fresh one</button>'; host.querySelector("[data-regen]").onclick = run; };
    host.innerHTML = '<div class="empty"><span class="spin"></span></div>';
    const saved = await api("/api/ai/notes?subject=" + encodeURIComponent(subject)).catch(() => ({ items: [] }));
    if (saved.items.length) show(saved.items[0]); else run();
  }
  C.aiBlock = aiBlock;

  const RLAB = {
    Investigate: { c: "--buy", d: "Smart money is buying AND the business and valuation check out. Worth your research time — still not a buy signal on its own." },
    Watch: { c: "--watch", d: "Positive investor activity, but the price is stretched or the business is only average." },
    "Needs data": { c: "--pass", d: "Investor activity in a company outside the analysed set — fundamentals are loaded automatically for the strongest ones." },
    Avoid: { c: "--avoid", d: "Smart money is in, but the business has red flags, is weak or loss-making, or the price already ran ahead." },
    "Smart money selling": { c: "--inv", d: "Insiders or big investors are reducing their stakes." },
    "Low signal": { c: "--pass", d: "Too little or too mixed activity to mean much." },
  };
  const rpill = (l) => `<span class="pill" style="color:var(${(RLAB[l] || RLAB["Low signal"]).c});background:color-mix(in srgb, var(${(RLAB[l] || RLAB["Low signal"]).c}) 14%, transparent)">${esc(l)}</span>`;
  const conf = (c) => `<span class="tag ${c === "High" ? "" : c === "Medium" ? "warn" : "bad"}" title="Confidence: how much independent evidence and data supports this">${esc(c)} confidence</span>`;
  const invLink = (key, name) => `<a href="#/investor/${encodeURIComponent(key)}">${esc(name)}</a>`;
  const dirTag = (d) => (d > 0 ? '<span class="up">▲</span>' : '<span class="down">▼</span>');
  const statCell = (s) => (s && s.n ? `<b class="${s.median >= 0 ? "up" : "down"}">${s.median >= 0 ? "+" : ""}${(s.median * 100).toFixed(1)}%</b><div class="muted sm">hit ${(s.hit * 100).toFixed(0)}% · n ${s.n}${s.stocks != null ? ` in ${s.stocks} cos` : ""}</div>` : '<span class="muted">—</span>');
  const TABS = [["radar", "Radar"], ["investors", "Investors"], ["activity", "Activity"], ["themes", "Themes"], ["track", "Track record"], ["coverage", "Coverage & limits"]];

  // ------------------------------------------------------------------ page shell
  V.smart = async (r) => {
    setTitle("Smart money");
    const tab = r.q.get("tab") || "radar";
    const st = await api("/api/status"); live(r);
    const running = st.jobs.running === "smartmoney";
    view().innerHTML = `${head("Smart money radar", "Discovers investors from public disclosures — bulk/block deals, SAST filings and quarterly shareholding — and checks whether the businesses they buy actually hold up.", `<button class="btn" id="smRun">${running ? '<span class="spin"></span> Updating…' : "↻ Update now"}</button>`, "Follow the evidence, not the crowd")}
      <div class="note warn" style="margin-bottom:14px"><b>Rule:</b> an investor buying, or a share price surging, is never a buy signal on its own. A stock only reaches “Investigate” when the business and the valuation also check out — and even then it's a reason to research, not to buy.</div>
      <div class="seg" style="margin-bottom:16px">${TABS.map(([k, l]) => `<a href="#/smart?tab=${k}" class="${k === tab ? "on" : ""}">${l}</a>`).join("")}</div>
      <div id="smBody"><div class="skel"></div></div>`;
    $("#smRun").onclick = async () => { await api("/api/sm/run", { method: "POST", body: {} }); toast("Smart-money update started — it crawls ~40 companies per run"); $("#smRun").innerHTML = '<span class="spin"></span> Updating…'; };
    await (TAB_FN[tab] || TAB_FN.radar)(r, $("#smBody"));
  };

  // ------------------------------------------------------------------ radar
  const RSTATE = { label: "Investigate", conf: "", q: "", show: 25 };
  const TAB_FN = {};
  TAB_FN.radar = async (r, host) => {
    const d = await api("/api/sm/radar"); live(r);
    const all = d.items, cov = d.coverage;
    const counts = {}; all.forEach((x) => (counts[x.label] = (counts[x.label] || 0) + 1));
    const covNote = cov.shareholding < cov.universe ? `<div class="note" style="margin-bottom:14px">Still collecting: shareholding history for ${cov.shareholding} of ${cov.universe} companies so far (it continues automatically every hour). The radar gets more complete as it fills in.</div>` : "";
    host.innerHTML = `${covNote}
      <div class="row" style="align-items:center;margin-bottom:12px">
        <div class="seg" id="rLab">${Object.keys(RLAB).map((l) => `<button data-l="${esc(l)}" class="${RSTATE.label === l ? "on" : ""}">${esc(l)}<span class="n">${counts[l] || 0}</span></button>`).join("")}<button data-l="" class="${!RSTATE.label ? "on" : ""}">All<span class="n">${all.length}</span></button></div>
        <select id="rConf"><option value="">Any confidence</option><option${RSTATE.conf === "High" ? " selected" : ""}>High</option><option${RSTATE.conf === "Medium" ? " selected" : ""}>Medium</option></select>
        <input id="rQ" placeholder="Filter company…" value="${esc(RSTATE.q)}" style="width:180px"></div>
      <div class="note" id="rDesc" style="margin-bottom:14px"></div><div id="rList"></div>`;
    const draw = () => {
      $("#rDesc").textContent = RSTATE.label ? RLAB[RSTATE.label].d : "Every company with recent investor activity.";
      const items = all.filter((x) => (!RSTATE.label || x.label === RSTATE.label) && (!RSTATE.conf || x.confidence === RSTATE.conf || (RSTATE.conf === "Medium" && x.confidence === "High")) && (!RSTATE.q || (x.symbol + " " + x.name).toLowerCase().includes(RSTATE.q.toLowerCase())));
      $("#rList").innerHTML = items.length ? items.slice(0, RSTATE.show).map(radarCard).join("") + (items.length > RSTATE.show ? `<div style="text-align:center;margin-top:14px"><button class="btn" id="rMore">Show more (${items.length - RSTATE.show})</button></div>` : "") : '<div class="card"><div class="empty">Nothing here yet.</div></div>';
      const m = $("#rMore"); if (m) m.onclick = () => { RSTATE.show += 25; draw(); };
      $$("[data-dd]", $("#rList")).forEach((b) => (b.onclick = () => {
        const host = document.getElementById("dd-" + b.dataset.dd);
        if (!host.hidden) { host.hidden = true; b.textContent = "✦ AI deep-dive"; return; }
        host.hidden = false; b.textContent = "Hide deep-dive";
        aiBlock(host, "RADAR:" + b.dataset.dd, "/api/ai/radar/" + encodeURIComponent(b.dataset.dd));
      }));
    };
    draw();
    $("#rLab").onclick = (e) => { const b = e.target.closest("[data-l]"); if (!b) return; RSTATE.label = b.dataset.l; RSTATE.show = 25; $$("#rLab button").forEach((x) => x.classList.toggle("on", x === b)); draw(); };
    $("#rConf").onchange = (e) => { RSTATE.conf = e.target.value; draw(); };
    let t; $("#rQ").oninput = (e) => { clearTimeout(t); t = setTimeout(() => { RSTATE.q = e.target.value; draw(); }, 150); };
  };
  function radarCard(x) {
    const bar = (l, v) => `<div class="mbar">${l}<i><b style="width:${isNum(v) ? v : 0}%;background:${v >= 65 ? "var(--buy)" : v >= 40 ? "var(--a2)" : "var(--avoid)"}"></b></i></div>`;
    return `<div class="card smcard" style="--lc:var(${(RLAB[x.label] || RLAB["Low signal"]).c})">
      <div class="smc-head"><div style="min-width:0"><div class="row" style="gap:8px;align-items:center">${x.inUniverse ? `<a class="sym" href="#/stock/${encodeURIComponent(x.symbol)}">${esc(x.symbol)}</a>` : `<span class="sym">${esc(x.symbol)}</span>`}${rpill(x.label)}${conf(x.confidence)}${x.repeated ? `<span class="tag">repeat buying</span>` : ""}${x.pledged ? '<span class="tag bad">pledge filings</span>' : ""}</div>
        <div class="muted sm">${esc(x.name)} · ${esc(x.industry)} · last activity ${dt(x.lastDate)}</div></div>
        ${isNum(x.score) ? `<div style="text-align:center">${ring(x.score, 62)}<div class="muted sm">score</div></div>` : ""}</div>
      <div class="smc-body"><div>
          <ul class="reasons" style="margin-top:4px">${x.reasons.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>
          <div class="sm muted" style="margin-top:8px">⚠ ${esc(x.guards.join(" "))}</div>
          <div class="ev">${x.evidence.slice(0, 5).map((e) => `<div class="evr"><span class="muted sm">${dt(e.date)}</span><span>${dirTag(e.dir)} <b>${esc(e.investor.slice(0, 48))}</b> <span class="muted sm">· ${esc(e.type)}</span><div class="sm soft">${esc(e.kind)} — ${esc(e.detail)}</div></span>${e.source ? `<a class="sm" href="${esc(e.source)}" target="_blank" rel="noopener">source ↗</a>` : "<span></span>"}</div>`).join("")}${x.evidence.length > 5 ? `<div class="sm muted">+ ${x.evidence.length - 5} more filings</div>` : ""}</div></div>
        <div class="smc-side">${x.inUniverse ? `<div class="mbars" style="grid-template-columns:repeat(3,1fr);margin-top:0">${bar("Quality", x.q)}${bar("Growth", x.g)}${bar("Value", x.v)}</div>
          <div class="kv" style="margin-top:12px;font-size:12.5px"><div class="k">Our take</div><div>${actPill(x.action) || "—"}</div><div class="k">Base / bear (real)</div><div>${x.upside ? `${sp(x.upside.base)} / ${sp(x.upside.bear)}` : "—"}</div><div class="k">3-month price</div><div>${sp(x.ret3m)}</div><div class="k">Business</div><div>${x.improving ? '<span class="up">improving</span>' : "not clearly improving"}</div>
          <div class="k">Investors</div><div><span class="up">${x.posInvestors} buying</span> · <span class="down">${x.negInvestors} selling</span></div></div>
          <a class="btn sm" style="margin-top:12px" href="#/stock/${encodeURIComponent(x.symbol)}">Open full analysis →</a>` : `<div class="note">Fundamentals not loaded yet. The strongest outside signals are analysed automatically each day.</div>`}
          <button class="btn sm pri" style="margin-top:8px" data-dd="${esc(x.symbol)}">✦ AI deep-dive</button></div></div>
      <div class="aidd" id="dd-${esc(x.symbol)}" hidden></div></div>`;
  }

  // ------------------------------------------------------------------ investors
  const ISTATE = { f: "lesser", q: "", sort: "recent", show: 60 };
  const IFILT = [["lesser", "Lesser-known, high-conviction", (i) => i.highConviction && i.itype !== "promoter"], ["individual", "Individuals", (i) => i.itype === "individual"], ["pe_vc", "Funds / PE / VC", (i) => i.itype === "pe_vc"], ["mutual_fund", "Mutual funds", (i) => i.itype === "mutual_fund"], ["foreign_institution", "Foreign", (i) => i.itype === "foreign_institution"], ["company", "Companies / family offices", (i) => i.itype === "company"], ["promoter", "Promoters", (i) => i.itype === "promoter"], ["all", "All", () => true]];
  TAB_FN.investors = async (r, host) => {
    const d = await api("/api/sm/investors"); live(r);
    const all = d.items;
    host.innerHTML = `<div class="note" style="margin-bottom:14px">${all.length.toLocaleString("en-IN")} investors discovered automatically from filings — nobody was hand-picked. Style labels come from what they actually hold; track record from how their past buys performed vs the Nifty 500.</div>
      <div class="row" style="align-items:center;margin-bottom:12px"><div class="seg" id="iF">${IFILT.map(([k, l, f]) => `<button data-f="${k}" class="${ISTATE.f === k ? "on" : ""}">${l}<span class="n">${all.filter(f).length}</span></button>`).join("")}</div>
        <select id="iS"><option value="recent">Most active recently</option><option value="value">Largest disclosed holdings</option><option value="track">Best track record</option><option value="positions">Most positions</option></select><input id="iQ" placeholder="Search investor…" style="width:180px" value="${esc(ISTATE.q)}"></div>
      <div class="card" style="padding:8px 10px"><div class="tbl-wrap" id="iT"></div></div>`;
    $("#iS").value = ISTATE.sort;
    const draw = () => {
      const f = (IFILT.find((x) => x[0] === ISTATE.f) || IFILT[0])[2];
      const sorters = { recent: (a, b) => b.recentBuys - a.recentBuys || b.totalCr - a.totalCr, value: (a, b) => b.totalCr - a.totalCr, track: (a, b) => ((b.track && b.track.n >= 3 ? b.track.median : -9) - (a.track && a.track.n >= 3 ? a.track.median : -9)), positions: (a, b) => b.nPositions - a.nPositions };
      const items = all.filter(f).filter((i) => !ISTATE.q || i.name.toLowerCase().includes(ISTATE.q.toLowerCase())).sort(sorters[ISTATE.sort]);
      $("#iT").innerHTML = items.length ? `<table class="tbl"><thead><tr><th>Investor</th><th>Type & style</th><th class="r">Positions</th><th class="r">Disclosed value</th><th class="r">Buys (4 mo)</th><th class="r">Past buys vs Nifty 500 (6m)</th><th>Last activity</th></tr></thead><tbody>
        ${items.slice(0, ISTATE.show).map((i) => `<tr class="go" data-k="${esc(i.key)}"><td><b>${esc(i.name)}</b>${i.lesserKnown ? ' <span class="tag">high conviction</span>' : ""}<div class="muted sm">${i.positions.slice(0, 3).map((p) => esc(p.symbol)).join(", ")}${i.nPositions > 3 ? "…" : ""}</div></td>
          <td><span class="sm">${esc(i.typeLabel)}</span><div>${i.style.map((s) => `<span class="tag" style="color:var(--a2);background:color-mix(in srgb,var(--a2) 12%,transparent)">${esc(s)}</span>`).join("")}</div></td>
          <td class="r">${i.nPositions}</td><td class="r">${i.totalCr ? "₹" + Math.round(i.totalCr).toLocaleString("en-IN") + " cr" : "—"}</td><td class="r">${i.recentBuys}</td><td class="r">${i.track && i.track.n >= 3 ? statCell(i.track) : '<span class="muted sm">too few</span>'}</td><td class="sm muted">${dt(i.lastActivity)}</td></tr>`).join("")}</tbody></table>
        ${items.length > ISTATE.show ? `<div style="text-align:center;margin:10px"><button class="btn sm" id="iMore">Show more (${items.length - ISTATE.show})</button></div>` : ""}` : '<div class="empty">No investors match.</div>';
      $$("tr[data-k]", $("#iT")).forEach((tr) => (tr.onclick = () => go("#/investor/" + encodeURIComponent(tr.dataset.k))));
      const m = $("#iMore"); if (m) m.onclick = () => { ISTATE.show += 60; draw(); };
    };
    draw();
    $("#iF").onclick = (e) => { const b = e.target.closest("[data-f]"); if (!b) return; ISTATE.f = b.dataset.f; ISTATE.show = 60; $$("#iF button").forEach((x) => x.classList.toggle("on", x === b)); draw(); };
    $("#iS").onchange = (e) => { ISTATE.sort = e.target.value; draw(); };
    let t; $("#iQ").oninput = (e) => { clearTimeout(t); t = setTimeout(() => { ISTATE.q = e.target.value; draw(); }, 150); };
  };

  V.investor = async (r) => {
    const i = await api("/api/sm/investor/" + encodeURIComponent(r.arg)); live(r);
    setTitle(i.name);
    const buys = i.activity.filter((a) => a.dir > 0);
    const pattern = [];
    if (i.style.includes("Buys on weakness")) pattern.push("tends to buy after the share price has fallen (contrarian)");
    if (i.style.includes("Buys momentum")) pattern.push("tends to buy after the price has already risen (momentum)");
    if (i.style.includes("Accumulates in steps")) pattern.push(`builds positions gradually (repeat buying in ${i.repeated.length} compan${i.repeated.length === 1 ? "y" : "ies"})`);
    if (i.style.includes("Concentrated")) pattern.push("holds a few large positions");
    if (i.style.includes("Small-cap specialist")) pattern.push("focuses on smaller companies");
    if (i.style.includes("Value")) pattern.push("owns companies that look cheap vs their industry");
    if (i.style.includes("Quality")) pattern.push("owns high-quality businesses");
    view().innerHTML = `${head(esc(i.name), `${esc(i.typeLabel)} · discovered from public filings · last activity ${dt(i.lastActivity)}`, `<a class="btn" href="#/smart?tab=investors">← Investors</a>`, "Investor profile")}
      <div class="grid g4"><div class="card kpi"><div class="k">Disclosed positions (&gt;1%)</div><div class="v">${i.nPositions}</div><div class="d">only stakes above 1% are named</div></div>
        <div class="card kpi"><div class="k">Disclosed value</div><div class="v">${i.totalCr ? "₹" + Math.round(i.totalCr).toLocaleString("en-IN") + " cr" : "—"}</div><div class="d">at today's prices</div></div>
        <div class="card kpi"><div class="k">Buys / sells seen</div><div class="v">${i.buys} / ${i.sells}</div><div class="d">${i.recentBuys} buys in the last 4 months</div></div>
        <div class="card kpi"><div class="k">Past buys vs Nifty 500 (6m)</div><div class="v">${i.track && i.track.n ? `${i.track.median >= 0 ? "+" : ""}${(i.track.median * 100).toFixed(1)}%` : "—"}</div><div class="d">${i.track && i.track.n ? `median · hit ${(i.track.hit * 100).toFixed(0)}% · n ${i.track.n}${i.track.n < 5 ? " (too few to trust)" : ""}` : "not enough history yet"}</div></div></div>
      <div class="card"><div class="card-h"><h2>Style & behaviour</h2></div><div>${i.style.map((s) => `<span class="tag" style="font-size:13px;height:26px">${esc(s)}</span>`).join("") || '<span class="muted">Not enough holdings data to infer a style.</span>'}</div>
        ${pattern.length ? `<p class="soft" style="margin:10px 0 0">From the filings, this investor ${esc(pattern.join("; "))}.</p>` : ""}<div class="sm muted" style="margin-top:8px">Inferred from disclosed holdings and trades only — their full portfolio, costs and reasons are not public.</div></div>
      <div class="card"><div class="card-h"><h2>✦ AI investor profile</h2><span class="hint">free Gemini · based only on these filings</span></div><div id="invAi"><button class="btn pri" id="invAiBtn">✦ Explain this investor</button></div></div>
      <div class="card"><div class="card-h"><h2>Disclosed holdings</h2><span class="hint">latest quarterly shareholding filings</span></div>${i.positions.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Company</th><th class="r">Stake</th><th class="r">Value</th><th>Our take</th><th class="r">Quality</th><th class="r">Value score</th><th>Quarter</th></tr></thead><tbody>
        ${i.positions.map((p) => `<tr class="go" data-sym="${esc(p.symbol)}"><td><b>${esc(p.symbol)}</b><div class="muted sm">${esc(p.name || "")} · ${esc(p.industry || "")}</div></td><td class="r">${pct(p.pct, 2)}</td><td class="r">${p.valueCr ? "₹" + Math.round(p.valueCr).toLocaleString("en-IN") + " cr" : "—"}</td><td>${actPill(p.action) || "—"}</td><td class="r">${isNum(p.q) ? p.q.toFixed(0) : "—"}</td><td class="r">${isNum(p.v) ? p.v.toFixed(0) : "—"}</td><td class="sm muted">${dt(p.quarter)}</td></tr>`).join("")}</tbody></table></div>` : '<div class="empty">No disclosed holdings above 1% in the analysed companies (activity may come from deals or SAST filings only).</div>'}</div>
      <div class="card"><div class="card-h"><h2>Activity & what happened next</h2><span class="hint">return vs Nifty 500 after each move</span></div>${i.activity.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Date</th><th>Company</th><th>Move</th><th class="r">Next 3 months</th><th class="r">Next 6 months</th><th></th></tr></thead><tbody>
        ${i.activity.map((a) => `<tr><td class="sm">${dt(a.date)}</td><td>${a.inUniverse ? `<a href="#/stock/${encodeURIComponent(a.symbol)}"><b>${esc(a.symbol)}</b></a>` : `<b>${esc(a.symbol)}</b>`}</td><td>${dirTag(a.dir)} ${esc(a.kindLabel)}<div class="muted sm">${esc(a.detail)}</div></td><td class="r">${isNum(a.excess["3m"]) ? sp(a.excess["3m"]) : '<span class="muted sm">pending</span>'}</td><td class="r">${isNum(a.excess["6m"]) ? sp(a.excess["6m"]) : '<span class="muted sm">pending</span>'}</td><td>${a.source ? `<a class="sm" href="${esc(a.source)}" target="_blank" rel="noopener">source ↗</a>` : ""}</td></tr>`).join("")}</tbody></table></div>` : '<div class="empty">No activity recorded.</div>'}</div>${disc}`;
    $$("tr[data-sym]").forEach((tr) => (tr.onclick = () => go("#/stock/" + encodeURIComponent(tr.dataset.sym))));
    const ib = $("#invAiBtn"); if (ib) ib.onclick = () => aiBlock($("#invAi"), "INV:" + i.key, "/api/ai/investor/" + encodeURIComponent(i.key));
    api("/api/ai/notes?subject=" + encodeURIComponent("INV:" + i.key)).then((n) => { if (n.items.length && $("#invAi")) aiBlock($("#invAi"), "INV:" + i.key, "/api/ai/investor/" + encodeURIComponent(i.key)); }).catch(() => {});
  };

  // ------------------------------------------------------------------ activity
  const ASTATE = { days: 30, dir: "buy", promoters: true, type: "" };
  TAB_FN.activity = async (r, host) => {
    const d = await api("/api/sm/activity?days=180"); live(r);
    const types = [...new Set(d.items.map((x) => x.typeLabel))].sort();
    host.innerHTML = `<div class="row" style="align-items:center;margin-bottom:12px"><div class="seg" id="aD">${[7, 30, 90, 180].map((x) => `<button data-d="${x}" class="${ASTATE.days === x ? "on" : ""}">${x} days</button>`).join("")}</div>
      <div class="seg" id="aDir">${[["buy", "Buying"], ["sell", "Selling"], ["all", "All"]].map(([k, l]) => `<button data-v="${k}" class="${ASTATE.dir === k ? "on" : ""}">${l}</button>`).join("")}</div>
      <select id="aT"><option value="">All investor types</option>${types.map((t) => `<option${ASTATE.type === t ? " selected" : ""}>${esc(t)}</option>`).join("")}</select>
      <label class="chk"><input type="checkbox" id="aP"${ASTATE.promoters ? " checked" : ""}> include promoters</label></div>
      <div class="sm muted" style="margin-bottom:10px">High-frequency traders (who buy and sell the same stock the same day), index funds and lenders recording pledges are filtered out automatically.</div>
      <div class="card" style="padding:8px 10px"><div class="tbl-wrap" id="aT2"></div></div>`;
    const draw = () => {
      const since = new Date(Date.now() - ASTATE.days * 864e5).toISOString().slice(0, 10);
      const items = d.items.filter((x) => x.date >= since && (ASTATE.dir === "all" || (ASTATE.dir === "buy" ? x.dir > 0 : x.dir < 0)) && (ASTATE.promoters || x.itype !== "promoter") && (!ASTATE.type || x.typeLabel === ASTATE.type) && !["broker", "passive"].includes(x.itype));
      $("#aT2").innerHTML = items.length ? `<table class="tbl"><thead><tr><th>Date</th><th>Company</th><th>Investor</th><th>Move</th><th></th></tr></thead><tbody>${items.slice(0, 300).map((x) => `<tr><td class="sm">${dt(x.date)}</td><td>${x.inUniverse ? `<a href="#/stock/${encodeURIComponent(x.symbol)}"><b>${esc(x.symbol)}</b></a>` : `<b>${esc(x.symbol)}</b>`}<div class="muted sm">${esc((x.name || "").slice(0, 30))}</div></td><td>${invLink(x.ckey, x.investor.slice(0, 50))}<div class="muted sm">${esc(x.typeLabel)}</div></td><td>${dirTag(x.dir)} ${esc(x.kindLabel)}<div class="muted sm">${esc(x.detail)}</div></td><td>${x.source ? `<a class="sm" href="${esc(x.source)}" target="_blank" rel="noopener">source ↗</a>` : ""}</td></tr>`).join("")}</tbody></table>${items.length > 300 ? '<div class="muted sm" style="padding:8px">Showing the latest 300.</div>' : ""}` : '<div class="empty">No activity in this window.</div>';
    };
    draw();
    $("#aD").onclick = (e) => { const b = e.target.closest("[data-d]"); if (!b) return; ASTATE.days = +b.dataset.d; $$("#aD button").forEach((x) => x.classList.toggle("on", x === b)); draw(); };
    $("#aDir").onclick = (e) => { const b = e.target.closest("[data-v]"); if (!b) return; ASTATE.dir = b.dataset.v; $$("#aDir button").forEach((x) => x.classList.toggle("on", x === b)); draw(); };
    $("#aT").onchange = (e) => { ASTATE.type = e.target.value; draw(); };
    $("#aP").onchange = (e) => { ASTATE.promoters = e.target.checked; draw(); };
  };

  // ------------------------------------------------------------------ themes
  TAB_FN.themes = async (r, host) => {
    const d = await api("/api/sm/themes"); live(r);
    const inds = d.items.filter((t) => !/Not analysed/.test(t.industry));
    const other = d.items.find((t) => /Not analysed/.test(t.industry));
    const TL = { individual: "individuals", mutual_fund: "mutual funds", foreign_institution: "foreign funds", pe_vc: "PE/VC/AIFs", promoter: "promoters", company: "companies", insurer: "insurers", government: "govt/pension" };
    host.innerHTML = `<div class="grid g-21">
      <div class="card"><div class="card-h"><h2>Where smart money is buying</h2><span class="hint">last 4 months · distinct buyers per industry</span></div>
        ${inds.length ? inds.slice(0, 14).map((t) => `<div class="theme"><div class="row" style="align-items:baseline;gap:8px"><b>${esc(t.industry)}</b>${t.accelerating ? '<span class="tag">accelerating</span>' : ""}${isNum(t.avgRevAccel) && t.avgRevAccel > 0.02 ? '<span class="tag" style="color:var(--buy);background:var(--buy-bg)">sales accelerating</span>' : ""}<span class="muted sm" style="margin-left:auto">${t.buyers} buying · ${t.sellers} selling${t.prevBuyers ? ` · ${t.prevBuyers} buyers in the 4 months before` : ""}</span></div>
          <div class="sm soft">${Object.entries(t.byType).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => `${n} by ${TL[k] || k}`).join(", ")}</div>
          <div>${t.companies.map((s) => `<a class="chip" href="#/stock/${encodeURIComponent(s)}">${esc(s)}</a>`).join("")}</div></div>`).join("") : '<div class="empty">Not enough data yet.</div>'}
        ${other ? `<div class="sm muted" style="margin-top:12px">Plus ${other.buyers} buyers in smaller companies outside the analysed set.</div>` : ""}</div>
      <div class="card"><div class="card-h"><h2>Where venture capital is going</h2><a class="hint" href="#/vc">details →</a></div>${d.vc.length ? hbars(d.vc.map((s) => [s.sector, s.usdMn, `$${num(s.usdMn, 0)}M · ${s.deals}`])) : '<div class="empty">No funding headlines yet.</div>'}
        <div class="sm muted" style="margin-top:12px">Themes that show up in both columns — listed investors buying AND venture money flowing in — are the ones worth a closer look. “Accelerating” means more distinct buyers than in the previous 4 months.</div></div></div>`;
  };

  // ------------------------------------------------------------------ track record
  TAB_FN.track = async (r, host) => {
    const t = await api("/api/sm/track"); live(r);
    const KL = { PROMOTER_BUY: "Promoter bought in the market", PROMOTER_SELL: "Promoter sold in the market", PROMOTER_PREF: "Promoter subscribed to new shares", SAST_BUY: "Big holder added (5%+)", SAST_SELL: "Big holder cut (5%+)", PREF_ALLOT: "Investor took a preferential allotment", NEW_STAKE: "New stake above 1%", STAKE_UP: "Raised stake", STAKE_DOWN: "Cut stake", STAKE_EXIT: "Dropped below 1%", BULK_BUY: "Bulk-deal purchase", BULK_SELL: "Bulk-deal sale", BLOCK_BUY: "Block-deal purchase", BLOCK_SELL: "Block-deal sale", PLEDGE: "Pledge / encumbrance filing" };
    const TL = { individual: "Individuals", mutual_fund: "Mutual funds", foreign_institution: "Foreign institutions", pe_vc: "Funds / PE / VC", promoter: "Promoters", company: "Companies / family offices", insurer: "Insurers", government: "Govt / pension" };
    const tbl = (rows, lab) => `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Signal</th><th class="r">Events</th><th class="r">After 3 months</th><th class="r">After 6 months</th><th class="r">After 1 year</th></tr></thead><tbody>${rows.map((x) => `<tr><td>${esc(lab ? lab[x.key] || x.key : x.key)}</td><td class="r">${x.events}</td><td class="r">${statCell(x.s3m)}</td><td class="r">${statCell(x.s6m)}</td><td class="r">${statCell(x.s1y)}</td></tr>`).join("")}</tbody></table></div>`;
    host.innerHTML = `<div class="note warn" style="margin-bottom:14px"><b>How to read this:</b> each figure is the <b>median</b> return vs the Nifty 500 after the signal (for selling signals, a positive number means the stock did worse — the warning was useful). “Hit” = how often it worked. “in N cos” matters: a result driven by a handful of companies is weak evidence however good it looks.</div>
      <div class="card"><div class="card-h"><h2>Which signals have been useful?</h2><span class="hint">${t.measured.toLocaleString("en-IN")} signals measured · history from ${dt(t.from)}</span></div>${tbl(t.byKind, KL)}</div>
      <div class="grid g2"><div class="card"><div class="card-h"><h2>Buys by investor type</h2></div>${tbl(t.byType, TL)}</div>
        <div class="card"><div class="card-h"><h2>Does buying after a fall or a rise matter?</h2></div>${tbl(t.byPrior)}</div></div>
      <div class="card"><div class="card-h"><h2>Smart money + fundamentals</h2><span class="hint">${t.fairCount} signals tested fairly so far</span></div>${tbl(t.byFundamentals)}
        <div class="sm muted" style="margin-top:10px">The fair test uses the fundamentals as they were when each signal appeared (recorded from now on). The “look-ahead biased” rows judge old signals with today's fundamentals, which flatters or distorts the result — don't rely on them. The fair rows fill in as months pass.</div></div>
      <div class="card"><div class="card-h"><h2>Known weaknesses of this test</h2></div><ul class="reasons">
        <li>Short history: about a year of disclosures, so many results have small samples.</li>
        <li>Survivorship bias: prices are tracked for today's Nifty 500 and loaded companies — firms that collapsed or delisted are under-represented, which flatters results.</li>
        <li>Disclosures are late: shareholding is published up to 3 weeks after the quarter, so you couldn't have acted on the quarter-end date.</li>
        <li>Clustering: several investors in one deal, or one investor's many filings, are not independent — repeat filings within a month are counted once.</li>
        <li>Past usefulness doesn't guarantee future usefulness, and none of this accounts for taxes or trading costs.</li></ul></div>`;
  };

  // ------------------------------------------------------------------ coverage
  TAB_FN.coverage = async (r, host) => {
    const d = await api("/api/sm/radar"); live(r);
    const c = d.coverage;
    host.innerHTML = `<div class="grid g4"><div class="card kpi"><div class="k">Shareholding history</div><div class="v">${c.shareholding}/${c.universe}</div><div class="d">companies crawled · ${c.holdings.q} quarters</div></div>
        <div class="card kpi"><div class="k">Investors found</div><div class="v">${c.holdings.i.toLocaleString("en-IN")}</div><div class="d">distinct named holders</div></div>
        <div class="card kpi"><div class="k">Bulk & block deals</div><div class="v">${c.deals.n.toLocaleString("en-IN")}</div><div class="d">${dt(c.deals.a)} → ${dt(c.deals.b)}</div></div>
        <div class="card kpi"><div class="k">SAST filings</div><div class="v">${c.sast.n.toLocaleString("en-IN")}</div><div class="d">${dt(c.sast.a)} → ${dt(c.sast.b)}</div></div></div>
      <div class="card"><div class="card-h"><h2>Sources (all free and official)</h2></div><div class="kv">
        <div class="k">Bulk & block deals</div><div><a href="https://www.nseindia.com/report-detail/display-bulk-and-block-deals" target="_blank" rel="noopener">NSE</a> — daily files (complete), plus 1-year history per tracked company</div>
        <div class="k">SAST Reg 29</div><div><a href="https://www.nseindia.com/companies-listing/corporate-filings-regulation-29" target="_blank" rel="noopener">NSE</a> — acquisitions/sales by promoters and 5%+ holders</div>
        <div class="k">Shareholding pattern</div><div>NSE quarterly XBRL filings — every named holder above 1%</div>
        <div class="k">Benchmark</div><div>Nifty 500 index (Yahoo Finance) for measuring outcomes</div>
        <div class="k">Venture capital</div><div>Funding headlines (Inc42, Entrackr, ET Tech)</div></div>
        <div class="sm muted" style="margin-top:8px">Updated automatically every hour while the app runs (about 40 companies per pass; the daily files once every 6 hours). Last daily pull: ${c.dailyAt ? ago(c.dailyAt) : "not yet"}.</div></div>
      <div class="card"><div class="card-h"><h2>What it can't see</h2></div><ul class="reasons">
        <li><b>Holdings below 1%</b> aren't named in filings — small positions and gradual exits are invisible (a drop off the list is shown as “below 1% or exited”).</li>
        <li><b>Insider trading (PIT) disclosures</b>: NSE's feed returns no data to automated tools, so director/employee trades below SAST thresholds are missing. Promoter buying above thresholds is covered by SAST.</li>
        <li><b>Mutual fund monthly portfolios</b> are published per fund house in separate files — only quarterly stakes above 1% are used.</li>
        <li><b>BSE-only deals and companies</b>: BSE blocks automated access.</li>
        <li><b>Bulk-deal history</b> before this app started is only backfilled for tracked companies (NSE's history API returns 70 rows per query).</li>
        <li><b>Investor names</b> are matched by spelling; the same investor under different legal entities may appear separately, and a few classifications may be wrong.</li>
        <li><b>Timing</b>: filings arrive days to weeks after the trade — you're always behind the investor.</li>
        <li><b>Motives are unknown</b>: an investor may be hedging, rebalancing, meeting a lock-in or doing a strategic deal.</li></ul></div>`;
  };

  // ------------------------------------------------------------------ stock page section
  window.SMstock = async (sym, host) => {
    if (!host) return;
    host.innerHTML = '<div class="card"><div class="card-h"><h2>Smart-money activity</h2></div><div class="empty"><span class="spin"></span></div></div>';
    let d; try { d = await api("/api/sm/stock/" + encodeURIComponent(sym)); } catch { host.innerHTML = ""; return; }
    const acts = d.activity.filter((a) => !["broker", "passive"].includes(a.itype));
    const rd = d.radar;
    host.innerHTML = `<div class="card"><div class="card-h"><h2>Smart-money activity</h2>${rd ? rpill(rd.label) + conf(rd.confidence) : ""}<a class="hint" href="#/smart">Radar →</a></div>
      ${rd ? `<ul class="reasons" style="margin-top:0">${rd.reasons.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
      ${acts.length ? `<div class="tbl-wrap" style="margin-top:10px"><table class="tbl"><thead><tr><th>Date</th><th>Investor</th><th>Move</th><th class="r">Since then vs Nifty 500</th><th></th></tr></thead><tbody>${acts.slice(0, 12).map((a) => `<tr><td class="sm">${dt(a.date)}</td><td>${invLink(a.ckey, a.investor.slice(0, 44))}<div class="muted sm">${esc(a.typeLabel)}</div></td><td>${dirTag(a.dir)} ${esc(a.kindLabel)}<div class="muted sm">${esc(a.detail)}</div></td><td class="r">${isNum(a.excess["3m"]) ? sp(a.excess["3m"]) + '<div class="muted sm">3 months</div>' : '<span class="muted sm">too recent</span>'}</td><td>${a.source ? `<a class="sm" href="${esc(a.source)}" target="_blank" rel="noopener">source ↗</a>` : ""}</td></tr>`).join("")}</tbody></table></div>${acts.length > 12 ? `<div class="sm muted" style="margin-top:6px">+ ${acts.length - 12} older moves</div>` : ""}` : '<div class="empty">No disclosed moves by notable investors in the last 2 years.</div>'}
      <div class="sm muted" style="margin-top:8px">An investor buying is a reason to look closer, not a reason to buy. Filings arrive days to weeks after the trade.</div></div>`;
  };
})();
