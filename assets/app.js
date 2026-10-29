'use strict';

const PLATFORMS = {
  naver: {
    label: '네이버 시리즈', color: '--naver',
    metrics: [{ key: 'views', label: '조회수' }, { key: 'comments', label: '댓글' }],
  },
  munpia: {
    label: '문피아', color: '--munpia',
    metrics: [{ key: 'views', label: '조회수' }, { key: 'likes', label: '좋아요(추천)' }, { key: 'prefers', label: '선호작' }],
  },
};
const RANGES = [['7', '7일'], ['30', '30일'], ['90', '90일'], ['all', '전체']];
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];

const state = { work: null, tab: 'summary', range: '30', metric: 'views' };
let index = null;
let doc = null;
let charts = [];

// ---------- 도우미 ----------

const $ = (sel) => document.querySelector(sel);
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => (n == null ? '–' : Number(n).toLocaleString('ko-KR'));

function short(n) {
  if (n == null) return '–';
  const a = Math.abs(n);
  const trim = (x) => (Math.round(x * 10) / 10).toString();
  if (a >= 1e8) return trim(n / 1e8) + '억';
  if (a >= 1e4) return trim(n / 1e4) + '만';
  if (a >= 1e3) return trim(n / 1e3) + '천';
  return String(n);
}
// 네이버는 원래 반올림 값이라 짧은 표기, 문피아는 정확한 값이라 쉼표 표기
const valueFmt = (p) => (p === 'naver' ? short : fmt);

function signed(n, f = fmt) {
  if (n == null) return '';
  if (n > 0) return `<span class="up">▲ ${f(n)}</span>`;
  if (n < 0) return `<span class="down">▼ ${f(-n)}</span>`;
  return '<span>변동 없음</span>';
}

const parseDate = (s) => new Date(s + 'T00:00:00');
const dayDiff = (a, b) => Math.round((parseDate(b) - parseDate(a)) / 86400000);
function addDays(s, n) {
  const d = parseDate(s); d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const mmdd = (s) => `${+s.slice(5, 7)}/${+s.slice(8, 10)}`;
const fullDate = (s) => (s ? `${s.slice(0, 4)}.${s.slice(5, 7)}.${s.slice(8, 10)} (${WEEK[parseDate(s).getDay()]})` : '–');
const dotDate = (s) => (s ? `${s.slice(2, 4)}.${s.slice(5, 7)}.${s.slice(8, 10)}` : '');
const tileDate = (s) => (s ? `${dotDate(s)} (${WEEK[parseDate(s).getDay()]})` : '–');

function rowsOf(p) {
  return (doc.history || []).filter((r) => r.platform === p).sort((a, b) => (a.date < b.date ? -1 : 1));
}
// 전날 기록 대비 증가량. 수집이 빠진 날이 있으면 gap(일수)을 같이 남긴다
function withDelta(rows, key) {
  let prev = null;
  return rows.map((r) => {
    const value = r[key] ?? null;
    let delta = null, gap = null;
    if (prev && value != null) { delta = value - prev[key]; gap = dayDiff(prev.date, r.date); }
    if (value != null) prev = r;
    return { ...r, value, delta, gap };
  });
}
function inRange(rows) {
  if (state.range === 'all' || !rows.length) return rows;
  const from = addDays(rows[rows.length - 1].date, -(Number(state.range) - 1));
  return rows.filter((r) => r.date >= from);
}
const last = (arr) => arr[arr.length - 1];

// ---------- 상태(주소창 #) ----------

function readHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  for (const k of ['work', 'tab', 'range', 'metric']) if (h.get(k)) state[k] = h.get(k);
}
function writeHash() {
  const h = new URLSearchParams(state);
  history.replaceState(null, '', '#' + h.toString());
}

// ---------- 차트 ----------

function destroyCharts() { charts.forEach((c) => c.destroy()); charts = []; }

