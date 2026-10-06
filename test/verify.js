// アプリとは独立に Yahoo Finance を直接叩き、一括購入の期待値を計算する。
// 使い方: node test/verify.js  → 期待値をJSONで出力(アプリの画面結果と比較する)
const UA = { 'User-Agent': 'Mozilla/5.0' };
const cases = [
  { symbol: 'VOO', start: '2020-01-06', adj: false },
  { symbol: 'VOO', start: '2015-03-02', adj: true },
  { symbol: '7203.T', start: '2020-01-06', adj: false },
  { symbol: 'AAPL', start: '2018-05-01', adj: true },
  { symbol: '2559.T', start: '2022-06-01', adj: false },
];
const AMOUNT = 1000000;

async function get(symbol, from) {
  const p1 = Math.floor(new Date(from + 'T00:00:00Z') / 1000) - 604800;
  const p2 = Math.floor(Date.now() / 1000) + 86400;
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?period1=${p1}&period2=${p2}&interval=1d&events=div%7Csplit`, { headers: UA });
  const res = (await r.json()).chart.result[0];
  const off = res.meta.gmtoffset || 0;
  const adj = res.indicators.adjclose?.[0].adjclose, close = res.indicators.quote[0].close;
  return { cur: res.meta.currency, rows: res.timestamp.map((t, i) => ({ d: new Date((t + off) * 1000).toISOString().slice(0, 10), close: close[i], adj: adj ? adj[i] : close[i] })).filter((x) => x.close != null) };
}

(async () => {
  const out = [];
  for (const c of cases) {
    const s = await get(c.symbol, c.start);
    const fx = s.cur === 'JPY' ? null : await get(s.cur + 'JPY=X', c.start);
    const fxAt = (d) => { if (!fx) return 1; let v = fx.rows[0].close; for (const r of fx.rows) { if (r.d <= d) v = r.close; else break; } return v; };
    const px = (r) => (c.adj ? r.adj : r.close);
    const buy = s.rows.find((r) => r.d >= c.start), last = s.rows[s.rows.length - 1];
    const shares = AMOUNT / (px(buy) * fxAt(buy.d));
    out.push({ ...c, buyDate: buy.d, buyPx: px(buy), buyFx: fxAt(buy.d), endDate: last.d, value: Math.round(shares * px(last) * fxAt(last.d)) });
  }
  console.log(JSON.stringify(out));
})();
