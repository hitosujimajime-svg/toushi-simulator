const $ = (id) => document.getElementById(id);
const yen = (n) => '¥' + Math.round(n).toLocaleString('ja-JP');
const pct = (n) => (n >= 0 ? '+' : '') + (n * 100).toFixed(1) + '%';
const sign = (n) => (n >= 0 ? 'pos' : 'neg');

const holdings = []; // {symbol, name, amount}
let chart = null;

// ---------- 初期値 ----------
(function init() {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 10);
  $('start').value = d.toISOString().slice(0, 10);
  $('start').max = new Date().toISOString().slice(0, 10);
  $('mode').addEventListener('change', syncMode);
  syncMode();
  $('searchBtn').addEventListener('click', search);
  $('q').addEventListener('keydown', (e) => { if (e.key === 'Enter') search(); });
  $('run').addEventListener('click', run);
  renderHoldings();
})();

function syncMode() {
  const dca = $('mode').value === 'dca';
  $('dayWrap').style.display = dca ? '' : 'none';
  $('amountHint').textContent = (dca ? '金額は「毎月の積立額」です。' : '金額は「一括購入の総額」です。') +
    '米国株などは購入日の為替レートで円換算します。';
}

// ---------- 銘柄検索 ----------
async function search() {
  const q = $('q').value.trim();
  if (!q) return;
  const ul = $('results');
  ul.innerHTML = '<li>検索中...</li>';
  try {
    const r = await fetch('/api/search?q=' + encodeURIComponent(q));
    const j = await r.json();
    if (j.error) throw new Error(j.error);
    const items = (j.quotes || []).filter((x) => x.symbol && ['EQUITY', 'ETF', 'MUTUALFUND', 'INDEX'].includes(x.quoteType));
    ul.innerHTML = '';
    items.forEach((x) => addResult(ul, x.symbol, x.longname || x.shortname || x.symbol, `${x.exchDisp || ''} ${x.quoteType}`));
    // コード直接指定
    const direct = /^\d{4}$/.test(q) ? q + '.T' : q.toUpperCase();
    addResult(ul, direct, direct, 'このコードをそのまま追加');
  } catch (e) {
    ul.innerHTML = '';
    setStatus('検索に失敗しました: ' + e.message, true);
  }
}

// ---------- 投資信託 ----------
const FUND_PRESETS = [
  { symbol: 'fund:JP90C000H1T1:03311187', name: 'eMAXIS Slim 全世界株式(オール・カントリー)' },
  { symbol: 'fund:JP90C000GKC6:0331418A', name: 'eMAXIS Slim 米国株式(S&P500)' },
];
$('fundSel').innerHTML = '<option value="">投資信託を選択...</option>' +
  FUND_PRESETS.map((f, i) => `<option value="${i}">${f.name}</option>`).join('');
$('fundSel').addEventListener('change', () => {
  const f = FUND_PRESETS[$('fundSel').value];
  if (f) addHolding(f.symbol, f.name);
  $('fundSel').value = '';
});
$('fundAdd').addEventListener('click', () => {
  const isin = $('fundIsin').value.trim().toUpperCase();
  const code = $('fundCode').value.trim().toUpperCase();
  if (!/^[A-Z0-9]{12}$/.test(isin) || !/^[A-Z0-9]{8}$/.test(code)) return setStatus('ISINは12桁、協会コードは8桁で入力してください。', true);
  const name = $('fundName').value.trim() || `投資信託 ${code}`;
  addHolding(`fund:${isin}:${code}`, name);
  setStatus('');
});

function addHolding(symbol, name) {
  if (!holdings.some((h) => h.symbol === symbol)) holdings.push({ symbol, name, amount: 100000 });
  renderHoldings();
}

function addResult(ul, symbol, name, note) {
  const li = document.createElement('li');
  const l = document.createElement('span');
  l.textContent = name;
  const r = document.createElement('span');
  r.className = 'sym';
  r.textContent = `${symbol} · ${note}`;
  li.append(l, r);
  li.addEventListener('click', () => {
    if (!holdings.some((h) => h.symbol === symbol)) holdings.push({ symbol, name, amount: 100000 });
    $('results').innerHTML = '';
    $('q').value = '';
    renderHoldings();
  });
  ul.appendChild(li);
}

function renderHoldings() {
  const tb = document.querySelector('#holdings tbody');
  tb.innerHTML = '';
  holdings.forEach((h, i) => {
    const tr = document.createElement('tr');
    const name = document.createElement('td');
    name.textContent = h.symbol.startsWith('fund:') ? h.name : `${h.name} (${h.symbol})`;
    const cur = document.createElement('td');
    cur.textContent = h.currency || '-';
    const amt = document.createElement('td');
    const inp = document.createElement('input');
    inp.type = 'number'; inp.min = '1'; inp.step = '1000'; inp.value = h.amount;
    inp.addEventListener('input', () => { h.amount = Number(inp.value); });
    amt.appendChild(inp);
    const rm = document.createElement('td');
    const b = document.createElement('button');
    b.className = 'rm'; b.textContent = '×'; b.title = '削除';
    b.addEventListener('click', () => { holdings.splice(i, 1); renderHoldings(); });
    rm.appendChild(b);
    tr.append(name, cur, amt, rm);
    tb.appendChild(tr);
  });
  $('emptyMsg').style.display = holdings.length ? 'none' : '';
}