function baseOptions({ yFmt = short, reverse = false, tooltipLabel, tooltipTitle, yMin } = {}) {
  return {
    responsive: true, maintainAspectRatio: false, animation: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: css('--surface'), titleColor: css('--text'), bodyColor: css('--text-2'),
        borderColor: css('--axis'), borderWidth: 1, padding: 10, boxPadding: 4,
        callbacks: {
          title: tooltipTitle || ((items) => fullDate(items[0].label)),
          label: tooltipLabel,
        },
      },
    },
    scales: {
      x: {
        grid: { display: false }, border: { color: css('--axis') },
        ticks: { color: css('--muted'), maxRotation: 0, autoSkip: true, maxTicksLimit: 8, callback(v) { const l = this.getLabelForValue(v); return /^\d{4}-/.test(l) ? mmdd(l) : l; } },
      },
      y: {
        reverse, min: yMin, grid: { color: css('--grid') }, border: { display: false },
        ticks: { color: css('--muted'), callback: (v) => yFmt(v), precision: 0 },
      },
    },
  };
}

function makeChart(canvasId, config) {
  const el = document.getElementById(canvasId);
  if (!el) return;
  charts.push(new Chart(el, config));
}

function barDataset(label, data, color) {
  return { type: 'bar', label, data, backgroundColor: color, borderRadius: 4, borderSkipped: 'start', maxBarThickness: 28, categoryPercentage: 0.85, barPercentage: 0.9 };
}
function lineDataset(label, data, color, n) {
  return {
    type: 'line', label, data, borderColor: color, backgroundColor: color, borderWidth: 2, tension: 0.25,
    // 점이 많으면 숨기되, 앞뒤가 비어 있는 외톨이 값은 점으로 보여준다
    pointRadius: (ctx) => {
      const d = ctx.dataset.data, i = ctx.dataIndex;
      if (n <= 14) return 4;
      return d[i] != null && d[i - 1] == null && d[i + 1] == null ? 4 : 0;
    },
    pointHoverRadius: 5, pointBorderColor: css('--surface'), pointBorderWidth: 2, spanGaps: false,
  };
}

// ---------- 화면 조각 ----------

function tile(label, value, delta = '', tag = '', cls = '') {
  return `<div class="card tile ${cls}">${tag}<div class="label">${label}</div><div class="value">${value}</div><div class="delta">${delta || '&nbsp;'}</div></div>`;
}
function platformTag(p) {
  return `<div class="platform-tag"><span class="dot" style="background:var(${PLATFORMS[p].color})"></span>${PLATFORMS[p].label}</div>`;
}
function seg(name, items, current) {
  return `<div class="seg" role="group">${items.map(([v, l]) =>
    `<button type="button" data-${name}="${esc(v)}" aria-pressed="${v === current}">${esc(l)}</button>`).join('')}</div>`;
}
function rankText(v) { return v == null ? '순위권 밖' : `${v}위`; }

function deltaLine(rows, key, f) {
  const r = last(withDelta(rows, key));
  if (!r || r.delta == null) return '';
  const span = r.gap > 1 ? `${r.gap}일간` : '전일 대비';
  return `${span} ${signed(r.delta, f)}`;
}
function sumRecent(rows, key, days) {
  const d = withDelta(rows, key);
  if (!d.length) return null;
  const from = addDays(last(d).date, -(days - 1));
  const picked = d.filter((r) => r.date >= from && r.delta != null);
  return picked.length ? picked.reduce((s, r) => s + r.delta, 0) : null;
}

function eventsHtml(platforms) {
  const evs = (doc.events || []).filter((e) => platforms.includes(e.platform))
    .sort((a, b) => (b.active - a.active) || ((b.startedAt || b.firstSeen) > (a.startedAt || a.firstSeen) ? 1 : -1));
  if (!evs.length) return '<p class="empty">기록된 이벤트가 없습니다.</p>';
  return `<ul class="list">${evs.map((e) => {
    const start = e.startedAt || e.firstSeen;
    const when = e.active ? `${dotDate(start)} ~ 진행 중` : `${dotDate(start)} ~ ${dotDate(e.lastSeen)}`;
    return `<li>${e.active ? '<span class="pill on">진행 중</span>' : '<span class="pill">종료</span>'}
      <span class="name">${esc(e.name)}</span><span class="muted small">${esc(PLATFORMS[e.platform]?.label)} · ${esc(e.detail || '')}</span>
      <span class="when">${when}</span></li>`;
  }).join('')}</ul>`;
}

// ---------- 요약 탭 ----------

