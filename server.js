const express = require('express');
const Database = require('better-sqlite3');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const path = require('path');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(24).toString('hex');
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data.sqlite');
const SEED_ON_EMPTY = process.env.SEED_ON_EMPTY !== '0';
const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;

if (ADMIN_PASSWORD === 'admin123') {
  console.warn('\x1b[33m[warning] ADMIN_PASSWORD 未设置，正在使用默认密码 admin123，请在生产环境通过环境变量覆盖。\x1b[0m');
}
if (!process.env.SESSION_SECRET) {
  console.warn('\x1b[33m[warning] SESSION_SECRET 未设置，本次启动使用随机值 — 重启后管理员会话将失效。\x1b[0m');
}

// ============ Database ============
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS menus (
    id TEXT PRIMARY KEY,
    week_start TEXT NOT NULL,
    published_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    dishes_json TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_menus_week ON menus(week_start DESC);

  CREATE TABLE IF NOT EXISTS reviews (
    id TEXT PRIMARY KEY,
    menu_id TEXT NOT NULL,
    dish_id TEXT NOT NULL,
    nickname TEXT NOT NULL,
    rating INTEGER NOT NULL,
    text TEXT NOT NULL,
    visible INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    client_id TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_reviews_menu ON reviews(menu_id);
  CREATE INDEX IF NOT EXISTS idx_reviews_dish ON reviews(dish_id);

  CREATE TABLE IF NOT EXISTS replies (
    review_id TEXT PRIMARY KEY,
    menu_id TEXT NOT NULL,
    text TEXT NOT NULL,
    auto INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    by TEXT NOT NULL
  );
`);

// ============ Session ============
function signSession() {
  const exp = Date.now() + SESSION_TTL_MS;
  const payload = `admin.${exp}`;
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex').slice(0, 32);
  return `${payload}.${sig}`;
}
function verifySession(cookie) {
  if (!cookie || typeof cookie !== 'string') return false;
  const parts = cookie.split('.');
  if (parts.length !== 3 || parts[0] !== 'admin') return false;
  const exp = Number(parts[1]);
  if (!exp || exp < Date.now()) return false;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(`admin.${parts[1]}`).digest('hex').slice(0, 32);
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts[2]));
}
function requireAdmin(req, res, next) {
  if (!verifySession(req.cookies.admin_session)) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

// ============ App ============
const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '256kb' }));
app.use(cookieParser());

// ============ API ============
app.get('/api/session', (req, res) => {
  res.json({
    isAdmin: verifySession(req.cookies.admin_session),
    aiEnabled: !!ANTHROPIC_API_KEY
  });
});

app.post('/api/session/login', (req, res) => {
  const password = req.body?.password;
  if (!password || typeof password !== 'string') return res.status(400).json({ error: 'password_required' });
  const ok = password.length === ADMIN_PASSWORD.length &&
             crypto.timingSafeEqual(Buffer.from(password), Buffer.from(ADMIN_PASSWORD));
  if (!ok) return res.status(401).json({ error: 'wrong_password' });
  const token = signSession();
  res.cookie('admin_session', token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: SESSION_TTL_MS,
    secure: req.secure || req.get('x-forwarded-proto') === 'https'
  });
  res.json({ ok: true });
});

app.post('/api/session/logout', (req, res) => {
  res.clearCookie('admin_session');
  res.json({ ok: true });
});

// ---- Menus ----
function rowToMenu(r) {
  return { id: r.id, week_start: r.week_start, published_at: r.published_at, updated_at: r.updated_at, dishes: JSON.parse(r.dishes_json) };
}

app.get('/api/menus', (req, res) => {
  const rows = db.prepare('SELECT id, week_start, published_at, updated_at, dishes_json FROM menus ORDER BY week_start DESC LIMIT 104').all();
  res.json(rows.map(rowToMenu));
});

app.get('/api/menus/:id', (req, res) => {
  const r = db.prepare('SELECT id, week_start, published_at, updated_at, dishes_json FROM menus WHERE id = ?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'not_found' });
  res.json(rowToMenu(r));
});

app.post('/api/menus', requireAdmin, (req, res) => {
  const { id, week_start, dishes } = req.body || {};
  if (!id || typeof id !== 'string' || id.length > 64) return res.status(400).json({ error: 'bad_id' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week_start || '')) return res.status(400).json({ error: 'bad_week_start' });
  if (!Array.isArray(dishes)) return res.status(400).json({ error: 'bad_dishes' });
  for (const d of dishes) {
    if (!d.id || typeof d.id !== 'string' || d.id.length > 64) return res.status(400).json({ error: 'bad_dish_id' });
    if (!['breakfast', 'lunch', 'dinner'].includes(d.meal)) return res.status(400).json({ error: 'bad_dish_meal' });
    if (!d.name || typeof d.name !== 'string' || d.name.length > 100) return res.status(400).json({ error: 'bad_dish_name' });
    if (d.description != null && (typeof d.description !== 'string' || d.description.length > 200)) return res.status(400).json({ error: 'bad_dish_description' });
    if (d.meal === 'breakfast') {
      if (!['staple', 'side', 'drink'].includes(d.category || 'staple')) return res.status(400).json({ error: 'bad_dish_category' });
    } else {
      if (typeof d.day !== 'number' || d.day < 0 || d.day > 6) return res.status(400).json({ error: 'bad_dish_day' });
    }
  }
  const now = Date.now();
  const existing = db.prepare('SELECT published_at FROM menus WHERE id = ?').get(id);
  const published_at = existing ? existing.published_at : now;
  db.prepare(`INSERT INTO menus(id, week_start, published_at, updated_at, dishes_json)
              VALUES (?,?,?,?,?)
              ON CONFLICT(id) DO UPDATE SET
                week_start=excluded.week_start,
                updated_at=excluded.updated_at,
                dishes_json=excluded.dishes_json`)
    .run(id, week_start, published_at, now, JSON.stringify(dishes));
  res.json({ ok: true, published_at, updated_at: now });
});

app.delete('/api/menus/:id', requireAdmin, (req, res) => {
  const cascade = db.transaction((menuId) => {
    db.prepare('DELETE FROM replies WHERE menu_id = ?').run(menuId);
    db.prepare('DELETE FROM reviews WHERE menu_id = ?').run(menuId);
    db.prepare('DELETE FROM menus WHERE id = ?').run(menuId);
  });
  cascade(req.params.id);
  res.json({ ok: true });
});

// ---- Reviews ----
app.get('/api/reviews', (req, res) => {
  const menuId = String(req.query.menu_id || '');
  if (!menuId) return res.status(400).json({ error: 'menu_id_required' });
  const isAdmin = verifySession(req.cookies.admin_session);
  const clientId = String(req.query.client_id || '');
  let rows = db.prepare('SELECT id, menu_id, dish_id, nickname, rating, text, visible, created_at, client_id FROM reviews WHERE menu_id = ? ORDER BY created_at DESC LIMIT 500').all(menuId);
  if (!isAdmin) {
    rows = rows.filter(r => r.visible === 1 || r.client_id === clientId);
  }
  res.json(rows.map(r => ({
    id: r.id, menu_id: r.menu_id, dish_id: r.dish_id,
    nickname: r.nickname, rating: r.rating, text: r.text,
    visible: !!r.visible, created_at: r.created_at, client_id: r.client_id
  })));
});

app.post('/api/reviews', (req, res) => {
  const { id, menu_id, dish_id, nickname, rating, text, visible, client_id } = req.body || {};
  if (!id || typeof id !== 'string' || id.length > 64) return res.status(400).json({ error: 'bad_id' });
  if (!menu_id || !dish_id || !client_id) return res.status(400).json({ error: 'bad_request' });
  const nk = String(nickname || '').trim().slice(0, 32);
  if (!nk) return res.status(400).json({ error: 'nickname_required' });
  const r = Math.max(0, Math.min(5, Number(rating) || 0));
  const t = String(text || '').slice(0, 1000);
  if (r === 0 && t.trim().length === 0) return res.status(400).json({ error: 'empty_review' });
  const menuExists = db.prepare('SELECT 1 FROM menus WHERE id = ?').get(menu_id);
  if (!menuExists) return res.status(404).json({ error: 'menu_not_found' });
  db.prepare(`INSERT OR REPLACE INTO reviews(id, menu_id, dish_id, nickname, rating, text, visible, created_at, client_id)
              VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(id, String(menu_id), String(dish_id), nk, r, t, visible ? 1 : 0, Date.now(), String(client_id).slice(0, 64));
  res.json({ ok: true });
});

