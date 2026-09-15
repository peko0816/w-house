// ============ Constants ============
const DAY_NAMES = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const MEALS = [
  { key: 'breakfast', label: '早餐' },
  { key: 'lunch', label: '午餐' },
  { key: 'dinner', label: '晚餐' }
];
const BREAKFAST_CATEGORIES = [
  { key: 'staple', label: '主食' },
  { key: 'side', label: '小菜' },
  { key: 'drink', label: '饮品' }
];
const RATING_HINTS = ['未评分', '不满意', '一般', '还行', '不错', '很棒'];

// Migrate any old-format breakfast dishes (that had a `day` field per day)
// into the new shared-week format keyed by category.
function normalizeDishes(dishes) {
  const out = [];
  const bfSeen = new Set();
  for (const d of (dishes || [])) {
    if (d.meal === 'breakfast') {
      const cat = d.category || 'staple';
      const key = cat + '||' + d.name;
      if (bfSeen.has(key)) continue;
      bfSeen.add(key);
      out.push({ id: d.id, meal: 'breakfast', category: cat, name: d.name, description: d.description || '' });
    } else {
      out.push({ id: d.id, meal: d.meal, day: d.day, name: d.name, description: d.description || '' });
    }
  }
  return out;
}

// ============ State ============
const state = {
  isAdmin: false,
  aiEnabled: false,
  nickname: '',
  clientId: '',
  menusList: [],
  activeMenuIndex: 0,
  activeMenu: null,
  reviews: [],
  replies: {},
  activeDishId: null,
  mobileActiveDay: 0,
  mobileDayAutoSet: false,
  breakfastCollapsed: false,
  consoleTab: 'all',
  pollTimer: null,
  openReplyFor: null,
  replyDrafts: {},
};

// ============ localStorage ============
const LS = {
  nickname: 'sy.nick',
  clientId: 'sy.cid',
  myReviews: 'sy.mine'
};
function getClientId() {
  let id = null;
  try { id = localStorage.getItem(LS.clientId); } catch {}
  if (!id) {
    id = 'c_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
    try { localStorage.setItem(LS.clientId, id); } catch {}
  }
  return id;
}
function getNickname() { try { return localStorage.getItem(LS.nickname) || ''; } catch { return ''; } }
function setNickname(n) { try { localStorage.setItem(LS.nickname, n); } catch {}; state.nickname = n; updateNicknameDisplay(); }
function getMyReviews() {
  try { return JSON.parse(localStorage.getItem(LS.myReviews) || '[]'); }
  catch { return []; }
}
function pushMyReview(entry) {
  const list = getMyReviews();
  list.unshift(entry);
  try { localStorage.setItem(LS.myReviews, JSON.stringify(list.slice(0, 300))); } catch {}
}

// ============ Utilities ============
function pad2(n) { return n < 10 ? '0' + n : '' + n; }
function isoDate(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
function parseDate(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function mondayOf(d) {
  const dd = new Date(d);
  const day = dd.getDay();
  const diff = (day === 0 ? -6 : 1 - day);
  dd.setDate(dd.getDate() + diff);
  dd.setHours(0, 0, 0, 0);
  return dd;
}
function daysAdd(d, n) { const dd = new Date(d); dd.setDate(dd.getDate() + n); return dd; }
function isoWeekNum(d) {
  const dd = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dn = dd.getUTCDay() || 7;
  dd.setUTCDate(dd.getUTCDate() + 4 - dn);
  const yearStart = new Date(Date.UTC(dd.getUTCFullYear(), 0, 1));
  return Math.ceil((((dd - yearStart) / 86400000) + 1) / 7);
}
function weekLabelFrom(startIso) {
  const start = parseDate(startIso);
  const end = daysAdd(start, 6);
  const fmt = d => `${d.getMonth()+1}/${d.getDate()}`;
  return {
    title: `第 ${isoWeekNum(start)} 周`,
    range: `${fmt(start)} – ${fmt(end)} · ${start.getFullYear()}`
  };
}
function relativeTime(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前';
  if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前';
  const days = Math.floor(diff / 86400000);
  if (days < 7) return days + '天前';
  const d = new Date(ts);
  return `${d.getMonth()+1}月${d.getDate()}日`;
}
function newId(p) { return p + '_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }

function toast(msg, kind = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast' + (kind ? ' ' + kind : '');
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.hidden = true, 2600);
}

// ============ DOM helpers ============
function el(tag, attrs = {}, children = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on')) e[k] = v;
    else if (v === true) e.setAttribute(k, '');
    else if (v === false || v == null) {}
    else e.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null || c === false) continue;
    if (typeof c === 'string') e.appendChild(document.createTextNode(c));
    else e.appendChild(c);
  }
  return e;
}

function openSheet(id) {
  document.getElementById('overlay').hidden = false;
  document.getElementById(id).hidden = false;
  document.body.style.overflow = 'hidden';
}
function closeAllSheets() {
  document.getElementById('overlay').hidden = true;
  ['dish-sheet','editor-sheet','console-sheet','my-feedback-sheet'].forEach(id =>
    document.getElementById(id).hidden = true
  );
  document.body.style.overflow = '';
  state.activeDishId = null;
}