function renderSummary(platforms) {
  let html = '<div class="grid tiles">';
  for (const p of platforms) {
    const rows = rowsOf(p);
    const r = last(rows);
    const f = valueFmt(p);
    html += tile('누적 조회수', r ? (p === 'naver' ? esc(r.viewsText || short(r.views)) : fmt(r.views)) : '–', deltaLine(rows, 'views', f), platformTag(p));
    const week = sumRecent(rows, 'views', 7);
    html += tile('최근 7일 조회수 증가', week == null ? '–' : '+' + f(week), '', platformTag(p));
  }
  html += '</div>';

  html += `<div class="controls"><div></div>${seg('range', RANGES, state.range)}</div>`;
  html += `<div class="card"><h3>일간 조회수 증가</h3><p class="sub">하루 동안 늘어난 조회수 (플랫폼별)</p>
    <div class="legend">${platforms.map((p) => `<span style="--c:var(${PLATFORMS[p].color})">${PLATFORMS[p].label}</span>`).join('')}</div>
    <div class="chart-box tall"><canvas id="c-compare"></canvas></div></div>`;

  html += '<h2 class="section-title">연재 정보</h2><div class="card table-wrap"><table><thead><tr><th>항목</th>';
  html += platforms.map((p) => `<th>${PLATFORMS[p].label}</th>`).join('') + '</tr></thead><tbody>';
  const info = (p, k) => doc[p]?.[k];
  const rowsInfo = [
    ['연재 상태', (p) => esc(info(p, 'status') || '–')],
    ['연재 시작일', (p) => fullDate(info(p, 'startDate'))],
    ['최근 연재일', (p) => fullDate(info(p, 'lastEpisodeDate'))],
    ['회차', (p) => (info(p, 'chapters') != null ? `${fmt(info(p, 'chapters'))}화` : '–')],
    ['평점', (p) => (info(p, 'rating') != null ? `★ ${info(p, 'rating')}` : '–')],
    ['오늘 최고 순위', (p) => {
      const r = last(rowsOf(p));
      if (!r) return '–';
      return p === 'naver'
        ? `${esc(info(p, 'genre') || '장르')} 일간 ${rankText(r.rankGenreBest)} · 전체 ${rankText(r.rankAllBest)}`
        : `${esc(info(p, 'rankType') || '투데이 베스트')} ${rankText(r.rankBest)}`;
    }],
  ];
  for (const [label, fn] of rowsInfo) html += `<tr><td>${label}</td>${platforms.map((p) => `<td>${fn(p)}</td>`).join('')}</tr>`;
  html += '</tbody></table></div>';

  html += `<h2 class="section-title">이벤트 이력</h2><div class="card">${eventsHtml(platforms)}</div>`;
  $('#tab-body').innerHTML = html;

  // 두 플랫폼 날짜를 합쳐 한 축에
  const dates = [...new Set(platforms.flatMap((p) => rowsOf(p).map((r) => r.date)))].sort();
  const shown = inRange(dates.map((date) => ({ date }))).map((r) => r.date);
  const datasets = platforms.map((p) => {
    const m = new Map(withDelta(rowsOf(p), 'views').map((r) => [r.date, r]));
    return { ...lineDataset(PLATFORMS[p].label, shown.map((d) => m.get(d)?.delta ?? null), css(PLATFORMS[p].color), shown.length), _rows: shown.map((d) => m.get(d)) };
  });
  makeChart('c-compare', {
    type: 'line', data: { labels: shown, datasets },
    options: baseOptions({
      tooltipLabel: (ctx) => {
        const r = ctx.dataset._rows[ctx.dataIndex];
        if (!r || r.delta == null) return `${ctx.dataset.label}: 기록 없음`;
        return `${ctx.dataset.label}: +${fmt(r.delta)}${r.gap > 1 ? ` (${r.gap}일간)` : ''}`;
      },
    }),
  });
}

// ---------- 플랫폼 탭 ----------

