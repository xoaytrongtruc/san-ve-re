// Build bản web (GitHub Pages) từ dashboard của extension → docs/
//   node scripts/build-web.js
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const ext = path.join(root, 'extension');
const out = path.join(root, 'docs');
const REPO = 'https://github.com/xoaytrongtruc/san-ve-re';
const ZIP = `${REPO}/releases/latest/download/san-ve-re-extension.zip`;

fs.mkdirSync(out, { recursive: true });
for (const f of ['dashboard.js', 'page-search.js', 'icon16.png', 'icon48.png', 'icon128.png']) {
  fs.copyFileSync(path.join(ext, f), path.join(out, f));
}

const banner = `
<div class="wrap tight" id="webBanner">
  <div class="card webban">
    <div class="wb-ic">✈</div>
    <div class="wb-tx">
      <b>Bản xem trước với dữ liệu mẫu.</b>
      <span>Để quét giá thật, cài extension <b>Săn Vé Rẻ</b> cho Chrome (1 lần, ~30 giây) rồi bấm icon ✈ trên thanh công cụ.</span>
    </div>
    <a class="go wb-btn" href="${ZIP}">⬇ Tải extension</a>
    <a class="ibtn" href="${REPO}#cài-đặt-1-lần-30-giây" target="_blank" rel="noopener">Hướng dẫn</a>
  </div>
</div>`;
const css = `
  .webban { margin-top: 18px; padding: 14px 16px; display: flex; flex-wrap: wrap; gap: 12px 16px; align-items: center; border-color: var(--accent); }
  .webban .wb-ic { width: 40px; height: 40px; border-radius: 10px; background: var(--accent); color: #fff; display: grid; place-items: center; font-size: 20px; flex: none; }
  .webban .wb-tx { flex: 1 1 320px; display: grid; gap: 2px; color: var(--text-2); }
  .webban .wb-tx b:first-child { color: var(--text); }
  .webban a { text-decoration: none; display: inline-flex; align-items: center; }
`;

let html = fs.readFileSync(path.join(ext, 'dashboard.html'), 'utf8');
const must = (needle) => { if (!html.includes(needle)) throw new Error('dashboard.html thiếu: ' + needle); };
must('</header>'); must('</style>'); must('<title>Săn Vé Rẻ</title>');
html = html
  .replace('<title>Săn Vé Rẻ</title>', `<title>Săn Vé Rẻ</title>
<meta name="description" content="Quét giá mọi hãng bay, tìm chuyến rẻ nhất từng chặng trong tuần.">
<meta property="og:title" content="Săn Vé Rẻ">
<meta property="og:description" content="Quét giá mọi hãng bay, tìm chuyến rẻ nhất từng chặng trong tuần.">`)
  .replace('</style>', css + '</style>')
  .replace('</header>', '</header>' + banner);
fs.writeFileSync(path.join(out, 'index.html'), html);
fs.writeFileSync(path.join(out, '.nojekyll'), '');
console.log('docs/ đã build xong');
