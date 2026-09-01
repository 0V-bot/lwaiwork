#!/usr/bin/env bash
# 一键停用 certbot 自动续期，启用我们自己的告警机制。
# 这脚本是幂等的，可以重复跑。

set -e

echo "[1/4] 停用 systemd timer"
systemctl stop certbot.timer 2>&1 || true
systemctl disable certbot.timer 2>&1 || true
echo "  timer 状态: $(systemctl is-active certbot.timer) / $(systemctl is-enabled certbot.timer)"

echo ""
echo "[2/4] 移除 cron.d/certbot（双保险）"
if [ -f /etc/cron.d/certbot ]; then
  mv /etc/cron.d/certbot /etc/cron.d/certbot.disabled.manual-renew-mode
  echo "  已禁用（重命名为 .disabled.manual-renew-mode）"
else
  echo "  /etc/cron.d/certbot 已不存在（或已被禁用）"
fi

echo ""
echo "[3/4] 确保 cert-watch.sh 在 cron 里"
(crontab -l 2>/dev/null | grep -v 'cert-watch.sh' > /tmp/crontab.new) || true
echo "0 8 * * * /opt/lwaiwork/scripts/cert-watch.sh" >> /tmp/crontab.new
crontab /tmp/crontab.new
echo "  crontab 内容:"
crontab -l | grep cert-watch | sed 's/^/    /'

echo ""
echo "[4/4] 立即跑一次自检（不会自动续期！）"
/opt/lwaiwork/scripts/cert-watch.sh
echo "  日志最后一行: $(tail -1 /var/log/lwaiwork-cert-watch.log)"

echo ""
echo "完成。"
echo "提醒查看方式（不用 SSH 进容器）："
echo "  ls -la /opt/lwaiwork/.cert-*"
echo "  tail /var/log/lwaiwork-cert-watch.log"