app.delete('/api/reviews/:id', (req, res) => {
  const isAdmin = verifySession(req.cookies.admin_session);
  const clientId = String(req.query.client_id || '');
  const row = db.prepare('SELECT client_id FROM reviews WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  if (!isAdmin && row.client_id !== clientId) return res.status(403).json({ error: 'forbidden' });
  db.prepare('DELETE FROM reviews WHERE id = ?').run(req.params.id);
  db.prepare('DELETE FROM replies WHERE review_id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---- Replies ----
app.get('/api/replies', (req, res) => {
  const menuId = String(req.query.menu_id || '');
  if (!menuId) return res.status(400).json({ error: 'menu_id_required' });
  const rows = db.prepare('SELECT review_id, menu_id, text, auto, created_at, by FROM replies WHERE menu_id = ?').all(menuId);
  res.json(rows.map(r => ({ ...r, auto: !!r.auto })));
});

app.post('/api/replies', requireAdmin, (req, res) => {
  const { review_id, text, auto } = req.body || {};
  const t = String(text || '').trim().slice(0, 2000);
  if (!review_id || !t) return res.status(400).json({ error: 'bad_request' });
  const review = db.prepare('SELECT menu_id FROM reviews WHERE id = ?').get(review_id);
  if (!review) return res.status(404).json({ error: 'review_not_found' });
  db.prepare(`INSERT OR REPLACE INTO replies(review_id, menu_id, text, auto, created_at, by)
              VALUES (?,?,?,?,?,?)`)
    .run(review_id, review.menu_id, t, auto ? 1 : 0, Date.now(), '物业管理');
  res.json({ ok: true });
});

app.delete('/api/replies/:review_id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM replies WHERE review_id = ?').run(req.params.review_id);
  res.json({ ok: true });
});

// ---- AI reply draft ----
app.post('/api/ai-reply', requireAdmin, async (req, res) => {
  if (!ANTHROPIC_API_KEY) return res.status(400).json({ error: 'ai_not_configured' });
  const reviewId = req.body?.review_id;
  if (!reviewId) return res.status(400).json({ error: 'review_id_required' });
  const review = db.prepare('SELECT r.id, r.dish_id, r.rating, r.text, m.dishes_json FROM reviews r LEFT JOIN menus m ON r.menu_id = m.id WHERE r.id = ?').get(reviewId);
  if (!review) return res.status(404).json({ error: 'not_found' });
  let dishName = '（菜品）';
  try {
    const dishes = JSON.parse(review.dishes_json || '[]');
    const d = dishes.find(x => x.id === review.dish_id);
    if (d) dishName = d.name;
  } catch {}

  const prompt = `你是餐饮物业的客服，用礼貌、简洁、温暖的中文回复住客对菜品的反馈。
- 直接对住客说话，不要加抬头（无需"尊敬的"）。
- 具体回应他们的观点：如是表扬则真诚感谢并简单响应；如是抱怨，先致歉再说明改进方向；如是建议，感谢并表达会与厨房沟通。
- 60-100 字为宜，不要客套过多。不要使用星号或 Markdown。

菜品：${dishName}
住客评分：${review.rating}/5
住客反馈：${review.text || '（未附文字）'}`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 400,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    if (!r.ok) {
      const errText = await r.text();
      console.error('AI reply error:', r.status, errText);
      return res.status(502).json({ error: 'ai_upstream', status: r.status });
    }
    const data = await r.json();
    const text = (data.content?.[0]?.text || '').trim();
    if (!text) return res.status(502).json({ error: 'empty_response' });
    res.json({ text });
  } catch (e) {
    console.error('AI reply fetch failed:', e);
    res.status(502).json({ error: 'ai_fetch_failed' });
  }
});

app.get('/health', (req, res) => res.json({ ok: true }));

// Static frontend
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0
}));

