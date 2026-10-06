// 依存パッケージなしのローカルサーバー。静的配信 + Yahoo Finance へのプロキシ(CORS回避)。
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36';
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const cache = new Map(); // url -> {t, body}
const TTL = 10 * 60 * 1000;

async function yahoo(url) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.t < TTL) return hit.body;
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Yahoo Finance が ${res.status} を返しました`);
  const body = await res.text();
  cache.set(url, { t: Date.now(), body });
  return body;
}

function sendJson(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(text);
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (u.pathname === '/api/chart') {
      const symbol = u.searchParams.get('symbol');
      const from = u.searchParams.get('from'); // YYYY-MM-DD
      if (!symbol || !from) return sendJson(res, 400, '{"error":"symbol と from が必要です"}');
      const p1 = Math.floor(new Date(from + 'T00:00:00Z').getTime() / 1000) - 86400 * 7;
      const p2 = Math.floor(Date.now() / 1000) + 86400;
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${p1}&period2=${p2}&interval=1d&events=div%7Csplit`;
      return sendJson(res, 200, await yahoo(url));
    }
    if (u.pathname === '/api/fund') {
      // 投信総合検索ライブラリー(投資信託協会)の基準価額CSV
      const isin = u.searchParams.get('isin');
      const code = u.searchParams.get('code');
      if (!/^[A-Z0-9]{12}$/i.test(isin || '') || !/^[A-Z0-9]{8}$/i.test(code || '')) {
        return sendJson(res, 400, '{"error":"ISINコード(12桁)と協会コード(8桁)が必要です"}');
      }
      const url = `https://toushin-lib.fwg.ne.jp/FdsWeb/FDST030000/csv-file-download?isinCd=${isin}&associFundCd=${code}`;
      const hit = cache.get(url);
      if (hit && Date.now() - hit.t < TTL) return sendJson(res, 200, hit.body);
      const r = await fetch(url, { headers: { 'User-Agent': UA } });
      const buf = Buffer.from(await r.arrayBuffer());
      const text = new TextDecoder('shift_jis').decode(buf);
      const dates = [], prices = [];
      for (const line of text.split(/\r?\n/).slice(1)) {
        const m = line.match(/^(\d{4})年(\d{2})月(\d{2})日,([\d.]+)/);
        if (m) { dates.push(`${m[1]}-${m[2]}-${m[3]}`); prices.push(Number(m[4])); }
      }
      if (!dates.length) return sendJson(res, 404, '{"error":"投資信託のデータが取得できませんでした(コードをご確認ください)"}');
      const body = JSON.stringify({ dates, prices, currency: 'JPY' });
      cache.set(url, { t: Date.now(), body });
      return sendJson(res, 200, body);
    }
    if (u.pathname === '/api/search') {
      const q = u.searchParams.get('q');
      if (!q) return sendJson(res, 400, '{"error":"q が必要です"}');
      const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0&lang=ja-JP&region=JP`;
      return sendJson(res, 200, await yahoo(url));
    }
    // 静的ファイル
    let file = u.pathname === '/' ? '/index.html' : decodeURIComponent(u.pathname);
    const full = path.normalize(path.join(PUBLIC, file));
    if (!full.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
    fs.readFile(full, (err, data) => {
      if (err) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
      res.end(data);
    });
  } catch (e) {
    sendJson(res, 502, JSON.stringify({ error: e.message }));
  }
});

server.listen(PORT, () => console.log(`http://localhost:${PORT} で起動しました`));
