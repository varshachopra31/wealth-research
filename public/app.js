"use strict";
(() => {
  // =====================================================================
  // utilities
  // =====================================================================
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const isNum = (x) => typeof x === "number" && isFinite(x);
  const pct = (x, d = 1) => (isNum(x) ? (x * 100).toFixed(d) + "%" : "—");
  const sp = (x, d = 1) => (isNum(x) ? `<span class="${x >= 0 ? "up" : "down"}">${x >= 0 ? "+" : ""}${(x * 100).toFixed(d)}%</span>` : '<span class="muted">—</span>');
  const num = (x, d = 1) => (isNum(x) ? x.toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: d }) : "—");
  const inr = (x) => (isNum(x) ? "₹" + Math.round(x).toLocaleString("en-IN") : "—");
  const inrC = (x) => { if (!isNum(x)) return "—"; const a = Math.abs(x); return a >= 1e7 ? "₹" + num(x / 1e7, a >= 1e9 ? 0 : 2) + " cr" : a >= 1e5 ? "₹" + num(x / 1e5, 2) + " L" : inr(x); };
  const crs = (x) => (isNum(x) ? "₹" + Math.round(x / 1e7).toLocaleString("en-IN") + " cr" : "—");
  const crN = (x) => (isNum(x) ? Math.round(x / 1e7).toLocaleString("en-IN") : "—");
  const dt = (s) => { if (!s) return "—"; const d = new Date(s); return isNaN(d) ? esc(s) : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }); };
  const dtt = (s) => { if (!s) return "never"; const d = new Date(s); return isNaN(d) ? esc(s) : d.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); };
  const ago = (s) => { if (!s) return "never"; const m = (Date.now() - Date.parse(s)) / 60000; return m < 1 ? "just now" : m < 60 ? Math.round(m) + " min ago" : m < 1440 ? Math.round(m / 60) + " h ago" : Math.round(m / 1440) + " d ago"; };
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

  const LABEL = { buy: "Buy candidate", watch: "Watch", investigate: "Investigate", avoid: "Avoid", pass: "No signal" };
  const LCOL = { buy: "--buy", watch: "--watch", investigate: "--inv", avoid: "--avoid", pass: "--pass" };
  const pill = (l) => `<span class="pill l-${esc(l)}">${esc(LABEL[l] || l)}</span>`;
  const tagsHtml = (t, n = 9) => (t || []).slice(0, n).map((x) => `<span class="tag">${esc(x.text)}</span>`).join("");
  const scol = (v) => (v >= 65 ? "var(--buy)" : v >= 40 ? "var(--a2)" : "var(--avoid)");
  const sbar = (v) => (isNum(v) ? `<div class="sbar"><span>${v.toFixed(0)}</span><i><b style="width:${Math.max(3, v)}%;background:${scol(v)}"></b></i></div>` : '<span class="muted">—</span>');

  async function api(path, opts = {}) {
    const res = await fetch(path, { method: opts.method || "GET", headers: opts.body ? { "Content-Type": "application/json" } : {}, body: opts.body ? JSON.stringify(opts.body) : undefined });
    const j = await res.json().catch(() => ({ error: "Bad response from the app" }));
    if (!res.ok || j.error) throw new Error(j.error || "Request failed");
    return j;
  }
  function toast(msg, err) {
    const t = document.createElement("div");
    t.className = "toast" + (err ? " err" : ""); t.textContent = msg;
    $("#toasts").appendChild(t); setTimeout(() => t.remove(), err ? 7000 : 3500);
  }
  const view = () => $("#view");
  const setTitle = (t) => (document.title = t + " · Compound");
  const go = (h) => (location.hash = h);

  // markdown (escape first, then a safe subset)
  function md(src) {
    const lines = esc(src).split(/\r?\n/);
    let out = "", list = false;
    const inline = (s) => s.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\*(.+?)\*/g, "<i>$1</i>").replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/\[(S\d+|W\d+)\]/g, '<span class="chip">$1</span>');
    for (const l of lines) {
      const h = l.match(/^#{1,4}\s+(.*)/), li = l.match(/^\s*[-*•]\s+(.*)/) || l.match(/^\s*\d+[.)]\s+(.*)/);
      if (li) { if (!list) { out += "<ul>"; list = true; } out += "<li>" + inline(li[1]) + "</li>"; continue; }
      if (list) { out += "</ul>"; list = false; }
      if (h) out += "<h3>" + inline(h[1]) + "</h3>"; else if (l.trim()) out += "<p>" + inline(l) + "</p>";
    }
    return `<div class="md">${out}${list ? "</ul>" : ""}</div>`;
  }

  // glossary: beginner explanations shown on hover
  const GLOSS = {
    "buy-below price": "The highest price at which, if the business performs as expected (base case), you would still earn your target return above inflation. Buying below it gives a margin of safety.",
    "Suggested amount": "A rule of thumb: never put more than a set slice of your stock budget into one company (3% careful, 5% balanced, 8% adventurous), trimmed for smaller or riskier companies.",
    "Promoters": "The founders or controlling family/group of the company. A high promoter stake means they have their own money at risk.",
    "P/E": "Price-to-earnings: how many rupees you pay for each rupee of yearly profit. Lower is cheaper.",
    "ROE": "Return on equity: yearly profit as a % of the shareholders' money in the business.",
    "ROCE": "Return on capital employed: yearly operating profit as a % of all money invested in the business. Above 15-20% is strong.",
    "real return": "Return after removing inflation: what actually grows your buying power.",
    "CAGR": "Compound annual growth rate: the steady yearly growth that gets from the start value to the end value.",
    "base case": "The middle scenario: what happens if the company performs roughly as its recent history suggests, toned down.",
    "FIIs": "Foreign institutional investors: overseas funds investing in Indian shares.",
  };
  const g = (term, label) => `<span class="gl" data-tip="${esc(GLOSS[term] || "")}">${esc(label || term)}</span>`;
  document.addEventListener("mouseover", (e) => { const t = e.target.closest && e.target.closest("[data-tip]"); if (t && t.dataset.tip) { const r = t.getBoundingClientRect(); showTip(`<div style="max-width:260px">${esc(t.dataset.tip)}</div>`, r.left, r.bottom - 4); } });
  document.addEventListener("mouseout", (e) => { if (e.target.closest && e.target.closest("[data-tip]")) hideTip(); });

  // mount queue: charts render as HTML strings, then wire their interactivity
  let MOUNTS = [];
  const mount = (fn) => MOUNTS.push(fn);
  function flush() { const m = MOUNTS; MOUNTS = []; m.forEach((f) => { try { f(); } catch (e) { console.error(e); } }); countUps(); }
  let uid = 0; const nid = (p) => p + ++uid;

  // tooltip
  const tip = $("#tip");
  function showTip(html, x, y) {
    tip.innerHTML = html; tip.hidden = false;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = Math.min(innerWidth - w - 10, x + 14) + "px";
    tip.style.top = (y + h + 20 > innerHeight ? y - h - 12 : y + 14) + "px";
  }
  const hideTip = () => (tip.hidden = true);

  // animated numbers
  function countUps() {
    $$("[data-count]").forEach((el) => {
      const to = parseFloat(el.dataset.count), fmt = el.dataset.fmt; delete el.dataset.count;
      if (!isFinite(to)) return;
      const f = (v) => (fmt === "inr" ? inr(v) : fmt === "pct" ? (v >= 0 ? "+" : "") + (v * 100).toFixed(1) + "%" : Math.round(v).toLocaleString("en-IN"));
      const t0 = performance.now(), dur = 900;
      const step = (t) => { const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3); el.textContent = f(to * e); if (k < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    });
  }

  // =====================================================================
  // charts (hand-rolled SVG, interactive)
  // =====================================================================
  function ring(v, size = 56, label = "") {
    const r = size / 2 - 5, c = 2 * Math.PI * r, val = isNum(v) ? v : 0;
    return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" stroke="var(--line-2)" stroke-width="5"/>
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" stroke="${scol(val)}" stroke-width="5" stroke-dasharray="${(c * val) / 100} ${c}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
      <text x="50%" y="${label ? "47%" : "53%"}" text-anchor="middle" dominant-baseline="middle" fill="var(--ink)" stroke="none" font-size="${size / 3.6}" font-weight="700">${isNum(v) ? v.toFixed(0) : "—"}</text>
      ${label ? `<text x="50%" y="70%" text-anchor="middle" fill="var(--ink-3)" stroke="none" font-size="${size / 7.5}">${label}</text>` : ""}</svg>`;
  }

  function spark(values, color = "var(--a1)", w = 160, h = 50) {
    const v = (values || []).filter(isNum); if (v.length < 2) return "";
    const lo = Math.min(...v), hi = Math.max(...v), rg = hi - lo || 1;
    const pts = v.map((y, i) => [(i / (v.length - 1)) * w, h - 4 - ((y - lo) / rg) * (h - 8)]);
    const d = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
    const g = nid("sg");
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><defs><linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".35"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs><path d="${d} L${w} ${h} L0 ${h} Z" fill="url(#${g})" stroke="none"/><path d="${d}" stroke="${color}" stroke-width="2"/></svg>`;
  }

  // interactive area chart with crosshair; series = [[label, value], …]
  function areaChart(series, { h = 260, color = "var(--a1)", fmtV = (v) => num(v, 0), fmtX = (x) => String(x).slice(0, 10), ref = null } = {}) {
    if (!series || series.length < 2) return '<div class="empty">No chart data</div>';
    const id = nid("ac"), W = 900, H = h, pl = 58, pr = 14, pt = 14, pb = 28;
    const ys = series.map((p) => p[1]); let lo = Math.min(...ys), hi = Math.max(...ys);
    if (ref != null) { lo = Math.min(lo, ref); hi = Math.max(hi, ref); }
    const pad = (hi - lo) * 0.08 || 1; lo -= pad; hi += pad;
    const X = (i) => pl + (i / (series.length - 1)) * (W - pl - pr), Y = (v) => pt + (1 - (v - lo) / (hi - lo)) * (H - pt - pb);
    const d = series.map((p, i) => (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(p[1]).toFixed(1)).join(" ");
    const up = series[series.length - 1][1] >= series[0][1];
    const col = color === "auto" ? (up ? "var(--up)" : "var(--down)") : color;
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((k) => lo + (hi - lo) * k).map((v) => `<line class="gl" x1="${pl}" x2="${W - pr}" y1="${Y(v)}" y2="${Y(v)}"/><text class="ax" x="${pl - 8}" y="${Y(v) + 3.5}" text-anchor="end">${fmtV(v)}</text>`).join("");
    const xl = [0, 0.25, 0.5, 0.75, 1].map((k) => Math.round(k * (series.length - 1))).map((i, j) => `<text class="ax" x="${X(i)}" y="${H - 8}" text-anchor="${j === 0 ? "start" : j === 4 ? "end" : "middle"}">${esc(fmtX(series[i][0]))}</text>`).join("");
    const g = id + "g";
    mount(() => {
      const svg = document.getElementById(id); if (!svg) return;
      const cross = svg.querySelector(".cross"), dot = svg.querySelector(".dot");
      svg.addEventListener("mousemove", (e) => {
        const r = svg.getBoundingClientRect(), x = ((e.clientX - r.left) / r.width) * W;
        const i = Math.max(0, Math.min(series.length - 1, Math.round(((x - pl) / (W - pl - pr)) * (series.length - 1))));
        cross.setAttribute("x1", X(i)); cross.setAttribute("x2", X(i)); cross.style.display = "";
        dot.setAttribute("cx", X(i)); dot.setAttribute("cy", Y(series[i][1])); dot.style.display = "";
        const chg = series[i][1] / series[0][1] - 1;
        showTip(`<b>${fmtV(series[i][1])}</b><div class="t2">${esc(fmtX(series[i][0]))}</div><div class="t2">${sp(chg)} since ${esc(fmtX(series[0][0]))}</div>`, e.clientX, e.clientY);
      });
      svg.addEventListener("mouseleave", () => { cross.style.display = "none"; dot.style.display = "none"; hideTip(); });
    });
    return `<div class="chart"><svg id="${id}" viewBox="0 0 ${W} ${H}"><defs><linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity=".28"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient></defs>
      ${ticks}${ref != null ? `<line x1="${pl}" x2="${W - pr}" y1="${Y(ref)}" y2="${Y(ref)}" stroke="var(--ink-3)" stroke-dasharray="5 4"/>` : ""}
      <path d="${d} L${X(series.length - 1)} ${H - pb} L${pl} ${H - pb} Z" fill="url(#${g})" stroke="none"/><path d="${d}" stroke="${col}" stroke-width="2.2"/>
      ${xl}<line class="cross" y1="${pt}" y2="${H - pb}" style="display:none"/><circle class="dot" r="5" stroke="${col}" style="display:none"/>
      <rect x="${pl}" y="0" width="${W - pl - pr}" height="${H}" fill="transparent" stroke="none"/></svg></div>`;
  }

  // Opportunity map: Value score (x) vs Quality score (y), bubble = market cap, colour = screen label
  function oppMap(items, hidden = new Set(), h = 460) {
    const id = nid("om"), W = 900, H = h, pl = 40, pr = 16, pt = 16, pb = 34;
    const X = (v) => pl + (v / 100) * (W - pl - pr), Y = (v) => pt + (1 - v / 100) * (H - pt - pb);
    const pts = items.filter((x) => isNum(x.q) && isNum(x.v) && !hidden.has(x.label));
    const maxCap = Math.max(...pts.map((x) => x.mcapCr || 0), 1);
    const R = (c) => 3 + Math.sqrt((c || 0) / maxCap) * 16;
    const quad = (x, y, t, anchor) => `<text class="ax" x="${x}" y="${y}" text-anchor="${anchor}" style="font-size:12px;font-weight:600;fill:var(--ink-3);opacity:.8">${t}</text>`;
    mount(() => {
      const svg = document.getElementById(id); if (!svg) return;
      svg.addEventListener("mousemove", (e) => {
        const c = e.target.closest("circle[data-s]");
        if (!c) return hideTip();
        const it = pts[+c.dataset.i];
        showTip(`<b>${esc(it.symbol)}</b> ${pill(it.label)}<div class="t2">${esc((it.name || "").slice(0, 40))}</div><div class="t2" style="margin-top:4px">Quality ${it.q.toFixed(0)} · Value ${it.v.toFixed(0)} · Growth ${isNum(it.g) ? it.g.toFixed(0) : "—"}</div><div class="t2">P/E ${num(it.pe, 1)} · base real ${pct(it.baseReal)}/yr</div>`, e.clientX, e.clientY);
      });
      svg.addEventListener("mouseleave", hideTip);
      svg.addEventListener("click", (e) => { const c = e.target.closest("circle[data-s]"); if (c) { hideTip(); go("#/stock/" + encodeURIComponent(c.dataset.s)); } });
    });
    const sorted = pts.map((x, i) => ({ x, i })).sort((a, b) => (b.x.mcapCr || 0) - (a.x.mcapCr || 0));
    return `<div class="chart scatter"><svg id="${id}" viewBox="0 0 ${W} ${H}">
      <rect x="${X(50)}" y="${pt}" width="${X(100) - X(50)}" height="${Y(50) - pt}" fill="var(--buy)" opacity=".05" stroke="none"/>
      ${[0, 25, 50, 75, 100].map((v) => `<line class="gl" x1="${X(v)}" x2="${X(v)}" y1="${pt}" y2="${H - pb}"/><line class="gl" x1="${pl}" x2="${W - pr}" y1="${Y(v)}" y2="${Y(v)}"/><text class="ax" x="${X(v)}" y="${H - 14}" text-anchor="middle">${v}</text><text class="ax" x="${pl - 8}" y="${Y(v) + 4}" text-anchor="end">${v}</text>`).join("")}
      <line x1="${X(50)}" x2="${X(50)}" y1="${pt}" y2="${H - pb}" stroke="var(--line-2)" stroke-dasharray="4 4"/><line x1="${pl}" x2="${W - pr}" y1="${Y(50)}" y2="${Y(50)}" stroke="var(--line-2)" stroke-dasharray="4 4"/>
      ${quad(W - pr - 8, pt + 18, "Quality at a fair price ↗", "end")}${quad(pl + 10, pt + 18, "Great business, pricey", "start")}${quad(W - pr - 8, H - pb - 10, "Cheap — value trap?", "end")}${quad(pl + 10, H - pb - 10, "Weak & expensive", "start")}
      ${sorted.map(({ x, i }) => `<circle data-s="${esc(x.symbol)}" data-i="${i}" cx="${X(x.v).toFixed(1)}" cy="${Y(x.q).toFixed(1)}" r="${R(x.mcapCr).toFixed(1)}" fill="var(${LCOL[x.label] || "--pass"})" fill-opacity=".55" stroke="var(${LCOL[x.label] || "--pass"})" stroke-width="1"/>`).join("")}
      <text class="ax" x="${(pl + W - pr) / 2}" y="${H}" text-anchor="middle" style="font-size:11.5px">VALUE SCORE → cheaper vs industry</text>
      <text class="ax" x="12" y="${(pt + H - pb) / 2}" text-anchor="middle" transform="rotate(-90 12 ${(pt + H - pb) / 2})" style="font-size:11.5px">QUALITY SCORE →</text></svg></div>`;
  }

  function donut(segs, { size = 210, center = "" } = {}) {
    const id = nid("dn"), tot = segs.reduce((s, x) => s + x.value, 0);
    if (!tot) return '<div class="empty">Nothing to show yet</div>';
    const r = size / 2 - 4, ri = r * 0.64, cx = size / 2, cy = size / 2;
    let a0 = -Math.PI / 2;
    const arcs = segs.map((s, i) => {
      const a1 = a0 + (s.value / tot) * Math.PI * 2 - 0.0001, big = a1 - a0 > Math.PI ? 1 : 0;
      const p = (a, rr) => [cx + rr * Math.cos(a), cy + rr * Math.sin(a)];
      const [x0, y0] = p(a0, r), [x1, y1] = p(a1, r), [x2, y2] = p(a1, ri), [x3, y3] = p(a0, ri);
      const d = `M${x0} ${y0} A${r} ${r} 0 ${big} 1 ${x1} ${y1} L${x2} ${y2} A${ri} ${ri} 0 ${big} 0 ${x3} ${y3} Z`;
      a0 = a1 + 0.0001;
      return `<path data-i="${i}" d="${d}" fill="${s.color}" stroke="var(--card-solid)" stroke-width="2"/>`;
    }).join("");
    mount(() => {
      const svg = document.getElementById(id); if (!svg) return;
      const t1 = svg.querySelector(".c1"), t2 = svg.querySelector(".c2"), def1 = t1.textContent, def2 = t2.textContent;
      svg.addEventListener("mousemove", (e) => { const p = e.target.closest("path[data-i]"); if (!p) return; const s = segs[+p.dataset.i]; t1.textContent = (s.value / tot * 100).toFixed(1) + "%"; t2.textContent = s.label.slice(0, 22); });
      svg.addEventListener("mouseleave", () => { t1.textContent = def1; t2.textContent = def2; });
    });
    const legend = `<div class="legend" style="margin-top:12px;justify-content:center">${segs.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.label)} <b class="num">${(s.value / tot * 100).toFixed(0)}%</b></span>`).join("")}</div>`;
    return `<div class="chart donut" style="max-width:${size}px;margin:0 auto"><svg id="${id}" viewBox="0 0 ${size} ${size}">${arcs}
      <text class="c1" x="50%" y="47%" text-anchor="middle" fill="var(--ink)" stroke="none" font-size="22" font-weight="700">${esc(center)}</text>
      <text class="c2" x="50%" y="60%" text-anchor="middle" fill="var(--ink-3)" stroke="none" font-size="11">hover a slice</text></svg></div>${legend}`;
  }
  const PALETTE = ["#34d399", "#22d3ee", "#a78bfa", "#fbbf24", "#fb7185", "#60a5fa", "#f472b6", "#4ade80", "#facc15", "#94a3b8", "#2dd4bf", "#c084fc"];

  function gauge(v, { min = -0.05, max = 0.15, label = "" } = {}) {
    const W = 220, H = 130, cx = 110, cy = 112, r = 88;
    const k = isNum(v) ? Math.max(0, Math.min(1, (v - min) / (max - min))) : 0;
    const a = Math.PI * (1 - k), px = cx + r * Math.cos(a), py = cy - r * Math.sin(a);
    const zero = (0 - min) / (max - min), za = Math.PI * (1 - zero);
    return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:260px"><defs><linearGradient id="gg" x1="0" x2="1"><stop offset="0" stop-color="var(--avoid)"/><stop offset=".35" stop-color="var(--inv)"/><stop offset="1" stop-color="var(--buy)"/></linearGradient></defs>
      <path d="M${cx - r} ${cy} A${r} ${r} 0 0 1 ${cx + r} ${cy}" stroke="var(--line-2)" stroke-width="14"/>
      <path d="M${cx - r} ${cy} A${r} ${r} 0 0 1 ${cx + r} ${cy}" stroke="url(#gg)" stroke-width="14" stroke-dasharray="${Math.PI * r * k} 999"/>
      <line x1="${cx + (r - 14) * Math.cos(za)}" y1="${cy - (r - 14) * Math.sin(za)}" x2="${cx + (r + 9) * Math.cos(za)}" y2="${cy - (r + 9) * Math.sin(za)}" stroke="var(--ink-3)" stroke-width="2"/>
      ${isNum(v) ? `<circle cx="${px}" cy="${py}" r="9" fill="var(--card-solid)" stroke="var(--ink)" stroke-width="3"/>` : ""}
      <text x="${cx}" y="${cy - 22}" text-anchor="middle" fill="var(--ink)" stroke="none" font-size="28" font-weight="750">${isNum(v) ? (v >= 0 ? "+" : "") + (v * 100).toFixed(1) + "%" : "—"}</text>
      <text x="${cx}" y="${cy - 2}" text-anchor="middle" fill="var(--ink-3)" stroke="none" font-size="11">${esc(label)}</text></svg>`;
  }

  function radar(series, { size = 260, axes = ["Quality", "Growth", "Value", "Safety"] } = {}) {
    const c = size / 2, r = size / 2 - 34, n = axes.length;
    const P = (i, v) => { const a = -Math.PI / 2 + (i / n) * Math.PI * 2; return [c + r * (v / 100) * Math.cos(a), c + r * (v / 100) * Math.sin(a)]; };
    const rings = [25, 50, 75, 100].map((v) => `<polygon points="${axes.map((_, i) => P(i, v).join(",")).join(" ")}" stroke="var(--line)" fill="none"/>`).join("");
    const spokes = axes.map((a, i) => { const [x, y] = P(i, 100), [lx, ly] = P(i, 122); return `<line x1="${c}" y1="${c}" x2="${x}" y2="${y}" stroke="var(--line)"/><text class="ax" x="${lx}" y="${ly + 4}" text-anchor="middle" style="font-size:11.5px;font-weight:600">${a}</text>`; }).join("");
    const polys = series.map((s) => `<polygon points="${s.values.map((v, i) => P(i, isNum(v) ? v : 0).join(",")).join(" ")}" fill="${s.color}" fill-opacity=".18" stroke="${s.color}" stroke-width="2.2"/>${s.values.map((v, i) => `<circle cx="${P(i, isNum(v) ? v : 0)[0]}" cy="${P(i, isNum(v) ? v : 0)[1]}" r="3.5" fill="${s.color}" stroke="none"/>`).join("")}`).join("");
    return `<div class="chart" style="max-width:${size + 40}px;margin:0 auto"><svg viewBox="-20 -6 ${size + 40} ${size + 12}">${rings}${spokes}${polys}</svg></div>`;
  }

  // grouped bars: labels = x categories, series = [{name, color, values}]
  function bars(labels, series, { h = 240, fmtV = (v) => num(v, 0) } = {}) {
    const id = nid("br"), W = 900, H = h, pl = 58, pr = 10, pt = 12, pb = 28;
    const all = series.flatMap((s) => s.values).filter(isNum);
    if (!all.length) return '<div class="empty">No data</div>';
    let lo = Math.min(0, ...all), hi = Math.max(0, ...all); const pad = (hi - lo) * 0.08 || 1; hi += pad; if (lo < 0) lo -= pad;
    const Y = (v) => pt + (1 - (v - lo) / (hi - lo)) * (H - pt - pb);
    const gw = (W - pl - pr) / labels.length, bw = Math.min(46, (gw * 0.7) / series.length);
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((k) => lo + (hi - lo) * k).map((v) => `<line class="gl" x1="${pl}" x2="${W - pr}" y1="${Y(v)}" y2="${Y(v)}"/><text class="ax" x="${pl - 8}" y="${Y(v) + 3.5}" text-anchor="end">${fmtV(v)}</text>`).join("");
    let rects = "";
    labels.forEach((lab, gi) => {
      const x0 = pl + gi * gw + (gw - bw * series.length) / 2;
      series.forEach((s, si) => { const v = s.values[gi]; if (!isNum(v)) return; const y = Y(Math.max(v, 0)), hgt = Math.abs(Y(v) - Y(0)); rects += `<rect data-g="${gi}" data-s="${si}" x="${x0 + si * bw + 2}" y="${y}" width="${bw - 4}" height="${Math.max(1, hgt)}" rx="5" fill="${s.color}"/>`; });
      rects += `<text class="ax" x="${pl + gi * gw + gw / 2}" y="${H - 8}" text-anchor="middle">${esc(lab)}</text>`;
    });
    mount(() => {
      const svg = document.getElementById(id); if (!svg) return;
      svg.addEventListener("mousemove", (e) => { const r = e.target.closest("rect[data-g]"); if (!r) return hideTip(); const gi = +r.dataset.g; showTip(`<b>${esc(labels[gi])}</b>${series.map((s) => `<div class="t2"><span style="color:${s.color}">●</span> ${esc(s.name)}: <b style="font-size:12.5px">${fmtV(s.values[gi])}</b></div>`).join("")}`, e.clientX, e.clientY); });
      svg.addEventListener("mouseleave", hideTip);
    });
    return `<div class="chart bars"><svg id="${id}" viewBox="0 0 ${W} ${H}">${ticks}<line x1="${pl}" x2="${W - pr}" y1="${Y(0)}" y2="${Y(0)}" stroke="var(--line-2)"/>${rects}</svg></div>
      <div class="legend" style="margin-top:8px">${series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join("")}</div>`;
  }

  // 5-year fan chart for the scenarios
  function fan(price, s) {
    const W = 900, H = 250, pl = 66, pr = 70, pt = 16, pb = 28;
    const path = (k) => [0, 1, 2, 3, 4, 5].map((y) => price * Math.pow(s[k].p5 / price, y / 5)); // price path excludes dividends, ends at the implied price
    const P = { bear: path("bear"), base: path("base"), bull: path("bull") };
    const all = [...P.bear, ...P.bull, price]; const lo = Math.min(...all) * 0.92, hi = Math.max(...all) * 1.05;
    const X = (i) => pl + (i / 5) * (W - pl - pr), Y = (v) => pt + (1 - (v - lo) / (hi - lo)) * (H - pt - pb);
    const line = (a) => a.map((v, i) => (i ? "L" : "M") + X(i) + " " + Y(v)).join(" ");
    const band = line(P.bull) + " " + [...P.bear].reverse().map((v, i) => "L" + X(5 - i) + " " + Y(v)).join(" ") + " Z";
    const C = { bear: "var(--avoid)", base: "var(--a2)", bull: "var(--buy)" };
    const ticks = [0, 0.33, 0.66, 1].map((k) => lo + (hi - lo) * k).map((v) => `<line class="gl" x1="${pl}" x2="${W - pr}" y1="${Y(v)}" y2="${Y(v)}"/><text class="ax" x="${pl - 8}" y="${Y(v) + 3.5}" text-anchor="end">₹${num(v, 0)}</text>`).join("");
    return `<div class="chart"><svg viewBox="0 0 ${W} ${H}">${ticks}<path d="${band}" fill="var(--a2)" opacity=".08" stroke="none"/>
      <line x1="${pl}" x2="${W - pr}" y1="${Y(price)}" y2="${Y(price)}" stroke="var(--ink-3)" stroke-dasharray="4 4"/>
      ${["bear", "base", "bull"].map((k) => `<path d="${line(P[k])}" stroke="${C[k]}" stroke-width="${k === "base" ? 3 : 2}" ${k === "base" ? "" : 'stroke-dasharray="6 5"'}/><circle cx="${X(5)}" cy="${Y(P[k][5])}" r="5" fill="${C[k]}" stroke="none"/><text class="ax" x="${X(5) + 10}" y="${Y(P[k][5]) + 4}" style="font-size:12px;font-weight:700;fill:${C[k]}">₹${num(P[k][5], 0)}</text>`).join("")}
      ${[0, 1, 2, 3, 4, 5].map((i) => `<text class="ax" x="${X(i)}" y="${H - 8}" text-anchor="middle">${i === 0 ? "Today" : "Yr " + i}</text>`).join("")}</svg></div>`;
  }

  // =====================================================================
  // shell: nav, status, theme, palette
  // =====================================================================
  const NAV = [["home", "Home"], ["discover", "Discover"], ["smart", "Smart money"], ["compare", "Compare"], ["funds", "Funds"], ["portfolio", "Portfolio"], ["vc", "Startups & VC"], ["news", "News"], ["report", "Report"]];
  let STATUS = null;
  function renderNav(active) {
    const alias = { stock: "discover", fund: "funds", investor: "smart" };
    const a = alias[active] || active;
    $("#nav").innerHTML = NAV.map(([k, l]) => `<a href="#/${k}" class="${k === a ? "on" : ""}">${l}</a>`).join("");
    const on = $("#nav .on"); if (on) on.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
  async function refreshStatus() {
    try { STATUS = await api("/api/status"); } catch { return; }
    const j = STATUS.jobs, bar = $("#jobbar");
    if (j.running) { bar.hidden = false; const p = j.progress; bar.firstElementChild.style.width = p && p.total ? Math.max(4, (p.done / p.total) * 100) + "%" : "35%"; bar.title = "Updating " + j.running; }
    else bar.hidden = true;
    const n = STATUS.counts.alertsUnread, bc = $("#bellCount"); bc.hidden = !n; bc.textContent = n > 99 ? "99+" : n;
    $("#foot").innerHTML = `Inflation assumption ${pct(STATUS.inflation.value)} · ${STATUS.counts.analysed} stocks · ${STATUS.counts.mf.toLocaleString("en-IN")} funds · AI ${STATUS.ai.provider === "off" ? "off" : esc(STATUS.ai.provider)} ${j.running ? `· <span class="spin"></span> updating ${esc(j.running)}${j.progress && j.progress.total ? ` ${j.progress.done}/${j.progress.total}` : ""}` : ""} · <a href="#/method">Method & limits</a> · Research tool, not investment advice.`;
  }
  function setTheme(t) {
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem("theme", t); } catch { /* private mode */ }
    $("#themeIco").innerHTML = t === "dark" ? '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>' : '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>';
  }
  $("#themeBtn").onclick = () => { setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"); router(); };
  setTheme(document.documentElement.dataset.theme || "dark");

  // command palette
  let SYMS = null, palSel = 0, palItems = [];
  async function loadSyms() { if (!SYMS) { const d = await api("/api/stocks"); SYMS = d.items; setTimeout(() => (SYMS = null), 120000); } return SYMS; }
  const PAGES = [["Home", "#/home"], ["Discover — buy candidates", "#/discover?tab=buy"], ["Discover — emerging growth", "#/discover?tab=emerging"], ["Opportunity map", "#/discover?view=map&tab=all"], ["Compare stocks", "#/compare"], ["Mutual funds", "#/funds"], ["My portfolio", "#/portfolio"], ["Startups & VC", "#/vc"], ["News", "#/news"], ["Alerts", "#/alerts"], ["Report", "#/report"], ["Settings & data", "#/settings"], ["Method & limits", "#/method"]];
  function openPalette() { $("#palette").hidden = false; const i = $("#palInput"); i.value = ""; i.focus(); palRender(""); }
  function closePalette() { $("#palette").hidden = true; }
  let palT;
  async function palRender(q) {
    q = q.trim().toLowerCase();
    if (!SYMS) $("#palList").innerHTML = '<div class="empty"><span class="spin"></span> Loading…</div>';
    const syms = await loadSyms();
    const st = (q ? syms.filter((x) => x.symbol.toLowerCase().startsWith(q) || (x.name || "").toLowerCase().includes(q)) : syms.filter((x) => x.label === "buy")).slice(0, 8);
    const pg = PAGES.filter(([l]) => !q || l.toLowerCase().includes(q)).slice(0, q ? 4 : 6);
    palItems = [...st.map((x) => ({ kind: "stock", go: "#/stock/" + encodeURIComponent(x.symbol), html: `<span class="ico">${esc(x.symbol.slice(0, 3))}</span><div><b>${esc(x.symbol)}</b> <span class="muted sm">${esc(x.name)}</span></div><span class="meta">${pill(x.label)}</span>` })),
      ...pg.map(([l, h]) => ({ kind: "page", go: h, html: `<span class="ico">↗</span><div>${esc(l)}</div>` }))];
    if (q.length >= 2 && !st.length && /^[a-z0-9&-]+$/i.test(q)) palItems.unshift({ kind: "add", sym: q.toUpperCase(), html: `<span class="ico">+</span><div>Analyse <b>${esc(q.toUpperCase())}</b> (any NSE symbol)</div>` });
    let html = "", last = "";
    palItems.forEach((it, i) => { const g = it.kind === "page" ? "Pages" : "Stocks"; if (g !== last) { html += `<div class="grp">${q ? g : g === "Stocks" ? "Top buy candidates" : g}</div>`; last = g; } html += `<div class="it${i === 0 ? " sel" : ""}" data-i="${i}">${it.html}</div>`; });
    if (q.length >= 3) {
      clearTimeout(palT);
      palT = setTimeout(async () => {
        const f = await api("/api/mf/search?q=" + encodeURIComponent(q)).catch(() => ({ items: [] }));
        if ($("#palInput").value.trim().toLowerCase() !== q || !f.items.length) return;
        const base = palItems.length;
        f.items.slice(0, 5).forEach((x) => palItems.push({ kind: "fund", go: "#/fund/" + x.code, html: `<span class="ico">MF</span><div>${esc(x.name)} <div class="muted sm">${esc(x.category)}</div></div>` }));
        $("#palList").insertAdjacentHTML("beforeend", `<div class="grp">Mutual funds</div>` + palItems.slice(base).map((it, k) => `<div class="it" data-i="${base + k}">${it.html}</div>`).join(""));
      }, 220);
    }
    palSel = 0;
    $("#palList").innerHTML = html || '<div class="empty">No matches</div>';
  }
  async function palPick(i) {
    const it = palItems[i]; if (!it) return; closePalette();
    if (it.kind === "add") { toast("Fetching " + it.sym + "…"); try { const r = await api("/api/stock/add", { method: "POST", body: { symbol: it.sym } }); SYMS = null; go("#/stock/" + r.symbol); } catch (e) { toast(e.message, true); } }
    else go(it.go);
  }
  $("#openPalette").onclick = openPalette;
  $("#palette").addEventListener("mousedown", (e) => { if (e.target.id === "palette") closePalette(); });
  $("#palList").addEventListener("click", (e) => { const it = e.target.closest(".it"); if (it) palPick(+it.dataset.i); });
  $("#palInput").addEventListener("input", (e) => palRender(e.target.value));
  $("#palInput").addEventListener("keydown", (e) => {
    const els = $$("#palList .it");
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); palSel = (palSel + (e.key === "ArrowDown" ? 1 : -1) + els.length) % els.length; els.forEach((x, i) => x.classList.toggle("sel", i === palSel)); els[palSel] && els[palSel].scrollIntoView({ block: "nearest" }); }
    else if (e.key === "Enter") { e.preventDefault(); const el = els[palSel]; if (el) palPick(+el.dataset.i); }
    else if (e.key === "Escape") closePalette();
  });
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); $("#palette").hidden ? openPalette() : closePalette(); }
    else if (e.key === "/" && !/input|textarea|select/i.test(document.activeElement.tagName)) { e.preventDefault(); openPalette(); }
  });

  // =====================================================================
  // router
  // =====================================================================
  function route() {
    const h = location.hash.replace(/^#\/?/, "") || "home";
    const [p, qs] = h.split("?"); const parts = p.split("/");
    return { name: parts[0] === "dashboard" ? "home" : parts[0], arg: parts[1] ? decodeURIComponent(parts[1]) : null, q: new URLSearchParams(qs || "") };
  }
  let NAV_TOKEN = 0;
  class Stale extends Error {}
  async function router() {
    const r = route(); r.token = ++NAV_TOKEN; renderNav(r.name); hideTip();
    const fn = V[r.name] || V.home;
    view().innerHTML = '<div class="grid g3"><div class="skel"></div><div class="skel"></div><div class="skel"></div></div><div class="skel" style="height:320px;margin-top:18px"></div>';
    try { await fn(r); if (r.token !== NAV_TOKEN) return; view().classList.remove("fade-in"); void view().offsetWidth; view().classList.add("fade-in"); flush(); }
    catch (e) { if (e instanceof Stale || r.token !== NAV_TOKEN) return; view().innerHTML = `<div class="card"><div class="empty"><span class="em">⚠</span>${esc(e.message)}</div></div>`; }
    if (!r.q.get("keep")) window.scrollTo({ top: 0 });
  }
  const live = (r) => { if (r.token != null && r.token !== NAV_TOKEN) throw new Stale(); };
  const head = (title, sub, right = "", eyebrow = "") => `<div class="head"><div>${eyebrow ? `<div class="eyebrow">${eyebrow}</div>` : ""}<h1>${title}</h1>${sub ? `<div class="sub">${sub}</div>` : ""}</div>${right ? `<div class="right">${right}</div>` : ""}</div>`;
  const V = {};
  const disc = '<div class="disc">Screens and scenarios are calculations from free public data — research, not personalised investment advice, and not a promise of returns. Verify figures in the annual report before acting.</div>';

  // =====================================================================
  // HOME
  // =====================================================================
  V.home = async (r) => {
    setTitle("Home");
    const [st, rep, stocks, wl] = await Promise.all([api("/api/status"), api("/api/report"), api("/api/stocks"), api("/api/watchlist")]); live(r);
    STATUS = st;
    const hr = new Date().getHours(), greet = hr < 12 ? "Good morning" : hr < 17 ? "Good afternoon" : "Good evening";
    const p = st.jobs.progress, firstRun = st.counts.analysed < 20;
    const items = stocks.items.filter((x) => !x.insufficient);
    let hidden = new Set(["pass"]);
    view().innerHTML = `
      ${firstRun ? `<div class="card setup" style="margin-bottom:18px"><div class="card-h"><h2>Setting up your research data</h2></div><div class="soft">Downloading the Nifty 500, prices and four years of financials for each company, every mutual fund NAV, inflation and news — all from free sources. The first load takes 10–20 minutes; you can explore while it runs.</div>
        ${p && p.total ? `<div class="progress"><i style="width:${(p.done / p.total * 100).toFixed(1)}%"></i></div><div class="sm muted" style="margin-top:6px">${esc(p.job)}: ${p.done} of ${p.total} · ${esc(p.note)}</div>` : st.jobs.running ? `<div class="sm muted" style="margin-top:10px"><span class="spin"></span> ${esc(st.jobs.running)}…</div>` : `<button class="btn pri" id="startAll" style="margin-top:12px">Start the first data load</button>`}</div>` : ""}
      <div class="hero">
        <div class="card hero-main">
          <div class="eyebrow">${greet}</div>
          <h1>Your money vs <span class="gradtext">${pct(rep.inflation.value)} inflation</span></h1>
          ${rep.portfolio.total ? `<div class="big" data-count="${rep.portfolio.total}" data-fmt="inr">${inr(rep.portfolio.total)}</div>
            <div class="hero-stats"><div>Est. real return<b>${sp(rep.portfolio.expReal)}</b></div><div>Buy candidates<b>${rep.counts.buy || 0}</b></div><div>On watch<b>${rep.counts.watch || 0}</b></div><div>Unread alerts<b>${st.counts.alertsUnread}</b></div></div>`
            : `<div class="soft" style="margin-top:14px;max-width:520px">Add what you own to see your inflation-adjusted return, concentration risks and how each new idea fits.</div><div class="row" style="margin-top:16px"><a class="btn pri" href="#/portfolio">+ Add holdings</a><a class="btn" href="#/discover">Explore ideas</a></div>
            <div class="hero-stats"><div>Buy candidates<b>${rep.counts.buy || 0}</b></div><div>On watch<b>${rep.counts.watch || 0}</b></div><div>Analysed<b>${rep.universe}</b></div></div>`}
        </div>
        <div class="card" style="display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center">
          <div class="eyebrow">Portfolio real return / yr</div>
          ${gauge(rep.portfolio.expReal, { label: rep.portfolio.total ? "after inflation" : "no holdings yet" })}
          <div class="sm muted" style="max-width:300px">Needle above the tick = beating inflation. Stocks use their base-case scenario, funds their 5-yr history.</div>
        </div>
      </div>
      <div class="card" style="margin-top:18px"><div class="card-h"><h2>New here? Three steps</h2><a class="hint" href="#/method">How the ratings work →</a></div><div class="steps">
        <a class="step" href="#/discover?tab=buy" style="color:inherit;text-decoration:none"><b class="n">1</b><div><b>Pick an idea</b><div class="sm muted">Start with companies marked “Buy today” — they pass every check.</div></div></a>
        <a class="step" href="#/settings" style="color:inherit;text-decoration:none"><b class="n">2</b><div><b>Set your budget</b><div class="sm muted">So each company page can suggest how much to put in.</div></div></a>
        <a class="step" href="#/portfolio" style="color:inherit;text-decoration:none"><b class="n">3</b><div><b>Track what you buy</b><div class="sm muted">Add holdings to see your real return and get alerts.</div></div></a></div></div>
      ${rep.portfolio.warnings.length ? `<div class="note warn" style="margin-top:18px"><b>Portfolio checks</b><ul class="reasons">${rep.portfolio.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul></div>` : ""}
      <div class="card" style="margin-top:18px"><div class="card-h"><h2>Opportunity map</h2><span class="hint">every dot is a company · size = market cap · click to open</span></div>
        <div class="legend" id="mapLegend">${["buy", "watch", "investigate", "avoid", "pass"].map((l) => `<span data-l="${l}" class="${hidden.has(l) ? "off" : ""}"><i style="background:var(${LCOL[l]})"></i>${LABEL[l]} <b class="num">${rep.counts[l] || 0}</b></span>`).join("")}</div>
        <div id="mapHost" style="margin-top:8px">${oppMap(items, hidden)}</div></div>
      <div class="card-h" style="margin-top:28px"><h2 style="font-size:18px">Top buy candidates</h2><a class="hint" href="#/discover?tab=buy">See all ${rep.counts.buy || 0} →</a></div>
      <div class="scards">${rep.buy.slice(0, 8).map((x) => stockCard(x)).join("") || '<div class="empty">None yet.</div>'}</div>
      <div class="grid g2" style="margin-top:22px">
        <div class="card"><div class="card-h"><h2>Emerging growth</h2><a class="hint" href="#/discover?tab=emerging">See all →</a></div>${miniRows(rep.emerging.slice(0, 6))}</div>
        <div class="card"><div class="card-h"><h2>Your watchlist</h2><a class="hint" href="#/discover">Find stocks →</a></div>${wl.items.length ? miniRows(wl.items) : '<div class="empty"><span class="em">☆</span>Open any stock and press Watch to track it here.</div>'}</div>
        <div class="card"><div class="card-h"><h2>Where VC money is going</h2><a class="hint" href="#/vc">Details →</a></div>${rep.vc.length ? hbars(rep.vc.map((s) => [s.sector, s.usdMn, `$${num(s.usdMn, 0)}M · ${s.deals}`])) : '<div class="empty">No funding headlines yet.</div>'}</div>
        <div class="card"><div class="card-h"><h2>Latest alerts</h2><a class="hint" href="#/alerts">All →</a></div>${rep.alerts.length ? `<div class="timeline">${rep.alerts.slice(0, 6).map(alertItem).join("")}</div>` : '<div class="empty"><span class="em">🔔</span>No new alerts.</div>'}</div>
      </div>${disc}`;
    const sa = $("#startAll"); if (sa) sa.onclick = async () => { await api("/api/refresh/all", { method: "POST", body: {} }); toast("Data load started"); setTimeout(router, 1500); };
    $("#mapLegend").addEventListener("click", (e) => { const s = e.target.closest("[data-l]"); if (!s) return; const l = s.dataset.l; hidden.has(l) ? hidden.delete(l) : hidden.add(l); s.classList.toggle("off"); $("#mapHost").innerHTML = oppMap(items, hidden); flush(); });
    wireCards(view());
    if (firstRun && (st.jobs.running || st.jobs.queued.length)) setTimeout(() => { if (route().name === "home") router(); }, 8000);
  };

  function stockCard(x, { cmp = false } = {}) {
    const bars = [["Qual", x.q], ["Grow", x.g], ["Value", x.v], ["Safe", x.s]];
    return `<div class="scard" data-sym="${esc(x.symbol)}" style="--lc:var(${LCOL[x.label] || "--pass"})">
      <div class="top-row"><div style="min-width:0"><div class="sym">${esc(x.symbol)}</div><div class="nm">${esc(x.name || "")}</div><div style="margin-top:6px">${actPill(x.action) || pill(x.label)}</div></div>${ring(x.composite, 58)}</div>
      <div class="mbars">${bars.map(([l, v]) => `<div class="mbar">${l}<i><b style="width:${isNum(v) ? v : 0}%;background:${scol(v || 0)}"></b></i></div>`).join("")}</div>
      <div class="stats"><div>P/E<b>${num(x.pe, 1)}</b></div><div>Rev CAGR<b>${pct(x.revCagr, 0)}</b></div><div>Base real<b>${sp(x.baseReal)}</b></div></div>
      <div style="margin-top:8px">${tagsHtml(x.tags, 2)}${x.critical ? '<span class="tag bad">⚠ red flag</span>' : ""}${isNum(x.avgDailyTurnoverCr) && x.avgDailyTurnoverCr < 5 ? '<span class="tag bad">low liquidity</span>' : ""}</div>
      ${x.reason ? `<div class="why">${esc(x.reason)}</div>` : ""}
      ${cmp ? `<label class="cmpbox chk" title="Add to comparison" onclick="event.stopPropagation()"><input type="checkbox" class="cmpchk" value="${esc(x.symbol)}"></label>` : ""}</div>`;
  }
  function wireCards(root) { $$("[data-sym]", root).forEach((el) => el.addEventListener("click", (e) => { if (e.target.closest("input,label,a")) return; go("#/stock/" + encodeURIComponent(el.dataset.sym)); })); }
  function miniRows(items) {
    if (!items.length) return '<div class="empty">None yet.</div>';
    return `<table class="tbl"><tbody>${items.map((x) => `<tr class="go" data-sym="${esc(x.symbol)}"><td style="width:46px">${ring(x.composite, 40)}</td><td><b>${esc(x.symbol)}</b> ${tagsHtml(x.tags, 1)}<div class="muted sm" style="max-width:340px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(x.reason || x.name || "")}</div></td><td>${actPill(x.action) || pill(x.label)}</td><td class="r">${sp(x.baseReal)}<div class="muted sm">base real</div></td></tr>`).join("")}</tbody></table>`;
  }
  function hbars(rows) { const max = Math.max(...rows.map((r) => r[1]), 1); return rows.map(([l, v, t]) => `<div class="hb"><span class="lb" title="${esc(l)}">${esc(l)}</span><span class="tr"><i style="width:${(v / max * 100).toFixed(1)}%"></i></span><span class="vl">${t}</span></div>`).join(""); }
  function alertItem(a) {
    const c = a.severity === "critical" ? "var(--avoid)" : a.severity === "warn" ? "var(--inv)" : "var(--watch)";
    return `<div class="tl ${a.read ? "read" : ""}" style="--c:${c}"><div style="display:flex;gap:8px;align-items:baseline;flex-wrap:wrap"><b>${esc(a.title)}</b><span class="muted sm">${dtt(a.created_at)}</span>${a.symbol ? `<a class="sm" href="#/stock/${encodeURIComponent(a.symbol)}" style="margin-left:auto">Open →</a>` : ""}</div><div class="sm soft">${esc(a.detail).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">source</a>')}</div></div>`;
  }

  // =====================================================================
  // DISCOVER
  // =====================================================================
  const DTABS = [["buy", "Buy candidates", "label"], ["watch", "Watch", "label"], ["investigate", "Investigate", "label"], ["avoid", "Avoid", "label"],
    ["emerging", "Emerging", "tag"], ["compounder", "Compounders", "tag"], ["value", "Fair price", "tag"], ["turnaround", "Turnarounds", "tag"], ["hype", "Hype risk", "tag"], ["all", "All", null]];
  const DDESC = {
    buy: "Composite ≥ 60, quality ≥ 55, base-case real return ≥ 5%/yr, bear case no worse than −5%/yr, no critical red flag.",
    watch: "Good businesses that are expensive, or decent ones without a compelling return yet.",
    investigate: "Mixed signals — a red flag on a strong company, fast growth with weaker quality, one-off profits, or missing data.",
    avoid: "Weak overall, a critical red flag with low quality, or a poor bear case without the quality to justify it.",
    emerging: "Revenue growing ≥ 20%/yr, not slowing, margins improving, profitable, market cap under ₹30,000 cr.",
    compounder: "High returns on capital, cash-backed profits, ≥ 10% growth, low debt.",
    value: "Top-30% valuation within its industry while quality is above average.",
    turnaround: "Back in profit with net margin up 5+ points after loss years.",
    hype: "P/E above 70 without the profit growth to justify it.", all: "Every analysed company.",
  };
  const DSTATE = { view: localStorage.getItem("dview") || "cards", minQ: 0, maxPe: 200, minBase: -30, industry: "", q: "", sort: "composite", dir: -1, show: 48 };
  V.discover = async (r) => {
    setTitle("Discover");
    const tab = r.q.get("tab") || "buy";
    if (r.q.get("view")) DSTATE.view = r.q.get("view");
    if (r.q.get("industry") != null) DSTATE.industry = r.q.get("industry");
    DSTATE.show = 48;
    const data = await api("/api/stocks"), all = data.items; live(r);
    const inTab = (t, x) => (t[2] === "label" ? x.label === t[0] : t[2] === "tag" ? (x.tags || []).some((g) => g.code === t[0]) : true);
    const T = DTABS.find((x) => x[0] === tab) || DTABS[0];
    view().innerHTML = `${head("Discover", `${all.filter((x) => !x.insufficient).length} companies scored against the Nifty 500 · updated ${ago(data.meta && data.meta.at)}`, `<div class="seg" id="vseg">${[["cards", "▦ Cards"], ["table", "☰ Table"], ["map", "◎ Map"]].map(([k, l]) => `<button data-v="${k}" class="${DSTATE.view === k ? "on" : ""}">${l}</button>`).join("")}</div><button class="btn pri" id="cmpBtn">⇄ Compare <span id="cmpN"></span></button>`, "Screens")}
      <div class="seg" style="margin-bottom:12px">${DTABS.map((t) => `<a href="#/discover?tab=${t[0]}" class="${t[0] === tab ? "on" : ""}">${t[1]}<span class="n">${all.filter((x) => inTab(t, x)).length}</span></a>`).join("")}</div>
      <div class="note">${esc(DDESC[tab])}</div>
      <div class="card filters" style="margin-top:14px;padding:16px 18px">
        <div class="field" style="flex:1;min-width:180px">Search<input id="dq" placeholder="Name or symbol…" value="${esc(DSTATE.q)}"></div>
        <div class="field" style="min-width:200px">Industry<select id="ind"><option value="">All industries</option>${data.industries.map((i) => `<option${i === DSTATE.industry ? " selected" : ""}>${esc(i)}</option>`).join("")}</select></div>
        ${slider("minQ", "Min quality", 0, 100, 5, DSTATE.minQ, (v) => v)}${slider("maxPe", "Max P/E", 5, 200, 5, DSTATE.maxPe, (v) => (v >= 200 ? "any" : v))}${slider("minBase", "Min base real/yr", -30, 30, 1, DSTATE.minBase, (v) => (v <= -30 ? "any" : v + "%"))}
        <div class="field">Add a stock<input id="addSym" placeholder="NSE symbol ↵"></div></div>
      <div id="host" style="margin-top:16px"></div>`;
    const host = $("#host");
    const filtered = () => all.filter((x) => inTab(T, x) && (!DSTATE.industry || x.industry === DSTATE.industry)
      && (!DSTATE.q || (x.symbol + " " + x.name).toLowerCase().includes(DSTATE.q.toLowerCase()))
      && (DSTATE.minQ <= 0 || (x.q || 0) >= DSTATE.minQ) && (DSTATE.maxPe >= 200 || (isNum(x.pe) && x.pe <= DSTATE.maxPe))
      && (DSTATE.minBase <= -30 || (isNum(x.baseReal) && x.baseReal * 100 >= DSTATE.minBase)));
    const draw = () => {
      const items = filtered().sort((a, b) => { const va = a[DSTATE.sort], vb = b[DSTATE.sort]; if (va == null) return 1; if (vb == null) return -1; return (va > vb ? 1 : va < vb ? -1 : 0) * DSTATE.dir; });
      if (!items.length) host.innerHTML = '<div class="card"><div class="empty"><span class="em">∅</span>Nothing matches these filters.</div></div>';
      else if (DSTATE.view === "map") host.innerHTML = `<div class="card"><div class="card-h"><h2>${items.length} companies</h2><span class="hint">Quality vs Value · size = market cap</span></div>${oppMap(items)}</div>`;
      else if (DSTATE.view === "table") host.innerHTML = `<div class="card" style="padding:8px 10px"><div class="tbl-wrap">${stockTable(items)}</div></div>`;
      else host.innerHTML = `<div class="scards">${items.slice(0, DSTATE.show).map((x) => stockCard(x, { cmp: true })).join("")}</div>${items.length > DSTATE.show ? `<div style="text-align:center;margin-top:16px"><button class="btn" id="more">Show more (${items.length - DSTATE.show} left)</button></div>` : ""}`;
      wireCards(host); flush();
      $$("th.s", host).forEach((th) => (th.onclick = () => { const k = th.dataset.k; DSTATE.dir = DSTATE.sort === k ? -DSTATE.dir : (k === "symbol" ? 1 : -1); DSTATE.sort = k; draw(); }));
      const m = $("#more"); if (m) m.onclick = () => { DSTATE.show += 48; draw(); };
      $$(".cmpchk", host).forEach((c) => (c.onchange = updCmp));
      updCmp();
    };
    const updCmp = () => { const n = $$(".cmpchk:checked").length; $("#cmpN").textContent = n ? `(${n})` : ""; };
    draw();
    $("#vseg").onclick = (e) => { const b = e.target.closest("[data-v]"); if (!b) return; DSTATE.view = b.dataset.v; try { localStorage.setItem("dview", DSTATE.view); } catch { /* ignore */ } $$("#vseg button").forEach((x) => x.classList.toggle("on", x === b)); draw(); };
    let tq; $("#dq").oninput = (e) => { clearTimeout(tq); tq = setTimeout(() => { DSTATE.q = e.target.value; draw(); }, 150); };
    $("#ind").onchange = (e) => { DSTATE.industry = e.target.value; draw(); };
    wireSliders(view(), (k, v) => { DSTATE[k] = v; draw(); });
    $("#cmpBtn").onclick = () => { const s = $$(".cmpchk:checked").map((c) => c.value); if (s.length < 2) return toast("Tick 2–5 cards (switch to Cards view) to compare", true); go("#/compare?s=" + s.slice(0, 5).join(",")); };
    $("#addSym").onkeydown = async (e) => { if (e.key !== "Enter") return; const s = e.target.value.trim(); if (!s) return; e.target.disabled = true; toast("Fetching " + s.toUpperCase() + "…"); try { const r2 = await api("/api/stock/add", { method: "POST", body: { symbol: s } }); SYMS = null; go("#/stock/" + r2.symbol); } catch (err) { toast(err.message, true); e.target.disabled = false; } };
  };
  function slider(key, label, min, max, step, val, fmt) {
    const p = ((val - min) / (max - min)) * 100;
    return `<div class="slider"><div class="lab">${label}<b data-out="${key}">${fmt(val)}</b></div><input type="range" data-k="${key}" min="${min}" max="${max}" step="${step}" value="${val}" style="--p:${p}%" data-fmt="${encodeURIComponent(fmt.toString())}"></div>`;
  }
  function wireSliders(root, onChange) {
    $$("input[type=range][data-k]", root).forEach((el) => {
      const fmt = new Function("return " + decodeURIComponent(el.dataset.fmt))();
      let t;
      el.oninput = () => { const v = +el.value; el.style.setProperty("--p", ((v - el.min) / (el.max - el.min)) * 100 + "%"); const o = root.querySelector(`[data-out="${el.dataset.k}"]`); if (o) o.textContent = fmt(v); clearTimeout(t); t = setTimeout(() => onChange(el.dataset.k, v), 60); };
    });
  }
  function stockTable(items) {
    const th = (k, l, r) => `<th class="s${r ? " r" : ""}${DSTATE.sort === k ? (DSTATE.dir > 0 ? " asc" : " desc") : ""}" data-k="${k}">${l}</th>`;
    return `<table class="tbl"><thead><tr>${th("symbol", "Company")}${th("label", "Our take")}${th("composite", "Score")}${th("q", "Quality")}${th("g", "Growth")}${th("v", "Value")}${th("pe", "P/E", 1)}${th("roe", "ROE", 1)}${th("revCagr", "Rev CAGR", 1)}${th("baseReal", "Base real", 1)}${th("bearReal", "Bear real", 1)}${th("mcapCr", "Mkt cap cr", 1)}</tr></thead>
      <tbody>${items.map((x) => `<tr class="go" data-sym="${esc(x.symbol)}"><td><b>${esc(x.symbol)}</b> ${x.critical ? '<span class="tag bad">⚠</span>' : ""}<div class="muted sm">${esc((x.name || "").slice(0, 32))}</div></td><td>${actPill(x.action) || pill(x.label)}</td><td>${sbar(x.composite)}</td><td>${sbar(x.q)}</td><td>${sbar(x.g)}</td><td>${sbar(x.v)}</td>
        <td class="r">${num(x.pe, 1)}</td><td class="r">${pct(x.roe, 0)}</td><td class="r">${pct(x.revCagr, 0)}</td><td class="r">${sp(x.baseReal)}</td><td class="r">${sp(x.bearReal)}</td><td class="r">${isNum(x.mcapCr) ? Math.round(x.mcapCr).toLocaleString("en-IN") : "—"}</td></tr>`).join("")}</tbody></table>`;
  }

  // =====================================================================
  // STOCK — beginner report: verdict → business → money → pros/cons → owners → news → outcomes → advanced
  // =====================================================================
  const ACT = {
    buy: { ico: "✓", c: "--buy" }, parts: { ico: "◔", c: "--buy" }, wait: { ico: "⏳", c: "--watch" }, watch: { ico: "👁", c: "--watch" },
    skip: { ico: "–", c: "--pass" }, research: { ico: "?", c: "--inv" }, dont: { ico: "✕", c: "--avoid" }, nodata: { ico: "…", c: "--pass" },
  };
  const actPill = (a) => (a && a.code ? `<span class="pill" style="color:var(${(ACT[a.code] || ACT.skip).c});background:color-mix(in srgb, var(${(ACT[a.code] || ACT.skip).c}) 14%, transparent)">${esc(a.title)}</span>` : "");
  const TONE = { good: "var(--buy)", ok: "var(--inv)", bad: "var(--avoid)" };

  V.stock = async (r) => {
    view().innerHTML = '<div class="card"><div class="empty"><span class="spin"></span> Gathering the company profile, owners and latest filings…</div></div>';
    const a = await api("/api/stock/" + encodeURIComponent(r.arg)); live(r);
    setTitle(a.symbol);
    const m = a.metrics || {}, b = a.beginner || {}, v = b.verdict || {}, pf = a.profile || {}, own = b.ownership, G = (k) => a.score && a.score.groups && a.score.groups[k], gs = (k) => G(k) && G(k).score;
    const series = a.series || [], chg = series.length > 1 ? m.price / series[series.length - 2][1] - 1 : null;
    const ac = ACT[v.code] || ACT.skip;
    const sum = (pf.summary || "").split(/(?<=\.)\s+/);
    const scen = a.scenarios;
    view().innerHTML = `
      <div class="head" style="margin-bottom:16px"><div><div class="eyebrow">${esc(pf.sector || a.industry)}${pf.industry ? " · " + esc(pf.industry) : ""} · NSE: ${esc(a.symbol)}</div><h1>${esc(a.name)}</h1>
        <div class="row" style="align-items:baseline;margin-top:6px;gap:14px"><span style="font-size:28px;font-weight:750" class="num">₹${num(m.price, 2)}</span><span>${sp(chg)} <span class="muted sm">this week</span></span><span>${sp(m.ret1y)} <span class="muted sm">over 1 year</span></span></div></div>
        <div class="right noprint"><button class="btn" id="watchBtn">${a.watched ? "★ Watching" : "☆ Watch"}</button><button class="btn" id="cmpAdd">⇄ Compare</button><button class="btn pri" id="aiBtn">✦ AI explainer</button></div></div>

      <div class="card verdict" style="--vc:var(${ac.c})">
        <div class="v-top"><div class="v-ico">${ac.ico}</div><div><div class="eyebrow">Our take</div><div class="v-title">${esc(v.title || "—")}</div><div class="soft">${esc(v.line || "")}</div></div></div>
        <div class="v-grid">
          <div><span class="muted sm">${g("buy-below price")}</span><b>${v.buyBelow ? "₹" + num(v.buyBelow, 0) : "—"}</b><span class="sm muted">${isNum(v.gap) ? (v.gap <= 0 ? `price is ${pct(-v.gap, 0)} below it` : `price is ${pct(v.gap, 0)} above it`) : ""}</span></div>
          <div><span class="muted sm">${g("Suggested amount")}</span>${v.size && v.size.amount ? `<b>₹${v.size.amount.toLocaleString("en-IN")}</b><span class="sm muted">${v.size.shares >= 1 ? `≈ ${v.size.shares} share${v.size.shares === 1 ? "" : "s"}` : `less than 1 share (₹${num(m.price, 0)} each)`} · ${pct(v.size.pct, 1)} of your budget</span>` : b.settings && !b.settings.investAmount && ["buy", "parts", "wait", "watch"].includes(v.code) ? `<div class="row" style="gap:6px;margin-top:4px"><input id="budget" type="number" placeholder="Your total budget ₹" style="width:170px;height:34px"><button class="btn sm pri" id="budgetSave">Set</button></div>` : `<b>—</b><span class="sm muted">${["dont", "research", "skip"].includes(v.code) ? "not suggested" : ""}</span>`}</div>
          <div><span class="muted sm">How long to hold</span><b style="font-size:15px">${esc((v.hold || "—").split(" — ")[0].split(",")[0])}</b><span class="sm muted">${esc((v.hold || "").split(/ — |, /).slice(1).join(", "))}</span></div>
        </div>
        ${v.size && v.size.plan ? `<div class="note" style="margin-top:14px"><b>Plan:</b> ${esc(v.size.plan)}${v.size.note ? " " + esc(v.size.note) : ""}</div>` : ""}
        ${v.size && v.size.why ? `<div class="sm muted" style="margin-top:8px">Amount rule: ${esc(v.size.why.join("; "))}. Change your budget and risk level in <a href="#/settings">Settings</a>.</div>` : ""}
        <div class="grid g2" style="margin-top:14px;gap:14px">
          <div><div class="sm" style="font-weight:600;margin-bottom:4px">Why</div><ul class="reasons" style="margin:0">${(v.reasons || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>
          <div><div class="sm" style="font-weight:600;margin-bottom:4px">Re-check if…</div><ul class="reasons" style="margin:0">${(v.triggers || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div></div>
        ${v.owned ? `<div class="note ok" style="margin-top:14px"><b>You own this · ${esc(v.owned.title)}.</b> ${esc(v.owned.line)}</div>` : ""}
        <div class="sm muted" style="margin-top:12px">Rule-based research from public data, not personal financial advice. I'm a software tool, not a SEBI-registered adviser — decide with your own judgement.</div>
      </div>

      <div class="grid g-21">
        <div class="card"><div class="card-h"><h2>What does the company do?</h2>${pf.source || pf.wiki ? `<a class="hint" href="${esc(pf.source || pf.wiki)}" target="_blank" rel="noopener">source ↗</a>` : ""}</div>
          ${sum[0] ? `<p class="soft" style="margin:0;font-size:15px;line-height:1.65">${esc(sum.slice(0, 3).join(" "))}</p>${sum.length > 3 ? `<details style="margin-top:8px"><summary>Read more</summary><p class="soft">${esc(sum.slice(3).join(" "))}</p></details>` : ""}` : '<div class="empty">No business description available from the free sources.</div>'}</div>
        <div class="card"><div class="card-h"><h2>Quick facts</h2></div><div class="kv">
          <div class="k">Sector</div><div>${esc(pf.sector || a.industry || "—")}</div>
          ${pf.industry ? `<div class="k">Industry</div><div>${esc(pf.industry)}</div>` : ""}
          <div class="k">Company size</div><div>${crs(m.mcap)} <span class="muted sm">${sizeWord(m.mcap)}</span></div>
          ${isNum(m.avgDailyTurnoverCr) ? `<div class="k">Liquidity</div><div>≈₹${m.avgDailyTurnoverCr < 10 ? m.avgDailyTurnoverCr.toFixed(1) : Math.round(m.avgDailyTurnoverCr)} cr/day${m.avgDailyTurnoverCr < 5 ? ' <span class="down sm">low — orders may move the price</span>' : ""}</div>` : ""}
          ${pf.employees ? `<div class="k">Employees</div><div>${Number(pf.employees).toLocaleString("en-IN")}</div>` : ""}
          ${pf.city ? `<div class="k">Head office</div><div>${esc(pf.city)}</div>` : ""}
          ${(pf.officers || []).slice(0, 2).map((o) => `<div class="k">${esc((o.title || "").split(/[,&]/)[0].slice(0, 28))}</div><div>${esc(o.name)}</div>`).join("")}
          ${pf.website ? `<div class="k">Website</div><div><a href="${esc(pf.website)}" target="_blank" rel="noopener">${esc(pf.website.replace(/^https?:\/\/(www\.)?/, ""))}</a></div>` : ""}</div></div>
      </div>

      <div class="card"><div class="card-h"><h2>Money summary</h2><span class="hint">latest year (FY${String(m.latestFy || "").slice(2, 4)}) · hover a box for an explanation</span></div>
        <div class="money">${(b.money || []).map((t) => `<div class="mt" data-tip="${esc(t.explain)}" style="--tc:${TONE[t.tone] || "var(--ink-3)"}"><span class="k">${esc(t.k)}</span><b>${esc(t.v)}</b><span class="s">${esc(t.sub)}</span></div>`).join("")}</div>
        <div style="margin-top:18px"><div class="sm" style="font-weight:600;margin-bottom:6px">Sales and profit over the years (₹ crore)</div>${bars((a.years || []).map((y) => "FY" + y.fy.slice(2, 4)), [{ name: "Sales", color: "var(--a2)", values: (a.years || []).map((y) => (isNum(y.rev) ? y.rev / 1e7 : null)) }, { name: "Profit", color: "var(--a1)", values: (a.years || []).map((y) => (isNum(y.ni) ? y.ni / 1e7 : null)) }], { h: 190, fmtV: (x) => "₹" + num(x, 0) + " cr" })}</div></div>

      ${series.length >= 2 ? `<div class="card"><div class="card-h"><h2>Share price</h2><div class="seg" id="pxRng" style="margin-left:auto">${[["1Y", 52], ["3Y", 156], ["5Y", 9999]].map(([l, n], i) => `<button data-n="${n}" class="${i === 0 ? "on" : ""}">${l}</button>`).join("")}</div></div><div id="pxMain">${areaChart(series.slice(-52), { color: "auto", fmtV: (x) => "₹" + num(x, 0) })}</div></div>` : ""}

      <div class="grid g2">
        <div class="card pc pros"><div class="card-h"><h2>👍 Good things</h2></div>${(b.prosCons && b.prosCons.pros.length ? b.prosCons.pros : ["Nothing stands out as a clear strength."]).map((x) => `<div class="pci">${esc(x)}</div>`).join("")}</div>
        <div class="card pc cons"><div class="card-h"><h2>👎 Things to worry about</h2></div>${(b.prosCons && b.prosCons.cons.length ? b.prosCons.cons : ["No automated warning signs — still read the annual report for governance and related-party deals."]).map((x) => `<div class="pci">${esc(x)}</div>`).join("")}</div>
      </div>

      ${(a.peers || []).length ? `<div class="card"><div class="card-h"><h2>Alternatives in ${esc(a.industry || "this industry")}</h2><span class="hint">same industry, sorted by composite score</span></div>
        <div class="peer-scroll">${a.peers.map((x) => stockCard(x)).join("")}</div></div>` : ""}

      <div class="card"><div class="card-h"><h2>Who owns it — and who's buying?</h2>${own ? `<span class="hint">NSE shareholding filing, quarter ending ${esc(own.asOf)}</span>` : ""}</div>
        ${own ? `<div class="grid g-12" style="gap:24px">
          <div>${donut([...own.parts.map((p, i) => ({ label: p.label, value: p.pct, color: PALETTE[i % PALETTE.length] })), ...(1 - own.parts.reduce((t, p) => t + p.pct, 0) > 0.001 ? [{ label: "Others", value: 1 - own.parts.reduce((t, p) => t + p.pct, 0), color: "#64748b" }] : [])], { size: 200, center: own.parts[0] ? pct(own.parts[0].pct, 1) : "" })}<div class="sm muted" style="text-align:center;margin-top:6px">${own.parts[0] ? esc(own.parts[0].label) + " own the largest share" : ""}</div></div>
          <div><div class="sm" style="font-weight:600;margin-bottom:6px">Changes since last quarter</div>
            ${own.changes.length ? own.changes.map((c) => `<div class="chg"><span>${esc(c.label)}</span><span class="num">${pct(c.from, 1)} → <b>${pct(c.to, 1)}</b></span><span class="${c.delta >= 0 ? "up" : "down"} num">${c.delta >= 0 ? "▲ bought" : "▼ sold"} ${pct(Math.abs(c.delta), 2)}</span></div>`).join("") : '<div class="muted sm">No meaningful change.</div>'}
            <div class="sm muted" style="margin-top:6px">${g("Promoters")} own ${own.parts.find((p) => p.key === "promoter") ? pct(own.parts.find((p) => p.key === "promoter").pct, 1) : "nothing (no promoter group)"}. Big institutions buying is usually a vote of confidence; promoters selling deserves a question.</div>
            <div class="sm" style="font-weight:600;margin:16px 0 6px">Big investors (over 1% each, excluding promoters)</div>
            ${own.named.length ? `<table class="tbl"><tbody>${own.named.map((h) => `<tr><td>${esc(h.name)} ${h.isNew ? '<span class="tag">new this quarter</span>' : ""}</td><td class="r">${pct(h.pct, 2)}</td><td class="r sm">${h.prevPct != null && Math.abs(h.pct - h.prevPct) >= 0.0005 ? `<span class="${h.pct > h.prevPct ? "up" : "down"}">${h.pct > h.prevPct ? "▲" : "▼"} ${pct(Math.abs(h.pct - h.prevPct), 2)}</span>` : ""}</td></tr>`).join("")}</tbody></table>` : '<div class="muted sm">No outside investor holds more than 1%.</div>'}
            <div class="sm muted" style="margin-top:8px">Bulk/block deals (large one-day trades) aren't available from free sources.</div></div></div>` : '<div class="empty">Shareholding data couldn\'t be fetched from NSE right now. Try “Refresh” later.</div>'}</div>

      <div id="smHost"></div>
      <div class="card"><div class="card-h"><h2>News that matters</h2><span class="hint">official NSE filings + news headlines</span></div>
        ${(b.feed || []).length ? `<div class="feed">${b.feed.slice(0, 8).map(newsRow).join("")}</div>${b.feed.length > 8 ? `<details style="margin-top:8px"><summary>Show ${b.feed.length - 8} more</summary><div class="feed">${b.feed.slice(8).map(newsRow).join("")}</div></details>` : ""}` : '<div class="empty">No filings or headlines found recently.</div>'}</div>

      ${scen ? `<div class="card"><div class="card-h"><h2>What could ₹1 lakh become in 5 years?</h2><span class="hint">three scenarios, not predictions</span></div>
        <div class="grid g3" style="gap:14px">${[["bear", "If things go badly", "--avoid"], ["base", "If things go as expected", "--a2"], ["bull", "If things go well", "--buy"]].map(([k, l, c]) => `<div class="outcome" style="--oc:var(${c})"><div class="sm muted">${l}</div><div class="big num">${inrC(1e5 * scen[k].multiple5y)}</div><div class="sm">worth <b>${inrC((1e5 * scen[k].multiple5y) / Math.pow(1 + a.inflation, 5))}</b> in today's money</div><div class="sm">${sp(scen[k].real)} a year after inflation</div><div class="sm muted">profit grows ${pct(a.assumptions.growth[k], 0)}/yr</div></div>`).join("")}</div>
        <div class="sm muted" style="margin-top:10px">With ${pct(a.inflation, 1)} inflation, ₹1 lakh needs to become about ${inrC(1e5 * Math.pow(1 + a.inflation, 5))} in 5 years just to keep its buying power. Adjust the assumptions in “Detailed analysis” below.</div></div>` : ""}

      <div class="card" id="aiCard"><div class="card-h"><h2>✦ AI explainer</h2><span class="hint">free Gemini · plain English · cites sources</span></div><div id="aiBody">${a.notes.length ? noteHtml(a.notes[0]) : '<div class="empty"><span class="em">✦</span>Press “AI explainer” for a plain-English write-up of this company.</div>'}</div></div>

      <details class="adv" id="adv"><summary><span>Detailed analysis</span><span class="muted sm">scores, price chart, adjustable scenarios, full financials, red flags, sources</span></summary>
        <div class="grid g-21" style="margin-top:16px">
          <div class="card"><div class="card-h"><h2>Price</h2><div class="seg" id="rng" style="margin-left:auto">${[["1Y", 52], ["3Y", 156], ["5Y", 9999]].map(([l, n], i) => `<button data-n="${n}" class="${i === 2 ? "on" : ""}">${l}</button>`).join("")}</div></div><div id="pxHost">${areaChart(series, { color: "auto", fmtV: (x) => "₹" + num(x, 0) })}</div></div>
          <div class="card"><div class="card-h"><h2>Scores</h2><span class="hint">vs Nifty 500</span></div><div style="text-align:center;margin-bottom:6px">${ring(a.score && a.score.composite, 92, "overall")}</div>
            ${radar([{ color: "var(--a2)", values: [gs("quality"), gs("growth"), gs("value"), gs("safety")] }], { size: 210 })}
            <details style="margin-top:6px"><summary>How each score was built</summary>${["quality", "growth", "value", "safety"].map((k) => G(k) ? `<div style="margin-top:10px"><b class="sm" style="text-transform:capitalize">${k} ${num(G(k).score, 0)}</b>${G(k).penalty ? ` <span class="sm down">−${G(k).penalty} red-flag penalty</span>` : ""}<table class="tbl" style="font-size:12.5px"><tbody>${G(k).parts.map((p) => `<tr><td>${esc(p.label)}</td><td class="r">${p.value == null ? "n/a" : fmtFactor(p.key, p.value)}</td><td class="r">${p.pct == null ? "—" : p.pct.toFixed(0) + " pctl"}</td></tr>`).join("")}</tbody></table></div>` : "").join("")}</details></div>
        </div>
        <div class="card" id="scen"></div>
        <div class="grid g-21">
          <div class="card"><div class="card-h"><h2>Financials</h2><div class="seg" id="finSeg" style="margin-left:auto">${[["pl", "Sales & profit"], ["cf", "Cash flow"], ["bs", "Balance sheet"], ["rt", "Margins"]].map(([k, l], i) => `<button data-k="${k}" class="${i === 0 ? "on" : ""}">${l}</button>`).join("")}</div></div><div id="finHost"></div><details style="margin-top:10px"><summary>Full table (₹ crore)</summary>${finTable(a.years)}</details></div>
          <div class="card"><div class="card-h"><h2>All automated checks</h2></div>${a.flags && a.flags.length ? a.flags.map((f) => `<div class="flag ${f.severity}"><div>${esc(f.text)}</div></div>`).join("") : '<div class="note ok">No automated warning signs.</div>'}
            <div class="sm muted" style="margin-top:10px">Not checked (not in free data): promoter pledging, related-party transactions, auditor changes, contingent liabilities, bad loans (NPAs).</div>${(m.notes || []).map((n) => `<div class="note warn" style="margin-top:8px">${esc(n)}</div>`).join("")}</div>
        </div>
        <div class="card"><div class="card-h"><h2>Sources & data quality</h2><button class="btn sm" id="refBtn" style="margin-left:auto">↻ Refresh all data</button></div><div class="kv">
          <div class="k">Financials</div><div><a href="${esc(a.sources.page || a.sources.fundamentals)}" target="_blank" rel="noopener">Yahoo Finance</a> · ${dtt(a.fundFetchedAt)}</div>
          <div class="k">Prices</div><div><a href="${esc(a.sources.prices)}" target="_blank" rel="noopener">Yahoo Finance chart</a> · ${dtt(a.priceFetchedAt)} (delayed)</div>
          <div class="k">Profile, owners, filings</div><div>Yahoo Finance profile · NSE shareholding & announcements · ${dtt(a.profileFetchedAt)}${a.profileErrors && a.profileErrors.length ? ` <span class="down sm">(${esc(a.profileErrors.join("; ").slice(0, 120))})</span>` : ""}</div>
          <div class="k">Cross-check</div><div><a href="https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(a.symbol)}" target="_blank" rel="noopener">NSE</a> · <a href="https://www.screener.in/company/${encodeURIComponent(a.symbol)}/" target="_blank" rel="noopener">Screener</a></div></div></div>
      </details>${disc}`;

    // wiring
    if ($("#pxRng")) $("#pxRng").onclick = (e) => { const bt = e.target.closest("[data-n]"); if (!bt) return; $$("#pxRng button").forEach((x) => x.classList.toggle("on", x === bt)); $("#pxMain").innerHTML = areaChart(series.slice(-+bt.dataset.n), { color: "auto", fmtV: (x) => "₹" + num(x, 0) }); flush(); };
    $("#rng").onclick = (e) => { const bt = e.target.closest("[data-n]"); if (!bt) return; $$("#rng button").forEach((x) => x.classList.toggle("on", x === bt)); $("#pxHost").innerHTML = areaChart(series.slice(-+bt.dataset.n), { color: "auto", fmtV: (x) => "₹" + num(x, 0) }); flush(); };
    const yrs = a.years || [], labs = yrs.map((y) => "FY" + y.fy.slice(2, 4)), crv = (k) => yrs.map((y) => (isNum(y[k]) ? y[k] / 1e7 : null));
    const FIN = {
      pl: () => bars(labs, [{ name: "Sales", color: "var(--a2)", values: crv("rev") }, { name: "Operating profit", color: "var(--a3)", values: crv("opInc") }, { name: "Net profit", color: "var(--a1)", values: crv("ni") }], { fmtV: (x) => "₹" + num(x, 0) + " cr" }),
      cf: () => bars(labs, [{ name: "Cash from operations", color: "var(--a1)", values: crv("ocf") }, { name: "Capex", color: "var(--avoid)", values: crv("capex") }, { name: "Free cash flow", color: "var(--a2)", values: yrs.map((y) => (isNum(y.fcf) ? y.fcf / 1e7 : isNum(y.ocf) && isNum(y.capex) ? (y.ocf + y.capex) / 1e7 : null)) }], { fmtV: (x) => "₹" + num(x, 0) + " cr" }),
      bs: () => bars(labs, [{ name: "Equity", color: "var(--a1)", values: crv("equity") }, { name: "Debt", color: "var(--avoid)", values: crv("debt") }, { name: "Cash", color: "var(--a2)", values: crv("cash") }], { fmtV: (x) => "₹" + num(x, 0) + " cr" }),
      rt: () => bars(labs, [{ name: "Net margin %", color: "var(--a1)", values: yrs.map((y) => (y.rev > 0 && isNum(y.ni) ? (y.ni / y.rev) * 100 : null)) }, { name: "ROE %", color: "var(--a3)", values: yrs.map((y) => (y.equity > 0 && isNum(y.ni) ? (y.ni / y.equity) * 100 : null)) }], { fmtV: (x) => num(x, 1) + "%" }),
    };
    $("#finHost").innerHTML = FIN.pl();
    $("#finSeg").onclick = (e) => { const bt = e.target.closest("[data-k]"); if (!bt) return; $$("#finSeg button").forEach((x) => x.classList.toggle("on", x === bt)); $("#finHost").innerHTML = FIN[bt.dataset.k](); flush(); };
    renderScenario(a);
    if (window.SMstock) window.SMstock(a.symbol, $("#smHost"));
    $("#adv").addEventListener("toggle", () => { if ($("#adv").open) flush(); });
    const bs = $("#budgetSave"); if (bs) bs.onclick = async () => { const val = +$("#budget").value; if (!(val > 0)) return toast("Enter the total amount you plan to invest in stocks", true); await api("/api/settings", { method: "POST", body: { investAmount: String(val) } }); toast("Budget saved"); router(); };
    $("#watchBtn").onclick = async () => { await api("/api/watchlist", { method: "POST", body: { symbol: a.symbol, remove: a.watched } }); a.watched = !a.watched; $("#watchBtn").textContent = a.watched ? "★ Watching" : "☆ Watch"; toast(a.watched ? "Watching — you'll get alerts" : "Removed from watchlist"); };
    $("#refBtn").onclick = async () => { $("#refBtn").innerHTML = '<span class="spin"></span>'; try { await api(`/api/stock/${encodeURIComponent(a.symbol)}/refresh`, { method: "POST", body: {} }); router(); } catch (e) { toast(e.message, true); } };
    $("#cmpAdd").onclick = () => { let l = []; try { l = JSON.parse(localStorage.getItem("cmp") || "[]"); } catch { /* ignore */ } l = l.filter((x) => x !== a.symbol); l.push(a.symbol); l = l.slice(-5); try { localStorage.setItem("cmp", JSON.stringify(l)); } catch { /* ignore */ } go("#/compare?s=" + l.join(",")); };
    $("#aiBtn").onclick = async () => {
      const bt = $("#aiBtn"); bt.disabled = true; bt.innerHTML = '<span class="spin"></span> Writing…';
      $("#aiBody").innerHTML = '<div class="empty"><span class="spin"></span> Writing a plain-English explainer — usually 20–60 seconds…</div>';
      $("#aiCard").scrollIntoView({ behavior: "smooth", block: "start" });
      try { const n = await api("/api/ai/stock/" + encodeURIComponent(a.symbol), { method: "POST", body: {} }); $("#aiBody").innerHTML = noteHtml({ ...n, created_at: new Date().toISOString() }); }
      catch (e) { $("#aiBody").innerHTML = `<div class="note warn">${esc(e.message)} <a href="#/settings">Open settings</a></div>`; }
      bt.disabled = false; bt.textContent = "✦ AI explainer";
    };
    wireCards(view());
  };
  const sizeWord = (mc) => (!isNum(mc) ? "" : mc >= 1e12 ? "· large company" : mc >= 2e11 ? "· mid-sized company" : "· smaller company");
  function newsRow(n) {
    const col = n.tone === "positive" ? "var(--buy)" : n.tone === "negative" ? "var(--avoid)" : "var(--ink-3)";
    const generic = /^(updates?|general updates|press release|shareholders meeting)$/i.test(n.title.trim());
    const title = generic && n.detail ? n.title + ": " + n.detail.slice(0, 120) : n.title;
    return `<div class="nr" style="--nc:${col}"><div class="nr-l"><span class="tag" style="color:${col};background:color-mix(in srgb, ${col} 14%, transparent)">${n.tone === "positive" ? "▲ " : n.tone === "negative" ? "▼ " : ""}${esc(n.kind)}</span>${n.official ? '<span class="tag">official</span>' : ""}</div>
      <div style="min-width:0">${n.link ? `<a href="${esc(n.link)}" target="_blank" rel="noopener" class="nr-t">${esc(title)}</a>` : `<span class="nr-t">${esc(title)}</span>`}<div class="sm muted">${esc(n.source)} · ${dt(n.date)}${n.important ? ` · <span class="soft">${esc(n.why)}</span>` : ""}</div></div></div>`;
  }
  function fmtFactor(k, v) { return ["roe", "roce", "roa", "revCagr", "niCagr", "revAccel", "npmTrend", "earningsYield", "fcfYield", "maxDrawdown3y", "netCashRatio", "npmStd", "cashConv"].includes(k) ? pct(v) : num(v, 2); }
  function noteHtml(n) {
    return `<div class="muted sm">${esc(n.provider)} · ${dtt(n.created_at)}</div>${n.note ? `<div class="note" style="margin-top:8px">${esc(n.note)}</div>` : ""}${md(n.text)}
      <details style="margin-top:8px"><summary>Sources (${(n.sources || []).length})</summary><div class="srcs">${(n.sources || []).map((s) => `<div><span class="chip">${esc(s.id)}</span> ${s.url && /^https?:/.test(s.url) ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a>` : esc(s.name)}</div>`).join("")}</div></details>
      <div class="sm muted" style="margin-top:8px">AI text can be wrong. Statements marked “general knowledge — unverified” are not backed by a cited source.</div>`;
  }
  function finTable(years) {
    if (!years || !years.length) return '<div class="empty">No financials from the free source.</div>';
    const rows = [["Revenue", "rev"], ["Operating profit", "opInc"], ["EBIT", "ebit"], ["Net profit", "ni"], ["Operating cash flow", "ocf"], ["Capex", "capex"], ["Free cash flow", "fcf"], ["Dividends paid", "div"], ["Total assets", "assets"], ["Equity", "equity"], ["Total debt", "debt"], ["Cash", "cash"], ["Receivables", "recv"], ["Inventory", "inv"]];
    return `<div class="tbl-wrap"><table class="tbl" style="font-size:13px"><thead><tr><th></th>${years.map((y) => `<th class="r">FY${y.fy.slice(2, 4)}</th>`).join("")}</tr></thead><tbody>${rows.map(([l, k]) => `<tr><td>${l}</td>${years.map((y) => `<td class="r">${crN(y[k])}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  }

  function renderScenario(a) {
    const host = $("#scen"), m = a.metrics;
    if (!a.assumptions || !a.scenarios) { host.innerHTML = `<div class="card-h"><h2>5-year scenarios</h2></div><div class="note">Not computable: no positive (or only one-off) earnings in the latest year, so an earnings-based scenario would mislead. Judge it on revenue trajectory, cash runway and the path to profit.</div>`; return; }
    const as = JSON.parse(JSON.stringify(a.assumptions)), infl = a.inflation, eps0 = as.eps0 || m.eps;
    const calc = () => { const o = {}; for (const k of ["bear", "base", "bull"]) { const eps5 = eps0 * Math.pow(1 + as.growth[k], 5), p5 = eps5 * as.exitPe[k], pc = Math.pow(p5 / m.price, 1 / 5) - 1, nom = pc + (as.divYield || 0); o[k] = { eps5, p5, nom, real: (1 + nom) / (1 + infl) - 1, mult: Math.pow(1 + nom, 5) }; } return o; };
    const df = a.defaultAssumptions.derivedFrom;
    host.innerHTML = `<div class="card-h"><h2>5-year scenarios</h2><span class="hint">drag the sliders — everything recalculates live</span></div>
      <div class="scen-grid">${["bear", "base", "bull"].map((k) => `<div class="scase ${k}"><h3>${k}</h3><div class="ret" data-ret="${k}"></div><div class="muted sm" data-sub="${k}"></div>
        <div class="slider"><div class="lab">EPS growth / yr<b data-gv="${k}"></b></div><input type="range" data-g="${k}" min="-15" max="35" step="0.5" value="${(as.growth[k] * 100).toFixed(1)}"></div>
        <div class="slider"><div class="lab">Exit P/E in year 5<b data-pv="${k}"></b></div><input type="range" data-p="${k}" min="3" max="80" step="0.5" value="${as.exitPe[k]}"></div></div>`).join("")}</div>
      <div id="fanHost" style="margin-top:16px"></div>
      <div class="sm muted" style="margin-top:10px"><b>Defaults:</b> base growth = ${df.decelAdjusted ? "35%" : "60%"} of recent growth ${pct(df.historicGrowth)} (70% revenue + 30% profit CAGR) + ${df.decelAdjusted ? "65%" : "40%"} of a ${pct(df.longRun || 0.1, 0)} long-run rate, capped at 15%${df.decelAdjusted ? " — <b>growth is decelerating</b>, so we lean more on the long-run anchor" : ""}${df.cyclical ? " — <b>cyclical sector</b>: capped at 8%, no re-rating" : ""}. Exit P/E vs today's ${num(df.currentPe, 1)} and the industry's ${num(df.peerPe, 1)}: expensive stocks de-rate halfway, cheap ones re-rate only 30% of the way. ${as.normalised ? "<b>EPS is normalised</b> (one-off gains removed). " : ""}Return = (EPS₅ × exit P/E ÷ price)^(1/5) − 1 + ${pct(as.divYield)} dividend yield; real = after ${pct(infl)} inflation.</div>
      <div class="row noprint" style="margin-top:12px"><button class="btn pri sm" id="sSave">Save my assumptions</button><button class="btn sm" id="sReset">Reset to defaults</button>${a.assumptions.overridden ? '<span class="sm muted">Using your saved assumptions.</span>' : ""}</div>`;
    const upd = () => {
      const s = calc();
      for (const k of ["bear", "base", "bull"]) {
        host.querySelector(`[data-ret="${k}"]`).innerHTML = `${sp(s[k].real)}<span class="muted sm" style="font-weight:500"> real/yr</span>`;
        host.querySelector(`[data-sub="${k}"]`).innerHTML = `₹1 L → ${inrC(1e5 * s[k].mult)} · price ₹${num(s[k].p5, 0)} · nominal ${pct(s[k].nom)}`;
        host.querySelector(`[data-gv="${k}"]`).textContent = (as.growth[k] * 100).toFixed(1) + "%";
        host.querySelector(`[data-pv="${k}"]`).textContent = as.exitPe[k].toFixed(1) + "×";
      }
      $$("input[type=range]", host).forEach((el) => el.style.setProperty("--p", ((el.value - el.min) / (el.max - el.min)) * 100 + "%"));
      $("#fanHost").innerHTML = fan(m.price, s);
    };
    $$("input[data-g]", host).forEach((el) => (el.oninput = () => { as.growth[el.dataset.g] = +el.value / 100; upd(); }));
    $$("input[data-p]", host).forEach((el) => (el.oninput = () => { as.exitPe[el.dataset.p] = +el.value; upd(); }));
    upd();
    $("#sSave").onclick = async () => { try { await api(`/api/stock/${encodeURIComponent(a.symbol)}/assumptions`, { method: "POST", body: as }); toast("Saved — screens recalculated"); router(); } catch (e) { toast(e.message, true); } };
    $("#sReset").onclick = async () => { await api(`/api/stock/${encodeURIComponent(a.symbol)}/assumptions`, { method: "POST", body: { reset: true } }); toast("Reset to defaults"); router(); };
  }

  // =====================================================================
  // COMPARE
  // =====================================================================
  V.compare = async (r) => {
    setTitle("Compare");
    let saved = []; try { saved = JSON.parse(localStorage.getItem("cmp") || "[]"); } catch { /* ignore */ }
    const s = r.q.get("s") || saved.join(",");
    const d = s ? await api("/api/compare?s=" + encodeURIComponent(s)) : { items: [] }, it = d.items; live(r);
    const g = (a, k) => a.score.groups[k] && a.score.groups[k].score;
    const rows = [["Screen", (a) => pill(a.label)], ["Composite", (a) => sbar(a.score.composite)], ["Quality", (a) => sbar(g(a, "quality"))], ["Growth", (a) => sbar(g(a, "growth"))], ["Value", (a) => sbar(g(a, "value"))], ["Safety", (a) => sbar(g(a, "safety"))],
      ["Market cap", (a) => crs(a.metrics.mcap)], ["P/E (peer)", (a) => `${num(a.metrics.pe, 1)} <span class="muted sm">(${num(a.peerPe, 1)})</span>`], ["ROE", (a) => pct(a.metrics.roe)], ["ROCE", (a) => pct(a.metrics.roce)], ["Net margin", (a) => pct(a.metrics.npm)], ["Debt / equity", (a) => num(a.metrics.de, 2)],
      ["Revenue CAGR", (a) => pct(a.metrics.revCagr)], ["Profit CAGR", (a) => pct(a.metrics.niCagr)], ["FCF yield", (a) => pct(a.metrics.fcfYield)], ["1-yr return", (a) => sp(a.metrics.ret1y)],
      ["Bear / base / bull real", (a) => (a.scenarios ? `${sp(a.scenarios.bear.real)} / <b>${sp(a.scenarios.base.real)}</b> / ${sp(a.scenarios.bull.real)}` : "—")],
      ["Red flags", (a) => a.flags.filter((f) => f.severity !== "info").map((f) => `<div class="sm ${f.severity === "critical" ? "down" : ""}">• ${esc(f.text)}</div>`).join("") || '<span class="muted">none</span>']];
    view().innerHTML = `${head("Compare", "Up to five companies side by side.", `<input id="cmpIn" placeholder="NSE symbols, comma-separated" value="${esc(it.map((a) => a.symbol).join(","))}" style="width:300px"><button class="btn pri" id="cmpGo">Compare</button>`, "Side by side")}
      ${it.length ? `<div class="grid g-12"><div class="card"><div class="card-h"><h2>Score profiles</h2></div>${radar(it.map((a, i) => ({ color: PALETTE[i], values: [g(a, "quality"), g(a, "growth"), g(a, "value"), g(a, "safety")] })), { size: 250 })}
        <div class="legend" style="justify-content:center;margin-top:8px">${it.map((a, i) => `<span><i style="background:${PALETTE[i]}"></i>${esc(a.symbol)}</span>`).join("")}</div></div>
        <div class="card" style="padding:8px 10px"><div class="tbl-wrap"><table class="tbl"><thead><tr><th></th>${it.map((a, i) => `<th><a href="#/stock/${encodeURIComponent(a.symbol)}" style="color:${PALETTE[i]}">${esc(a.symbol)}</a></th>`).join("")}</tr></thead><tbody>${rows.map(([l, f]) => `<tr><td class="muted">${l}</td>${it.map((a) => `<td>${f(a)}</td>`).join("")}</tr>`).join("")}</tbody></table></div></div></div>`
      : '<div class="card"><div class="empty"><span class="em">⇄</span>Enter symbols above, or tick cards in Discover.</div></div>'}`;
    const goCmp = () => { const v = $("#cmpIn").value.toUpperCase().replace(/\s/g, ""); try { localStorage.setItem("cmp", JSON.stringify(v.split(",").filter(Boolean))); } catch { /* ignore */ } go("#/compare?s=" + v); };
    $("#cmpGo").onclick = goCmp; $("#cmpIn").onkeydown = (e) => e.key === "Enter" && goCmp();
  };

  // =====================================================================
  // FUNDS
  // =====================================================================
  V.funds = async (r) => {
    setTitle("Mutual funds");
    const cats = await api("/api/mf/categories"); live(r);
    view().innerHTML = `${head("Mutual funds", "Every scheme in AMFI's daily NAV file. Returns come from NAV history — past returns are not forecasts.", "", "14,000+ schemes")}
      <div class="grid g-21"><div class="card"><div class="card-h"><h2>Find a fund</h2><label class="chk hint"><input type="checkbox" id="mfdir" checked> Direct–Growth only</label></div><input id="mfq" placeholder="e.g. parag parikh flexi, nifty 50 index, hdfc mid cap" style="width:100%"><div id="mfres" style="margin-top:10px"></div></div>
        <div class="card"><div class="card-h"><h2>Rank a category</h2></div><div class="sm muted" style="margin-bottom:10px">Ranks every Direct–Growth fund on 5-yr return, rolling 3-yr consistency, how often it beat inflation, and drawdown.</div>
          <select id="catSel" style="width:100%">${cats.items.filter((c) => /Equity|Hybrid|Index|ETF|Solution|Debt/i.test(c.category)).map((c) => `<option>${esc(c.category)}</option>`).join("")}</select><button class="btn pri" id="rankBtn" style="margin-top:10px;width:100%;justify-content:center">Rank this category</button></div></div>
      <div id="mfDetail"></div>`;
    let t;
    const search = () => { clearTimeout(t); t = setTimeout(async () => { const q = $("#mfq").value.trim(), res = $("#mfres"); if (q.length < 2) { res.innerHTML = ""; return; } const d = await api(`/api/mf/search?q=${encodeURIComponent(q)}&direct=${$("#mfdir").checked ? 1 : 0}`); res.innerHTML = d.items.length ? `<table class="tbl"><tbody>${d.items.map((x) => `<tr class="go" data-code="${x.code}"><td><b>${esc(x.name)}</b><div class="muted sm">${esc(x.category)}</div></td><td class="r">₹${num(x.nav, 2)}<div class="muted sm">${esc(x.nav_date)}</div></td></tr>`).join("")}</tbody></table>` : '<div class="empty">No match.</div>'; $$("tr[data-code]", res).forEach((tr) => (tr.onclick = () => go("#/fund/" + tr.dataset.code))); }, 220); };
    $("#mfq").oninput = search; $("#mfdir").onchange = search; $("#mfq").focus();
    $("#rankBtn").onclick = async () => {
      const c = $("#catSel").value, b = $("#rankBtn"); b.disabled = true; b.innerHTML = '<span class="spin"></span> Ranking…';
      $("#mfDetail").innerHTML = '<div class="card" style="margin-top:18px"><div class="empty"><span class="spin"></span> Fetching NAV history for each fund (≈1 minute for big categories)…</div></div>';
      try {
        const d = await api("/api/mf/rank?category=" + encodeURIComponent(c));
        const top = d.funds.slice(0, 10);
        $("#mfDetail").innerHTML = `<div class="card" style="margin-top:18px"><div class="card-h"><h2>${esc(d.category)}</h2><span class="hint">${d.analysed} of ${d.count} Direct–Growth funds ${esc(d.note)}</span></div>
          ${bars(top.map((f, i) => "#" + (i + 1)), [{ name: "5-yr CAGR %", color: "var(--a1)", values: top.map((f) => (isNum(f.cagr5) ? f.cagr5 * 100 : null)) }, { name: "Rolling 3-yr median %", color: "var(--a2)", values: top.map((f) => (f.rolling3y ? f.rolling3y.median * 100 : null)) }], { h: 200, fmtV: (v) => num(v, 1) + "%" })}
          <div class="tbl-wrap" style="margin-top:12px"><table class="tbl"><thead><tr><th>#</th><th>Fund</th><th class="r">1 yr</th><th class="r">3 yr</th><th class="r">5 yr</th><th class="r">5 yr real</th><th class="r">Roll 3y median</th><th class="r">Roll 3y worst</th><th class="r">Beat inflation</th><th class="r">Volatility</th><th class="r">Max DD</th></tr></thead><tbody>
          ${d.funds.map((f, i) => `<tr class="go" data-code="${f.code}"><td>${i + 1}</td><td><b>${esc(f.name)}</b>${f.cagr5 == null ? ' <span class="tag warn">&lt; 5 yr history</span>' : ""}</td><td class="r">${sp(f.cagr1)}</td><td class="r">${sp(f.cagr3)}</td><td class="r">${sp(f.cagr5)}</td><td class="r">${sp(f.real5)}</td><td class="r">${pct(f.rolling3y && f.rolling3y.median)}</td><td class="r">${sp(f.rolling3y && f.rolling3y.min)}</td><td class="r">${f.rolling3y ? (f.rolling3y.beatInflationPct * 100).toFixed(0) + "%" : "—"}</td><td class="r">${pct(f.volatility)}</td><td class="r down">${pct(f.maxDrawdown5y)}</td></tr>`).join("")}</tbody></table></div>
          <div class="sm muted" style="margin-top:10px">Not in free data: expense ratio, holdings, AUM, manager tenure — check the AMC factsheet. Funds under 5 years old rank on 3-yr data with a 3-point penalty.</div></div>`;
        $$("tr[data-code]", $("#mfDetail")).forEach((tr) => (tr.onclick = () => go("#/fund/" + tr.dataset.code))); flush();
      } catch (e) { $("#mfDetail").innerHTML = `<div class="note warn" style="margin-top:18px">${esc(e.message)}</div>`; }
      b.disabled = false; b.textContent = "Rank this category";
    };
  };
  V.fund = async (r) => {
    const d = await api("/api/mf/scheme/" + r.arg), s = d.stats || {}; live(r);
    setTitle("Fund");
    const chart = d.chart || [];
    view().innerHTML = `${head(esc(d.scheme.name), `${esc(d.scheme.amc || (d.meta && d.meta.fund_house) || "")} · NAV ₹${num(s.nav, 4)} on ${dt(s.navDate)} · history since ${dt(s.historyFrom)}`, `<a class="btn" href="#/funds">← Funds</a><a class="btn pri" href="#/portfolio?mf=${esc(r.arg)}">+ Add to portfolio</a>`, esc(d.scheme.category || (d.meta && d.meta.scheme_category) || "Mutual fund"))}
      <div class="grid g4">${[[1, "1 year"], [3, "3 years"], [5, "5 years"], [10, "10 years"]].map(([y, l]) => `<div class="card kpi"><div class="k">${l} CAGR</div><div class="v">${sp(s["cagr" + y])}</div><div class="d">real ${sp(s["real" + y])}</div></div>`).join("")}</div>
      <div class="card"><div class="card-h"><h2>NAV history</h2><div class="seg" id="frng" style="margin-left:auto">${[["1Y", 1], ["3Y", 3], ["5Y", 5], ["All", 99]].map(([l, n]) => `<button data-y="${n}" class="${n === 99 ? "on" : ""}">${l}</button>`).join("")}</div></div><div id="fch">${areaChart(chart, { fmtV: (v) => num(v, 1) })}</div></div>
      <div class="grid g3">
        <div class="card" style="text-align:center"><div class="card-h"><h2>Beat inflation</h2></div>${s.rolling3y ? `${ring(s.rolling3y.beatInflationPct * 100, 130, "of 3-yr periods")}<div class="sm muted" style="margin-top:8px">Rolling 3-year returns beat ${pct(d.inflation)} inflation in ${(s.rolling3y.beatInflationPct * 100).toFixed(0)}% of ${s.rolling3y.count} monthly windows.</div>` : '<div class="empty">Under 3 years of history.</div>'}</div>
        <div class="card"><div class="card-h"><h2>Consistency</h2></div>${s.rolling3y ? `<div class="kv"><div class="k">Worst 3-yr</div><div>${sp(s.rolling3y.min)}</div><div class="k">Median 3-yr</div><div>${sp(s.rolling3y.median)}</div><div class="k">Best 3-yr</div><div>${sp(s.rolling3y.max)}</div><div class="k">Volatility</div><div>${pct(s.volatility)} / yr</div><div class="k">Max drawdown (5y)</div><div class="down">${pct(s.maxDrawdown5y)}</div><div class="k">Risk-adjusted*</div><div>${num(s.sharpeLike, 2)}</div></div>` : '<div class="empty">—</div>'}</div>
        <div class="card"><div class="card-h"><h2>Sources & gaps</h2></div><div class="srcs" style="margin-top:0">${d.sources.map((x) => `<div><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.name)}</a></div>`).join("")}</div><div class="sm muted" style="margin-top:10px">Not available free: expense ratio, holdings, AUM, manager tenure. *Uses an assumed 6.5% risk-free rate.</div></div></div>`;
    $("#frng").onclick = (e) => { const b = e.target.closest("[data-y]"); if (!b) return; $$("#frng button").forEach((x) => x.classList.toggle("on", x === b)); const y = +b.dataset.y, cut = new Date(); cut.setFullYear(cut.getFullYear() - y); const c = cut.toISOString().slice(0, 10); $("#fch").innerHTML = areaChart(y >= 99 ? chart : chart.filter((p) => p[0] >= c), { fmtV: (v) => num(v, 1) }); flush(); };
  };

  // =====================================================================
  // PORTFOLIO
  // =====================================================================
  const KINDS = { stock: "Stock", mf: "Mutual fund", cash: "Cash / FD", gold: "Gold", other: "Other" };
  V.portfolio = async (r) => {
    setTitle("Portfolio");
    const pv = await api("/api/portfolio"), pre = r.q.get("mf"); live(r);
    const kindSegs = Object.entries(pv.byKind).map(([k, v], i) => ({ label: KINDS[k], value: v, color: PALETTE[i] }));
    const secSegs = Object.entries(pv.bySector).sort((a, b) => b[1] - a[1]).map(([k, v], i) => ({ label: k, value: v, color: PALETTE[i % PALETTE.length] }));
    const invested = pv.holdings.reduce((s, h) => s + (h.invested || 0), 0);
    view().innerHTML = `${head("My portfolio", "Stored only on this computer. Values use the latest fetched price or NAV.", `<button class="btn pri" id="addOpen">+ Add holding</button>`, "Holdings")}
      <div class="grid g4">
        <div class="card kpi"><div class="k">Current value</div><div class="v" data-count="${pv.total || 0}" data-fmt="inr">${inr(pv.total)}</div><div class="d">${invested ? `${sp(pv.total / invested - 1)} on ${inrC(invested)} invested` : "—"}</div></div>
        <div class="card kpi"><div class="k">Est. real return / yr</div><div class="v">${sp(pv.expReal)}</div><div class="d">covers ${(pv.expCoverage * 100).toFixed(0)}% of value</div></div>
        <div class="card kpi"><div class="k">Inflation assumption</div><div class="v">${pct(pv.inflation)}</div><div class="d"><a href="#/settings">change</a></div></div>
        <div class="card kpi"><div class="k">Holdings</div><div class="v">${pv.holdings.length}</div><div class="d">${Object.keys(pv.bySector).length} sectors / categories</div></div></div>
      <div class="card" id="addCard" ${pre ? "" : "hidden"}><div class="card-h"><h2>Add a holding</h2><button class="btn ghost sm" id="addClose" style="margin-left:auto">✕</button></div>
        <div class="seg" id="kseg" style="margin-bottom:14px">${Object.entries(KINDS).map(([k, l]) => `<button data-k="${k}" class="${(pre ? "mf" : "stock") === k ? "on" : ""}">${l}</button>`).join("")}</div>
        <div class="row" id="pf"></div></div>
      ${pv.warnings.length ? `<div class="note warn" style="margin-top:18px"><b>Checks</b><ul class="reasons">${pv.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul></div>` : ""}
      ${pv.holdings.length ? `<div class="grid g2"><div class="card"><div class="card-h"><h2>By asset type</h2></div>${donut(kindSegs, { center: inrC(pv.total) })}</div><div class="card"><div class="card-h"><h2>By sector / category</h2></div>${donut(secSegs, { center: secSegs.length + " groups" })}</div></div>` : ""}
      <div class="card"><div class="card-h"><h2>Holdings</h2></div>${pv.holdings.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Holding</th><th>Type</th><th class="r">Qty</th><th class="r">Invested</th><th class="r">Current</th><th class="r">Gain</th><th class="r">Est. real/yr</th><th>Screen</th><th></th></tr></thead><tbody>
        ${pv.holdings.map((h) => `<tr><td>${h.kind === "stock" ? `<a href="#/stock/${encodeURIComponent(h.ref)}"><b>${esc(h.ref)}</b></a> <span class="muted sm">${esc(h.name)}</span>` : h.kind === "mf" ? `<a href="#/fund/${esc(h.ref)}">${esc(h.name)}</a>` : `<b>${esc(h.name)}</b>`}<div class="muted sm">${esc(h.sector || "")}${h.notes ? " · " + esc(h.notes) : ""}</div></td><td>${KINDS[h.kind]}</td><td class="r">${h.qty ? num(h.qty, h.kind === "mf" ? 3 : 0) : "—"}</td><td class="r">${inr(h.invested)}</td><td class="r">${inr(h.current)}</td><td class="r">${sp(h.gain)}</td><td class="r" title="${esc(h.basis)}">${sp(h.expReal)}</td><td>${h.label ? pill(h.label) : ""}</td><td class="r"><button class="btn ghost sm danger" data-del="${h.id}" title="Remove">✕</button></td></tr>`).join("")}</tbody></table></div>
        <div class="sm muted" style="margin-top:10px">Est. real return: stocks use their base-case 5-yr scenario; funds their historical 5-yr real CAGR (not a forecast); cash/FD a rate written in notes like “@ 7.1%”.</div>`
        : `<div class="empty"><span class="em">▤</span>No holdings yet.<div style="margin-top:12px"><button class="btn pri" id="addOpen2">+ Add your first holding</button></div></div>`}</div>`;
    let kind = pre ? "mf" : "stock", mfCode = pre || "";
    const fields = () => {
      const f = (l, h) => `<div class="field">${l}${h}</div>`;
      $("#pf").innerHTML = (kind === "stock" ? f("NSE symbol", '<input id="pr" placeholder="e.g. TCS" style="width:150px">') : kind === "mf" ? f("Fund", '<div style="position:relative"><input id="pr" placeholder="Search fund name" style="width:340px"><div id="mfPick" class="palette-list" style="position:absolute;z-index:20;top:42px;left:0;right:0;background:var(--card-solid);border:1px solid var(--line-2);border-radius:12px;max-height:260px" hidden></div></div>') : f("Name", '<input id="pr" placeholder="e.g. SBI FD" style="width:200px">'))
        + (kind === "stock" ? f("Quantity", '<input id="pq" type="number" min="0" step="1" style="width:110px">') : kind === "mf" ? f("Units", '<input id="pq" type="number" min="0" step="0.001" style="width:120px">') : "")
        + (kind === "stock" ? f("Avg buy price ₹", '<input id="pc" type="number" min="0" step="0.01" style="width:130px">') : kind === "mf" ? f("Avg NAV paid ₹", '<input id="pc" type="number" min="0" step="0.0001" style="width:130px">') : f("Invested ₹", '<input id="pc" type="number" min="0" style="width:130px">'))
        + (kind === "stock" || kind === "mf" ? "" : f("Current value ₹", '<input id="pvv" type="number" min="0" style="width:140px">'))
        + f("Notes", '<input id="pn" placeholder="e.g. FD @ 7.1%" style="width:170px">') + '<button class="btn pri" id="pAdd">Add</button>';
      if (kind === "mf") {
        const inp = $("#pr"), pop = $("#mfPick"); let tm;
        if (pre) api("/api/mf/scheme/" + pre).then((d) => (inp.value = d.scheme.name)).catch(() => {});
        inp.oninput = () => { mfCode = ""; clearTimeout(tm); tm = setTimeout(async () => { if (inp.value.trim().length < 2) { pop.hidden = true; return; } const d = await api("/api/mf/search?q=" + encodeURIComponent(inp.value.trim())); pop.hidden = !d.items.length; pop.innerHTML = d.items.slice(0, 12).map((x) => `<div class="it" data-c="${x.code}" data-n="${esc(x.name)}"><div>${esc(x.name)}</div><span class="meta muted sm">₹${num(x.nav, 2)}</span></div>`).join(""); $$(".it", pop).forEach((el) => (el.onmousedown = (e) => { e.preventDefault(); mfCode = el.dataset.c; inp.value = el.dataset.n; pop.hidden = true; })); }, 220); };
        inp.onblur = () => setTimeout(() => (pop.hidden = true), 150);
      }
      $("#pAdd").onclick = async () => {
        const body = { kind, ref: kind === "mf" ? mfCode : $("#pr").value, name: $("#pr").value, qty: +(($("#pq") || {}).value || 0), cost: +(($("#pc") || {}).value || 0), value: +(($("#pvv") || {}).value || 0), notes: $("#pn").value };
        if (kind === "mf" && !mfCode) return toast("Pick the fund from the dropdown list", true);
        const b = $("#pAdd"); b.disabled = true; b.innerHTML = '<span class="spin"></span>';
        try { await api("/api/portfolio", { method: "POST", body }); toast("Holding added"); go("#/portfolio"); router(); } catch (e) { toast(e.message, true); b.disabled = false; b.textContent = "Add"; }
      };
    };
    fields();
    const open = () => { $("#addCard").hidden = false; $("#addCard").scrollIntoView({ behavior: "smooth", block: "center" }); setTimeout(() => $("#pr") && $("#pr").focus(), 300); };
    $("#addOpen").onclick = open; const a2 = $("#addOpen2"); if (a2) a2.onclick = open; $("#addClose").onclick = () => ($("#addCard").hidden = true);
    $("#kseg").onclick = (e) => { const b = e.target.closest("[data-k]"); if (!b) return; kind = b.dataset.k; mfCode = ""; $$("#kseg button").forEach((x) => x.classList.toggle("on", x === b)); fields(); };
    $$("[data-del]").forEach((b) => (b.onclick = async () => { if (!confirm("Remove this holding?")) return; await api("/api/portfolio/" + b.dataset.del, { method: "DELETE" }); router(); }));
  };

  // =====================================================================
  // VC
  // =====================================================================
  V.vc = async (r) => {
    setTitle("Startups & VC");
    const days = +r.q.get("days") || 120, d = await api("/api/vc?days=" + days); live(r);
    const total = d.sectors.reduce((s, x) => s + x.usdMn, 0);
    const MAP = { "Industrial / Manufacturing": "Capital Goods", "Fintech": "Financial Services", "Consumer / D2C": "Fast Moving Consumer Goods", "Quick & e-commerce": "Consumer Services", "EV / Mobility": "Automobile and Auto Components", "Climate / Energy": "Power", "Healthtech": "Healthcare", "SaaS / Enterprise": "Information Technology", "AI / Deeptech": "Information Technology", "Real estate / Proptech": "Realty", "Gaming / Media": "Media Entertainment & Publication", "Edtech": "Consumer Services" };
    view().innerHTML = `${head("Startups & venture capital", `Funding rounds parsed from ${d.fromHeadlines} startup headlines (Inc42, Entrackr, ET Tech).`, `<div class="seg">${[30, 90, 120].map((x) => `<a href="#/vc?days=${x}" class="${x === days ? "on" : ""}">${x} days</a>`).join("")}</div>`, "Early signals")}
      <div class="grid g4"><div class="card kpi"><div class="k">Disclosed funding</div><div class="v">$${num(total, 0)}M</div><div class="d">≈ ₹${num(total * 88 / 10, 0)} cr</div></div><div class="card kpi"><div class="k">Startup rounds</div><div class="v">${d.deals.length}</div><div class="d">${days} days</div></div><div class="card kpi"><div class="k">Upcoming IPOs</div><div class="v">${d.ipos.length}</div><div class="d">anchor-book news</div></div><div class="card kpi"><div class="k">VC funds raising</div><div class="v">${d.funds.length}</div><div class="d">new corpuses</div></div></div>
      <div class="note warn">Headline-based and approximate: ₹ converted at ≈ ₹88/$, undisclosed rounds counted but not summed. Use it to spot <b>sectors</b> attracting capital, then look at listed companies in those sectors.</div>
      <div class="grid g-21"><div class="card"><div class="card-h"><h2>Money by sector</h2></div>${d.sectors.length ? hbars(d.sectors.map((s) => [s.sector, s.usdMn, `$${num(s.usdMn, 0)}M · ${s.deals}`])) : '<div class="empty">No deals parsed yet.</div>'}
          <div style="margin-top:14px">${d.sectors.slice(0, 6).filter((s) => MAP[s.sector]).map((s) => `<a class="btn sm" style="margin:3px" href="#/discover?tab=all&industry=${encodeURIComponent(MAP[s.sector])}">${esc(s.sector)} → listed peers</a>`).join("")}</div></div>
        <div class="card"><div class="card-h"><h2>Active lead investors</h2></div>${d.investors.length ? d.investors.map(([n, c]) => `<span class="chip" style="margin:3px">${esc(n)}${c > 1 ? " ×" + c : ""}</span>`).join("") : '<div class="empty">Few headlines name lead investors.</div>'}</div></div>
      <div class="grid g2"><div class="card"><div class="card-h"><h2>Upcoming IPOs</h2><span class="hint">the earliest retail entry point</span></div>${d.ipos.length ? miniDeals(d.ipos) : '<div class="empty">None in this period.</div>'}</div>
        <div class="card"><div class="card-h"><h2>VC funds raising money</h2></div>${d.funds.length ? miniDeals(d.funds) : '<div class="empty">None in this period.</div>'}</div></div>
      <div class="card"><div class="card-h"><h2>Funding rounds</h2></div><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Date</th><th>Company</th><th>Sector</th><th>Stage</th><th class="r">Amount</th><th>Lead</th><th></th></tr></thead><tbody>
        ${d.deals.map((x) => `<tr><td class="sm muted">${dt(x.published)}</td><td><b>${esc(x.company)}</b><div class="muted sm" style="max-width:420px">${esc(x.title.slice(0, 110))}</div></td><td><span class="tag">${esc(x.sector)}</span></td><td>${esc(x.stage || "—")}</td><td class="r">${x.amount != null ? `${x.currency === "USD" ? "$" : "₹"}${num(x.amount, 1)} ${esc(x.unit || "")}` : "undisclosed"}${x.usdMn ? `<div class="muted sm">≈$${num(x.usdMn, 1)}M</div>` : ""}</td><td class="sm">${esc(x.leadInvestor || "—")}</td><td><a class="sm" href="${esc(x.link)}" target="_blank" rel="noopener">${esc(x.source)} ↗</a></td></tr>`).join("")}</tbody></table></div></div>`;
  };
  const miniDeals = (l) => `<table class="tbl"><tbody>${l.map((x) => `<tr><td><b>${esc(x.company)}</b><div class="muted sm">${dt(x.published)} · ${esc(x.sector)}</div></td><td class="r">${x.usdMn ? "≈$" + num(x.usdMn, 0) + "M" : "—"}</td><td class="r"><a class="sm" href="${esc(x.link)}" target="_blank" rel="noopener">${esc(x.source)} ↗</a></td></tr>`).join("")}</tbody></table>`;

  // =====================================================================
  // NEWS · ALERTS
  // =====================================================================
  V.news = async (r) => {
    setTitle("News");
    const kind = r.q.get("kind") || "market", d = await api("/api/news?kind=" + kind); live(r);
    view().innerHTML = `${head("News", "Public RSS feeds, refreshed every 2 hours. Headlines are matched to listed companies by name.", `<div class="seg"><a href="#/news?kind=market" class="${kind === "market" ? "on" : ""}">Markets & companies</a><a href="#/news?kind=startup" class="${kind === "startup" ? "on" : ""}">Startups & VC</a></div><button class="btn" id="nRef">↻ Refresh</button>`, "Live feeds")}
      ${d.items.length ? `<div class="newsgrid">${d.items.map((n) => `<div class="news"><a class="t" href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.title)}</a>${n.summary ? `<div class="sm soft" style="display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden">${esc(n.summary)}</div>` : ""}<div>${(n.symbols || "").split(",").filter(Boolean).map((s) => `<a class="chip" href="#/stock/${encodeURIComponent(s)}">${esc(s)}</a>`).join("")}</div><div class="s">${esc(n.source)} · ${ago(n.published)}</div></div>`).join("")}</div>` : '<div class="card"><div class="empty">No news yet.</div></div>'}`;
    $("#nRef").onclick = async () => { await api("/api/refresh/news", { method: "POST", body: {} }); toast("Refreshing news…"); setTimeout(router, 6000); };
  };
  V.alerts = async (r) => {
    setTitle("Alerts");
    const d = await api("/api/alerts"); live(r);
    view().innerHTML = `${head("Alerts", "Screen changes, new red flags, sharp price falls and news for stocks you hold or watch.", `<button class="btn" id="markAll">✓ Mark all read</button>`, "Notifications")}
      <div class="card">${d.items.length ? `<div class="timeline">${d.items.map(alertItem).join("")}</div>` : '<div class="empty"><span class="em">🔔</span>No alerts yet. Add holdings or watch stocks to get personal alerts.</div>'}</div>`;
    $("#markAll").onclick = async () => { await api("/api/alerts/read", { method: "POST", body: {} }); await refreshStatus(); router(); };
  };

  // =====================================================================
  // REPORT
  // =====================================================================
  V.report = async (r) => {
    setTitle("Report");
    const [rep, notes] = await Promise.all([api("/api/report"), api("/api/ai/notes?subject=BRIEF")]); live(r);
    const sec = (title, items, blurb, l) => `<div class="card"><div class="card-h"><h2>${title}</h2>${l ? pill(l) : ""}<span class="hint">${items.length} shown</span></div><div class="sm muted" style="margin:-6px 0 12px">${blurb}</div>${items.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Company</th><th>Why</th><th class="r">Base / bear real</th><th>Portfolio fit</th></tr></thead><tbody>${items.map((x) => `<tr class="go" data-sym="${esc(x.symbol)}"><td style="min-width:150px"><b>${esc(x.symbol)}</b>${x.watched ? ' <span class="tag">★</span>' : ""}<div class="muted sm">${esc(x.industry)}</div>${tagsHtml(x.tags, 2)}</td><td class="sm soft">${(x.reasons || []).map(esc).join("<br>")}</td><td class="r">${sp(x.baseReal)} / ${sp(x.bearReal)}</td><td class="sm soft">${esc(x.fit.text)}</td></tr>`).join("")}</tbody></table></div>` : '<div class="empty">None.</div>'}</div>`;
    view().innerHTML = `${head("Research report", `Generated ${dtt(rep.generatedAt)} · ${rep.universe} companies · inflation ${pct(rep.inflation.value)} (${esc(rep.inflation.basis)})`, `<button id="briefBtn" class="btn pri noprint">✦ Write AI weekly brief</button><button class="btn noprint" onclick="window.print()">⎙ Print / PDF</button>`, "What to do and why")}
      <div class="grid g4">${["buy", "watch", "investigate", "avoid"].map((l) => `<div class="card kpi"><div class="k">${LABEL[l]}</div><div class="v" style="color:var(${LCOL[l]})">${rep.counts[l] || 0}</div></div>`).join("")}</div>
      <div class="card" id="briefCard"><div class="card-h"><h2>✦ AI weekly brief</h2></div><div id="briefBody">${notes.items.length ? noteHtml(notes.items[0]) : '<div class="empty">No brief yet — uses your free AI provider.</div>'}</div></div>
      ${rep.portfolio.warnings.length ? `<div class="note warn"><b>Portfolio:</b> ${rep.portfolio.warnings.map(esc).join(" ")}</div>` : ""}
      ${sec("What to consider buying", rep.buy, "Passed every quality, return and downside test. Still read the annual report and check governance first.", "buy")}
      ${sec("Emerging opportunities", rep.emerging, "Fast, accelerating, profitable growth in smaller companies — higher potential, higher risk. Size positions accordingly.")}
      ${sec("Watch", rep.watch, "Good businesses waiting for a better price, or decent ones without a compelling return yet.", "watch")}
      ${sec("Investigate further", rep.investigate, "Mixed signals that need your judgement.", "investigate")}
      ${sec("Avoid", rep.avoid, "Weak scores, critical red flags or poor downside protection.", "avoid")}
      <div class="disc">Produced by rules applied to free public data (Yahoo Finance, NSE, AMFI, World Bank, news RSS). Research, not personalised financial advice, and not from a SEBI-registered adviser. Scenario returns illustrate stated assumptions; they are not predictions.</div>`;
    wireCards(view());
    $("#briefBtn").onclick = async () => {
      const b = $("#briefBtn"); b.disabled = true; b.innerHTML = '<span class="spin"></span> Writing…';
      $("#briefBody").innerHTML = '<div class="empty"><span class="spin"></span> Writing the brief…</div>';
      try { const n = await api("/api/ai/brief", { method: "POST", body: {} }); $("#briefBody").innerHTML = noteHtml({ ...n, created_at: new Date().toISOString() }); } catch (e) { $("#briefBody").innerHTML = `<div class="note warn">${esc(e.message)} <a href="#/settings">Settings</a></div>`; }
      b.disabled = false; b.textContent = "✦ Write AI weekly brief";
    };
  };

  // =====================================================================
  // SETTINGS · METHOD
  // =====================================================================
  V.settings = async (r) => {
    setTitle("Settings");
    const [s, st, src] = await Promise.all([api("/api/settings"), api("/api/status"), api("/api/sources")]); live(r);
    const log = Object.fromEntries(st.logs.map((l) => [l.job, l]));
    const jobs = [["stocks", "Prices & financials", "Daily prices; financials weekly"], ["amfi", "Mutual-fund NAVs", "Daily"], ["news", "News & startup feeds", "Every 2 hours"], ["cpi", "Inflation (CPI)", "Monthly"], ["universe", "Nifty 500 list", "Monthly"]];
    view().innerHTML = `${head("Settings & data", 'Everything runs on this computer. Data lives in <span class="num" style="font-family:var(--mono)">data\\research.db</span>.', "", "Preferences")}
      <div class="card"><div class="card-h"><h2>Your investing profile</h2><span class="hint">used for the suggested amount and buy-below price on each company</span></div>
        <div class="row" style="align-items:flex-end;gap:18px"><div class="field">Total you plan to invest in stocks (₹)<input id="budgetIn" type="number" min="0" step="1000" placeholder="e.g. 500000" value="${esc(s.investAmount || "")}" style="width:220px"></div>
          <div class="field">Return you want above inflation (% a year)<input id="targetIn" type="number" min="0" max="20" step="0.5" value="${esc(s.targetReal || "6")}" style="width:120px"></div></div>
        <div class="row" id="riskSel" style="margin-top:14px">${[["careful", "Careful", "Max 3% of budget per company"], ["balanced", "Balanced", "Max 5% per company"], ["adventurous", "Adventurous", "Max 8% per company"]].map(([k, l, d]) => `<label class="optcard${(s.riskProfile || "balanced") === k ? " on" : ""}"><input type="radio" name="risk" value="${k}"${(s.riskProfile || "balanced") === k ? " checked" : ""}><div><b>${l}</b><span>${d}</span></div></label>`).join("")}</div>
        <div class="sm muted" style="margin-top:10px">A higher target return means lower buy-below prices (you wait for cheaper entries). Long-run Indian stocks have returned roughly 6–7% a year above inflation — expecting much more usually means taking more risk.</div>
        <button class="btn pri" id="saveProfile" style="margin-top:14px">Save profile</button></div>
      <div class="card"><div class="card-h"><h2>Free AI provider</h2><span class="hint">AI: ${st.ai.provider === "off" ? "off" : esc(st.ai.provider) + (st.ai.configured ? " ✓" : "")}</span></div>
        <div class="row" id="aip">${[["off", "Off", "Scores & scenarios still work"], ["gemini", "Google Gemini", "Free tier · best quality"], ["ollama", "Ollama", "Local & private · slow on this PC"]].map(([v, l, d]) => `<label class="optcard${s.aiProvider === v ? " on" : ""}"><input type="radio" name="aip" value="${v}"${s.aiProvider === v ? " checked" : ""}><div><b>${l}</b><span>${d}</span></div></label>`).join("")}</div>
        <div id="aiG" style="margin-top:16px"><div class="row"><div class="field" style="flex:1;min-width:260px">Gemini API key<input id="gk" type="password" placeholder="paste key from aistudio.google.com/apikey" value="${esc(s.geminiKey)}"></div><div class="field">Model<input id="gm" value="${esc(s.geminiModel)}" style="width:210px"></div></div>
          <label class="chk" style="margin-top:12px"><input type="checkbox" id="gg"${s.geminiGrounding === "1" ? " checked" : ""}> Google Search grounding (live web citations) — <span class="muted">often has no free quota; the app turns it off automatically if Google refuses</span></label>
          <div class="sm muted" style="margin-top:8px">Free key: <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a> → Create API key. Leave the model as <b>gemini-flash-latest</b> — it always points at Google's current model, and the app falls back automatically if a model is retired. Free-tier prompts may be used by Google to improve its products; stock notes contain only public company data.</div></div>
        <div id="aiO" style="margin-top:16px"><div class="row"><div class="field">Ollama URL<input id="ou" value="${esc(s.ollamaUrl)}"></div><div class="field">Model<input id="om" value="${esc(s.ollamaModel)}"></div></div><div class="sm muted" style="margin-top:8px">Install from ollama.com, then run <b>ollama pull llama3.2:3b</b>. Private and free, but slow without a GPU.</div></div>
        <div class="row" style="margin-top:16px;align-items:center"><button class="btn pri" id="saveAi">Save</button><button class="btn" id="testAi">Test connection</button><span id="aiMsg" class="sm"></span></div></div>
      <div class="card"><div class="card-h"><h2>Assumptions</h2></div><div class="row" style="align-items:center"><div class="field">Expected inflation % / yr<input id="infl" type="number" step="0.1" placeholder="${(st.inflation.value * 100).toFixed(2)}" value="${esc(s.inflationOverride)}" style="width:150px"></div><button class="btn" id="saveInfl">Save</button><div class="sm muted" style="max-width:560px">Blank = ${esc(st.inflation.basis)}. RBI targets 4% (band 2–6%). Changing it recalculates every screen.</div></div>
        <label class="chk" style="margin-top:14px"><input type="checkbox" id="autoR"${s.autoRefresh === "1" ? " checked" : ""}> Refresh data automatically while the app is running</label></div>
      <div class="card"><div class="card-h"><h2>Data jobs</h2></div><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Job</th><th>Schedule</th><th>Last run</th><th>Result</th><th></th></tr></thead><tbody>
        ${jobs.map(([k, l, sch]) => `<tr><td><b>${l}</b></td><td class="sm muted">${sch}</td><td class="sm">${log[k] ? ago(log[k].finished_at || log[k].started_at) : "never"}</td><td class="sm soft">${log[k] ? (log[k].status === "ok" ? '<span class="up">●</span> ' : log[k].status === "running" ? '<span class="spin"></span> ' : '<span class="down">●</span> ') + esc((log[k].message || "").slice(0, 110)) : "—"}</td><td class="r"><button class="btn sm" data-job="${k}">Run now</button></td></tr>`).join("")}
        <tr><td><b>Recalculate scores</b></td><td class="sm muted">after every refresh</td><td></td><td class="sm soft">${st.counts.analysed} analysed · ${st.counts.fundErrors} without financials</td><td class="r"><button class="btn sm" data-job="analysis">Run now</button></td></tr></tbody></table></div></div>
      <div class="card"><div class="card-h"><h2>Data sources</h2></div><div class="kv">
        <div class="k">Universe</div><div><a href="${esc(src.sources.nifty500)}" target="_blank" rel="noopener">NSE Nifty 500 constituents</a> (official)</div>
        <div class="k">Prices</div><div>Yahoo Finance chart API (unofficial, delayed)</div><div class="k">Financials</div><div>Yahoo Finance fundamentals — 4 annual years (unofficial)</div>
        <div class="k">Mutual funds</div><div><a href="${esc(src.sources.amfi)}" target="_blank" rel="noopener">AMFI NAVAll.txt</a> + mfapi.in history</div>
        <div class="k">Inflation</div><div><a href="${esc(src.sources.cpi)}" target="_blank" rel="noopener">World Bank India CPI</a></div>
        <div class="k">News</div><div>${src.feeds.map((f) => `<a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.name)}</a>`).join(" · ")}</div></div></div>`;
    const showAi = () => { const v = $("input[name=aip]:checked").value; $("#aiG").style.display = v === "gemini" ? "" : "none"; $("#aiO").style.display = v === "ollama" ? "" : "none"; $$("#aip .optcard").forEach((c) => c.classList.toggle("on", c.querySelector("input").checked)); };
    $$("input[name=aip]").forEach((x) => (x.onchange = showAi)); showAi();
    const saveAi = () => api("/api/settings", { method: "POST", body: { aiProvider: $("input[name=aip]:checked").value, geminiKey: $("#gk").value.trim(), geminiModel: $("#gm").value.trim() || "gemini-flash-latest", geminiGrounding: $("#gg").checked ? "1" : "0", ollamaUrl: $("#ou").value.trim(), ollamaModel: $("#om").value.trim() } });
    $("#saveAi").onclick = async () => { try { await saveAi(); toast("Saved"); refreshStatus(); } catch (e) { toast(e.message, true); } };
    $("#testAi").onclick = async () => { $("#aiMsg").innerHTML = '<span class="spin"></span> Testing…'; try { await saveAi(); const r = await api("/api/ai/test", { method: "POST", body: {} }); $("#aiMsg").innerHTML = `<span class="up">✓ ${esc(r.provider)} replied “${esc(r.reply)}”</span>`; refreshStatus(); } catch (e) { $("#aiMsg").innerHTML = `<span class="down">${esc(e.message)}</span>`; } };
    $$("input[name=risk]").forEach((x) => (x.onchange = () => $$("#riskSel .optcard").forEach((c) => c.classList.toggle("on", c.querySelector("input").checked))));
    $("#saveProfile").onclick = async () => { await api("/api/settings", { method: "POST", body: { investAmount: $("#budgetIn").value, targetReal: $("#targetIn").value || "6", riskProfile: $("input[name=risk]:checked").value } }); toast("Profile saved — verdicts recalculated"); };
    $("#saveInfl").onclick = async () => { await api("/api/settings", { method: "POST", body: { inflationOverride: $("#infl").value } }); toast("Saved — screens recalculated"); refreshStatus(); };
    $("#autoR").onchange = async (e) => { await api("/api/settings", { method: "POST", body: { autoRefresh: e.target.checked ? "1" : "0" } }); toast("Saved"); };
    $$("[data-job]").forEach((b) => (b.onclick = async () => { await api("/api/refresh/" + b.dataset.job, { method: "POST", body: {} }); toast("Started " + b.dataset.job); refreshStatus(); setTimeout(router, 1500); }));
  };

  V.method = async () => {
    setTitle("Method & limits");
    const c = (t, b) => `<div class="card"><div class="card-h"><h2>${t}</h2></div><div class="soft">${b}</div></div>`;
    view().innerHTML = `${head("How it works — and what it can't do", "Every number is calculated from public data with stated rules. Here they are.", "", "Method")}
      <div class="grid g2">
      ${c("1 · What's analysed", "The Nifty 500 (≈ 93% of Indian market value) plus any NSE stock you add, every mutual fund AMFI publishes, and startup funding rounds in the news. Data refreshes automatically while the app runs.")}
      ${c("2 · Scores (0–100)", "Each metric becomes a percentile rank against the universe — valuation against the company's own industry when it has 8+ peers. Composite = <b>Quality 35% · Growth 25% · Value 25% · Safety 15%</b>. Quality: ROE, ROCE, cash conversion, debt, interest cover, margin stability (banks use ROE/ROA). Growth: revenue & profit CAGR, acceleration, margin trend. Value: earnings & FCF yield, P/B, PEG. Safety: drawdown, net cash, minus red-flag penalties.")}
      ${c("3 · Red flags", "Losses, profit without operating cash flow, high leverage, thin interest cover, weak cash conversion, receivables outgrowing revenue, dilution, shrinking margins or revenue, extreme valuation, unsustainable payouts, one-off gains inflating profit, and cyclical-peak warnings.")}
      ${c("4 · Five-year scenarios", "Return/yr = (EPS × (1+g)⁵ × exit P/E ÷ price)^(1/5) − 1 + dividend yield; real = (1+nominal)/(1+inflation) − 1. Base growth blends 60% of recent growth (70% revenue, 30% profit) with a 10% long-run rate, capped at 15% (8% for cyclicals). Exit P/E reverts asymmetrically: expensive stocks halfway to the industry median, cheap ones only 30%. One-off profits are normalised. Everything is editable per stock. <b>Illustrations, not forecasts.</b>")}
      ${c("5 · Labels", "<b>Buy candidate</b>: composite ≥ 60, quality ≥ 55, base real ≥ 5%/yr, bear real ≥ −5%/yr, no critical flag. <b>Watch</b>: high quality but pricey, or decent without a compelling return. <b>Investigate</b>: red flag on a strong company, growth with weak quality, one-off profits, missing data. <b>Avoid</b>: weak composite, critical flag with low quality, or a poor bear case without the quality to justify it.")}
      ${c("6 · Known limits", "Free data is unofficial (bank equity can differ from the annual report) and only 4 years deep. Not checked: promoter pledging, related-party deals, auditor changes, contingent liabilities, NPAs, quarterly results. Funds: no expense ratio, holdings or AUM. VC: headline-based only — deal databases are paid. Free AI can be wrong. Taxes, costs and your personal situation aren't modelled.")}
      </div><div class="disc">A personal research tool built on public data. Not investment advice, not from a SEBI-registered adviser, and it does not promise or predict returns.</div>`;
  };

  // =====================================================================
  // shared helpers for feature modules (smartmoney.js)
  window.CMP = { V, api, esc, isNum, pct, sp, num, inr, inrC, crs, dt, dtt, ago, head, ring, bars, donut, hbars, pill, actPill, tagsHtml, sbar, toast, go, live, flush, mount, showTip, hideTip, md, noteHtml, route, $, $$, PALETTE, LABEL, LCOL, setTitle, g, disc, view, areaChart, spark };
  window.addEventListener("hashchange", router);
  refreshStatus().then(router).then(() => loadSyms().catch(() => {}));
  setInterval(refreshStatus, 10000);
})();
