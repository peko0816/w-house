# W-HOUSE — 餐饮菜单与住客反馈系统

面向物业餐厅的每周菜单发布与住客反馈平台。住客手机 / 电脑访问同一网址即可查看本周餐单、给每道菜打 0-5 星、留下点评（可选择公开或仅管理员可见）；物业管理员登录后台后可发布菜单、逐条回复反馈、或让 AI 起草回复。

- Node.js + Express，前端零框架，SQLite 单文件存储
- 一份代码同时服务住客和管理员，Cookie 会话
- 支持深浅色主题、移动端优先布局、离线可读

## 快速开始

```bash
npm install
cp .env.example .env
# 编辑 .env 至少设置 ADMIN_PASSWORD 和 SESSION_SECRET
npm start
```

打开 http://localhost:3000

- 顶部右侧「管理员」按钮 → 输入密码登录
- 首次启动会自动生成本周示例菜单，登录后可编辑或删除

## 环境变量

| 变量 | 必填 | 说明 |
|---|---|---|
| `ADMIN_PASSWORD` | 强烈推荐 | 管理员密码，默认 `admin123` 仅用于本地测试 |
| `SESSION_SECRET` | 生产必填 | HMAC 签名密钥，重启保持登录 |
| `PORT` | 否 | 服务端口，默认 3000 |
| `DB_PATH` | 否 | SQLite 文件路径，默认 `./data.sqlite` |
| `ANTHROPIC_API_KEY` | 否 | 配置后启用「AI 起草回复」按钮 |
| `ANTHROPIC_MODEL` | 否 | 默认 `claude-haiku-4-5-20251001` |
| `SEED_ON_EMPTY` | 否 | 空库首次启动是否生成示例菜单，默认 `1` |

## 部署

- **阿里云 ECS**（推荐国内场景）：完整分步教程见 [DEPLOY-ALIYUN.md](DEPLOY-ALIYUN.md) — 从选购、SSH、Node 安装、pm2、安全组、Caddy 自动 HTTPS 到备份和更新流程。
- **Docker**：

  ```bash
  docker build -t w-house .
  docker run -d --name w-house \
    -p 3000:3000 \
    -v $(pwd)/data:/data \
    -e ADMIN_PASSWORD='your-strong-password' \
    -e SESSION_SECRET="$(openssl rand -hex 32)" \
    -e ANTHROPIC_API_KEY='sk-ant-...' \
    w-house
  ```

  SQLite 文件挂载在 `/data`，容器重建不丢数据。

- **PaaS（Railway / Fly.io / Render）**：连 Git 仓库、配置环境变量、挂持久卷到 `/data` 并设 `DB_PATH=/data/w-house.sqlite`。

## 数据模型

三张表：

- `menus` — 每周菜单（`dishes_json` 内嵌菜品列表，避免每菜一行）
- `reviews` — 反馈（含 `visible` 公私标记，`client_id` 用于住客本机识别）
- `replies` — 物业回复（`review_id` 一对一，`auto` 区分是否 AI 起草）

自动备份 SQLite：`cp data.sqlite backup-$(date +%F).sqlite`。

## 隐私模型

- **公开反馈**：所有住客可见，物业可见
- **仅管理员**：只有物业登录后台能看到；住客本机通过 `client_id` 仍可看到自己提交过什么
- 后端在 `/api/reviews` 会根据登录状态过滤私密条目，未登录管理员无法通过 API 拉取到私密反馈

## 修改样式

样式集中在 [public/styles.css](public/styles.css)，主色通过 CSS 变量控制（`--accent` 是暖锈红，`--gold` 是星标金）。改主色只需替换 `:root` 里对应变量。

## 常见问题

- **忘记管理员密码** → 修改 `.env` 里 `ADMIN_PASSWORD`，重启服务
- **重启后所有管理员被登出** → 设置固定 `SESSION_SECRET`（生成方式见 `.env.example`）
- **想恢复示例数据** → 停服务、删除 `data.sqlite`、重启（`SEED_ON_EMPTY=1`）

## 文档

- [ADMIN-GUIDE.md](ADMIN-GUIDE.md) — 管理员日常操作手册（发菜单、回复反馈、AI 起草、常见问题）
- [DEPLOY-ALIYUN.md](DEPLOY-ALIYUN.md) — 阿里云 ECS 从零到公网可访问的完整部署教程
- [CHANGELOG.md](CHANGELOG.md) — 变更记录

## 许可

MIT
