// ==UserScript==
// @name         Săn Vé Rẻ — airbookingonline
// @namespace    san-ve-re
// @version      1.0.0
// @description  Quét giá nhiều chặng × nhiều ngày, tìm chuyến bay rẻ nhất trong tuần
// @match        https://airbookingonline.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';

  // ───────────────────────── Core (không phụ thuộc DOM) ─────────────────────────

  const pad = n => String(n).padStart(2, '0');
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const dmy = d => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  const parseIso = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const WEEKDAY = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

  function parseRoutes(text) {
    const out = [], seen = new Set();
    for (const m of String(text).matchAll(/([A-Za-z]{3})\s*(?:-|–|>|→|\s)\s*([A-Za-z]{3})/g)) {
      const from = m[1].toUpperCase(), to = m[2].toUpperCase(), k = `${from}-${to}`;
      if (from !== to && !seen.has(k)) { seen.add(k); out.push({ from, to, key: k }); }
    }
    return out;
  }

  /** Rút gọn JSON ApiSearch (vài MB) thành danh sách chuyến bay của đúng chặng/ngày. */
  function extract(json, route, dateIso) {
    const out = [];
    for (const g of json?.ArrivalFlights || []) {
      for (const it of [...(g.ArrivalFlightItems || []), ...(g.GlobalFlightItems || [])]) {
        const li = it?.LowestInventory;
        if (!li || it.DepartureCode !== route.from || it.ArrivalCode !== route.to) continue;
        if (String(it.DepartureDate1).slice(0, 10) !== dateIso) continue;
        // Giống cách trang hiển thị (sprice == 2): tổng giá + phí dịch vụ
        const price = (li.SumPrice || 0) + (li.SumTaxSales || 0);
        if (price <= 0) continue;
        const dep = new Date(it.DepartureDate1), arr = new Date(it.DepartureDate2);
        const segs = it.DepartureStopInfos || [];
        out.push({
          airline: it.Airline || g.Airline || json.Airline || '?',
          airlineName: it.FlightAirline || g.FlightAirline || '',
          no: (it.DepartureFlightNo || []).join(' + ') || segs.map(s => s.Airline + s.FlightNo).join(' + '),
          dep: it.DepartureDate1,
          arr: it.DepartureDate2,
          dur: arr > dep ? Math.round((arr - dep) / 60000) : segs.reduce((a, s) => a + (s.TotalDuration || 0), 0),
          stops: it.DepartureStopNo || Math.max(0, segs.length - 1),
          fare: li.FareType || '',
          cls: li.FareCode || '',
          price,
          oldPrice: li.SumPriceOld > li.SumPrice ? li.SumPriceOld + (li.SumTaxSales || 0) : 0,
        });
      }
    }
    return out;
  }

  /** Gộp trùng (cùng chuyến xuất hiện ở nhiều nguồn) — giữ giá thấp nhất, sắp xếp tăng dần. */
  function mergeFlights(list) {
    const best = new Map();
    for (const f of list) {
      const k = `${f.airline}|${f.no}|${f.dep}`;
      const cur = best.get(k);
      if (!cur || f.price < cur.price) best.set(k, f);
    }
    return [...best.values()].sort((a, b) => a.price - b.price || a.dep.localeCompare(b.dep));
  }

  if (typeof window === 'undefined') {
    module.exports = { extract, mergeFlights, parseRoutes };
    return;
  }

  // ───────────────────────── Tích hợp với airbookingonline ─────────────────────────

  if (location.origin !== 'https://airbookingonline.com') {
    alert('Hãy chạy Săn Vé Rẻ trên trang airbookingonline.com (đã đăng nhập).');
    return;
  }
  if (window.__SAN_VE_RE__) { window.__SAN_VE_RE__.open(); return; }

  const SITEKEY_DEFAULT = '6Le0v4shAAAAADYUZ70Lv3I4iP9EVDLF3gG42cxz';
  const CACHE_TTL = 30 * 60 * 1000;
  const LS_SETTINGS = 'sanvere:settings', LS_CACHE = 'sanvere:cache';

  const AIRPORTS_FALLBACK = {
    HAN: 'Hà Nội', HPH: 'Hải Phòng', DIN: 'Điện Biên Phủ', VDO: 'Vân Đồn', DAD: 'Đà Nẵng', CXR: 'Nha Trang',
    DLI: 'Đà Lạt', VII: 'Vinh', HUI: 'Huế', THD: 'Thanh Hóa', BMV: 'Buôn Ma Thuột', PXU: 'Pleiku', UIH: 'Quy Nhơn',
    VDH: 'Đồng Hới', TBB: 'Tuy Hòa', VCL: 'Chu Lai', PQC: 'Phú Quốc', VCS: 'Côn Đảo', VCA: 'Cần Thơ', CAH: 'Cà Mau',
    VKG: 'Rạch Giá', SGN: 'Hồ Chí Minh', HKG: 'Hồng Kông', BKK: 'Băng Cốc', SIN: 'Singapore', ICN: 'Seoul',
    NRT: 'Tokyo Narita', KIX: 'Osaka', TPE: 'Đài Bắc', PNH: 'Phnom Penh', REP: 'Siem Reap', KUL: 'Kuala Lumpur',
  };
  const AIRLINE_COLORS = { VJ: '#e4252b', VN: '#00718f', QH: '#1f9d55', VU: '#7b3fe4', BL: '#f08a24', '9G': '#f59e0b', '1G': '#64748b', '1A': '#64748b' };

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* quota / private mode */ } },
  };

  function airports() {
    const map = { ...AIRPORTS_FALLBACK };
    document.querySelectorAll('li.item-air[data-code][data-city]').forEach(li => { map[li.dataset.code] = li.dataset.city; });
    return map;
  }

  function siteKey() {
    const el = document.querySelector('[data-sitekey]');
    if (el?.dataset.sitekey) return el.dataset.sitekey;
    const s = [...document.scripts].map(s => s.src).find(s => /recaptcha\/api\.js\?render=/.test(s));
    return s ? new URL(s).searchParams.get('render') : SITEKEY_DEFAULT;
  }

  let recaptchaLoading;
  function loadRecaptcha(key) {
    if (window.grecaptcha?.execute) return Promise.resolve();
    return recaptchaLoading ||= new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = `https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(key)}`;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Không tải được reCAPTCHA'));
      document.head.appendChild(s);
    });
  }
  async function recaptchaToken(key) {
    await loadRecaptcha(key);
    await new Promise(r => window.grecaptcha.ready(r));
    return window.grecaptcha.execute(key, { action: 'homepage' });
  }

  /** Lấy mẫu form tìm vé (CSRF token, mã khuyến mãi của đại lý...) từ trang hiện tại hoặc trang chủ. */
  async function loadFormTemplate() {
    const pick = doc => doc.querySelector('#SearchProForm, form[action*="CreateProBooking"]');
    const docs = [document];
    let form = pick(document);
    for (const url of ['/', '/ProBooking/']) {
      if (form) break;
      try {
        const doc = new DOMParser().parseFromString(await (await fetch(url, { credentials: 'include' })).text(), 'text/html');
        docs.push(doc);
        form = pick(doc);
      } catch { /* thử URL tiếp theo */ }
    }
    if (!form) throw fatal('Không tìm thấy form tìm vé. Mở trang tìm chuyến bay (đã đăng nhập) rồi chạy lại.');
    const entries = [...new FormData(form)].filter(([, v]) => typeof v === 'string');
    const csrf = entries.find(([k]) => k === '__RequestVerificationToken');
    if (!csrf?.[1]) {
      const v = docs.map(d => d.querySelector('input[name="__RequestVerificationToken"]')?.value).find(Boolean);
      if (v) csrf ? (csrf[1] = v) : entries.unshift(['__RequestVerificationToken', v]);
    }
    return entries;
  }

  function buildSearchBody(tpl, route, date, pax, captcha, names) {
    const p = new URLSearchParams();
    const overridden = /^(g_recaptcha_response|TypeTrip|Calendar|adult|child|infant)$|^Flight|^Check/;
    const city = c => (names[c] || c).toLocaleUpperCase('vi');
    p.append('__RequestVerificationToken', tpl.find(([k]) => k === '__RequestVerificationToken')?.[1] || '');
    p.append('g_recaptcha_response', captcha);
    p.append('TypeTrip', 'O');
    p.append('Flight_0__departure', city(route.from));
    p.append('Flight[0].departureplace', `${city(route.from)} (${route.from})`);
    p.append('Flight[0].departurecode', route.from);
    p.append('Flight_0__arrival', city(route.to));
    p.append('Flight[0].arrivalplace', `${city(route.to)} (${route.to})`);
    p.append('Flight[0].arrivalcode', route.to);
    p.append('Flight[0].departuredate', dmy(date));
    p.append('Flight[0].arrivaldate', dmy(date));
    for (const [k, v] of tpl) if (k !== '__RequestVerificationToken' && !overridden.test(k)) p.append(k, v);
    if (!p.has('FlightType')) p.append('FlightType', '1');
    p.append('Calendar', 'false');
    p.append('adult', String(pax));
    p.append('child', '0');
    p.append('infant', '0');
    const checks = [...new Set(tpl.map(([k]) => k).filter(k => /^Check/.test(k)))];
    for (const k of checks.length ? checks : ['CheckALL', 'CheckVNA', 'CheckBBA', 'CheckVJ', 'CheckVU']) {
      if (k === 'CheckALL') p.append(k, 'true');
      p.append(k, 'false');
    }
    return p;
  }

  function fatal(msg) { const e = new Error(msg); e.fatal = true; return e; }

  /** 1 lượt tìm = tạo phiên (CreateProBooking) → lấy token từng hãng → gọi ApiSearch song song. */
  async function searchDay(ctx, route, date, onPartial) {
    const captcha = await recaptchaToken(ctx.sitekey);
    const res = await fetch('/CreateProBooking', {
      method: 'POST',
      credentials: 'include',
      signal: ctx.signal,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: buildSearchBody(ctx.tpl, route, date, ctx.pax, captcha, ctx.names),
    });
    if (/login/i.test(res.url)) throw fatal('Phiên đăng nhập đã hết — đăng nhập lại rồi bấm Quét tiếp.');
    const html = await res.text();
    const m = html.match(/Postresult\(\s*(\[\s*(?:"[^"]*"\s*,?\s*)*\])\s*\)/);
    if (!m) throw new Error('Server không trả phiên tìm kiếm (reCAPTCHA hoặc phiên bị từ chối)');
    const tokens = JSON.parse(m[1]);
    const all = [];
    await Promise.all(tokens.map(async token => {
      try {
        const r = await fetch('/ApiSearch/', {
          method: 'POST',
          credentials: 'include',
          signal: ctx.signal,
          headers: {
            'Content-Type': 'application/json; charset=UTF-8',
            'Accept': 'application/json, text/javascript, */*; q=0.01',
            'X-Requested-With': 'XMLHttpRequest',
          },
          body: JSON.stringify({ token }),
        });
        const txt = await r.text();
        if (!txt) return; // hãng không có chuyến
        const flights = extract(JSON.parse(txt), route, iso(date));
        all.push(...flights);
        onPartial(flights);
      } catch (e) {
        if (e.name === 'AbortError') throw e; // lỗi 1 hãng không làm hỏng cả lượt
      }
    }));
    return mergeFlights(all);
  }

  // ───────────────────────── State ─────────────────────────

  const today = new Date();
  const settings = Object.assign({
    routes: 'SGN-HAN, HAN-SGN, SGN-DAD',
    start: iso(today),
    days: 7,
    pax: 1,
    concurrency: 3,
    directOnly: false,
    useCache: true,
    sync: true,
    syncUrl: 'http://localhost:8787',
  }, store.get(LS_SETTINGS, {}));
  if (settings.start < iso(today)) settings.start = iso(today);

  const state = {
    routes: [], dates: [],
    cells: new Map(),        // `${route}|${date}` → {status, flights, err}
    running: false, ctrl: null,
    startedAt: 0, done: 0, total: 0,
    selected: null,          // {route, date}
    airlineFilter: new Set(),
    message: '',
    scanId: '',
    sync: '',              // '' | 'ok' | 'off' — trạng thái đẩy sang dashboard
  };

  const cache = store.get(LS_CACHE, {});
  const cacheKey = (r, d) => `${r}|${d}|${settings.pax}`;
  function cacheGet(r, d) {
    const c = cache[cacheKey(r, d)];
    return c && Date.now() - c.ts < CACHE_TTL ? c.flights : null;
  }
  function cachePut(r, d, flights) {
    for (const k of Object.keys(cache)) if (Date.now() - cache[k].ts > CACHE_TTL) delete cache[k];
    cache[cacheKey(r, d)] = { ts: Date.now(), flights: flights.slice(0, 40) };
    store.set(LS_CACHE, cache);
  }

  const visible = flights => flights.filter(f =>
    (!settings.directOnly || f.stops === 0) &&
    (state.airlineFilter.size === 0 || state.airlineFilter.has(f.airline)));

  // ───────────────────────── Runner ─────────────────────────

  async function run() {
    if (state.running) return;
    const routes = parseRoutes(settings.routes);
    if (!routes.length) { state.message = 'Nhập ít nhất 1 chặng, ví dụ: SGN-HAN'; return render(); }
    const days = Math.min(31, Math.max(1, settings.days | 0));
    const start = parseIso(settings.start);
    state.routes = routes;
    state.dates = Array.from({ length: days }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
    state.cells.clear();
    state.selected = null;
    state.message = '';

    const tasks = [];
    for (const r of routes) for (const d of state.dates) {
      const k = `${r.key}|${iso(d)}`;
      const hit = settings.useCache && cacheGet(r.key, iso(d));
      if (hit) state.cells.set(k, { status: 'done', flights: hit, cached: true });
      else { state.cells.set(k, { status: 'queued', flights: [] }); tasks.push({ r, d, k }); }
    }
    state.total = tasks.length; state.done = 0;
    state.running = true; state.startedAt = Date.now(); state.scanId = state.startedAt.toString(36);
    state.ctrl = new AbortController();
    render();

    let ctx;
    try {
      ctx = { tpl: await loadFormTemplate(), sitekey: siteKey(), names: airports(), pax: settings.pax, signal: state.ctrl.signal };
    } catch (e) {
      state.running = false; state.message = e.message;
      for (const t of tasks) state.cells.set(t.k, { status: 'error', flights: [], err: e.message });
      return render();
    }

    let next = 0, failStreak = 0;
    const worker = async (wi) => {
      await sleep(wi * 350); // giãn nhịp khởi động
      while (state.running && next < tasks.length) {
        const t = tasks[next++];
        const cell = state.cells.get(t.k);
        cell.status = 'running';
        render();
        try {
          let flights;
          for (let attempt = 0; ; attempt++) {
            try {
              flights = await searchDay(ctx, t.r, t.d, part => { cell.flights = mergeFlights([...cell.flights, ...part]); render(); });
              break;
            } catch (e) {
              if (e.fatal || e.name === 'AbortError' || attempt >= 1) throw e;
              await sleep(1500);
            }
          }
          Object.assign(cell, { status: 'done', flights });
          cachePut(t.r.key, iso(t.d), flights);
          failStreak = 0;
        } catch (e) {
          if (e.name === 'AbortError') { cell.status = 'queued'; break; }
          Object.assign(cell, { status: 'error', err: e.message });
          if (e.fatal || ++failStreak >= 3) {
            state.message = e.fatal ? e.message : `Dừng vì lỗi liên tiếp: ${e.message}`;
            stop();
          }
        }
        state.done++;
        render();
        await sleep(300 + Math.random() * 400);
      }
    };
    await Promise.all(Array.from({ length: Math.min(6, Math.max(1, settings.concurrency | 0)) }, (_, i) => worker(i)));
    state.running = false;
    for (const c of state.cells.values()) if (c.status === 'queued' || c.status === 'running') c.status = 'idle';
    render();
  }

  function stop() {
    state.running = false;
    state.ctrl?.abort();
  }

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function exportCsv() {
    const rows = [['Chang', 'Ngay', 'Thu', 'Hang', 'Chuyen bay', 'Gio di', 'Gio den', 'Thoi gian (phut)', 'Diem dung', 'Hang ve', 'Gia (VND)']];
    for (const r of state.routes) for (const d of state.dates) {
      for (const f of visible(state.cells.get(`${r.key}|${iso(d)}`)?.flights || [])) {
        rows.push([r.key, dmy(d), WEEKDAY[d.getDay()], f.airline, f.no, hhmm(f.dep), hhmm(f.arr), f.dur, f.stops, `${f.fare} ${f.cls}`.trim(), f.price]);
      }
    }
    const csv = '﻿' + rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `san-ve-re_${settings.start}_${state.dates.length}ngay.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  // ───────────────────────── UI ─────────────────────────

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => n.toLocaleString('vi-VN') + '₫';
  const short = n => n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 1 : 2).replace(/\.?0+$/, '') + 'tr' : Math.round(n / 1000) + 'K';
  const hhmm = s => String(s).slice(11, 16);
  const dur = m => `${Math.floor(m / 60)}h${pad(m % 60)}`;
  const color = a => AIRLINE_COLORS[a] || '#475569';
  const chip = f => `<span class="al" style="--c:${color(f.airline)}" title="${esc(f.airlineName)}">${esc(f.airline)}</span>`;

  const host = document.createElement('div');
  host.id = 'san-ve-re';
  document.body.appendChild(host);
  const root = host.attachShadow({ mode: 'open' });

  root.innerHTML = `<style>
    :host { all: initial; }
    * { box-sizing: border-box; }
    .wrap { --bg:#0b1220; --panel:#111a2e; --card:#16213a; --line:#24314f; --tx:#e6ecf8; --mut:#8fa0c2; --acc:#38bdf8; --good:#22c55e;
      font: 13px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--tx); }
    .fab { position: fixed; right: 20px; bottom: 20px; z-index: 2147483646; border: 0; cursor: pointer; color: #fff;
      padding: 12px 18px; border-radius: 999px; font: 600 14px system-ui; background: linear-gradient(135deg,#0ea5e9,#6366f1);
      box-shadow: 0 10px 30px rgba(14,165,233,.45); transition: transform .15s; }
    .fab:hover { transform: translateY(-2px) scale(1.03); }
    .panel { position: fixed; inset: 12px 12px 12px auto; width: min(1080px, calc(100vw - 24px)); z-index: 2147483647;
      background: var(--bg); border: 1px solid var(--line); border-radius: 18px; display: none; flex-direction: column;
      box-shadow: 0 30px 80px rgba(0,0,0,.55); overflow: hidden; }
    .panel.open { display: flex; animation: in .22s ease-out; }
    @keyframes in { from { opacity: 0; transform: translateX(24px); } }
    header { display: flex; align-items: center; gap: 12px; padding: 14px 18px; border-bottom: 1px solid var(--line);
      background: linear-gradient(90deg, rgba(56,189,248,.12), rgba(99,102,241,.08)); }
    header h1 { font-size: 17px; margin: 0; letter-spacing: .2px; }
    header .sub { color: var(--mut); font-size: 12px; }
    header .x { margin-left: auto; background: none; border: 0; color: var(--mut); font-size: 22px; cursor: pointer; }
    .body { overflow: auto; padding: 16px 18px 24px; display: grid; gap: 16px; }
    .controls { display: grid; grid-template-columns: 2.4fr 1fr .6fr .6fr .7fr; gap: 10px; align-items: end; }
    @media (max-width: 760px) { .controls { grid-template-columns: 1fr 1fr; } .controls .routes { grid-column: 1 / -1; } }
    label { display: grid; gap: 4px; color: var(--mut); font-size: 11px; text-transform: uppercase; letter-spacing: .5px; }
    input[type=text], input[type=date], input[type=number] { width: 100%; background: var(--panel); color: var(--tx);
      border: 1px solid var(--line); border-radius: 10px; padding: 9px 10px; font: 14px system-ui; color-scheme: dark; }
    input:focus { outline: 2px solid var(--acc); outline-offset: -1px; }
    .row { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
    .tog { display: inline-flex; gap: 6px; align-items: center; color: var(--tx); text-transform: none; letter-spacing: 0; font-size: 13px; cursor: pointer; }
    .btn { border: 1px solid var(--line); background: var(--card); color: var(--tx); border-radius: 10px; padding: 9px 14px;
      font: 600 13px system-ui; cursor: pointer; }
    .btn:hover { border-color: var(--acc); }
    .btn.go { background: linear-gradient(135deg,#0ea5e9,#6366f1); border: 0; color: #fff; padding: 10px 20px; }
    .btn.stop { background: #b91c1c; border: 0; color: #fff; }
    .btn:disabled { opacity: .45; cursor: default; }
    .spacer { flex: 1; }
    .prog { height: 6px; background: var(--panel); border-radius: 99px; overflow: hidden; }
    .prog > i { display: block; height: 100%; background: linear-gradient(90deg,#22c55e,#38bdf8); transition: width .3s; }
    .msg { color: #fca5a5; }
    .muted { color: var(--mut); }
    .hero { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; }
    .deal { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 14px; cursor: pointer; position: relative; overflow: hidden; }
    .deal:hover { border-color: var(--acc); }
    .deal.best { border-color: #facc15; box-shadow: 0 0 0 1px #facc15 inset, 0 10px 30px rgba(250,204,21,.12); }
    .deal .rt { font-weight: 700; font-size: 15px; }
    .deal .nm { color: var(--mut); font-size: 12px; }
    .deal .pr { font-size: 26px; font-weight: 800; margin: 6px 0 2px; color: #4ade80; letter-spacing: -.5px; }
    .deal .ribbon { position: absolute; top: 10px; right: -30px; transform: rotate(35deg); background: #facc15; color: #111; font-weight: 800;
      font-size: 10px; padding: 3px 34px; }
    .al { display: inline-block; min-width: 26px; text-align: center; padding: 1px 6px; border-radius: 6px; font-weight: 700; font-size: 11px;
      color: #fff; background: var(--c); }
    .grid { background: var(--card); border: 1px solid var(--line); border-radius: 14px; overflow: auto; }
    table { border-collapse: collapse; width: 100%; }
    .heat th, .heat td { padding: 0; border-bottom: 1px solid var(--line); }
    .heat thead th { padding: 10px 6px; color: var(--mut); font-weight: 600; font-size: 12px; text-align: center; white-space: nowrap; }
    .heat thead th.we { color: #fbbf24; }
    .heat th.rh { text-align: left; padding: 10px 14px; white-space: nowrap; position: sticky; left: 0; background: var(--card); z-index: 1; }
    .heat th.rh small { display: block; color: var(--mut); font-weight: 400; }
    .cell { width: 100%; min-width: 84px; height: 62px; border: 0; background: transparent; color: var(--tx); cursor: pointer;
      display: grid; place-items: center; gap: 0; font: 700 14px system-ui; position: relative; }
    .cell .h { position: absolute; inset: 4px; border-radius: 10px; background: var(--h, transparent); opacity: .9; }
    .cell > span { position: relative; }
    .cell small { position: relative; font: 600 10px system-ui; opacity: .85; }
    .cell.sel .h { outline: 2px solid #fff; }
    .cell .crown { position: absolute; top: 2px; right: 6px; font-size: 13px; }
    .spin { width: 16px; height: 16px; border: 2px solid var(--line); border-top-color: var(--acc); border-radius: 50%; animation: sp .8s linear infinite; position: relative; }
    @keyframes sp { to { transform: rotate(360deg); } }
    .legend { display: flex; align-items: center; gap: 8px; color: var(--mut); font-size: 12px; }
    .legend i { width: 120px; height: 8px; border-radius: 9px; background: linear-gradient(90deg, hsl(140 70% 38%), hsl(70 70% 40%), hsl(0 70% 45%)); }
    .detail h3 { margin: 0 0 10px; font-size: 15px; }
    .flights th { text-align: left; color: var(--mut); font-weight: 600; font-size: 11px; text-transform: uppercase; padding: 8px 10px; border-bottom: 1px solid var(--line); }
    .flights td { padding: 9px 10px; border-bottom: 1px solid var(--line); white-space: nowrap; }
    .flights tr:first-child td { background: rgba(34,197,94,.08); }
    .flights .p { font-weight: 800; color: #4ade80; text-align: right; }
    .flights del { color: var(--mut); font-weight: 400; margin-right: 6px; font-size: 11px; }
    .filters .f { cursor: pointer; opacity: .45; }
    .filters .f.on { opacity: 1; }
    .syncdot { width: 8px; height: 8px; border-radius: 50%; background: var(--line); display: inline-block; }
    .syncdot.ok { background: #22c55e; box-shadow: 0 0 0 3px rgba(34,197,94,.25); }
    .syncdot.off { background: #ef4444; }
    .empty { padding: 28px; text-align: center; color: var(--mut); }
  </style>
  <div class="wrap">
    <button class="fab" data-act="toggle">✈ Săn vé rẻ</button>
    <section class="panel">
      <header>
        <div><h1>✈ Săn Vé Rẻ</h1><div class="sub">Quét mọi hãng · từng chặng × từng ngày · giá đã gồm thuế phí</div></div>
        <button class="x" data-act="toggle" title="Đóng (Esc)">×</button>
      </header>
      <div class="body">
        <div class="controls">
          <label class="routes">Chặng bay <input type="text" name="routes" placeholder="SGN-HAN, HAN-SGN, SGN-DAD"></label>
          <label>Từ ngày <input type="date" name="start"></label>
          <label>Số ngày <input type="number" name="days" min="1" max="31"></label>
          <label>Người lớn <input type="number" name="pax" min="1" max="9"></label>
          <label>Song song <input type="number" name="concurrency" min="1" max="6"></label>
        </div>
        <div class="row">
          <label class="tog"><input type="checkbox" name="directOnly"> Chỉ bay thẳng</label>
          <label class="tog"><input type="checkbox" name="useCache"> Dùng kết quả cũ &lt; 30 phút</label>
          <label class="tog" title="Gửi kết quả sang dashboard chạy ở máy bạn (node server.js)"><input type="checkbox" name="sync"> Đồng bộ dashboard <span class="syncdot"></span></label>
          <button class="btn" data-act="reverse" title="Thêm chiều ngược lại cho mọi chặng">⇄ Thêm chiều về</button>
          <span class="spacer"></span>
          <button class="btn" data-act="dash">📊 Dashboard</button>
          <button class="btn" data-act="csv">⬇ CSV</button>
          <button class="btn go" data-act="run">🔍 Quét giá</button>
        </div>
        <div class="status"></div>
        <div class="hero"></div>
        <div class="heatbox"></div>
        <div class="detail"></div>
      </div>
    </section>
  </div>`;

  const $ = s => root.querySelector(s);
  const panel = $('.panel');

  // Bind controls ↔ settings
  for (const el of root.querySelectorAll('.controls input, .row input')) {
    const k = el.name;
    if (el.type === 'checkbox') el.checked = !!settings[k]; else el.value = settings[k];
    el.addEventListener('input', () => {
      settings[k] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value;
      store.set(LS_SETTINGS, settings);
      if (k === 'directOnly') render();
    });
  }
  $('input[name=start]').min = iso(today);

  root.addEventListener('click', e => {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const act = t.dataset.act;
    if (act === 'toggle') panel.classList.toggle('open');
    else if (act === 'run') state.running ? stop() : run();
    else if (act === 'csv') exportCsv();
    else if (act === 'dash') { window.open(settings.syncUrl, 'san-ve-re-dashboard'); pushSoon(0); }
    else if (act === 'reverse') {
      const rs = parseRoutes(settings.routes);
      const all = [...rs, ...rs.map(r => ({ key: `${r.to}-${r.from}` }))].map(r => r.key);
      settings.routes = [...new Set(all)].join(', ');
      $('input[name=routes]').value = settings.routes;
      store.set(LS_SETTINGS, settings);
    } else if (act === 'cell') {
      state.selected = { route: t.dataset.r, date: t.dataset.d };
      render();
      $('.detail').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else if (act === 'al') {
      const a = t.dataset.a;
      state.airlineFilter.has(a) ? state.airlineFilter.delete(a) : state.airlineFilter.add(a);
      render();
    }
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') panel.classList.remove('open'); });

  let raf = 0;
  function render() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); pushSoon(); }

  // ── Đồng bộ sang dashboard (server.js trên máy bạn) ──
  function snapshot() {
    const names = airports();
    const cells = {};
    for (const [k, c] of state.cells) cells[k] = { status: c.status, cached: !!c.cached, err: c.err || '', flights: c.flights.slice(0, 60) };
    return {
      scanId: state.scanId || 'cache',
      updatedAt: Date.now(),
      settings: { start: settings.start, days: state.dates.length, pax: settings.pax, directOnly: settings.directOnly },
      routes: state.routes.map(r => ({ key: r.key, from: r.from, to: r.to, fromName: names[r.from] || r.from, toName: names[r.to] || r.to })),
      dates: state.dates.map(iso),
      cells,
      progress: { done: state.done, total: state.total, running: state.running, message: state.message },
    };
  }
  let pushTimer = 0, pushing = false, pushAgain = false;
  function pushSoon(delay = 700) {
    if (!settings.sync || !state.routes.length) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(pushNow, delay);
  }
  async function pushNow() {
    if (pushing) { pushAgain = true; return; }
    pushing = true;
    try {
      const r = await fetch(settings.syncUrl.replace(/\/+$/, '') + '/api/push', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(snapshot()),
      });
      state.sync = r.ok ? 'ok' : 'off';
    } catch { state.sync = 'off'; }
    pushing = false;
    const dot = root.querySelector('.syncdot');
    if (dot) { dot.className = 'syncdot ' + state.sync; dot.title = state.sync === 'ok' ? 'Đã kết nối dashboard' : 'Không thấy dashboard — chạy: node server.js'; }
    if (pushAgain) { pushAgain = false; pushSoon(300); }
  }

  function draw() {
    const names = airports();
    const nm = c => names[c] || c;

    // Nút chạy + tiến độ
    const runBtn = $('[data-act=run]');
    runBtn.textContent = state.running ? '■ Dừng' : '🔍 Quét giá';
    runBtn.className = 'btn ' + (state.running ? 'stop' : 'go');
    $('[data-act=csv]').disabled = !state.routes.length;
    const pct = state.total ? (state.done / state.total) * 100 : (state.routes.length ? 100 : 0);
    const active = [...state.cells.values()].filter(c => c.status === 'running').length;
    let eta = '';
    if (state.running && state.done > 0) {
      const s = Math.round(((Date.now() - state.startedAt) / state.done) * (state.total - state.done) / 1000);
      eta = ` · còn ~${s >= 60 ? Math.round(s / 60) + ' phút' : s + 's'}`;
    }
    const cachedN = [...state.cells.values()].filter(c => c.cached).length;
    $('.status').innerHTML = state.routes.length || state.message ? `
      <div class="prog"><i style="width:${pct}%"></i></div>
      <div class="row muted" style="margin-top:6px">
        <span>${state.done}/${state.total} lượt tìm${active ? ` · ${active} đang chạy` : ''}${eta}${cachedN ? ` · ${cachedN} ô lấy từ cache` : ''}</span>
        ${state.message ? `<span class="msg">⚠ ${esc(state.message)}</span>` : ''}
      </div>` : '';

    if (!state.routes.length) {
      $('.hero').innerHTML = '';
      $('.heatbox').innerHTML = `<div class="grid empty">Nhập chặng bay (vd <b>SGN-HAN, HAN-SGN</b>), chọn ngày bắt đầu rồi bấm <b>Quét giá</b>.<br>
        Mỗi ô là 1 lượt tìm giống hệt khi bạn bấm “Tìm kiếm” trên trang.</div>`;
      $('.detail').innerHTML = '';
      return;
    }

    // Tổng hợp từng chặng
    const stats = state.routes.map(r => {
      const days = state.dates.map(d => {
        const c = state.cells.get(`${r.key}|${iso(d)}`) || { status: 'idle', flights: [] };
        const fl = visible(c.flights);
        return { d, c, fl, min: fl[0]?.price ?? null };
      });
      const prices = days.map(x => x.min).filter(v => v != null);
      const best = days.filter(x => x.min != null).sort((a, b) => a.min - b.min)[0];
      return { r, days, lo: Math.min(...prices), hi: Math.max(...prices), best };
    });
    const overall = stats.filter(s => s.best).sort((a, b) => a.best.min - b.best.min)[0];

    // Thẻ “rẻ nhất tuần” cho từng chặng
    $('.hero').innerHTML = stats.map(s => {
      const b = s.best, f = b?.fl[0];
      return `<div class="deal ${s === overall && stats.length > 1 ? 'best' : ''}" data-act="${b ? 'cell' : ''}" data-r="${s.r.key}" data-d="${b ? iso(b.d) : ''}">
        ${s === overall && stats.length > 1 ? '<div class="ribbon">RẺ NHẤT</div>' : ''}
        <div class="rt">${s.r.from} → ${s.r.to}</div>
        <div class="nm">${esc(nm(s.r.from))} → ${esc(nm(s.r.to))}</div>
        ${f ? `<div class="pr">${money(f.price)}</div>
          <div>${chip(f)} <b>${esc(f.no)}</b> · ${WEEKDAY[b.d.getDay()]} ${dmy(b.d).slice(0, 5)} · ${hhmm(f.dep)}→${hhmm(f.arr)}</div>
          ${s.hi > s.lo ? `<div class="muted" style="margin-top:4px">Tiết kiệm ${money(s.hi - s.lo)} so với ngày đắt nhất</div>` : ''}`
        : `<div class="pr muted" style="color:var(--mut)">${state.running ? '…' : '—'}</div><div class="muted">${state.running ? 'Đang quét' : 'Chưa có chuyến'}</div>`}
      </div>`;
    }).join('');

    // Heatmap chặng × ngày
    const sel = state.selected;
    $('.heatbox').innerHTML = `<div class="grid"><table class="heat">
      <thead><tr><th class="rh">Chặng</th>${state.dates.map(d =>
        `<th class="${d.getDay() % 6 === 0 ? 'we' : ''}">${WEEKDAY[d.getDay()]}<br>${dmy(d).slice(0, 5)}</th>`).join('')}</tr></thead>
      <tbody>${stats.map(s => `<tr><th class="rh">${s.r.from} → ${s.r.to}<small>${esc(nm(s.r.from))} – ${esc(nm(s.r.to))}</small></th>${s.days.map(x => {
        const di = iso(x.d), isSel = sel && sel.route === s.r.key && sel.date === di;
        let inner;
        if (x.min != null) {
          const t = s.hi > s.lo ? (x.min - s.lo) / (s.hi - s.lo) : 0;
          const crown = x === s.best && s.days.filter(y => y.min != null).length > 1 ? '<span class="crown">👑</span>' : '';
          inner = `<div class="h" style="--h:hsl(${140 - 140 * t} 70% ${38 + 4 * t}%)"></div>${crown}<span>${short(x.min)}</span><small>${esc(x.fl[0].airline)} ${hhmm(x.fl[0].dep)}${x.c.status === 'running' ? ' …' : ''}</small>`;
        } else if (x.c.status === 'running') inner = '<div class="spin"></div>';
        else if (x.c.status === 'error') inner = `<span title="${esc(x.c.err)}">⚠</span>`;
        else if (x.c.status === 'done') inner = '<span class="muted">—</span>';
        else inner = '<span class="muted">·</span>';
        return `<td><button class="cell ${isSel ? 'sel' : ''}" data-act="cell" data-r="${s.r.key}" data-d="${di}">${inner}</button></td>`;
      }).join('')}</tr>`).join('')}</tbody></table></div>
      <div class="row" style="margin-top:8px"><div class="legend"><span>Rẻ</span><i></i><span>Đắt</span></div>
      <span class="muted">· màu so sánh trong cùng 1 chặng · 👑 ngày rẻ nhất · bấm ô để xem tất cả chuyến</span></div>`;

    // Chi tiết 1 ô
    if (!sel) { $('.detail').innerHTML = ''; return; }
    const c = state.cells.get(`${sel.route}|${sel.date}`);
    const d = parseIso(sel.date);
    const allAirlines = [...new Set((c?.flights || []).map(f => f.airline))].sort();
    const fl = visible(c?.flights || []);
    const [from, to] = sel.route.split('-');
    $('.detail').innerHTML = `<div class="grid" style="padding:14px">
      <h3>${from} → ${to} · ${WEEKDAY[d.getDay()]} ${dmy(d)} <span class="muted" style="font-weight:400">· ${fl.length} chuyến</span></h3>
      ${allAirlines.length > 1 ? `<div class="row filters" style="margin-bottom:10px"><span class="muted">Lọc hãng:</span>${allAirlines.map(a =>
        `<span class="al f ${state.airlineFilter.size === 0 || state.airlineFilter.has(a) ? 'on' : ''}" style="--c:${color(a)}" data-act="al" data-a="${esc(a)}">${esc(a)}</span>`).join('')}</div>` : ''}
      ${fl.length ? `<div style="overflow:auto"><table class="flights">
        <thead><tr><th>Hãng</th><th>Chuyến</th><th>Giờ bay</th><th>Thời gian</th><th>Hạng vé</th><th style="text-align:right">Giá / ${settings.pax} khách</th></tr></thead>
        <tbody>${fl.slice(0, 40).map(f => `<tr>
          <td>${chip(f)} <span class="muted">${esc(f.airlineName)}</span></td>
          <td><b>${esc(f.no)}</b></td>
          <td>${hhmm(f.dep)} → ${hhmm(f.arr)}</td>
          <td>${dur(f.dur)}${f.stops ? ` · ${f.stops} điểm dừng` : ' · bay thẳng'}</td>
          <td class="muted">${esc(f.fare === f.cls ? f.fare : `${f.fare} ${f.cls}`.trim())}</td>
          <td class="p">${f.oldPrice ? `<del>${money(f.oldPrice)}</del>` : ''}${money(f.price)}</td></tr>`).join('')}</tbody></table></div>`
        : `<div class="empty">${c?.status === 'error' ? '⚠ ' + esc(c.err) : c?.status === 'running' ? 'Đang quét…' : 'Không có chuyến phù hợp'}</div>`}
    </div>`;
  }

  window.__SAN_VE_RE__ = { open: () => panel.classList.add('open'), run, stop, state };
  draw();
})();
