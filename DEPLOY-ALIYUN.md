# 阿里云 ECS 部署指南

面向阿里云 ECS 的 W-HOUSE 部署手册。**从零到公网可访问 HTTPS**，总耗时约 30 分钟（不含域名备案）。

---

## 目录

1. [选购 ECS](#1-选购-ecs)
2. [首次登录服务器](#2-首次登录服务器)
3. [安装 Node.js](#3-安装-nodejs)
4. [上传代码](#4-上传代码)
5. [配置环境变量](#5-配置环境变量)
6. [用 pm2 启动服务](#6-用-pm2-启动服务)
7. [配置阿里云安全组](#7-配置阿里云安全组)
8. [域名解析](#8-域名解析)
9. [Caddy 反向代理 + 自动 HTTPS](#9-caddy-反向代理--自动-https)
10. [备份](#10-备份)
11. [代码更新流程](#11-代码更新流程)
12. [故障排查](#12-故障排查)

---

## 1. 选购 ECS

进入阿里云控制台 → ECS。推荐配置：

| 项目 | 推荐 | 说明 |
|---|---|---|
| 地域 | **香港 / 新加坡** 或**杭州 / 上海** | 国内 ECS 域名需要 [ICP 备案](https://beian.aliyun.com/)（免费但要 2-3 周）；不想备案就选境外 |
| 规格 | 突发性能 **t6-c1m1**（1 vCPU · 1 GB） | 小型物业已足够，几百住客同时用没压力 |
| 系统 | **Ubuntu 22.04 LTS** | 长期支持，包管理方便 |
| 硬盘 | 40 GB **ESSD Entry** | SQLite 数据+日志几十 MB 就够 |
| 带宽 | 按流量 或 **1 Mbps 固定** | 前端资源小，够用 |
| 公网 IP | **勾选分配** | 必须有公网 IP 才能对外提供服务 |

购买时**记下 root 密码**（或选 SSH 密钥）。

> **国内 ECS + 域名**：必须先做 ICP 备案，否则国内 DNS 拒绝解析你的域名指向国内 IP。备案要提交营业执照或个人身份证，主体一次备案即可。境外 ECS 不需要。

---

## 2. 首次登录服务器

用 macOS 或 Linux 终端：

```bash
ssh root@<你的公网IP>
```

进服务器后先更新系统并创建一个非 root 用户（安全习惯）：

```bash
apt update && apt upgrade -y
apt install -y curl git ufw

# 创建部署用户
adduser --disabled-password --gecos "" deploy
usermod -aG sudo deploy

# 把当前的 SSH key 复制给新用户
mkdir -p /home/deploy/.ssh
cp ~/.ssh/authorized_keys /home/deploy/.ssh/  # 用密钥登录时才需要
chown -R deploy:deploy /home/deploy/.ssh
chmod 700 /home/deploy/.ssh
chmod 600 /home/deploy/.ssh/authorized_keys 2>/dev/null || true

# 换到 deploy 用户
su - deploy
```

之后所有命令都在 `deploy` 用户下操作。

---

## 3. 安装 Node.js

用官方 NodeSource 源装 Node 20 LTS：

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # 应该显示 v20.x
npm -v
```

---

## 4. 上传代码

**方式 A：Git（推荐）**

如果你把代码推到了 GitHub / Gitee，在服务器：

```bash
cd ~
git clone https://github.com/<你的用户名>/menu-feedback.git w-house
cd w-house
npm install --omit=dev
```

**方式 B：scp 直接从本机传**

在你的 Mac 上：

```bash
cd /Users/peko
# 排除 node_modules 和数据库
tar --exclude='menu-feedback/node_modules' \
    --exclude='menu-feedback/data.sqlite*' \
    -czf w-house.tar.gz menu-feedback/
scp w-house.tar.gz deploy@<公网IP>:~/
```

在服务器：

```bash
cd ~
tar xzf w-house.tar.gz
mv menu-feedback w-house
cd w-house
npm install --omit=dev
```

---

## 5. 配置环境变量

```bash
cp .env.example .env
nano .env
```

**必须修改**这两项：

```env
ADMIN_PASSWORD=你的强密码-至少-16-位
SESSION_SECRET=贴一段随机字节
```

`SESSION_SECRET` 用这条命令生成后贴进去：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**可选**：如果你有 Anthropic API Key，配置以启用 AI 起草回复：

```env
ANTHROPIC_API_KEY=sk-ant-xxxxxxxx
```

保存退出（`Ctrl+O`、`Enter`、`Ctrl+X`）。

---

## 6. 用 pm2 启动服务

pm2 让 Node 进程崩溃自动重启、开机自启。

```bash
sudo npm install -g pm2
pm2 start server.js --name w-house
pm2 save
pm2 startup      # 复制打印出的命令，粘贴执行一次（用来注册开机自启）
```

验证：

```bash
pm2 status       # 应看到 w-house 状态为 online
pm2 logs w-house --lines 20   # 应看到 "W-HOUSE 已启动 http://0.0.0.0:3000"
curl http://127.0.0.1:3000/health    # 应返回 {"ok":true}
```

---

## 7. 配置阿里云安全组

阿里云控制台 → ECS → 实例 → 安全组 → 配置规则 → **入方向**新增：

| 端口 | 协议 | 授权对象 | 说明 |
|---|---|---|---|
| **22** | TCP | 你的家用 IP / 全部 | SSH（尽量收窄，减少暴力破解） |
| **80** | TCP | 0.0.0.0/0 | HTTP（Caddy 会用来做 ACME 挑战） |
| **443** | TCP | 0.0.0.0/0 | HTTPS |

**不要**开放 3000 端口——Node 服务只在本机监听 127.0.0.1 提供服务，由 Caddy 代理。

---

## 8. 域名解析

进入阿里云 DNS 控制台（或你的域名注册商后台）：

- 记录类型：**A**
- 主机记录：`menu`（或你想要的子域名，例如 `wh`）
- 记录值：**你的 ECS 公网 IP**
- TTL：10 分钟

等 1-5 分钟后，本地测试：

```bash
dig menu.yourdomain.com   # 或 ping menu.yourdomain.com
```

应能解析到你的 ECS IP。

> **国内域名**必须先备案通过，才能解析到国内 ECS。境外 ECS 无此限制。
>
> **没有域名？** 可以用 `<公网IP>:80` 直接访问（Caddy 那步用 `:80` 代替域名）。但没有 HTTPS，Chrome 会警告。

---

## 9. Caddy 反向代理 + 自动 HTTPS

Caddy 自动申请 Let's Encrypt 证书，一行配置搞定 HTTPS。

安装：

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | \
  sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | \
  sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

编辑配置：

```bash
sudo nano /etc/caddy/Caddyfile
```

用**你的域名**替换掉 `menu.yourdomain.com`：

```
menu.yourdomain.com {
    reverse_proxy 127.0.0.1:3000
    encode gzip
}
```

如果没有域名，用 IP 直连（无 HTTPS）：

```
:80 {
    reverse_proxy 127.0.0.1:3000
}
```

重启 Caddy：

```bash
sudo systemctl restart caddy
sudo systemctl status caddy    # 应显示 active (running)
```

首次访问 `https://menu.yourdomain.com` 时，Caddy 会自动申请证书（几秒钟）。刷新一下应显示 W-HOUSE 页面。

---

## 10. 备份

SQLite 就一个 `data.sqlite` 文件，复制即可。加一个定时任务，每天备份到 `~/backups`：

```bash
mkdir -p ~/backups
crontab -e
```

添加这行（每天 3:00 自动备份，保留最近 30 天）：

```
0 3 * * * cp ~/w-house/data.sqlite ~/backups/data-$(date +\%F).sqlite && find ~/backups -name 'data-*.sqlite' -mtime +30 -delete
```

想拉到本地保管：

```bash
# 在你的 Mac 上
scp deploy@<公网IP>:~/backups/data-2026-09-13.sqlite ~/Downloads/
```

---

## 11. 代码更新流程

服务器上，标准流程：

```bash
cd ~/w-house
git pull             # 或用 scp 覆盖上传
npm install --omit=dev   # 有新依赖时才需要
pm2 restart w-house
pm2 logs w-house --lines 30   # 确认没报错
```

样式和前端 JS 改动**无需 restart**（用户刷新页面即可）。仅当 `server.js`、`package.json` 或环境变量改动时才需要 pm2 restart。

---

## 12. 故障排查

| 症状 | 排查步骤 |
|---|---|
| 浏览器打不开 | 1. `curl http://127.0.0.1:3000/health` 看服务是否活着<br>2. 阿里云安全组 80/443 是否放行<br>3. `sudo systemctl status caddy` 看反代<br>4. Caddy 日志：`journalctl -u caddy -n 50` |
| HTTPS 证书申请失败 | 1. 域名 A 记录是否正确指向 ECS 公网 IP<br>2. 80 端口是否开放（ACME 需要）<br>3. 国内域名是否已备案 |
| 管理员密码忘了 | `nano ~/w-house/.env` 改 `ADMIN_PASSWORD`，`pm2 restart w-house` |
| 重启后全部管理员被登出 | 说明 `SESSION_SECRET` 没配置。回 `.env` 配置一个固定值即可 |
| 服务不定期崩溃 | `pm2 logs w-house --err` 看错误日志。SQLite 一般不会崩，多半是 OOM，升级 ECS 到 2GB 内存 |
| 想看谁在访问 | `sudo tail -f /var/log/caddy/access.log`（Caddy 默认不写 access log，需要在 Caddyfile 里 `log { output file /var/log/caddy/access.log }`） |

---

## 加固建议（可选）

生产环境上线一段时间后可以做的事：

- **SSH 密钥登录**：`sshd_config` 里禁用密码登录，`PasswordAuthentication no`
- **fail2ban**：`sudo apt install fail2ban`，防 SSH 暴力破解
- **AI Key 分级**：给系统专属 API Key 而不是主账号 Key
- **上流量监控**：阿里云云监控免费，可设定 CPU / 内存 / 带宽阈值报警
- **邮件告警**：pm2 有插件 `pm2-slack` / `pm2-mail`，进程崩溃时通知
- **UFW 防火墙**：`sudo ufw allow 22`, `sudo ufw allow 80`, `sudo ufw allow 443`, `sudo ufw enable`（阿里云安全组已经是第一道防线，UFW 是额外一层）

---

## 一键部署（可选）

如果你嫌步骤多，可以把 3-6 步 整合进一个脚本：

```bash
cat > ~/deploy.sh <<'EOF'
#!/bin/bash
set -e
cd ~/w-house
git pull
npm install --omit=dev
pm2 restart w-house || pm2 start server.js --name w-house
pm2 save
echo "✅ 部署完成"
pm2 status
EOF
chmod +x ~/deploy.sh
```

以后更新只需 `~/deploy.sh`。