// ============ API ============
async function api(path, options = {}) {
  const r = await fetch(path, {
    credentials: 'include',
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  const ct = r.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await r.json().catch(() => ({})) : {};
  if (!r.ok) {
    const err = new Error(data.error || `HTTP ${r.status}`);
    err.code = data.error;
    err.status = r.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function fetchSession() {
  try {
    const s = await api('/api/session');
    state.isAdmin = !!s.isAdmin;
    state.aiEnabled = !!s.aiEnabled;
  } catch (e) {
    state.isAdmin = false;
    state.aiEnabled = false;
  }
}

async function fetchMenus() {
  const list = await api('/api/menus');
  state.menusList = list.map(m => ({ ...m, dishes: normalizeDishes(m.dishes) }));
  if (!state.menusList.length) {
    state.activeMenu = null;
    state.activeMenuIndex = 0;
    return;
  }
  if (state.activeMenu) {
    const idx = state.menusList.findIndex(m => m.id === state.activeMenu.id);
    state.activeMenuIndex = idx >= 0 ? idx : 0;
  } else {
    state.activeMenuIndex = 0;
  }
  state.activeMenu = state.menusList[state.activeMenuIndex];
}

async function fetchReviewsAndReplies() {
  if (!state.activeMenu) { state.reviews = []; state.replies = {}; return; }
  const menuId = state.activeMenu.id;
  try {
    const [reviews, replies] = await Promise.all([
      api(`/api/reviews?menu_id=${encodeURIComponent(menuId)}&client_id=${encodeURIComponent(state.clientId)}`),
      api(`/api/replies?menu_id=${encodeURIComponent(menuId)}`)
    ]);
    state.reviews = reviews;
    const m = {};
    for (const r of replies) m[r.review_id] = r;
    state.replies = m;
  } catch (e) {
    console.error('fetch reviews/replies failed', e);
  }
}

// ============ Init ============
async function init() {
  state.clientId = getClientId();
  state.nickname = getNickname();
  updateNicknameDisplay();
  if (!state.nickname) promptNickname();

  wireEvents();

  await fetchSession();
  updateAdminUI();

  try {
    await fetchMenus();
    await fetchReviewsAndReplies();
    defaultMobileDayToToday();
  } catch (e) {
    console.error('init fetch failed', e);
    toast('加载失败，请检查网络', 'error');
  }
  renderAll();
  updateFabVisibility();
  startPolling();
}

function defaultMobileDayToToday() {
  if (state.mobileDayAutoSet || !state.activeMenu) return;
  const start = parseDate(state.activeMenu.week_start);
  const todayStr = isoDate(new Date());
  for (let d = 0; d < 7; d++) {
    if (isoDate(daysAdd(start, d)) === todayStr) {
      state.mobileActiveDay = d;
      break;
    }
  }
  state.mobileDayAutoSet = true;
}

function scrollActiveDayIntoView() {
  const tabs = document.getElementById('day-tabs');
  if (!tabs || getComputedStyle(tabs).display === 'none') return;
  const chip = tabs.children[state.mobileActiveDay];
  if (!chip) return;
  const containerW = tabs.clientWidth;
  const chipLeft = chip.offsetLeft;
  const chipW = chip.offsetWidth;
  let target;
  if (state.mobileActiveDay <= 1) {
    target = 0;
  } else if (state.mobileActiveDay >= 5) {
    target = tabs.scrollWidth - containerW;
  } else {
    target = chipLeft - (containerW - chipW) / 2;
  }
  tabs.scrollTo({ left: Math.max(0, target), behavior: 'smooth' });
}

function updateAdminUI() {
  document.getElementById('admin-toolbar').hidden = !state.isAdmin;
  document.getElementById('admin-badge').hidden = !state.isAdmin;
  document.getElementById('admin-login-btn').hidden = state.isAdmin;
}

function startPolling() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = setInterval(async () => {
    // Only poll when a sheet is open (user is actively engaged) or every ~2 min
    const anySheetOpen = ['dish-sheet','console-sheet','my-feedback-sheet'].some(id =>
      !document.getElementById(id).hidden);
    if (!anySheetOpen) return;
    try {
      await fetchReviewsAndReplies();
      renderAll();
    } catch {}
  }, 20000);
}

// ============ Rendering ============
function updateNicknameDisplay() {
  document.getElementById('nickname-display').textContent = state.nickname || '匿名';
}

function renderAll() {
  renderHeader();
  renderMenuGrid();
  renderDishSheetIfOpen();
  renderConsoleIfOpen();
  renderMyFeedbackIfOpen();
  updateFabVisibility();
}

function renderHeader() {
  const m = state.activeMenu;
  const wt = document.getElementById('week-title');
  const wd = document.getElementById('week-dates');
  const wm = document.getElementById('week-metadata');
  if (!m) {
    wt.textContent = '暂无菜单';
    wd.textContent = '—';
    wm.hidden = true;
    document.getElementById('prev-week').disabled = true;
    document.getElementById('next-week').disabled = true;
    return;
  }
  const w = weekLabelFrom(m.week_start);
  wt.textContent = w.title;
  wd.textContent = w.range;

  wm.hidden = false;
  document.getElementById('wm-published').textContent = m.published_at ? '发布于 ' + relativeTime(m.published_at) : '未发布';
  const uniqueNames = new Set((m.dishes || []).map(d => d.name));
  document.getElementById('wm-dishcount').textContent = `${uniqueNames.size} 道菜`;
  const visibleReviews = state.isAdmin
    ? state.reviews
    : state.reviews.filter(r => r.visible !== false);
  document.getElementById('wm-reviewcount').textContent = `${visibleReviews.length} 条反馈`;

  document.getElementById('prev-week').disabled = state.activeMenuIndex >= state.menusList.length - 1;
  document.getElementById('next-week').disabled = state.activeMenuIndex <= 0;
}

function computeDishStats(dishId) {
  let ratingSum = 0, ratedCount = 0, feedbackCount = 0;
  for (const r of state.reviews) {
    if (r.dish_id !== dishId) continue;
    if (!state.isAdmin && r.visible === false && r.client_id !== state.clientId) continue;
    feedbackCount++;
    if (typeof r.rating === 'number' && r.rating > 0) {
      ratingSum += r.rating;
      ratedCount++;
    }
  }
  return {
    avg: ratedCount ? ratingSum / ratedCount : null,
    ratedCount,
    feedbackCount
  };
}

function renderDishItem(dish) {
  const stats = computeDishStats(dish.id);
  const meta = el('div', { class: 'dish-meta' });
  if (stats.avg != null) {
    meta.appendChild(el('span', { class: 'dish-rating' }, [
      '★', el('span', { class: 'rating-value' }, stats.avg.toFixed(1))
    ]));
  }
  if (stats.feedbackCount > 0) {
    meta.appendChild(el('span', { class: 'review-count-badge' }, stats.feedbackCount + ' 条'));
  }
  const attrs = {
    class: 'dish' + (dish.description ? ' has-desc' : ''),
    onclick: () => openDishSheet(dish.id)
  };
  const wrap = el('div', attrs, [
    el('span', { class: 'dish-name' }, dish.name),
    meta
  ]);
  if (dish.description) {
    wrap.appendChild(el('span', { class: 'dish-desc-tip', 'aria-hidden': 'true' }, dish.description));
  }
  return wrap;
}

function renderMenuGrid() {
  const grid = document.getElementById('menu-grid');
  const tabs = document.getElementById('day-tabs');
  const m = state.activeMenu;

  if (!m) {
    grid.innerHTML = '';
    tabs.innerHTML = '';
    grid.appendChild(el('div', { class: 'menu-empty' }, [
      el('div', { class: 'empty-mark' }, '·'),
      el('h2', {}, state.isAdmin ? '还没有菜单' : '本周菜单尚未发布'),
      el('p', {}, state.isAdmin ? '点击「新一周菜单」创建第一份餐单。' : '请留意公告，物业管理员将很快发布。')
    ]));
    return;
  }

  const start = parseDate(m.week_start);
  const todayStr = isoDate(new Date());

  // Day tabs (mobile only)
  tabs.innerHTML = '';
  for (let d = 0; d < 7; d++) {
    const date = daysAdd(start, d);
    const isTodayFlag = isoDate(date) === todayStr;
    const active = d === state.mobileActiveDay;
    tabs.appendChild(el('button', {
      class: 'day-tab' + (active ? ' active' : '') + (isTodayFlag ? ' today' : ''),
      onclick: () => {
        state.mobileActiveDay = d;
        state.mobileDayAutoSet = true;
        state.breakfastCollapsed = true;
        renderMenuGrid();
      }
    }, [
      DAY_NAMES[d],
      el('span', { class: 'dt-date' }, `${date.getMonth()+1}/${date.getDate()}`)
    ]));
  }

  const byMeal = { breakfast: [], lunch: [], dinner: [] };
  for (const dish of (m.dishes || [])) {
    if (byMeal[dish.meal]) byMeal[dish.meal].push(dish);
  }

  grid.innerHTML = '';

  // ---------- Breakfast (shared, 3-column categorized panel) ----------
  const bfSection = el('section', {
    class: 'meal-section breakfast' + (state.breakfastCollapsed ? ' collapsed' : '')
  });
  bfSection.appendChild(el('div', {
    class: 'meal-title-row',
    role: 'button',
    tabindex: '0',
    'aria-expanded': state.breakfastCollapsed ? 'false' : 'true',
    onclick: () => {
      state.breakfastCollapsed = !state.breakfastCollapsed;
      renderMenuGrid();
    }
  }, [
    el('h2', { class: 'meal-title' }, '早餐'),
    el('span', { class: 'meal-title-note' }, '全周共用'),
    el('span', {
      class: 'collapse-chevron',
      'aria-hidden': 'true',
      html: '<svg viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg"><path d="M5 7l5 6 5-6" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    })
  ]));

  const bfByCat = {};
  for (const cat of BREAKFAST_CATEGORIES) bfByCat[cat.key] = [];
  for (const dish of byMeal.breakfast) {
    const cat = dish.category || 'staple';
    (bfByCat[cat] || bfByCat.staple).push(dish);
  }

  if (byMeal.breakfast.length === 0) {
    bfSection.appendChild(el('div', { class: 'meal-empty' }, '本周尚未安排早餐'));
  } else {
    const bfBox = el('div', { class: 'breakfast-cats' });
    for (const cat of BREAKFAST_CATEGORIES) {
      const list = bfByCat[cat.key] || [];
      if (list.length === 0) continue;
      bfBox.appendChild(el('div', { class: 'bf-cat' }, [
        el('div', { class: 'bf-cat-label' }, cat.label),
        el('div', { class: 'bf-cat-list' }, list.map(renderDishItem))
      ]));
    }
    bfSection.appendChild(bfBox);
  }
  grid.appendChild(bfSection);

  // ---------- Lunch + Dinner: 7 standalone day cards ----------
  const weekGrid = el('div', { class: 'week-grid' });
  for (let d = 0; d < 7; d++) {
    const date = daysAdd(start, d);
    const isTodayFlag = isoDate(date) === todayStr;
    const lunchList = byMeal.lunch.filter(x => x.day === d);
    const dinnerList = byMeal.dinner.filter(x => x.day === d);
    const col = el('div', {
      class: 'day-col' + (isTodayFlag ? ' today' : '') + (d === state.mobileActiveDay ? ' mobile-active' : '')
    }, [
      el('div', { class: 'day-header' }, [
        el('div', { class: 'day-name' }, DAY_NAMES[d]),
        el('div', { class: 'day-date' }, `${date.getMonth()+1}/${date.getDate()}`)
      ]),
      el('div', { class: 'meal-block' }, [
        el('div', { class: 'meal-label' }, '午餐'),
        el('div', { class: 'meal-block-list' },
          lunchList.length === 0
            ? [el('div', { class: 'dish-empty' }, '—')]
            : lunchList.map(renderDishItem))
      ]),
      el('div', { class: 'meal-block' }, [
        el('div', { class: 'meal-label' }, '晚餐'),
        el('div', { class: 'meal-block-list' },
          dinnerList.length === 0
            ? [el('div', { class: 'dish-empty' }, '—')]
            : dinnerList.map(renderDishItem))
      ])
    ]);
    weekGrid.appendChild(col);
  }
  grid.appendChild(weekGrid);

  // Ensure the active day chip is visible on mobile
  requestAnimationFrame(scrollActiveDayIntoView);
}

// ============ Dish sheet ============
function findDish(dishId) {
  if (!state.activeMenu) return null;
  return (state.activeMenu.dishes || []).find(d => d.id === dishId) || null;
}
function findDishInAnyMenu(dishId) {
  for (const m of state.menusList) {
    const d = (m.dishes || []).find(x => x.id === dishId);
    if (d) return d;
  }
  return null;
}

function openDishSheet(dishId) {
  state.activeDishId = dishId;
  state.dishFormRating = null;
  state.dishFormText = '';
  state.dishFormVisible = true;
  renderDishSheet();
  openSheet('dish-sheet');
}

function renderDishSheetIfOpen() {
  if (state.activeDishId && !document.getElementById('dish-sheet').hidden) {
    renderDishSheet();
  }
}

function reviewsForDish(dishId) {
  const list = [];
  for (const r of state.reviews) {
    if (r.dish_id !== dishId) continue;
    const isPrivate = r.visible === false;
    const mine = r.client_id === state.clientId;
    if (isPrivate && !state.isAdmin && !mine) continue;
    list.push({ ...r, _private: isPrivate, _mine: mine });
  }
  list.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
  return list;
}

function starsBar(rating, size = 14) {
  const filled = Math.round(rating);
  return `<span class="stars" style="font-size:${size}px">${'★'.repeat(filled)}${'☆'.repeat(5 - filled)}</span>`;
}

function renderDishSheet() {
  const body = document.getElementById('dish-sheet-body');
  const dish = findDish(state.activeDishId);
  if (!dish) {
    body.innerHTML = '<div class="empty-line">此菜品已不存在。</div>';
    return;
  }
  const stats = computeDishStats(dish.id);
  const meal = MEALS.find(m => m.key === dish.meal);
  const start = parseDate(state.activeMenu.week_start);
  const dishReviews = reviewsForDish(dish.id);

  let eyebrowText;
  if (dish.meal === 'breakfast') {
    const cat = BREAKFAST_CATEGORIES.find(c => c.key === (dish.category || 'staple'));
    eyebrowText = `早餐 · ${cat ? cat.label : '主食'} · 全周共用`;
  } else {
    const date = daysAdd(start, dish.day);
    eyebrowText = `${DAY_NAMES[dish.day]} · ${meal ? meal.label : ''} · ${date.getMonth()+1}月${date.getDate()}日`;
  }

  body.innerHTML = '';
  body.appendChild(el('button', {
    class: 'dish-back-btn',
    'aria-label': '返回',
    onclick: closeAllSheets,
    html: '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg><span class="dish-back-label">返回</span>'
  }));
  body.appendChild(el('div', { class: 'dish-detail-head' }, [
    el('div', { class: 'dish-detail-eyebrow' }, eyebrowText),
    el('h2', { class: 'dish-detail-name' }, dish.name),
    dish.description ? el('p', { class: 'dish-detail-desc' }, dish.description) : null
  ]));

  body.appendChild(el('div', { class: 'dish-detail-stats' }, [
    el('div', { class: 'stat-item' }, [
      el('div', { class: 'stat-label' }, '平均评分'),
      el('div', { class: 'stat-value', html: stats.avg != null
        ? `${starsBar(stats.avg, 16)}${stats.avg.toFixed(1)}<span class="stat-sub"> · ${stats.ratedCount}人</span>`
        : '<span style="color:var(--ink-3)">—</span>' })
    ]),
    el('div', { class: 'stat-item' }, [
      el('div', { class: 'stat-label' }, '反馈条数'),
      el('div', { class: 'stat-value' }, String(stats.feedbackCount))
    ])
  ]));

  body.appendChild(el('div', { class: 'section-heading' }, ['我的评价']));
  const form = el('div', { class: 'review-form' });
  form.appendChild(renderStarInput());
  const ta = el('textarea', {
    class: 'review-text',
    id: 'review-text',
    placeholder: '想对这道菜说点什么？（可留空）',
    maxlength: 500,
    oninput: e => state.dishFormText = e.target.value
  });
  ta.value = state.dishFormText || '';
  form.appendChild(ta);

  form.appendChild(el('div', { class: 'form-row' }, [
    el('div', { class: 'pill-group' + (!state.dishFormVisible ? ' private-mode' : '') }, [
      el('button', {
        class: 'pill' + (state.dishFormVisible ? ' active' : ''),
        onclick: () => setVisibility(true)
      }, '公开可见'),
      el('button', {
        class: 'pill' + (!state.dishFormVisible ? ' active' : ''),
        onclick: () => setVisibility(false)
      }, '仅管理员')
    ]),
    el('button', {
      class: 'btn',
      id: 'submit-review',
      onclick: submitReview
    }, '提交反馈')
  ]));
  body.appendChild(form);

  body.appendChild(el('div', { class: 'section-heading' }, [`反馈 ${dishReviews.length ? '· ' + dishReviews.length : ''}`]));

  if (dishReviews.length === 0) {
    body.appendChild(el('div', { class: 'empty-line' }, '还没有反馈，做第一个留言的人吧。'));
  } else {
    for (const r of dishReviews) {
      body.appendChild(renderReviewItem(r));
    }
  }
}

function renderStarInput() {
  const container = el('div', { class: 'stars-input', id: 'stars-input' });
  const cur = state.dishFormRating || 0;
  for (let i = 1; i <= 5; i++) {
    const star = el('span', {
      class: 'star' + (i <= cur ? ' filled' : ''),
      'data-star': i,
      onmouseenter: () => hoverStars(i),
      onmouseleave: () => hoverStars(0),
      onclick: () => setRating(i)
    }, '★');
    container.appendChild(star);
  }
  container.appendChild(el('span', { class: 'rating-hint' }, RATING_HINTS[cur]));
  return container;
}

function hoverStars(n) {
  const c = document.getElementById('stars-input');
  if (!c) return;
  const stars = c.querySelectorAll('.star');
  if (n === 0) { c.classList.remove('hovering'); return; }
  c.classList.add('hovering');
  stars.forEach((s, i) => {
    s.classList.toggle('hover-filled', i < n);
  });
}
function setRating(n) {
  state.dishFormRating = state.dishFormRating === n ? null : n;
  const c = document.getElementById('stars-input');
  if (!c) return renderDishSheet();
  const cur = state.dishFormRating || 0;
  c.querySelectorAll('.star').forEach((s, i) => s.classList.toggle('filled', i < cur));
  const hint = c.querySelector('.rating-hint');
  if (hint) hint.textContent = RATING_HINTS[cur];
}
function setVisibility(v) {
  state.dishFormVisible = v;
  const pg = document.querySelector('#dish-sheet-body .pill-group');
  if (!pg) return;
  pg.classList.toggle('private-mode', !v);
  const pills = pg.querySelectorAll('.pill');
  if (pills[0]) pills[0].classList.toggle('active', v);
  if (pills[1]) pills[1].classList.toggle('active', !v);
}

async function submitReview() {
  if (!state.nickname) { promptNickname(); return; }
  const rating = state.dishFormRating;
  const text = (state.dishFormText || '').trim();
  if (!rating && !text) { toast('请给个星级或写点什么'); return; }
  if (!state.activeMenu || !state.activeDishId) return;

  const btn = document.getElementById('submit-review');
  btn.disabled = true; btn.textContent = '提交中…';

  const rid = newId('r');
  try {
    await api('/api/reviews', {
      method: 'POST',
      body: JSON.stringify({
        id: rid,
        menu_id: state.activeMenu.id,
        dish_id: state.activeDishId,
        nickname: state.nickname,
        rating: rating || 0,
        text,
        visible: state.dishFormVisible,
        client_id: state.clientId
      })
    });
    pushMyReview({
      reviewId: rid,
      dishId: state.activeDishId,
      menuId: state.activeMenu.id,
      dishName: findDish(state.activeDishId)?.name || '',
      private: !state.dishFormVisible,
      rating: rating || 0,
      text,
      ts: Date.now()
    });
    state.dishFormRating = null;
    state.dishFormText = '';
    toast(state.dishFormVisible ? '已提交公开反馈' : '已提交私密反馈');
    await fetchReviewsAndReplies();
    renderAll();
  } catch (e) {
    toast('提交失败：' + (e.message || ''), 'error');
  } finally {
    btn.disabled = false; btn.textContent = '提交反馈';
  }
}

function renderReviewItem(r) {
  const wrap = el('div', { class: 'review-item' + (r._mine ? ' mine' : '') });
  const head = el('div', { class: 'review-head' });
  const rating = typeof r.rating === 'number' && r.rating > 0
    ? el('span', { class: 'review-stars' }, '★'.repeat(r.rating) + '☆'.repeat(5 - r.rating))
    : null;
  const author = el('span', { class: 'review-author' }, [
    r._mine ? el('span', { class: 'review-tag tag-mine' }, '我') : null,
    r._private ? el('span', { class: 'review-tag tag-private' }, '私密') : null,
    r.nickname || '匿名'
  ]);
  head.appendChild(el('div', {}, [author, ' ', rating]));
  head.appendChild(el('span', { class: 'review-time' }, relativeTime(r.created_at)));
  wrap.appendChild(head);

  if (r.text) {
    wrap.appendChild(el('div', { class: 'review-body' }, r.text));
  }

  const reply = state.replies[r.id];
  if (reply) {
    wrap.appendChild(el('div', { class: 'reply-box' }, [
      el('div', { class: 'reply-head' }, [
        el('span', { class: 'reply-author' }, '物业回复'),
        reply.auto ? el('span', { class: 'reply-auto-tag' }, 'AI 起草') : null
      ]),
      el('div', { class: 'reply-body' }, reply.text || ''),
      el('div', { class: 'reply-time' }, relativeTime(reply.created_at))
    ]));
  }

  if (state.isAdmin) {
    const controls = el('div', { class: 'admin-controls' }, [
      el('button', { class: 'link-btn', onclick: () => toggleReplyForm(r.id, r) },
        reply ? '编辑回复' : '回复'),
      state.aiEnabled ? el('button', { class: 'link-btn', onclick: () => autoReply(r) },
        '自动生成回复') : null,
      el('button', { class: 'link-btn danger', onclick: () => deleteReview(r) }, '删除反馈')
    ]);
    wrap.appendChild(controls);
    if (state.openReplyFor === r.id) {
      wrap.appendChild(renderReplyForm(r));
    }
  } else if (r._mine) {
    wrap.appendChild(el('div', { class: 'admin-controls' }, [
      el('button', { class: 'link-btn danger', onclick: () => deleteReview(r) }, '删除我的反馈')
    ]));
  }
  return wrap;
}

function toggleReplyForm(reviewId, review) {
  if (state.openReplyFor === reviewId) {
    state.openReplyFor = null;
    delete state.replyDrafts[reviewId];
  } else {
    state.openReplyFor = reviewId;
    if (state.replyDrafts[reviewId] == null) {
      state.replyDrafts[reviewId] = state.replies[reviewId]?.text || '';
    }
  }
  renderAll();
  // Focus the newly-mounted textarea
  setTimeout(() => {
    const ta = document.querySelector('.reply-form textarea');
    if (ta) ta.focus();
  }, 20);
}

function renderReplyForm(review) {
  const form = el('div', { class: 'reply-form' });
  const ta = el('textarea', {
    placeholder: '回复给住客的话…',
    oninput: e => { state.replyDrafts[review.id] = e.target.value; }
  });
  ta.value = state.replyDrafts[review.id] || '';
  form.appendChild(ta);
  const actions = el('div', { class: 'reply-form-actions' });
  if (state.aiEnabled) {
    const autoBtn = el('button', {
      class: 'btn ghost small',
      onclick: async () => {
        autoBtn.disabled = true; autoBtn.textContent = '生成中…';
        try {
          const txt = await generateReplyText(review);
          state.replyDrafts[review.id] = txt;
          renderAll();
        } catch (err) {
          toast('自动生成失败：' + (err.message || ''), 'error');
        } finally {
          autoBtn.disabled = false; autoBtn.textContent = '自动生成';
        }
      }
    }, '自动生成');
    actions.appendChild(autoBtn);
  }
  const cancelBtn = el('button', {
    class: 'btn ghost small',
    onclick: () => {
      state.openReplyFor = null;
      delete state.replyDrafts[review.id];
      renderAll();
    }
  }, '取消');
  actions.appendChild(cancelBtn);
  const sendBtn = el('button', {
    class: 'btn small',
    onclick: async () => {
      const txt = (state.replyDrafts[review.id] || '').trim();
      if (!txt) { toast('请填写回复内容'); return; }
      sendBtn.disabled = true; sendBtn.textContent = '发送中…';
      try {
        await sendReply(review.id, txt, false);
        state.openReplyFor = null;
        delete state.replyDrafts[review.id];
        toast('已发送回复');
        renderAll();
      } catch (err) {
        toast('发送失败：' + (err.message || ''), 'error');
      } finally {
        sendBtn.disabled = false; sendBtn.textContent = '发送';
      }
    }
  }, '发送');
  actions.appendChild(sendBtn);
  form.appendChild(actions);
  return form;
}

async function sendReply(reviewId, text, auto) {
  await api('/api/replies', {
    method: 'POST',
    body: JSON.stringify({ review_id: reviewId, text, auto })
  });
  await fetchReviewsAndReplies();
  renderAll();
}

async function autoReply(review) {
  try {
    const text = await generateReplyText(review);
    await sendReply(review.id, text, true);
    toast('已发送自动回复（AI 起草）');
  } catch (e) {
    toast('自动回复失败：' + (e.message || ''), 'error');
  }
}

async function generateReplyText(review) {
  const r = await api('/api/ai-reply', {
    method: 'POST',
    body: JSON.stringify({ review_id: review.id })
  });
  return r.text || '';
}

async function deleteReview(review) {
  if (!confirm('确认删除这条反馈？此操作不可恢复。')) return;
  try {
    await api(`/api/reviews/${encodeURIComponent(review.id)}?client_id=${encodeURIComponent(state.clientId)}`, {
      method: 'DELETE'
    });
    toast('已删除反馈');
    await fetchReviewsAndReplies();
    renderAll();
  } catch (e) {
    toast('删除失败：' + (e.message || ''), 'error');
  }
}

// ============ Menu editor ============
function openEditor(mode) {
  let base;
  if (mode === 'new') {
    const nextMonday = mondayOf(daysAdd(new Date(), 7));
    base = {
      id: 'm_' + isoDate(nextMonday),
      week_start: isoDate(nextMonday),
      dishes: [],
      _isNew: true
    };
  } else {
    if (!state.activeMenu) { toast('没有可编辑的菜单'); return; }
    base = JSON.parse(JSON.stringify(state.activeMenu));
    base._isNew = false;
  }
  state._editing = base;
  renderEditor();
  openSheet('editor-sheet');
}

function renderEditor() {
  const body = document.getElementById('editor-body');
  const e = state._editing;
  if (!e) return;
  const isNew = e._isNew;

  const start = mondayOf(parseDate(e.week_start));
  e.week_start = isoDate(start);

  body.innerHTML = '';
  body.appendChild(el('div', { class: 'console-head' }, [
    el('h2', { class: 'editor-title' }, isNew ? '新一周菜单' : '编辑本周菜单'),
    el('div', { class: 'editor-sub' }, '早餐全周共用，按主食/小菜/饮品分类。午餐、晚餐每日四菜一汤。每行一道菜，用 “|” 分隔名称和描述。')
  ]));

  body.appendChild(el('div', { class: 'editor-week-input' }, [
    el('label', {}, '本周起始日'),
    el('input', {
      type: 'date',
      value: e.week_start,
      onchange: ev => {
        const d = mondayOf(parseDate(ev.target.value));
        e.week_start = isoDate(d);
        e.id = isNew ? 'm_' + e.week_start : e.id;
        renderEditor();
      }
    }),
    el('span', { style: 'color:var(--ink-3);font-size:12px' },
      weekLabelFrom(e.week_start).range)
  ]));

  // Breakfast (categorized, week-shared)
  const bfSection = el('section', { class: 'editor-meal-section' });
  bfSection.appendChild(el('div', { class: 'editor-meal-title-row' }, [
    el('h3', { class: 'editor-meal-title' }, '早餐'),
    el('span', { class: 'editor-meal-note' }, '全周共用')
  ]));
  const bfGrid = el('div', { class: 'editor-breakfast-grid' });
  const bfByCat = {};
  for (const cat of BREAKFAST_CATEGORIES) bfByCat[cat.key] = [];
  for (const dish of e.dishes) {
    if (dish.meal !== 'breakfast') continue;
    const cat = dish.category || 'staple';
    (bfByCat[cat] || bfByCat.staple).push(dish);
  }
  for (const cat of BREAKFAST_CATEGORIES) {
    const list = bfByCat[cat.key] || [];
    const text = list.map(x => x.name + (x.description ? ' | ' + x.description : '')).join('\n');
    const ta = el('textarea', {
      placeholder: '一行一道',
      oninput: ev => updateBreakfastCategoryDishes(e, cat.key, ev.target.value)
    });
    ta.value = text;
    bfGrid.appendChild(el('div', { class: 'editor-bf-cell' }, [
      el('div', { class: 'editor-bf-cat-label' }, cat.label),
      ta
    ]));
  }
  bfSection.appendChild(bfGrid);
  body.appendChild(bfSection);

  // Lunch and Dinner (per-day)
  for (const mealKey of ['lunch', 'dinner']) {
    const meal = MEALS.find(x => x.key === mealKey);
    const section = el('section', { class: 'editor-meal-section' });
    section.appendChild(el('div', { class: 'editor-meal-title-row' }, [
      el('h3', { class: 'editor-meal-title' }, meal.label),
      el('span', { class: 'editor-meal-note' }, '每日四菜一汤')
    ]));
    const grid = el('div', { class: 'editor-week-grid' });
    for (let d = 0; d < 7; d++) {
      const date = daysAdd(start, d);
      const cellDishes = e.dishes.filter(x => x.meal === mealKey && x.day === d);
      const text = cellDishes.map(x => x.name + (x.description ? ' | ' + x.description : '')).join('\n');
      const ta = el('textarea', {
        placeholder: '一行一道',
        oninput: ev => updateDayMealDishes(e, d, mealKey, ev.target.value)
      });
      ta.value = text;
      grid.appendChild(el('div', { class: 'editor-day-cell' }, [
        el('div', { class: 'editor-day-cell-header' }, [
          el('span', { class: 'editor-day-cell-name' }, DAY_NAMES[d]),
          el('span', { class: 'editor-day-cell-date' }, `${date.getMonth()+1}/${date.getDate()}`)
        ]),
        ta
      ]));
    }
    section.appendChild(grid);
    body.appendChild(section);
  }

  body.appendChild(el('div', { class: 'editor-hint' },
    '每一行一道菜。用 “|” 分隔菜名和描述，例如：宫保鸡丁 | 微辣，含花生。同名菜品的历史评价会保留；改名视为新菜。允许不同日期出现同名菜品，会去重计入本周菜品总数。'
  ));

  body.appendChild(el('div', { class: 'editor-actions' }, [
    el('div', { class: 'left-side' },
      isNew ? '' : el('button', { class: 'btn ghost danger', onclick: deleteEditedMenu }, '删除本周菜单')
    ),
    el('button', { class: 'btn ghost', onclick: closeAllSheets }, '取消'),
    el('button', { class: 'btn', onclick: saveEditedMenu }, isNew ? '发布' : '保存')
  ]));
}

function parseDishLine(line) {
  const barIdx = line.indexOf('|');
  if (barIdx < 0) return { name: line, description: '' };
  return { name: line.slice(0, barIdx).trim(), description: line.slice(barIdx + 1).trim() };
}

function updateBreakfastCategoryDishes(editing, categoryKey, text) {
  const lines = text.split('\n').map(x => x.trim()).filter(Boolean);
  const existingHere = editing.dishes.filter(x => x.meal === 'breakfast' && (x.category || 'staple') === categoryKey);
  editing.dishes = editing.dishes.filter(x => !(x.meal === 'breakfast' && (x.category || 'staple') === categoryKey));
  const used = new Set();
  const newHere = lines.map(line => {
    const { name, description } = parseDishLine(line);
    const match = existingHere.find(x => x.name === name && !used.has(x.id));
    if (match) used.add(match.id);
    return {
      id: match ? match.id : newId('d'),
      meal: 'breakfast',
      category: categoryKey,
      name,
      description
    };
  });
  editing.dishes.push(...newHere);
}

function updateDayMealDishes(editing, day, mealKey, text) {
  const lines = text.split('\n').map(x => x.trim()).filter(Boolean);
  const existingHere = editing.dishes.filter(x => x.meal === mealKey && x.day === day);
  editing.dishes = editing.dishes.filter(x => !(x.meal === mealKey && x.day === day));
  const used = new Set();
  const newHere = lines.map(line => {
    const { name, description } = parseDishLine(line);
    const match = existingHere.find(x => x.name === name && !used.has(x.id));
    if (match) used.add(match.id);
    return {
      id: match ? match.id : newId('d'),
      meal: mealKey,
      day,
      name,
      description
    };
  });
  editing.dishes.push(...newHere);
}

async function saveEditedMenu() {
  const e = state._editing;
  if (!e) return;
  if (!e.dishes.length) {
    if (!confirm('还没有添加任何菜品，确定要发布空菜单吗？')) return;
  }
  try {
    await api('/api/menus', {
      method: 'POST',
      body: JSON.stringify({
        id: e.id,
        week_start: e.week_start,
        dishes: e.dishes.map(d => d.meal === 'breakfast' ? ({
          id: d.id, meal: 'breakfast', category: d.category || 'staple',
          name: d.name, description: d.description || ''
        }) : ({
          id: d.id, meal: d.meal, day: d.day,
          name: d.name, description: d.description || ''
        }))
      })
    });
    closeAllSheets();
    toast(e._isNew ? '新菜单已发布' : '菜单已更新');
    await fetchMenus();
    // Point to the saved menu
    const idx = state.menusList.findIndex(m => m.id === e.id);
    if (idx >= 0) { state.activeMenuIndex = idx; state.activeMenu = state.menusList[idx]; }
    await fetchReviewsAndReplies();
    renderAll();
  } catch (err) {
    toast('保存失败：' + (err.message || ''), 'error');
  }
}

async function deleteEditedMenu() {
  if (!confirm('确认删除本周菜单？相关反馈将保留但不再显示。')) return;
  const e = state._editing;
  if (!e || e._isNew) { closeAllSheets(); return; }
  try {
    await api(`/api/menus/${encodeURIComponent(e.id)}`, { method: 'DELETE' });
    closeAllSheets();
    toast('菜单已删除');
    state.activeMenu = null;
    await fetchMenus();
    await fetchReviewsAndReplies();
    renderAll();
  } catch (err) {
    toast('删除失败：' + (err.message || ''), 'error');
  }
}

async function deleteActiveMenu() {
  if (!state.activeMenu) return;
  if (!confirm(`确认删除「${weekLabelFrom(state.activeMenu.week_start).title}」的菜单？`)) return;
  try {
    await api(`/api/menus/${encodeURIComponent(state.activeMenu.id)}`, { method: 'DELETE' });
    toast('菜单已删除');
    state.activeMenu = null;
    await fetchMenus();
    await fetchReviewsAndReplies();
    renderAll();
  } catch (err) {
    toast('删除失败：' + (err.message || ''), 'error');
  }
}

// ============ Admin console ============
function openConsole() {
  state.consoleTab = 'all';
  renderConsole();
  openSheet('console-sheet');
}

function renderConsoleIfOpen() {
  if (!document.getElementById('console-sheet').hidden) renderConsole();
}

function renderConsole() {
  const body = document.getElementById('console-body');
  body.innerHTML = '';
  body.appendChild(el('div', { class: 'console-head' }, [
    el('h2', { class: 'console-title' }, '反馈管理'),
    el('div', { class: 'console-sub' },
      state.activeMenu ? weekLabelFrom(state.activeMenu.week_start).title + ' · ' +
        weekLabelFrom(state.activeMenu.week_start).range : '未选中菜单')
  ]));

  const all = state.reviews.map(r => ({ ...r, _private: r.visible === false }));
  all.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
  const unreplied = all.filter(r => !state.replies[r.id]);
  const priv = all.filter(r => r._private);

  body.appendChild(el('div', { class: 'console-tabs' }, [
    consoleTabBtn('all', '全部', all.length),
    consoleTabBtn('unreplied', '待回复', unreplied.length),
    consoleTabBtn('private', '私密', priv.length)
  ]));

  const view = state.consoleTab === 'unreplied' ? unreplied :
               state.consoleTab === 'private' ? priv : all;

  if (view.length === 0) {
    body.appendChild(el('div', { class: 'empty-line' }, '本周暂无相关反馈。'));
    return;
  }

  const list = el('div', {});
  for (const r of view) list.appendChild(renderConsoleItem(r));
  body.appendChild(list);
}

function consoleTabBtn(key, label, count) {
  return el('button', {
    class: 'console-tab' + (state.consoleTab === key ? ' active' : ''),
    onclick: () => { state.consoleTab = key; renderConsole(); }
  }, [label, el('span', { class: 'count' }, String(count))]);
}

function renderConsoleItem(r) {
  const dish = findDish(r.dish_id) || findDishInAnyMenu(r.dish_id);
  const wrap = el('div', { class: 'feedback-item' });
  const reply = state.replies[r.id];
  wrap.appendChild(el('div', { class: 'fi-head' }, [
    el('span', { class: 'fi-dish' }, dish ? dish.name : '（已移除的菜品）'),
    r._private ? el('span', { class: 'review-tag tag-private' }, '私密') : null,
    el('span', { class: 'fi-stars' },
      r.rating > 0 ? '★'.repeat(r.rating) + '☆'.repeat(5 - r.rating) : '未评分'),
    el('span', {}, r.nickname || '匿名'),
    el('span', {}, relativeTime(r.created_at))
  ]));
  wrap.appendChild(el('div', { class: 'fi-body' + (r.text ? '' : ' empty') },
    r.text || '（无文字）'));

  if (reply) {
    wrap.appendChild(el('div', { class: 'reply-box' }, [
      el('div', { class: 'reply-head' }, [
        el('span', { class: 'reply-author' }, '物业回复'),
        reply.auto ? el('span', { class: 'reply-auto-tag' }, 'AI 起草') : null
      ]),
      el('div', { class: 'reply-body' }, reply.text),
      el('div', { class: 'reply-time' }, relativeTime(reply.created_at))
    ]));
  }

  wrap.appendChild(el('div', { class: 'admin-controls' }, [
    el('button', { class: 'link-btn', onclick: () => toggleReplyForm(r.id, r) },
      reply ? '编辑回复' : '回复'),
    state.aiEnabled ? el('button', { class: 'link-btn', onclick: () => autoReply(r) },
      '自动生成回复') : null,
    el('button', { class: 'link-btn danger', onclick: () => deleteReview(r) }, '删除')
  ]));
  if (state.openReplyFor === r.id) {
    wrap.appendChild(renderReplyForm(r));
  }
  return wrap;
}

// ============ My feedback ============
function updateFabVisibility() {
  const list = getMyReviews();
  const menuId = state.activeMenu?.id;
  const relevant = menuId ? list.filter(x => x.menuId === menuId).length : list.length;
  document.getElementById('fab').hidden = state.isAdmin || list.length === 0;
  document.getElementById('fab-count').textContent = relevant || list.length;
}

function openMyFeedback() {
  renderMyFeedback();
  openSheet('my-feedback-sheet');
}
function renderMyFeedbackIfOpen() {
  if (!document.getElementById('my-feedback-sheet').hidden) renderMyFeedback();
}

function renderMyFeedback() {
  const body = document.getElementById('my-feedback-body');
  const mine = getMyReviews();
  body.innerHTML = '';
  body.appendChild(el('div', { class: 'console-head' }, [
    el('h2', { class: 'console-title' }, '我的反馈'),
    el('div', { class: 'console-sub' }, '本机记录 · 共 ' + mine.length + ' 条')
  ]));
  if (mine.length === 0) {
    body.appendChild(el('div', { class: 'empty-line' }, '还没有提交过反馈。'));
    return;
  }
  const list = el('div', { style: 'margin-top:14px' });
  for (const e of mine) {
    const reply = state.replies[e.reviewId];
    const item = el('div', { class: 'feedback-item' }, [
      el('div', { class: 'fi-head' }, [
        el('span', { class: 'fi-dish' }, e.dishName || '（菜品）'),
        e.private ? el('span', { class: 'review-tag tag-private' }, '私密') : null,
        el('span', { class: 'fi-stars' },
          e.rating > 0 ? '★'.repeat(e.rating) + '☆'.repeat(5 - e.rating) : '未评分'),
        el('span', {}, relativeTime(e.ts))
      ]),
      el('div', { class: 'fi-body' + (e.text ? '' : ' empty') }, e.text || '（无文字）'),
      reply ? el('div', { class: 'reply-box' }, [
        el('div', { class: 'reply-head' }, [
          el('span', { class: 'reply-author' }, '物业回复'),
          reply.auto ? el('span', { class: 'reply-auto-tag' }, 'AI 起草') : null
        ]),
        el('div', { class: 'reply-body' }, reply.text),
        el('div', { class: 'reply-time' }, relativeTime(reply.created_at))
      ]) : el('div', { style: 'font-size:12px;color:var(--ink-3);margin-top:6px' }, '等待物业回复…')
    ]);
    list.appendChild(item);
  }
  body.appendChild(list);
}

// ============ Nickname & Login modals ============
function promptNickname() {
  document.getElementById('nickname-modal').hidden = false;
  const input = document.getElementById('nickname-input');
  input.value = state.nickname || '';
  setTimeout(() => input.focus(), 30);
}
function saveNicknameFromModal() {
  const v = document.getElementById('nickname-input').value.trim();
  if (!v) { toast('请填写昵称'); return; }
  setNickname(v);
  document.getElementById('nickname-modal').hidden = true;
  toast('已保存');
}

function openLoginModal() {
  document.getElementById('login-modal').hidden = false;
  const input = document.getElementById('login-input');
  input.value = '';
  setTimeout(() => input.focus(), 30);
}
async function submitLogin() {
  const password = document.getElementById('login-input').value;
  if (!password) { toast('请输入密码'); return; }
  const btn = document.getElementById('login-submit');
  btn.disabled = true; btn.textContent = '登录中…';
  try {
    await api('/api/session/login', {
      method: 'POST',
      body: JSON.stringify({ password })
    });
    document.getElementById('login-modal').hidden = true;
    toast('登录成功');
    await fetchSession();
    updateAdminUI();
    await fetchReviewsAndReplies();
    renderAll();
  } catch (e) {
    if (e.code === 'wrong_password') toast('密码错误', 'error');
    else toast('登录失败：' + (e.message || ''), 'error');
  } finally {
    btn.disabled = false; btn.textContent = '登录';
  }
}

async function logout() {
  try {
    await api('/api/session/logout', { method: 'POST' });
    state.isAdmin = false;
    closeAllSheets();
    updateAdminUI();
    await fetchReviewsAndReplies();
    renderAll();
    toast('已退出管理');
  } catch (e) {
    toast('退出失败', 'error');
  }
}

// ============ Events ============
function wireEvents() {
  document.getElementById('overlay').addEventListener('click', closeAllSheets);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      const anySheet = ['dish-sheet','editor-sheet','console-sheet','my-feedback-sheet'].some(id => !document.getElementById(id).hidden);
      if (anySheet) closeAllSheets();
    }
  });
  document.querySelectorAll('.sheet-close').forEach(btn => {
    btn.addEventListener('click', closeAllSheets);
  });

  document.getElementById('prev-week').addEventListener('click', async () => {
    if (state.activeMenuIndex < state.menusList.length - 1) {
      state.activeMenuIndex++;
      state.activeMenu = state.menusList[state.activeMenuIndex];
      await fetchReviewsAndReplies();
      renderAll();
    }
  });
  document.getElementById('next-week').addEventListener('click', async () => {
    if (state.activeMenuIndex > 0) {
      state.activeMenuIndex--;
      state.activeMenu = state.menusList[state.activeMenuIndex];
      await fetchReviewsAndReplies();
      renderAll();
    }
  });

  document.getElementById('nickname-btn').addEventListener('click', promptNickname);

  document.getElementById('admin-login-btn').addEventListener('click', openLoginModal);
  document.getElementById('login-submit').addEventListener('click', submitLogin);
  document.getElementById('login-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') submitLogin();
  });

  document.getElementById('btn-new-menu').addEventListener('click', () => openEditor('new'));
  document.getElementById('btn-edit-menu').addEventListener('click', () => openEditor('edit'));
  document.getElementById('btn-console').addEventListener('click', openConsole);
  document.getElementById('btn-delete-menu').addEventListener('click', deleteActiveMenu);
  document.getElementById('btn-logout').addEventListener('click', logout);

  document.getElementById('fab-btn').addEventListener('click', openMyFeedback);

  document.getElementById('nickname-save').addEventListener('click', saveNicknameFromModal);
  document.getElementById('nickname-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') saveNicknameFromModal();
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
