// Hàm này được chrome.scripting.executeScript tiêm vào tab airbookingonline.com (world: MAIN),
// nên phải TỰ CHỨA hoàn toàn — không dùng biến bên ngoài.
// 1 lượt = reCAPTCHA của trang → POST /CreateProBooking → token từng hãng → POST /ApiSearch/ song song.
async function pageSearch(route, dateIso, pax, names) {
  const pad = n => String(n).padStart(2, '0');
  const [Y, M, D] = dateIso.split('-').map(Number);
  const dmy = `${pad(D)}/${pad(M)}/${Y}`;
  const fail = (error, fatal = false) => ({ ok: false, error, fatal });

  try {
    // ── Mẫu form (CSRF token, mã khuyến mãi đại lý) — cache trên window của tab ──
    if (!window.__svrTpl) {
      const pick = doc => doc.querySelector('#SearchProForm, form[action*="CreateProBooking"]');
      const docs = [document];
      let form = pick(document);
      for (const url of ['/', '/ProBooking/']) {
        if (form) break;
        const res = await fetch(url, { credentials: 'include' });
        if (/login/i.test(res.url)) return fail('Chưa đăng nhập airbookingonline.com', true);
        const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
        docs.push(doc);
        form = pick(doc);
      }
      if (!form) {
        const isLogin = /đăng nhập/i.test(document.title) || document.querySelector('input[name=password]');
        return fail(isLogin ? 'Chưa đăng nhập airbookingonline.com' : 'Không tìm thấy form tìm vé trên trang', true);
      }
      const entries = [...new FormData(form)].filter(([, v]) => typeof v === 'string');
      let csrf = entries.find(([k]) => k === '__RequestVerificationToken')?.[1];
      if (!csrf) csrf = docs.map(d => d.querySelector('input[name="__RequestVerificationToken"]')?.value).find(Boolean) || '';
      const el = document.querySelector('[data-sitekey]');
      const src = [...document.scripts].map(s => s.src).find(s => /recaptcha\/api\.js\?render=/.test(s));
      const siteNames = {};
      for (const d of docs) d.querySelectorAll('li.item-air[data-code][data-city]').forEach(li => { siteNames[li.dataset.code] = li.dataset.city; });
      window.__svrTpl = {
        entries, csrf, siteNames,
        sitekey: el?.dataset.sitekey || (src && new URL(src).searchParams.get('render')) || '6Le0v4shAAAAADYUZ70Lv3I4iP9EVDLF3gG42cxz',
      };
    }
    const tpl = window.__svrTpl;

    // ── reCAPTCHA v3 của chính trang ──
    if (!window.grecaptcha?.execute) {
      window.__svrRc ||= new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = `https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(tpl.sitekey)}`;
        s.onload = resolve;
        s.onerror = () => reject(new Error('Không tải được reCAPTCHA'));
        document.head.appendChild(s);
      });
      await window.__svrRc;
    }
    await new Promise(r => window.grecaptcha.ready(r));
    const captcha = await window.grecaptcha.execute(tpl.sitekey, { action: 'homepage' });

    // ── Form tìm vé một chiều ──
    const city = c => (tpl.siteNames[c] || names[c] || c).toLocaleUpperCase('vi');
    const p = new URLSearchParams();
    p.append('__RequestVerificationToken', tpl.csrf);
    p.append('g_recaptcha_response', captcha);
    p.append('TypeTrip', 'O');
    p.append('Flight_0__departure', city(route.from));
    p.append('Flight[0].departureplace', `${city(route.from)} (${route.from})`);
    p.append('Flight[0].departurecode', route.from);
    p.append('Flight_0__arrival', city(route.to));
    p.append('Flight[0].arrivalplace', `${city(route.to)} (${route.to})`);
    p.append('Flight[0].arrivalcode', route.to);
    p.append('Flight[0].departuredate', dmy);
    p.append('Flight[0].arrivaldate', dmy);
    const overridden = /^(__RequestVerificationToken|g_recaptcha_response|TypeTrip|Calendar|adult|child|infant)$|^Flight|^Check/;
    for (const [k, v] of tpl.entries) if (!overridden.test(k)) p.append(k, v);
    if (!p.has('FlightType')) p.append('FlightType', '1');
    p.append('Calendar', 'false');
    p.append('adult', String(pax));
    p.append('child', '0');
    p.append('infant', '0');
    const checks = [...new Set(tpl.entries.map(([k]) => k).filter(k => /^Check/.test(k)))];
    for (const k of checks.length ? checks : ['CheckALL', 'CheckVNA', 'CheckBBA', 'CheckVJ', 'CheckVU']) {
      if (k === 'CheckALL') p.append(k, 'true');
      p.append(k, 'false');
    }

    const res = await fetch('/CreateProBooking', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: p,
    });
    if (/login/i.test(res.url)) { window.__svrTpl = null; return fail('Phiên đăng nhập đã hết — đăng nhập lại', true); }
    const html = await res.text();
    const m = html.match(/Postresult\(\s*(\[\s*(?:"[^"]*"\s*,?\s*)*\])\s*\)/);
    if (!m) { window.__svrTpl = null; return fail('Server không trả phiên tìm kiếm (reCAPTCHA hoặc phiên bị từ chối)'); }
    const tokens = JSON.parse(m[1]);

    // ── Gọi từng hãng song song, rút gọn JSON vài MB → danh sách chuyến ──
    const best = new Map();
    let okSources = 0;
    await Promise.all(tokens.map(async token => {
      try {
        const r = await fetch('/ApiSearch/', {
          method: 'POST', credentials: 'include',
          headers: {
            'Content-Type': 'application/json; charset=UTF-8',
            'Accept': 'application/json, text/javascript, */*; q=0.01',
            'X-Requested-With': 'XMLHttpRequest',
          },
          body: JSON.stringify({ token }),
        });
        const txt = await r.text();
        okSources++;
        if (!txt) return;
        const json = JSON.parse(txt);
        for (const g of json?.ArrivalFlights || []) {
          for (const it of [...(g.ArrivalFlightItems || []), ...(g.GlobalFlightItems || [])]) {
            const li = it?.LowestInventory;
            if (!li || it.DepartureCode !== route.from || it.ArrivalCode !== route.to) continue;
            if (String(it.DepartureDate1).slice(0, 10) !== dateIso) continue;
            const price = (li.SumPrice || 0) + (li.SumTaxSales || 0); // giống giá trang hiển thị
            if (price <= 0) continue;
            const dep = new Date(it.DepartureDate1), arr = new Date(it.DepartureDate2);
            const segs = it.DepartureStopInfos || [];
            const f = {
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
            };
            const k = `${f.airline}|${f.no}|${f.dep}`;
            if (!best.has(k) || f.price < best.get(k).price) best.set(k, f);
          }
        }
      } catch { /* lỗi 1 hãng không làm hỏng cả lượt */ }
    }));
    if (!okSources && tokens.length) return fail('Không hãng nào phản hồi');
    const flights = [...best.values()].sort((a, b) => a.price - b.price || a.dep.localeCompare(b.dep));
    return { ok: true, flights, sources: tokens.length };
  } catch (e) {
    return fail(String(e?.message || e));
  }
}