// SPA fallback (residents may open a shared link) — but leave /api/ alone
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'not_found' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.use('/api/', (req, res) => res.status(405).json({ error: 'method_not_allowed' }));

// Error handler
app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'payload_too_large' });
  console.error(err);
  res.status(500).json({ error: 'internal' });
});

// ============ Seed ============
function seedSampleMenu() {
  const count = db.prepare('SELECT COUNT(*) AS c FROM menus').get().c;
  if (count > 0) return;

  const now = new Date();
  const day = now.getDay();
  const diff = (day === 0 ? -6 : 1 - day);
  const monday = new Date(now);
  monday.setDate(now.getDate() + diff);
  monday.setHours(0, 0, 0, 0);
  const pad2 = n => String(n).padStart(2, '0');
  const weekStart = `${monday.getFullYear()}-${pad2(monday.getMonth() + 1)}-${pad2(monday.getDate())}`;
  const menuId = 'm_' + weekStart;

  const rand = () => Math.random().toString(36).slice(2, 6);
  const dishes = [];

  // Breakfast (shared for the week, categorized)
  const breakfast = [
    ['staple', '小米南瓜粥', '温润养胃'],
    ['staple', '皮蛋瘦肉粥', ''],
    ['staple', '菜肉包', '青菜香菇馅'],
    ['staple', '花卷', ''],
    ['side', '水煮鸡蛋', ''],
    ['side', '榨菜', ''],
    ['side', '花生米', ''],
    ['side', '拌黄瓜', ''],
    ['drink', '豆浆', '无糖 / 微糖'],
    ['drink', '牛奶', ''],
    ['drink', '小米粥', '免费续']
  ];
  breakfast.forEach(([category, name, description], i) => {
    dishes.push({ id: `bf_${category}_${i}_${rand()}`, meal: 'breakfast', category, name, description });
  });

  // Lunch (per day, 4 dishes + 1 soup)
  const lunch = [
    [0, ['宫保鸡丁 微辣，含花生', '清炒时蔬', '麻婆豆腐 微辣', '糖醋里脊', '番茄鸡蛋汤']],
    [1, ['鱼香肉丝 微辣', '蒜蓉西兰花', '香煎豆腐', '梅菜扣肉', '冬瓜排骨汤']],
    [2, ['咖喱牛肉饭 中辣', '清炒芦笋', '木须肉', '干煸豆角', '酸辣汤 微辣']],
    [3, ['清蒸鲈鱼', '青菜炒蛋', '红烧茄子', '粉蒸肉', '白萝卜排骨汤']],
    [4, ['回锅肉 微辣', '香煎豆腐', '青椒肉丝', '蒜蓉油麦菜', '酸辣土豆丝']],
    [5, ['红烧狮子头', '清炒时蔬', '干锅花菜 微辣', '虎皮青椒 微辣', '西红柿疙瘩汤']],
    [6, ['家常豆腐', '蒜蓉粉丝虾', '青椒肉丝', '手撕包菜', '菌菇鸡汤']]
  ];
  for (const [day, items] of lunch) {
    items.forEach((raw, i) => {
      const [name, description] = raw.split(' ').length > 1 && !/^[一-鿿]+$/.test(raw)
        ? [raw.split(' ')[0], raw.slice(raw.indexOf(' ') + 1)]
        : [raw, ''];
      dishes.push({ id: `l${day}_${i}_${rand()}`, meal: 'lunch', day, name, description });
    });
  }

  // Dinner (per day, 4 dishes + 1 soup)
  const dinner = [
    [0, ['红烧肉 三层肉，冰糖上色', '蒜蓉西兰花', '香菇油菜', '干煎带鱼', '紫菜蛋花汤']],
    [1, ['香菇滑鸡', '水煮小白菜', '土豆炖牛肉', '蚝油生菜', '玉米排骨汤']],
    [2, ['糖醋里脊', '蒜蓉茄子', '青椒土豆丝', '香辣豆腐', '鲫鱼豆腐汤']],
    [3, ['红烧牛腩', '清炒芥兰', '西红柿炒蛋', '香菇油菜', '丝瓜蛋汤']],
    [4, ['白切鸡 配姜葱蘸料', '蒜蓉菠菜', '香煎鲳鱼', '肉末茄子', '冬瓜薏米汤']],
    [5, ['香酥鸭', '素三鲜 木耳、笋、香菇', '干煸四季豆 微辣', '蚝油芥兰', '罗宋汤']],
    [6, ['卤味拼盘 牛肉、鸭翅、豆干', '清炒莴笋', '香菇烧鸡', '虾仁滑蛋', '金针菇肥牛汤']]
  ];
  for (const [day, items] of dinner) {
    items.forEach((raw, i) => {
      const [name, description] = raw.split(' ').length > 1 && !/^[一-鿿]+$/.test(raw)
        ? [raw.split(' ')[0], raw.slice(raw.indexOf(' ') + 1)]
        : [raw, ''];
      dishes.push({ id: `d${day}_${i}_${rand()}`, meal: 'dinner', day, name, description });
    });
  }

  const insert = db.prepare(`INSERT INTO menus(id, week_start, published_at, updated_at, dishes_json) VALUES (?,?,?,?,?)`);
  const nowMs = Date.now();
  insert.run(menuId, weekStart, nowMs, nowMs, JSON.stringify(dishes));
  console.log(`[seed] 已生成示例菜单 ${menuId}（${weekStart}）`);
}

if (SEED_ON_EMPTY) seedSampleMenu();

app.listen(PORT, HOST, () => {
  console.log(`\x1b[32mW-HOUSE 已启动\x1b[0m  http://${HOST}:${PORT}`);
  console.log(`数据库: ${DB_PATH}`);
  console.log(`AI 自动回复: ${ANTHROPIC_API_KEY ? '已启用（' + ANTHROPIC_MODEL + '）' : '未配置（设置 ANTHROPIC_API_KEY 启用）'}`);
});