function renderPlatform(p) {
  const P = PLATFORMS[p];
  const info = doc[p] || {};
  const rows = rowsOf(p);
  const r = last(rows);
  const f = valueFmt(p);
  if (!P.metrics.some((m) => m.key === state.metric)) state.metric = 'views';
  const metric = P.metrics.find((m) => m.key === state.metric);

  let html = '';
  if (info.lastError) html += `<p class="notice-box err">최근 수집 실패: ${esc(info.lastError)}</p>`;

  html += '<div class="grid tiles">';
  for (const m of P.metrics) {
    const text = p === 'naver' && r ? r[m.key + 'Text'] : null;
    html += tile(`누적 ${m.label}`, r ? esc(text || f(r[m.key])) : '–', deltaLine(rows, m.key, f));
  }
  if (p === 'naver') {
    html += tile('평점', info.rating != null ? `★ ${info.rating}` : '–');
    html += tile(`${esc(info.genre || '장르')} 일간 순위`, r ? rankText(r.rankGenreBest) : '–', r ? `지금 ${rankText(r.rankGenre)}` : '');
    html += tile('전체 일간 순위', r ? rankText(r.rankAllBest) : '–', r ? `지금 ${rankText(r.rankAll)}` : '');
  } else {
    html += tile(esc(info.rankType || '투데이 베스트'), r ? rankText(r.rankBest) : '–', r ? `오늘 최고 · 지금 ${rankText(r.rank)}` : '');
    html += tile('글자 수', fmt(info.characters));
  }
  html += tile('회차', info.chapters != null ? `${fmt(info.chapters)}화` : '–', info.freeChapters ? `무료 ${info.freeChapters}화` : '');
  html += tile('연재 시작일', tileDate(info.startDate), info.paidConversionDate ? `유료 전환 ${dotDate(info.paidConversionDate)}` : '', '', 'date');
  html += tile('최근 연재일', tileDate(info.lastEpisodeDate), info.serialDays?.length ? `연재 요일 ${info.serialDays.join('·')}` : '', '', 'date');
  html += '</div>';

  html += `<div class="controls">${seg('metric', P.metrics.map((m) => [m.key, m.label]), state.metric)}${seg('range', RANGES, state.range)}</div>`;

  html += `<div class="grid two">
    <div class="card"><h3>일간 ${metric.label} 증가</h3><p class="sub">전날 기록 대비 늘어난 양</p><div class="chart-box"><canvas id="c-delta"></canvas></div></div>
    <div class="card"><h3>누적 ${metric.label}</h3><p class="sub">매일 마지막 수집 기준</p><div class="chart-box"><canvas id="c-total"></canvas></div></div>
  </div>`;

  const rankLegend = p === 'naver'
    ? `<div class="legend"><span style="--c:var(--naver)">${esc(info.genre || '장르')} 일간</span><span style="--c:var(--series-3)">전체 일간</span></div>`
    : '';
  html += `<div class="card" style="margin-top:12px"><h3>순위 추이</h3><p class="sub">하루 중 최고 순위 · 위로 갈수록 상위 (${p === 'naver' ? 'TOP100' : 'TOP200'} 밖이면 비어 있음)</p>${rankLegend}
    <div class="chart-box"><canvas id="c-rank"></canvas></div></div>`;

  // 일별 기록 표
  const cols = P.metrics.map((m) => ({ ...m, rows: new Map(withDelta(rows, m.key).map((x) => [x.date, x])) }));
  const tableRows = inRange(rows).slice().reverse();
  html += `<h2 class="section-title">일별 기록</h2><div class="card table-wrap" style="max-height:420px"><table><thead><tr><th>날짜</th>
    ${cols.map((c) => `<th>${c.label}</th><th>증가</th>`).join('')}${p === 'naver' ? '<th>장르 순위</th><th>전체 순위</th>' : '<th>순위</th>'}</tr></thead><tbody>
    ${tableRows.map((row) => `<tr><td>${fullDate(row.date)}</td>${cols.map((c) => {
      const x = c.rows.get(row.date);
      return `<td>${p === 'naver' && row[c.key + 'Text'] ? esc(row[c.key + 'Text']) : f(row[c.key])}</td><td>${x?.delta == null ? '–' : (x.delta >= 0 ? '+' : '') + f(x.delta)}</td>`;
    }).join('')}${p === 'naver'
      ? `<td>${rankText(row.rankGenreBest)}</td><td>${rankText(row.rankAllBest)}</td>`
      : `<td>${rankText(row.rankBest)}</td>`}</tr>`).join('')}
    </tbody></table></div>`;

  html += `<div class="grid two" style="margin-top:28px">
    <div class="card"><h3>이벤트 이력</h3><p class="sub">작품 페이지에 노출된 이벤트를 매일 기록</p>${eventsHtml([p])}</div>`;
  if (p === 'munpia') {
    const notices = (doc.notices || []).filter((n) => n.platform === p).sort((a, b) => ((b.date || '') > (a.date || '') ? 1 : -1));
    html += `<div class="card"><h3>작가 공지</h3><p class="sub">문피아 작품 공지 목록</p>${notices.length
      ? `<ul class="list">${notices.map((n) => `<li><span class="name">${esc(n.title)}</span><span class="when">${dotDate(n.date)}</span></li>`).join('')}</ul>`
      : '<p class="empty">공지가 없습니다.</p>'}</div>`;
  }
  html += '</div>';

  if (p === 'munpia') html += munpiaExtras(info);
  $('#tab-body').innerHTML = html;

  // 차트
  const color = css(P.color);
  const shown = inRange(withDelta(rows, metric.key));
  const labels = shown.map((x) => x.date);
  makeChart('c-delta', {
    type: 'bar', data: { labels, datasets: [barDataset(`${metric.label} 증가`, shown.map((x) => x.delta), color)] },
    options: baseOptions({
      tooltipLabel: (ctx) => {
        const x = shown[ctx.dataIndex];
        return x.delta == null ? '이전 기록 없음' : `+${fmt(x.delta)}${x.gap > 1 ? ` (${x.gap}일간)` : ''}`;
      },
    }),
  });
  makeChart('c-total', {
    type: 'line', data: { labels, datasets: [lineDataset(`누적 ${metric.label}`, shown.map((x) => x.value), color, shown.length)] },
    options: baseOptions({ tooltipLabel: (ctx) => `누적 ${metric.label}: ${fmt(ctx.raw)}` }),
  });
  const rankSets = p === 'naver'
    ? [lineDataset(`${info.genre || '장르'} 일간`, shown.map((x) => x.rankGenreBest ?? null), color, shown.length),
       lineDataset('전체 일간', shown.map((x) => x.rankAllBest ?? null), css('--series-3'), shown.length)]
    : [lineDataset(info.rankType || '투데이 베스트', shown.map((x) => x.rankBest ?? null), color, shown.length)];
  makeChart('c-rank', {
    type: 'line', data: { labels, datasets: rankSets },
    options: baseOptions({ reverse: true, yMin: 1, yFmt: (v) => `${v}위`, tooltipLabel: (ctx) => `${ctx.dataset.label}: ${rankText(ctx.raw)}` }),
  });
  if (p === 'munpia') renderChapterChart();
}

