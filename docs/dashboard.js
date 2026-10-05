(() => {
  'use strict';

  // ───── helpers ─────
  const $ = s => document.querySelector(s);
  const pad = n => String(n).padStart(2, '0');
  const parseIso = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const WD = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
  const WD_FULL = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];
  const dm = s => { const d = parseIso(s); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`; };
  const wd = s => WD[parseIso(s).getDay()];
  const isWeekend = s => parseIso(s).getDay() % 6 === 0;
  const money = n => Math.round(n).toLocaleString('vi-VN') + '₫';
  const short = n => n >= 1e6 ? (n / 1e6).toFixed(2).replace(/\.?0+$/, '').replace('.', ',') + 'tr' : Math.round(n / 1000) + 'K';
  const hhmm = s => String(s).slice(11, 16);
  const dur = m => `${Math.floor(m / 60)}h${pad(m % 60)}`;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ago = ts => { const s = Math.round((Date.now() - ts) / 1000); return s < 10 ? 'vừa xong' : s < 60 ? `${s} giây trước` : s < 3600 ? `${Math.round(s / 60)} phút trước` : new Date(ts).toLocaleString('vi-VN'); };

  // Màu theo thực thể (cố định thứ tự, không đổi khi lọc)
  const AIRLINE_ORDER = ['VN', 'VJ', 'QH', 'VU', '9G', 'BL'];
  const AIRLINE_NAME = { VN: 'Vietnam Airlines', VJ: 'Vietjet Air', QH: 'Bamboo Airways', VU: 'Vietravel Airlines', '9G': 'Sun PhuQuoc Airways', BL: 'Pacific Airlines' };
  const alColor = a => { const i = AIRLINE_ORDER.indexOf(a); return i >= 0 ? `var(--s${i + 1})` : 'var(--other)'; };
  const routeColor = i => i < 8 ? `var(--s${i + 1})` : 'var(--other)';
  const chip = (a, name) => `<span class="al" style="--c:${alColor(a)}" title="${esc(name || AIRLINE_NAME[a] || a)}">${esc(a)}</span>`;
  const bucketOf = f => { const h = Number(hhmm(f.dep).slice(0, 2)); return h < 12 ? 'sang' : h < 18 ? 'chieu' : 'toi'; };

  // ───── state ─────
  let snap = null, hist = {};
  const ui = {
    route: 'all', date: 'all', direct: false, bucket: 'all', sort: 'price', limit: 50,
    airlinesOff: new Set(), routesOff: new Set(), selected: null,
  };
  try { Object.assign(ui, JSON.parse(localStorage.getItem('svr-ui') || '{}'), { airlinesOff: new Set(), routesOff: new Set(), selected: null, limit: 50 }); } catch {}
  const saveUi = () => { try { localStorage.setItem('svr-ui', JSON.stringify({ direct: ui.direct, bucket: ui.bucket, sort: ui.sort })); } catch {} };

  // ───── theme ─────
  const applyTheme = t => { if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme; };
  try { applyTheme(localStorage.getItem('svr-theme')); } catch {}
  $('#btnTheme').onclick = () => {
    const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    const t = dark ? 'light' : 'dark';
    applyTheme(t);
    try { localStorage.setItem('svr-theme', t); } catch {}
    render();
  };

  // ───── Engine: quét qua tab airbookingonline.com đã đăng nhập ─────
  const SITE = 'https://airbookingonline.com';
  const CACHE_TTL = 30 * 60 * 1000;
  const AIRPORTS = {
    SGN: 'Hồ Chí Minh', HAN: 'Hà Nội', DAD: 'Đà Nẵng', CXR: 'Nha Trang', PQC: 'Phú Quốc', DLI: 'Đà Lạt', HPH: 'Hải Phòng',
    VII: 'Vinh', HUI: 'Huế', THD: 'Thanh Hóa', VDO: 'Vân Đồn', DIN: 'Điện Biên Phủ', BMV: 'Buôn Ma Thuột', PXU: 'Pleiku',
    UIH: 'Quy Nhơn', VDH: 'Đồng Hới', TBB: 'Tuy Hòa', VCL: 'Chu Lai', VCS: 'Côn Đảo', VCA: 'Cần Thơ', CAH: 'Cà Mau', VKG: 'Rạch Giá',
    BKK: 'Băng Cốc', SIN: 'Singapore', HKG: 'Hồng Kông', TPE: 'Đài Bắc', ICN: 'Seoul', PUS: 'Pusan', NRT: 'Tokyo Narita',
    KIX: 'Osaka', NGO: 'Nagoya', CAN: 'Quảng Châu', PVG: 'Thượng Hải', MFM: 'Macau', MNL: 'Manila', PNH: 'Phnom Penh',
    REP: 'Siem Reap', VTE: 'Vientiane', RGN: 'Yangon', CGK: 'Jakarta', KUL: 'Kuala Lumpur', SYD: 'Sydney', MEL: 'Melbourne',
    LHR: 'London', PAR: 'Paris', FRA: 'Frankfurt', SFO: 'San Francisco', LAX: 'Los Angeles',
  };
  // Chạy như extension → chrome.storage; mở như trang web thường (GitHub Pages) → chỉ xem, lưu localStorage
  const WEB = typeof chrome === 'undefined' || !chrome.storage?.local;
  const store = WEB ? {
    get: async (k, d) => { try { const v = localStorage.getItem('svr:' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set: (k, v) => { try { localStorage.setItem('svr:' + k, JSON.stringify(v)); } catch {} },
  } : {
    get: async (k, d) => { try { const o = await chrome.storage.local.get(k); return o[k] ?? d; } catch { return d; } },
    set: (k, v) => chrome.storage.local.set({ [k]: v }).catch(() => {}),
  };
  const isoOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const todayIso = isoOf(new Date());

  const S = { routes: ['SGN-HAN', 'HAN-SGN'], start: todayIso, days: 7, pax: 1, concurrency: 3, useCache: true };
  const scan = { running: false, stop: false, message: '', fatal: false };
  let cache = {};

  // ── Controls ──
  const apOpts = Object.entries(AIRPORTS).map(([c, n]) => `<option value="${c}">${esc(n)} (${c})</option>`).join('');
  $('#selFrom').innerHTML = apOpts; $('#selTo').innerHTML = apOpts;
  $('#selFrom').value = 'SGN'; $('#selTo').value = 'HAN';

  function drawRouteChips() {
    $('#routeChips').innerHTML = S.routes.length ? S.routes.map(k => {
      const [a, b] = k.split('-');
      return `<span class="rchip" title="${esc((AIRPORTS[a] || a) + ' → ' + (AIRPORTS[b] || b))}"><b>${a}</b> → <b>${b}</b><button data-del="${k}" aria-label="Xoá ${k}">×</button></span>`;
    }).join('') : '<span class="muted">Chưa có chặng nào — chọn điểm đi/đến rồi bấm “+ Thêm”</span>';
    $('#routeChips').querySelectorAll('[data-del]').forEach(b => b.onclick = () => { S.routes = S.routes.filter(k => k !== b.dataset.del); saveS(); drawRouteChips(); });
  }
  const saveS = () => store.set('settings', S);
  function bindControls() {
    for (const id of ['start', 'days', 'pax', 'concurrency']) {
      const el = $('#c_' + id);
      el.value = S[id];
      el.oninput = () => { S[id] = el.type === 'number' ? Number(el.value) : el.value; saveS(); };
    }
    $('#c_start').min = todayIso;
    $('#c_cache').checked = S.useCache;
    $('#c_cache').onchange = e => { S.useCache = e.target.checked; saveS(); };
    // Cặp đang chọn ở 2 ô select nhưng chưa bấm “+ Thêm” → làm nổi nút, và tự thêm khi bấm Quét
    let pickDirty = false;
    const pickedKey = () => `${$('#selFrom').value}-${$('#selTo').value}`;
    const markDirty = () => {
      pickDirty = $('#selFrom').value !== $('#selTo').value && !S.routes.includes(pickedKey());
      $('#addRoute').classList.toggle('hl', pickDirty);
    };
    const addPicked = () => {
      const k = pickedKey();
      if ($('#selFrom').value !== $('#selTo').value && !S.routes.includes(k)) { S.routes.push(k); saveS(); drawRouteChips(); }
      markDirty();
    };
    $('#selFrom').onchange = $('#selTo').onchange = markDirty;
    $('#addRoute').onclick = addPicked;
    $('#swapSel').onclick = () => { const a = $('#selFrom').value; $('#selFrom').value = $('#selTo').value; $('#selTo').value = a; markDirty(); };
    $('#addReturn').onclick = () => {
      for (const k of [...S.routes]) { const r = k.split('-').reverse().join('-'); if (!S.routes.includes(r)) S.routes.push(r); }
      saveS(); drawRouteChips();
    };
    $('#btnRun').onclick = () => {
      if (scan.running) { scan.stop = true; scan.message = 'Đang dừng…'; return renderTop(); }
      if (WEB) {
        scan.message = 'Bản web chỉ để xem. Cài extension để quét giá thật';
        renderTop();
        return document.querySelector('#webBanner')?.scrollIntoView({ behavior: 'smooth' });
      }
      if (pickDirty) addPicked();
      runScan();
    };
    $('#btnLogin').onclick = async () => { const t = await siteTab(true); chrome.windows.update(t.windowId, { focused: true }); };
    drawRouteChips();
  }

  async function siteTab(activate = false) {
    let [t] = await chrome.tabs.query({ url: SITE + '/*' });
    if (!t) t = await chrome.tabs.create({ url: SITE + '/', active: activate });
    else if (activate) await chrome.tabs.update(t.id, { active: true });
    if (t.status !== 'complete') {
      await new Promise(resolve => {
        const done = () => { chrome.tabs.onUpdated.removeListener(l); resolve(); };
        const l = (id, info) => { if (id === t.id && info.status === 'complete') done(); };
        chrome.tabs.onUpdated.addListener(l);
        setTimeout(done, 20000);
      });
    }
    return t;
  }

  async function searchCell(r, d) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const t = await siteTab();
        const [inj] = await chrome.scripting.executeScript({
          target: { tabId: t.id }, world: 'MAIN', func: pageSearch,
          args: [{ from: r.from, to: r.to }, d, S.pax, AIRPORTS],
        });
        const res = inj?.result || { ok: false, error: 'Không chạy được trên tab airbookingonline' };
        if (res.ok || res.fatal || attempt === 2) return res;
      } catch (e) {
        // tab đang tải lại / bị đóng → thử lại
        if (attempt === 2) return { ok: false, error: String(e.message || e) };
      }
      await new Promise(z => setTimeout(z, 1500));
    }
  }

  let saveTimer = 0;
  function commit() {
    snap.updatedAt = Date.now();
    snap.progress = { done: scan.done, total: scan.total, running: scan.running, message: scan.message };
    render();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { store.set('snapshot', snap); store.set('history', hist); store.set('cache', cache); }, 400);
  }

  async function runScan() {
    if (scan.running) return;
    const routes = S.routes.map(k => { const [from, to] = k.split('-'); return { key: k, from, to, fromName: AIRPORTS[from] || from, toName: AIRPORTS[to] || to }; });
    if (!routes.length) { scan.message = 'Thêm ít nhất một chặng'; return renderTop(); }
    const days = Math.min(31, Math.max(1, S.days | 0));
    const start = parseIso(S.start < todayIso ? todayIso : S.start);
    const dates = Array.from({ length: days }, (_, i) => isoOf(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)));
    const scanId = Date.now().toString(36);
    snap = { scanId, updatedAt: Date.now(), settings: { start: dates[0], days, pax: S.pax }, routes, dates, cells: {}, progress: {} };
    ui.route = 'all'; ui.date = 'all'; ui.selected = null; ui.routesOff.clear(); ui.airlinesOff.clear();

    for (const k of Object.keys(cache)) if (Date.now() - cache[k].ts > CACHE_TTL) delete cache[k];
    const tasks = [];
    for (const r of routes) for (const d of dates) {
      const key = `${r.key}|${d}`, hit = S.useCache && cache[`${key}|${S.pax}`];
      if (hit) snap.cells[key] = { status: 'done', cached: true, flights: hit.flights };
      else { snap.cells[key] = { status: 'queued', flights: [] }; tasks.push({ r, d, key }); }
    }
    Object.assign(scan, { running: true, stop: false, message: '', fatal: false, done: 0, total: tasks.length });
    commit();

    let next = 0, failStreak = 0;
    const worker = async wi => {
      await new Promise(z => setTimeout(z, wi * 400));
      while (!scan.stop && next < tasks.length) {
        const t = tasks[next++];
        const cell = snap.cells[t.key];
        cell.status = 'running'; commit();
        const res = await searchCell(t.r, t.d);
        if (res.ok) {
          Object.assign(cell, { status: 'done', flights: res.flights.slice(0, 80) });
          cache[`${t.key}|${S.pax}`] = { ts: Date.now(), flights: cell.flights };
          if (cell.flights.length) {
            const list = hist[t.key] ||= [];
            list.push({ ts: Date.now(), scan: scanId, min: cell.flights[0].price });
            if (list.length > 60) list.splice(0, list.length - 60);
          }
          failStreak = 0;
        } else {
          Object.assign(cell, { status: 'error', err: res.error });
          if (res.fatal || ++failStreak >= 3) {
            scan.stop = true; scan.fatal = !!res.fatal;
            scan.message = res.fatal ? res.error : `Dừng vì lỗi liên tiếp: ${res.error}`;
          }
        }
        scan.done++; commit();
        await new Promise(z => setTimeout(z, 300 + Math.random() * 400));
      }
    };
    await Promise.all(Array.from({ length: Math.min(6, Math.max(1, S.concurrency | 0)) }, (_, i) => worker(i)));
    for (const c of Object.values(snap.cells)) if (c.status === 'queued' || c.status === 'running') c.status = 'idle';
    scan.running = false;
    if (scan.message === 'Đang dừng…') scan.message = 'Đã dừng';
    commit();
  }

  // ── Khởi động: nạp cài đặt + lần quét gần nhất ──
  (async () => {
    Object.assign(S, await store.get('settings', {}));
    if (S.start < todayIso) S.start = todayIso;
    cache = await store.get('cache', {});
    hist = await store.get('history', {});
    snap = await store.get('snapshot', null);
    if (!snap && WEB) {
      try { const demo = await (await fetch('demo.json')).json(); snap = demo.snapshot; hist = demo.history || {}; } catch {}
    }
    if (WEB && snap?.routes?.length) S.routes = snap.routes.map(r => r.key);
    if (snap?.progress) snap.progress.running = false;
    if (snap) for (const c of Object.values(snap.cells)) if (c.status === 'queued' || c.status === 'running') c.status = 'idle';
    bindControls();
    render();
  })();

  // ── Xuất / nhập JSON ──
  function setData(p) { snap = p.snapshot || null; if (p.history) hist = p.history; render(); }
  function loadFile(file) {
    const r = new FileReader();
    r.onload = () => {
      try { const j = JSON.parse(r.result); setData(j.snapshot ? j : { snapshot: j }); }
      catch { alert('File JSON không hợp lệ'); }
    };
    r.readAsText(file);
  }
  $('#btnImport').onclick = () => $('#file').click();
  $('#file').onchange = e => e.target.files[0] && loadFile(e.target.files[0]);
  $('#btnExport').onclick = () => {
    if (!snap) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify({ snapshot: snap, history: hist })], { type: 'application/json' }));
    a.download = `san-ve-re_${snap.dates[0] || 'data'}.json`;
    a.click();
  };
  $('#btnCsv').onclick = () => {
    if (!snap) return;
    const rows = [['Chang', 'Ngay', 'Thu', 'Hang', 'Chuyen bay', 'Gio di', 'Gio den', 'Thoi gian (phut)', 'Diem dung', 'Hang ve', 'Gia (VND)']];
    for (const r of snap.routes) for (const d of snap.dates) for (const f of snap.cells[`${r.key}|${d}`]?.flights || [])
      rows.push([r.key, dm(d) + '/' + d.slice(0, 4), wd(d), f.airline, f.no, hhmm(f.dep), hhmm(f.arr), f.dur, f.stops, f.fare === f.cls ? f.fare : `${f.fare} ${f.cls}`.trim(), f.price]);
    const csv = '﻿' + rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `san-ve-re_${snap.dates[0]}_${snap.dates.length}ngay.csv`;
    a.click();
  };
  let dragN = 0;
  addEventListener('dragenter', e => { e.preventDefault(); dragN++; $('#drop').classList.add('show'); });
  addEventListener('dragleave', () => { if (--dragN <= 0) { dragN = 0; $('#drop').classList.remove('show'); } });
  addEventListener('dragover', e => e.preventDefault());
  addEventListener('drop', e => { e.preventDefault(); dragN = 0; $('#drop').classList.remove('show'); const f = e.dataTransfer.files[0]; f && loadFile(f); });


  // ───── derive ─────
  function derive() {
    const routes = snap.routes.map((r, i) => ({ ...r, color: routeColor(i), idx: i }));
    const filt = f => !ui.direct || f.stops === 0;
    const cell = (rk, d) => snap.cells[`${rk}|${d}`] || { status: 'idle', flights: [] };
    const stats = routes.map(r => {
      const days = snap.dates.map(d => {
        const c = cell(r.key, d);
        const fl = (c.flights || []).filter(filt);
        return { d, c, fl, min: fl.length ? fl[0].price : null, best: fl[0] || null };
      });
      const ok = days.filter(x => x.min != null);
      const lo = ok.length ? Math.min(...ok.map(x => x.min)) : null;
      const hi = ok.length ? Math.max(...ok.map(x => x.min)) : null;
      const best = ok.slice().sort((a, b) => a.min - b.min)[0] || null;
      // So với lần quét trước của chính ngày rẻ nhất
      let delta = null;
      if (best) {
        const h = (hist[`${r.key}|${best.d}`] || []).filter(x => x.scan !== snap.scanId);
        if (h.length) delta = best.min - h[h.length - 1].min;
      }
      return { r, days, lo, hi, best, delta };
    });
    const overall = stats.filter(s => s.best).sort((a, b) => a.best.min - b.best.min)[0] || null;
    let total = 0;
    for (const c of Object.values(snap.cells)) total += (c.flights || []).length;
    const spread = stats.filter(s => s.best && s.hi > s.lo).sort((a, b) => (b.hi - b.lo) - (a.hi - a.lo))[0] || null;
    return { routes, stats, overall, total, spread, filt };
  }

  // ───── render ─────
  function render() {
    renderTop();
    const app = $('#app');
    if (!snap || !snap.routes?.length) { app.innerHTML = emptyView(); return; }
    const D = derive();
    app.innerHTML = `
      <section>${kpiView(D)}</section>
      <section><h2>Rẻ nhất tuần theo chặng <small>bấm để xem chi tiết</small></h2><div class="routes">${D.stats.map(s => routeCard(s, D)).join('')}</div></section>
      <section><h2>Giá rẻ nhất mỗi ngày <small>giá/${snap.settings?.pax || 1} khách, đã gồm thuế phí</small></h2>
        <div class="card chartcard"><div class="legend" id="legend"></div><div id="chart"></div></div></section>
      <section><h2>Bản đồ giá <small>chặng × ngày</small></h2><div class="card heat" id="heat"></div></section>
      <section><h2>Tra cứu chuyến bay</h2><div class="card" id="explorer"></div></section>`;
    drawLegend(D);
    drawChart(D);
    drawHeat(D);
    drawExplorer(D);
    bindCards();
  }

  const live = (cls, text) => { const el = $('#live'); el.className = 'live ' + cls; el.lastElementChild.textContent = text; };
  function renderTop() {
    const btn = $('#btnRun');
    btn.textContent = scan.running ? (scan.stop ? 'Đang dừng…' : '■ Dừng') : '🔍 Quét giá';
    btn.classList.toggle('stop', scan.running);
    $('#btnLogin').hidden = !scan.fatal;
    const msg = $('#ctlMsg');
    msg.textContent = scan.message ? '⚠ ' + scan.message : '';
    if (scan.running) {
      live('scan', `Đang quét ${scan.done}/${scan.total}`);
      $('#prog').style.width = scan.total ? (scan.done / scan.total * 100) + '%' : '0';
    } else {
      live(scan.fatal ? 'off' : 'on', scan.fatal ? 'Cần đăng nhập' : 'Sẵn sàng');
      $('#prog').style.width = '0';
    }
    $('#upd').textContent = snap ? 'Cập nhật ' + ago(snap.updatedAt) : '';
  }
  setInterval(() => snap && ($('#upd').textContent = 'Cập nhật ' + ago(snap.updatedAt)), 15000);

  function emptyView() {
    return `<div class="empty">
      <div class="big">✈</div>
      <h1>Sẵn sàng săn vé</h1>
      <p>Chọn chặng bay và số ngày ở trên rồi bấm <b>🔍 Quét giá</b>. Extension dùng tab airbookingonline.com bạn đã đăng nhập (nếu chưa có sẽ tự mở ở chế độ nền).</p>
      <p class="muted">Mỗi ô ngày × chặng là 1 lượt tìm, giống hệt khi bạn bấm “Tìm kiếm” trên trang.</p>
    </div>`;
  }


  function kpiView(D) {
    const o = D.overall;
    const days = snap.dates.length;
    const range = days ? `${dm(snap.dates[0])} – ${dm(snap.dates[days - 1])}` : '';
    return `<div class="kpis">
      <div class="card kpi hero" data-open="${o ? `${o.r.key}|${o.best.d}` : ''}">
        <div class="lb">Vé rẻ nhất trong ${days} ngày</div>
        ${o ? `<div class="v num">${money(o.best.min)}</div>
          <div class="meta"><b>${o.r.from} → ${o.r.to}</b><span>${WD_FULL[parseIso(o.best.d).getDay()]}, ${dm(o.best.d)}</span>
          ${chip(o.best.best.airline, o.best.best.airlineName)}<span class="num">${esc(o.best.best.no)} · ${hhmm(o.best.best.dep)} → ${hhmm(o.best.best.arr)}</span></div>`
        : `<div class="v muted">${snap.progress?.running ? 'Đang quét…' : '—'}</div>`}
      </div>
      <div class="card kpi"><div class="lb">Chặng đang theo dõi</div><div class="v num">${D.routes.length}</div><div class="sub num">${range}</div></div>
      <div class="card kpi"><div class="lb">Chuyến bay đã quét</div><div class="v num">${D.total.toLocaleString('vi-VN')}</div><div class="sub num">${D.routes.length * days} lượt tìm</div></div>
      <div class="card kpi"><div class="lb">Chọn đúng ngày tiết kiệm</div>
        ${D.spread ? `<div class="v num">${short(D.spread.hi - D.spread.lo)}</div><div class="sub">${D.spread.r.from} → ${D.spread.r.to}: rẻ nhất so với đắt nhất</div>` : '<div class="v muted">—</div>'}
      </div>
    </div>`;
  }

  function routeCard(s, D) {
    const b = s.best, f = b?.best;
    const isBest = D.overall === s && D.stats.length > 1;
    let deltaHtml = '';
    if (s.delta != null) {
      deltaHtml = s.delta < 0 ? `<span class="pill down">▼ ${short(-s.delta)} so với lần trước</span>`
        : s.delta > 0 ? `<span class="pill up">▲ ${short(s.delta)} so với lần trước</span>`
        : `<span class="pill flat">= không đổi</span>`;
    }
    const pending = s.days.filter(x => x.c.status === 'running' || x.c.status === 'queued').length;
    return `<div class="card rc ${isBest ? 'best' : ''}" style="--c:${s.r.color}" data-open="${b ? `${s.r.key}|${b.d}` : ''}">
      <div class="hd"><span class="sw"></span><span class="code">${s.r.from} → ${s.r.to}</span>${isBest ? '<span class="tag">RẺ NHẤT</span>' : ''}</div>
      <div class="nm">${esc(s.r.fromName)} → ${esc(s.r.toName)}</div>
      ${f ? `<div class="pr num">${money(b.min)}</div>
        <div class="fl">${chip(f.airline, f.airlineName)}<b class="num">${esc(f.no)}</b><span class="num">${wd(b.d)} ${dm(b.d)} · ${hhmm(f.dep)} → ${hhmm(f.arr)}</span></div>
        <div class="ft">${deltaHtml}${s.hi > s.lo ? `<span class="num">Đắt nhất ${short(s.hi)}</span>` : ''}${pending ? `<span>· còn ${pending} ngày đang quét</span>` : ''}</div>`
      : `<div class="pr muted">${pending ? 'Đang quét…' : 'Không có chuyến'}</div>`}
    </div>`;
  }

  function bindCards() {
    document.querySelectorAll('[data-open]').forEach(el => el.addEventListener('click', () => {
      const v = el.dataset.open;
      if (!v) return;
      const [rk, d] = v.split('|');
      openCell(rk, d);
    }));
  }
  function openCell(rk, d) {
    ui.route = rk; ui.date = d; ui.selected = `${rk}|${d}`; ui.limit = 50;
    render();
    $('#explorer').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ───── legend + line chart ─────
  function drawLegend(D) {
    const el = $('#legend');
    if (D.routes.length < 2) { el.style.display = 'none'; return; }
    el.innerHTML = D.routes.map(r => `<button class="${ui.routesOff.has(r.key) ? 'off' : ''}" style="--c:${r.color}" data-rk="${r.key}" aria-pressed="${!ui.routesOff.has(r.key)}"><i></i>${r.from} → ${r.to}</button>`).join('');
    el.querySelectorAll('button').forEach(b => b.onclick = () => {
      const k = b.dataset.rk;
      ui.routesOff.has(k) ? ui.routesOff.delete(k) : ui.routesOff.add(k);
      render();
    });
  }

  function niceTicks(lo, hi, n = 4) {
    if (lo === hi) { lo *= .9; hi *= 1.1; }
    const raw = (hi - lo) / n, mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw);
    const t0 = Math.floor(lo / step) * step, out = [];
    for (let v = t0; v <= hi + step * .5; v += step) out.push(v);
    return out;
  }

  function drawChart(D) {
    const host = $('#chart');
    const series = D.stats.filter(s => !ui.routesOff.has(s.r.key));
    const vals = series.flatMap(s => s.days.map(x => x.min).filter(v => v != null));
    if (!vals.length) { host.innerHTML = `<div class="muted" style="padding:40px;text-align:center">${snap.progress?.running ? 'Đang chờ kết quả đầu tiên…' : 'Chưa có dữ liệu'}</div>`; return; }
    const W = host.clientWidth || 800, H = 280;
    const labelW = series.length <= 4 ? 92 : 16;
    const m = { t: 12, r: labelW, b: 34, l: 52 };
    const ticks = niceTicks(Math.min(...vals), Math.max(...vals));
    const y0 = ticks[0], y1 = ticks[ticks.length - 1];
    const n = snap.dates.length;
    const x = i => m.l + (n === 1 ? (W - m.l - m.r) / 2 : i * (W - m.l - m.r) / (n - 1));
    const y = v => m.t + (1 - (v - y0) / (y1 - y0)) * (H - m.t - m.b);
    let svg = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="Giá rẻ nhất mỗi ngày theo chặng">`;
    svg += '<g class="axis">';
    for (const t of ticks) svg += `<line class="gridl" x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}"/><text x="${m.l - 8}" y="${y(t) + 4}" text-anchor="end">${short(t)}</text>`;
    snap.dates.forEach((d, i) => {
      if (n > 14 && i % 2) return;
      svg += `<text x="${x(i)}" y="${H - 16}" text-anchor="middle" ${isWeekend(d) ? 'font-weight="700" style="fill:var(--text-2)"' : ''}>${wd(d)}</text><text x="${x(i)}" y="${H - 3}" text-anchor="middle">${dm(d)}</text>`;
    });
    svg += '</g><line id="xh" y1="' + m.t + '" y2="' + (H - m.b) + '" stroke="var(--muted)" stroke-dasharray="3 3" opacity="0"/>';
    const labels = [];
    for (const s of series) {
      const pts = s.days.map((x0, i) => x0.min != null ? [x(i), y(x0.min)] : null);
      // Đường nét liền giữa các điểm có dữ liệu liên tiếp
      let dPath = '', pen = false;
      pts.forEach(p => { if (p) { dPath += (pen ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); pen = true; } else pen = false; });
      svg += `<path d="${dPath}" fill="none" stroke="${s.r.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
      pts.forEach((p, i) => {
        if (!p) return;
        const isMin = s.best && s.days[i] === s.best;
        svg += `<circle cx="${p[0]}" cy="${p[1]}" r="${isMin ? 5.5 : 4}" fill="${isMin ? s.r.color : 'var(--surface)'}" stroke="${isMin ? 'var(--surface)' : s.r.color}" stroke-width="2"/>`;
      });
      if (series.length <= 4) {
        const lastI = pts.map((p, i) => p ? i : -1).filter(i => i >= 0).pop();
        if (lastI != null) labels.push({ y: pts[lastI][1], x: pts[lastI][0], text: `${s.r.from}→${s.r.to}` });
      }
      if (s.best) {
        const i = s.days.indexOf(s.best);
        // nhãn đặt dưới điểm nếu phía trên có điểm của chặng khác
        const py = y(s.best.min), clash = series.some(o => o !== s && o.days[i].min != null && Math.abs(y(o.days[i].min) - (py - 12)) < 13);
        svg += `<text x="${x(i)}" y="${clash ? py + 20 : py - 10}" text-anchor="middle" font-size="11" font-weight="700" fill="var(--text)">${short(s.best.min)}</text>`;
      }
    }
    // Nhãn trực tiếp ở cuối đường — tránh chồng nhau
    labels.sort((a, b) => a.y - b.y);
    for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 14) labels[i].y = labels[i - 1].y + 14;
    for (const l of labels) svg += `<text x="${W - m.r + 10}" y="${l.y + 4}" font-size="11.5" font-weight="600" fill="var(--text-2)">${l.text}</text>`;
    svg += `<rect id="hit" x="${m.l - 10}" y="0" width="${W - m.l - m.r + 20}" height="${H - m.b}" fill="transparent" style="cursor:crosshair"/></svg>`;
    host.innerHTML = svg;

    const hit = host.querySelector('#hit'), xh = host.querySelector('#xh'), svgEl = host.querySelector('svg');
    const idxAt = ev => {
      const r = svgEl.getBoundingClientRect(), px = (ev.clientX - r.left) * (W / r.width);
      return n === 1 ? 0 : Math.max(0, Math.min(n - 1, Math.round((px - m.l) / ((W - m.l - m.r) / (n - 1)))));
    };
    hit.addEventListener('mousemove', ev => {
      const i = idxAt(ev), d = snap.dates[i];
      xh.setAttribute('x1', x(i)); xh.setAttribute('x2', x(i)); xh.setAttribute('opacity', 1);
      const rows = series.map(s => ({ s, v: s.days[i].min, f: s.days[i].best })).sort((a, b) => (a.v ?? 1e15) - (b.v ?? 1e15));
      showTip(ev, `<div class="t">${WD_FULL[parseIso(d).getDay()]}, ${dm(d)}</div>` + rows.map(o =>
        `<div class="r"><span><i style="--c:${o.s.r.color}"></i>${o.s.r.from}→${o.s.r.to}${o.f ? ` · ${esc(o.f.airline)} ${hhmm(o.f.dep)}` : ''}</span><b class="num">${o.v != null ? money(o.v) : '—'}</b></div>`).join('')
        + '<div class="muted" style="margin-top:4px">Bấm để xem chuyến</div>');
    });
    hit.addEventListener('mouseleave', () => { xh.setAttribute('opacity', 0); hideTip(); });
    hit.addEventListener('click', ev => {
      const d = snap.dates[idxAt(ev)];
      ui.date = d; ui.selected = null; ui.limit = 50;
      hideTip(); render();
      $('#explorer').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  const tip = $('#tip');
  function showTip(ev, html) {
    tip.innerHTML = html; tip.classList.add('show');
    const r = tip.getBoundingClientRect();
    let left = ev.clientX + 14, top = ev.clientY + 14;
    if (left + r.width > innerWidth - 8) left = ev.clientX - r.width - 14;
    if (top + r.height > innerHeight - 8) top = ev.clientY - r.height - 14;
    tip.style.left = left + 'px'; tip.style.top = top + 'px';
  }
  function hideTip() { tip.classList.remove('show'); }

  // ───── heatmap ─────
  function drawHeat(D) {
    const dark = getComputedStyle(document.documentElement).colorScheme === 'dark';
    const head = `<tr><th class="rh"></th>${snap.dates.map(d => `<th class="${isWeekend(d) ? 'we' : ''}">${wd(d)}<br><span class="num">${dm(d)}</span></th>`).join('')}</tr>`;
    const rows = D.stats.map(s => `<tr><th class="rh"><b>${s.r.from} → ${s.r.to}</b><small>${esc(s.r.fromName)} – ${esc(s.r.toName)}</small></th>${s.days.map(x => {
      const key = `${s.r.key}|${x.d}`;
      const sel = ui.selected === key ? ' sel' : '';
      if (x.min == null) {
        const st = x.c.status;
        const txt = st === 'running' ? '…' : st === 'queued' ? '' : st === 'error' ? '⚠' : '—';
        return `<td><button class="hc${st === 'running' || st === 'queued' ? ' pending' : ''}${sel}" data-k="${key}" data-tip="${esc(st === 'error' ? 'Lỗi: ' + (x.c.err || '') : st === 'done' ? 'Không có chuyến' : 'Đang quét')}">${txt}</button></td>`;
      }
      const t = s.hi > s.lo ? (x.min - s.lo) / (s.hi - s.lo) : 0;
      const step = Math.round(t * 5);
      const fg = dark ? (step >= 3 ? '#0b0b0b' : '#ffffff') : (step >= 3 ? '#ffffff' : '#0b0b0b');
      const isBest = x === s.best && s.days.filter(y => y.min != null).length > 1;
      return `<td><button class="hc${isBest ? ' best' : ''}${sel}" style="--bgc:var(--seq-${step});--fg:${fg}" data-k="${key}">
        <b class="num">${short(x.min)}</b><small>${esc(x.best.airline)} · ${hhmm(x.best.dep)}</small></button></td>`;
    }).join('')}</tr>`).join('');
    $('#heat').innerHTML = `<table><thead>${head}</thead><tbody>${rows}</tbody></table>
      <div class="scale"><span>Rẻ</span><span class="bar">${[0, 1, 2, 3, 4, 5].map(i => `<i style="background:var(--seq-${i})"></i>`).join('')}</span><span>Đắt</span>
      <span>· so sánh trong cùng một chặng · ★ ngày rẻ nhất · bấm ô để xem tất cả chuyến</span></div>`;
    $('#heat').querySelectorAll('.hc').forEach(b => {
      const [rk, d] = b.dataset.k.split('|');
      b.onclick = () => openCell(rk, d);
      b.onmousemove = ev => {
        const s = D.stats.find(z => z.r.key === rk), x0 = s.days.find(z => z.d === d);
        if (b.dataset.tip) return showTip(ev, `<div class="t">${rk.replace('-', ' → ')} · ${wd(d)} ${dm(d)}</div>${esc(b.dataset.tip)}`);
        const top = x0.fl.slice(0, 3);
        showTip(ev, `<div class="t">${rk.replace('-', ' → ')} · ${WD_FULL[parseIso(d).getDay()]} ${dm(d)}</div>` + top.map(f =>
          `<div class="r"><span>${chip(f.airline, f.airlineName)} ${esc(f.no)} ${hhmm(f.dep)}</span><b class="num">${money(f.price)}</b></div>`).join('')
          + `<div class="muted" style="margin-top:4px">${x0.fl.length} chuyến${s.hi > s.lo ? ` · đắt hơn ngày rẻ nhất ${short(x0.min - s.lo)}` : ''}</div>`);
      };
      b.onmouseleave = hideTip;
    });
  }

  // ───── explorer ─────
  function drawExplorer(D) {
    let rows = [];
    for (const s of D.stats) {
      if (ui.route !== 'all' && ui.route !== s.r.key) continue;
      for (const x of s.days) {
        if (ui.date !== 'all' && ui.date !== x.d) continue;
        for (const f of x.fl) rows.push({ ...f, rk: s.r.key, d: x.d, isMin: f === x.best, isWeekMin: s.best && f === s.best.best });
      }
    }
    const airlines = [...new Set(rows.map(f => f.airline))].sort((a, b) => (AIRLINE_ORDER.indexOf(a) + 1 || 99) - (AIRLINE_ORDER.indexOf(b) + 1 || 99));
    rows = rows.filter(f => !ui.airlinesOff.has(f.airline) && (ui.bucket === 'all' || bucketOf(f) === ui.bucket));
    const sorters = {
      price: (a, b) => a.price - b.price,
      dep: (a, b) => (a.d + a.dep).localeCompare(b.d + b.dep),
      dur: (a, b) => a.dur - b.dur || a.price - b.price,
    };
    rows.sort(sorters[ui.sort] || sorters.price);

    const seg = (key, opts) => `<div class="seg" data-seg="${key}">${opts.map(([v, l]) => `<button data-v="${v}" class="${ui[key] === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    const el = $('#explorer');
    el.innerHTML = `<div class="filters">
        <select id="fRoute"><option value="all">Tất cả chặng</option>${D.routes.map(r => `<option value="${r.key}" ${ui.route === r.key ? 'selected' : ''}>${r.from} → ${r.to}</option>`).join('')}</select>
        <select id="fDate"><option value="all">Cả ${snap.dates.length} ngày</option>${snap.dates.map(d => `<option value="${d}" ${ui.date === d ? 'selected' : ''}>${WD_FULL[parseIso(d).getDay()]}, ${dm(d)}</option>`).join('')}</select>
        <span class="sep"></span>
        ${seg('bucket', [['all', 'Cả ngày'], ['sang', 'Sáng'], ['chieu', 'Chiều'], ['toi', 'Tối']])}
        <label class="seg" style="padding:0 10px;height:32px;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" id="fDirect" ${ui.direct ? 'checked' : ''}> Bay thẳng</label>
        <span class="sep"></span>
        <span class="chips" id="fAir">${airlines.map(a => `<button class="${ui.airlinesOff.has(a) ? 'off' : ''}" data-a="${esc(a)}" aria-pressed="${!ui.airlinesOff.has(a)}">${chip(a)}</button>`).join('')}</span>
        <span class="grow"></span>
        <span class="muted num">${rows.length.toLocaleString('vi-VN')} chuyến</span>
      </div>
      ${rows.length ? `<div class="tbl"><table class="fl">
        <thead><tr>
          <th>Chặng</th><th data-sort="dep" class="${ui.sort === 'dep' ? 'on' : ''}">Ngày / giờ ${ui.sort === 'dep' ? '↑' : ''}</th><th>Hãng</th><th>Chuyến</th>
          <th data-sort="dur" class="${ui.sort === 'dur' ? 'on' : ''}">Thời gian ${ui.sort === 'dur' ? '↑' : ''}</th><th>Hạng vé</th>
          <th data-sort="price" class="r ${ui.sort === 'price' ? 'on' : ''}">Giá ${ui.sort === 'price' ? '↑' : ''}</th></tr></thead>
        <tbody>${rows.slice(0, ui.limit).map(f => `<tr>
          <td><b>${f.rk.replace('-', ' → ')}</b></td>
          <td class="num">${wd(f.d)} ${dm(f.d)} · <b>${hhmm(f.dep)}</b> → ${hhmm(f.arr)}</td>
          <td>${chip(f.airline, f.airlineName)} <span class="muted">${esc(f.airlineName || AIRLINE_NAME[f.airline] || '')}</span></td>
          <td class="num">${esc(f.no)}</td>
          <td class="num">${dur(f.dur)} <span class="muted">${f.stops ? `· ${f.stops} điểm dừng` : '· thẳng'}</span></td>
          <td class="muted">${esc(f.fare === f.cls ? f.fare : `${f.fare || ''} ${f.cls || ''}`.trim())}</td>
          <td class="r p num">${f.oldPrice ? `<del>${money(f.oldPrice)}</del>` : ''}${money(f.price)}${f.isWeekMin ? '<span class="badge">rẻ nhất tuần</span>' : f.isMin && ui.date === 'all' ? '<span class="badge">rẻ nhất ngày</span>' : ''}</td>
        </tr>`).join('')}</tbody></table></div>
        ${rows.length > ui.limit ? `<button class="more" id="more">Xem thêm ${Math.min(50, rows.length - ui.limit)} chuyến</button>` : ''}`
      : `<div class="muted" style="padding:40px;text-align:center">Không có chuyến phù hợp bộ lọc</div>`}`;

    $('#fRoute').onchange = e => { ui.route = e.target.value; ui.selected = null; ui.limit = 50; render(); };
    $('#fDate').onchange = e => { ui.date = e.target.value; ui.selected = null; ui.limit = 50; render(); };
    $('#fDirect').onchange = e => { ui.direct = e.target.checked; saveUi(); render(); };
    el.querySelectorAll('[data-seg] button').forEach(b => b.onclick = () => { ui[b.parentElement.dataset.seg] = b.dataset.v; saveUi(); render(); });
    el.querySelectorAll('#fAir button').forEach(b => b.onclick = () => { const a = b.dataset.a; ui.airlinesOff.has(a) ? ui.airlinesOff.delete(a) : ui.airlinesOff.add(a); render(); });
    el.querySelectorAll('th[data-sort]').forEach(th => th.onclick = () => { ui.sort = th.dataset.sort; saveUi(); render(); });
    const more = $('#more');
    if (more) more.onclick = () => { ui.limit += 50; render(); };
  }

  let rz;
  addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => snap && render(), 150); });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => render());
})();
