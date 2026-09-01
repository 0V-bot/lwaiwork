# SSL 证书手动切换 SOP（lwaiwork）

> 适用：当 `/var/log/lwaiwork-cert-watch.log` 出现提醒、或者
> `/opt/lwaiwork/.cert-action-needed*` 标志文件存在时执行。

## 1. 设计原则

- **不自动续期**（2026-09-01 用户决策）：
  - Let's Encrypt 证书虽然免费，但续期是"无意识动作"
  - 用户希望：85 天前 → 提醒 → 用户决定怎么处理（重新走 LE / 切其他 CA）
  - 专家团负责执行切换
- **预警时间线**（`/opt/lwaiwork/scripts/cert-watch.sh`）：

| 剩余天数 | 等级 | 标志文件 | 你该做什么 |
| --- | --- | --- | --- |
| ≥ 85 | OK | — | 无需任何操作 |
| 60-84 | INFO | `.cert-action-needed` | 准备：登录证书商控制台 / 续费 |
| 30-59 | WARN | `.cert-action-needed` | 准备 + 联系专家团 |
| 7-29 | URGENT | `.cert-action-needed-urgent` | **立即**处理 |
| 0-6 | CRIT | `.cert-action-needed-urgent` | 24h 内必须切换 |
| < 0 | EXPIRED | `.cert-expired` | 服务停服中，紧急 |

- **监控频率**：每天 08:00 跑一次 `cert-watch.sh`（crontab）
- **如何感知**：
  - SSH 到 ECS 后 `ls /opt/lwaiwork/.cert-*` 一眼可见
  - `tail /var/log/lwaiwork-cert-watch.log` 看历史
  - 后续可接入飞书/钉钉 webhook（待你点头）

## 2. 当收到提醒后的流程

### 2.1 用户需要做的（5-10 分钟）

**方案 A：继续用 Let's Encrypt（仍免费）**

1. 确认你能 SSH 到 ECS（密钥 `C:\Users\Administrator\Desktop\AIwork.pem`）
2. 告诉 WorkBuddy 的专家团"想重新走 LE 申请证书"
3. 专家团执行 `scripts/aliyun-dns-record.js` 加 TXT → certbot 重新走 DNS-01 验证
4. 新证书文件落到 `/etc/letsencrypt/live/wb.lwai.work/`

**方案 B：换其他免费 CA（ZeroSSL / BuyPass）**

1. 去对应 CA 注册账号并签发证书（CSR 可让专家团生成）
2. 把证书文件（`fullchain.pem` + `privkey.pem`）上传到 ECS：
   - 推荐路径：`/etc/letsencrypt/live/wb.lwai.work/`
   - 目录权限 `drwx------`，属主 root
3. 不动文件路径，只换里面的 PEM；Nginx 配置不需要改一行

**方案 C：买收费证书（DigiCert / Sectigo 等）**

1. 在 CA 厂商生成 CSR（专家团可代生成）
2. 把厂商颁发的 `fullchain.pem` + `chain.pem` + `privkey.pem` 上传到 ECS
3. Nginx 配置可能需要加 `ssl_trusted_certificate /path/to/chain.pem;`

### 2.2 专家团（WorkBuddy）会做的事

1. 在你 SSH 进 ECS 之前，先做诊断：
   - 当前证书指纹 / 过期时间 / 域名匹配
   - 备用证书（如果有）是否就绪
2. 切换步骤（10-15 分钟）：
   - 新证书文件落到正确路径
   - `nginx -t` 语法检查
   - `nginx -s reload` 平滑重载（不中断连接）
3. 切换后验证：
   - `echo | openssl s_client -connect api.wb.lwai.work:443 -servername api.wb.lwai.work 2>/dev/null | openssl x509 -noout -subject -dates`
   - `curl -kI https://api.wb.lwai.work/api/health` 预期 200
4. 清理状态：
   - 旧证书文件移到 `/etc/letsencrypt/archive/wb.lwai.work/`
   - 标志文件 `.cert-action-needed*` 自动清掉（下次 cron 跑时）
5. 起草一份"新证书交接记录"附在你的工作日志

## 3. 紧急回滚（旧证书还在）

**前提**：原 certbot 申请未做 revoke / certbot 还能跑 / 旧证书文件未删

```bash
# 1. 找出前一张证书（archive 目录按 certN.pem 编号）
ls -la /etc/letsencrypt/archive/wb.lwai.work/

# 2. 把 live 目录软链改回旧 cert
cd /etc/letsencrypt/live/wb.lwai.work
sudo rm fullchain.pem privkey.pem chain.pem cert.pem
sudo ln -s ../../archive/wb.lwai.work/cert2.pem cert.pem
sudo ln -s ../../archive/wb.lwai.work/chain2.pem chain.pem
sudo ln -s ../../archive/wb.lwai.work/fullchain2.pem fullchain.pem
sudo ln -s ../../archive/wb.lwai.work/privkey2.pem privkey.pem

# 3. nginx reload
sudo nginx -t && sudo nginx -s reload
```

**如果旧证书被 certbot 清理或不可用**：只能重新走"2.1 用户做的"流程，**没有捷径**。

## 4. 监控脚本技术细节

- 脚本：`/opt/lwaiwork/scripts/cert-watch.sh`
- 日志：`/var/log/lwaiwork-cert-watch.log`
- 标志目录：`/opt/lwaiwork/.cert-*`
- crontab：`0 8 * * * /opt/lwaiwork/scripts/cert-watch.sh`
- 阈值常量 `THRESHOLD=85` 在脚本顶部，要改阈值直接编辑重启 cron

## 5. 升级路线（可选，你点头就做）

| 升级 | 价值 | 实施成本 |
| --- | --- | --- |
| 加飞书/钉钉 webhook 告警 | 不用 SSH 也能感知 | 0.5h |
| 标志文件加自动邮件告警（通过 agent-mail connector） | 邮件提醒 | 0.5h |
| 把 THRESHOLD 改成可配置（环境变量） | 不同环境用不同阈值 | 0.2h |
| 多 ECS 集中监控（中心化日志） | 服务器多了也能监控 | 中 |