function munpiaExtras(info) {
  let html = `<div class="card" style="margin-top:12px"><h3>회차별 조회수</h3><p class="sub">문피아 회차 목록 기준 · 최근 수집 ${esc((doc.chapters?.updatedAt || '').slice(0, 16).replace('T', ' '))}</p>
    <div class="chart-box tall"><canvas id="c-chapters"></canvas></div></div>`;
  const rd = info.readers;
  if (rd) {
    const total = (rd.male || 0) + (rd.female || 0);
    const bar = (label, pct, num) => `<div class="row"><span>${label}</span><div class="track"><div class="fill" style="width:${Math.max(0, Math.min(100, pct))}%"></div></div><span class="num">${num}</span></div>`;
    html += `<div class="grid two" style="margin-top:12px">
      <div class="card bars-h"><h3>독자 성별</h3><p class="sub">문피아 독자 통계</p>
        ${bar('남성', total ? rd.male / total * 100 : 0, total ? `${(rd.male / total * 100).toFixed(1)}%` : '–')}
        ${bar('여성', total ? rd.female / total * 100 : 0, total ? `${(rd.female / total * 100).toFixed(1)}%` : '–')}</div>
      <div class="card bars-h"><h3>독자 연령</h3><p class="sub">문피아 독자 통계</p>
        ${[['10대', rd.age10s], ['20대', rd.age20s], ['30대', rd.age30s], ['40대', rd.age40s], ['50대+', rd.age50s]].map(([l, v]) => bar(l, v, v == null ? '–' : `${v}%`)).join('')}</div>
    </div>`;
  }
  return html;
}

function renderChapterChart() {
  const list = doc.chapters?.munpia || [];
  if (!list.length) return;
  const color = css('--munpia');
  makeChart('c-chapters', {
    type: 'bar',
    data: { labels: list.map((c) => `${c.num}화`), datasets: [barDataset('조회수', list.map((c) => c.views), color)] },
    options: baseOptions({
      tooltipTitle: (items) => { const c = list[items[0].dataIndex]; return `${c.num}화 ${c.title}`; },
      tooltipLabel: (ctx) => {
        const c = list[ctx.dataIndex];
        return [`조회 ${fmt(c.views)} · 좋아요 ${fmt(c.likes)} · 댓글 ${fmt(c.comments)}`, `${fullDate(c.date)} · ${c.free ? '무료' : '유료'}`];
      },
    }),
  });
}