function setStatus(msg, err) {
  const s = $('status');
  s.textContent = msg;
  s.className = 'status' + (err ? ' err' : '');
}

// ---------- データ取得 ----------
const seriesCache = new Map();

async function loadSeries(symbol, from, useAdj) {
  const key = `${symbol}|${from}|${useAdj}`;
  if (seriesCache.has(key)) return seriesCache.get(key);
  if (symbol.startsWith('fund:')) { // fund:ISIN:協会コード
    const [, isin, code] = symbol.split(':');
    const r = await fetch(`/api/fund?isin=${isin}&code=${code}`);
    const j = await r.json();
    if (j.error) throw new Error(`${symbol}: ${j.error}`);
    seriesCache.set(key, j);
    return j;
  }
  const r = await fetch(`/api/chart?symbol=${encodeURIComponent(symbol)}&from=${from}`);
  const j = await r.json();
  if (j.error) throw new Error(`${symbol}: ${j.error}`);
  const res = j.chart && j.chart.result && j.chart.result[0];
  if (!res || !res.timestamp) throw new Error(`${symbol} のデータが見つかりません`);
  const off = res.meta.gmtoffset || 0;
  const close = res.indicators.quote[0].close;
  const adj = res.indicators.adjclose && res.indicators.adjclose[0].adjclose;
  const px = useAdj && adj ? adj : close;
  const dates = [], prices = [];
  res.timestamp.forEach((t, i) => {
    if (px[i] != null && px[i] > 0) {
      dates.push(new Date((t + off) * 1000).toISOString().slice(0, 10));
      prices.push(px[i]);
    }
  });
  if (!dates.length) throw new Error(`${symbol} の価格データがありません`);
  const out = { dates, prices, currency: res.meta.currency || 'JPY' };
  seriesCache.set(key, out);
  return out;
}

// d 以前で最後のインデックス(なければ 0)
function idxAtOrBefore(dates, d) {
  let lo = 0, hi = dates.length - 1, ans = 0;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (dates[m] <= d) { ans = m; lo = m + 1; } else hi = m - 1;
  }
  return ans;
}
// d 以降で最初のインデックス(なければ -1)
function idxAtOrAfter(dates, d) {
  let lo = 0, hi = dates.length - 1, ans = -1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (dates[m] >= d) { ans = m; hi = m - 1; } else lo = m + 1;
  }
  return ans;
}

