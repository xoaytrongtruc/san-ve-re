// Săn Vé Rẻ — dashboard server (Node thuần, không cần npm install)
//   node server.js        → http://localhost:8787
// Userscript đẩy kết quả quét vào POST /api/push; dashboard nhận realtime qua SSE.

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 8787;
const DATA_DIR = path.join(__dirname, 'data');
const LATEST = path.join(DATA_DIR, 'latest.json');
const HISTORY = path.join(DATA_DIR, 'history.json');
const INDEX = path.join(__dirname, 'public', 'index.html');
const MAX_BODY = 20 * 1024 * 1024;
const HISTORY_PER_CELL = 60;

fs.mkdirSync(DATA_DIR, { recursive: true });
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };

let latest = readJson(LATEST, null);
// `${route}|${date}` → [{ ts, min }] — giá rẻ nhất mỗi lần quét xong ô đó
let history = readJson(HISTORY, {});
const clients = new Set();

let saveTimer;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFile(LATEST, JSON.stringify(latest), () => {});
    fs.writeFile(HISTORY, JSON.stringify(history), () => {});
  }, 500);
}

function recordHistory(snap) {
  for (const [key, cell] of Object.entries(snap.cells || {})) {
    if (cell.status !== 'done' || cell.cached || !cell.flights?.length) continue;
    const min = Math.min(...cell.flights.map(f => f.price));
    const list = history[key] ||= [];
    const last = list[list.length - 1];
    // cùng một lượt quét có thể đẩy nhiều lần — chỉ ghi khi là lượt mới
    if (last && last.scan === snap.scanId) { last.min = min; continue; }
    list.push({ ts: snap.updatedAt, scan: snap.scanId, min });
    if (list.length > HISTORY_PER_CELL) list.splice(0, list.length - HISTORY_PER_CELL);
  }
}

function payload() {
  if (!latest) return { snapshot: null, history: {} };
  const keys = Object.keys(latest.cells || {});
  return { snapshot: latest, history: Object.fromEntries(keys.filter(k => history[k]).map(k => [k, history[k]])) };
}

function broadcast() {
  const msg = `data: ${JSON.stringify(payload())}\n\n`;
  for (const res of clients) res.write(msg);
}

function cors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  // Chrome Private/Local Network Access: trang https công khai gọi vào localhost
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  res.setHeader('Vary', 'Origin');
}

const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  cors(req, res);

  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    return fs.readFile(INDEX, (err, buf) => {
      if (err) return json(res, 500, { error: 'Thiếu public/index.html' });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(buf);
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/state') return json(res, 200, payload());

  if (req.method === 'GET' && url.pathname === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(`data: ${JSON.stringify(payload())}\n\n`);
    clients.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => { clearInterval(ping); clients.delete(res); });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/push') {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) { json(res, 413, { error: 'Payload quá lớn' }); req.destroy(); }
      else chunks.push(c);
    });
    req.on('end', () => {
      if (res.writableEnded) return;
      let snap;
      try { snap = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return json(res, 400, { error: 'JSON không hợp lệ' }); }
      if (!snap || typeof snap.cells !== 'object' || !Array.isArray(snap.routes)) return json(res, 400, { error: 'Sai định dạng snapshot' });
      snap.updatedAt ||= Date.now();
      latest = snap;
      recordHistory(snap);
      persist();
      broadcast();
      json(res, 200, { ok: true, clients: clients.size });
    });
    return;
  }

  json(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => {
  console.log(`✈  Săn Vé Rẻ dashboard: http://localhost:${PORT}`);
  console.log(latest ? `   Đã nạp lần quét gần nhất (${new Date(latest.updatedAt).toLocaleString('vi-VN')})` : '   Chưa có dữ liệu — chạy userscript trên airbookingonline.com để bắt đầu.');
});