// ---------- 전체 그리기 ----------

function render() {
  destroyCharts();
  if (!doc) return;
  const platforms = Object.keys(PLATFORMS).filter((p) => doc[p]);
  if (state.tab !== 'summary' && !platforms.includes(state.tab)) state.tab = 'summary';
  writeHash();

  const base = doc.munpia || doc.naver || {};
  const cover = doc.naver?.cover || doc.munpia?.cover;
  const tags = [...new Set([...(doc.munpia?.genres || []), ...(doc.munpia?.tags || []), doc.naver?.genre].filter(Boolean))];
  const live = platforms.flatMap((p) => (doc.events || []).filter((e) => e.platform === p && e.active).map((e) => e));

  let html = `<section class="hero">
    ${cover ? `<img src="${esc(cover)}" alt="" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">` : ''}
    <div><h2>${esc(base.title || doc.name)}</h2>
      <p class="meta">${esc(base.author || '')}${doc.naver?.publisher ? ` · ${esc(doc.naver.publisher)}` : ''}</p>
      <div class="chips">
        ${platforms.map((p) => `<a class="chip" href="${esc(doc[p].url)}" target="_blank" rel="noopener"><span class="dot" style="background:var(${PLATFORMS[p].color})"></span>${PLATFORMS[p].label}${doc[p].status ? ` · ${esc(doc[p].status)}` : ''}</a>`).join('')}
        ${live.length ? '<span class="chip live">이벤트 진행 중</span>' : ''}
        ${tags.map((t) => `<span class="chip">#${esc(t)}</span>`).join('')}
      </div></div></section>`;
  html += `<div class="controls">${seg('tab', [['summary', '요약'], ...platforms.map((p) => [p, PLATFORMS[p].label])], state.tab)}</div>`;
  html += '<div id="tab-body"></div>';
  $('#app').innerHTML = html;

  if (state.tab === 'summary') renderSummary(platforms); else renderPlatform(state.tab);
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tab],button[data-range],button[data-metric]');
  if (!b) return;
  for (const k of ['tab', 'range', 'metric']) if (b.dataset[k]) state[k] = b.dataset[k];
  render();
});
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', render);
window.addEventListener('hashchange', () => {
  const prevWork = state.work;
  readHash();
  if (state.work !== prevWork) loadWork(state.work).catch(showError); else render();
});

async function loadJson(path) {
  const res = await fetch(`${path}?t=${Date.now()}`);
  if (!res.ok) throw new Error(`${path} (${res.status})`);
  return res.json();
}

async function loadWork(id) {
  state.work = id;
  doc = await loadJson(`data/${encodeURIComponent(id)}.json`);
  const u = doc.updatedAt ? doc.updatedAt.slice(0, 16).replace('T', ' ') : '';
  $('#updated').textContent = u ? `마지막 수집 ${u}` : '';
  render();
}

async function init() {
  readHash();
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  try {
    index = await loadJson('data/index.json');
  } catch (err) {
    $('#app').innerHTML = '<p class="notice-box">아직 수집된 데이터가 없습니다. GitHub Actions에서 첫 수집이 끝나면 표시됩니다.</p>';
    return;
  }
  const works = index.works || [];
  if (!works.length) { $('#app').innerHTML = '<p class="notice-box">config.json에 작품을 추가해 주세요.</p>'; return; }
  const sel = $('#work-select');
  if (works.length > 1) {
    sel.hidden = false;
    sel.innerHTML = works.map((w) => `<option value="${esc(w.id)}">${esc(w.name)}</option>`).join('');
    sel.addEventListener('change', () => loadWork(sel.value).catch(showError));
  }
  const id = works.some((w) => w.id === state.work) ? state.work : works[0].id;
  sel.value = id;
  await loadWork(id);
}
function showError(err) {
  $('#app').innerHTML = `<p class="notice-box err">데이터를 불러오지 못했습니다: ${esc(err.message)}</p>`;
}
init().catch(showError);