function purchaseTargets(mode, start, day, end) {
  if (mode === 'lump') return [start];
  const out = [];
  let y = Number(start.slice(0, 4)), m = Number(start.slice(5, 7));
  for (;;) {
    const d = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (d > end) break;
    if (d >= start) out.push(d);
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}

function xirr(flows) { // flows: [{date, amount}] 投資は負、回収は正
  const t0 = new Date(flows[0].date).getTime();
  const f = (r) => flows.reduce((s, c) => s + c.amount / Math.pow(1 + r, (new Date(c.date).getTime() - t0) / 31557600000), 0);
  let lo = -0.99, hi = 20;
  if (f(lo) * f(hi) > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (f(lo) * f(mid) <= 0) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
}

// ---------- シミュレーション ----------
async function run() {
  if (!holdings.length) return setStatus('銘柄を追加してください。', true);
  if (holdings.some((h) => !(h.amount > 0))) return setStatus('金額は1円以上で入力してください。', true);
  const start = $('start').value;
  if (!start) return setStatus('開始日を入力してください。', true);
  const mode = $('mode').value;
  const day = Math.min(28, Math.max(1, Number($('day').value) || 1));
  const useAdj = $('div').checked;

  $('run').disabled = true;
  setStatus('データ取得中...');
  try {
    const loaded = await Promise.all(holdings.map((h) => loadSeries(h.symbol, start, useAdj)));
    const fxNeeded = [...new Set(loaded.map((s) => s.currency).filter((c) => c !== 'JPY'))];
    const fxSeries = {};
    await Promise.all(fxNeeded.map(async (c) => {
      fxSeries[c] = await loadSeries(`${c}JPY=X`, start, false);
    }));
    loaded.forEach((s, i) => { holdings[i].currency = s.currency; });
    renderHoldings();

    const fxAt = (cur, d) => {
      if (cur === 'JPY') return 1;
      const s = fxSeries[cur];
      return s.prices[idxAtOrBefore(s.dates, d)];
    };

    const warnings = [];
    const results = []; // 銘柄ごとの結果
    holdings.forEach((h, i) => {
      const s = loaded[i];
      const last = s.dates[s.dates.length - 1];
      const events = [];
      for (const t of purchaseTargets(mode, start, day, last)) {
        const k = idxAtOrAfter(s.dates, t);
        if (k < 0) continue;
        const d = s.dates[k];
        const fx = fxAt(s.currency, d);
        events.push({ date: d, amount: h.amount, shares: h.amount / (s.prices[k] * fx) });
      }
      if (!events.length) throw new Error(`${h.symbol}: 開始日以降に購入可能な日がありません`);
      if (events[0].date > addDays(start, 10)) warnings.push(`${h.name} は ${events[0].date} からのデータのため、その日から購入したものとして計算しました。`);
      results.push({ h, s, events });
    });

    // 共通タイムライン
    const first = results.map((r) => r.events[0].date).sort()[0];
    const dateSet = new Set();
    results.forEach((r) => r.s.dates.forEach((d) => { if (d >= first) dateSet.add(d); }));
    const timeline = [...dateSet].sort();
    const endDate = timeline[timeline.length - 1];

    const perHolding = results.map((r) => {
      const vals = [], inv = [];
      let ei = 0, shares = 0, invested = 0;
      timeline.forEach((d) => {
        while (ei < r.events.length && r.events[ei].date <= d) { shares += r.events[ei].shares; invested += r.events[ei].amount; ei++; }
        const k = idxAtOrBefore(r.s.dates, d);
        vals.push(shares > 0 ? shares * r.s.prices[k] * fxAt(r.s.currency, d) : 0);
        inv.push(invested);
      });
      return { vals, inv };
    });

    const totalVals = timeline.map((_, i) => perHolding.reduce((s, p) => s + p.vals[i], 0));
    const totalInv = timeline.map((_, i) => perHolding.reduce((s, p) => s + p.inv[i], 0));
    render(results, perHolding, timeline, totalVals, totalInv, endDate, warnings);
    setStatus(warnings.join(' '));
  } catch (e) {
    setStatus('エラー: ' + e.message, true);
  } finally {
    $('run').disabled = false;
  }
}

function addDays(d, n) {
  const t = new Date(d + 'T00:00:00Z');
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

function render(results, per, timeline, totalVals, totalInv, endDate, warnings) {
  $('out').hidden = false;
  const n = timeline.length - 1;
  const val = totalVals[n], inv = totalInv[n], gain = val - inv;

  const allFlows = results.flatMap((r) => r.events.map((e) => ({ date: e.date, amount: -e.amount })))
    .sort((a, b) => a.date.localeCompare(b.date));
  allFlows.push({ date: endDate, amount: val });
  const totalX = xirr(allFlows);

  const stat = (k, v, cls) => `<div class="stat"><div class="k">${k}</div><div class="v ${cls || ''}">${v}</div></div>`;
  $('summary').innerHTML =
    stat('投資総額', yen(inv)) +
    stat('現在の評価額', yen(val)) +
    stat('損益', (gain >= 0 ? '+' : '-') + yen(Math.abs(gain)), sign(gain)) +
    stat('損益率', inv ? pct(gain / inv) : '-', sign(gain)) +
    stat('年率(XIRR)', totalX == null ? '-' : pct(totalX), totalX != null ? sign(totalX) : '');

  const tb = document.querySelector('#detail tbody');
  tb.innerHTML = '';
  results.forEach((r, i) => {
    const v = per[i].vals[n], iv = per[i].inv[n], g = v - iv;
    const flows = r.events.map((e) => ({ date: e.date, amount: -e.amount }));
    flows.push({ date: endDate, amount: v });
    const x = xirr(flows);
    const tr = document.createElement('tr');
    tr.innerHTML = `<td></td><td>${yen(iv)}</td><td>${yen(v)}</td>
      <td class="${sign(g)}">${g >= 0 ? '+' : '-'}${yen(Math.abs(g))}</td>
      <td class="${sign(g)}">${pct(g / iv)}</td>
      <td class="${x == null ? '' : sign(x)}">${x == null ? '-' : pct(x)}</td>`;
    tr.firstChild.textContent = r.h.symbol.startsWith('fund:') ? r.h.name : `${r.h.name} (${r.h.symbol})`;
    tb.appendChild(tr);
  });

  const palette = ['#e8710a', '#0f9d58', '#9334e6', '#00acc1', '#c2185b', '#7cb342'];
  const datasets = [
    { label: '評価額(合計)', data: totalVals, borderColor: '#2563eb', borderWidth: 2.5, pointRadius: 0 },
    { label: '投資額(合計)', data: totalInv, borderColor: '#8b94a7', borderWidth: 2, borderDash: [6, 4], pointRadius: 0, stepped: true },
  ];
  if (results.length > 1) {
    results.forEach((r, i) => datasets.push({
      label: r.h.name, data: per[i].vals, borderColor: palette[i % palette.length], borderWidth: 1.2, pointRadius: 0, hidden: false,
    }));
  }
  if (chart) chart.destroy();
  chart = new Chart($('chart'), {
    type: 'line',
    data: { labels: timeline, datasets },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: { ticks: { maxTicksLimit: 8 } },
        y: { ticks: { callback: (v) => '¥' + (v / 10000).toLocaleString('ja-JP') + '万' } },
      },
      plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${yen(c.parsed.y)}` } } },
    },
  });
  $('out').scrollIntoView({ behavior: 'smooth' });
}
