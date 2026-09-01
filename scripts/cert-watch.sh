#!/usr/bin/env bash
# ============================================================================
# lwaiwork 证书有效期监控（替代 certbot 自动续期）
#
# 设计（2026-09-01 用户决策）：
#   - LE 等免费证书有效期 90 天
#   - 用户希望："使用 85 天之后"才开始提醒 = 剩余 ≤ 5 天 开始告警
#   - 不自动续期（每次到期都让用户决策一次）
#   - 专家团协助切换证书（脚本见 disable-certbot-auto-renew.sh）
#
# 阈值（剩余天数）：
#   remaining >= 6   -> OK（不在监控范围）
#   remaining 4-5    -> INFO  '剩 5 天，建议开始准备'
#   remaining 2-3    -> WARN  '剩 ≤ 3 天，请尽快注册新证书'
#   remaining 1      -> URGENT'明天过期！'
#   remaining 0      -> CRIT  '今天已过期！'
#             < 0    -> EXPIRED
#
# 标志位文件（ls /opt/lwaiwork/.cert-* 一眼可见）：
#   .cert-action-needed          普通提醒（INF/WARN 级别）
#   .cert-action-needed-urgent   紧急（URGENT/CRIT 级别）
#   .cert-expired                已过期
# ============================================================================
set -u

LIVE_DIR=/etc/letsencrypt/live
LOGFILE=/var/log/lwaiwork-cert-watch.log
ACTION_DIR=/opt/lwaiwork
NOW_EPOCH=$(date +%s)
ONE_DAY=86400
THRESHOLD=5  # 用户决策：剩余 ≤ 5 天开始提醒（90 - 85 = 5）

# 清掉今天之前的待处理标志，每次都从最新结果重算
rm -f "$ACTION_DIR/.cert-action-needed" "$ACTION_DIR/.cert-action-needed-urgent" "$ACTION_DIR/.cert-expired" 2>/dev/null

echo_log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOGFILE"
}

MAX_URGENCY=0  # 0=OK 1=INFO 2=WARN 3=URGENT 4=CRIT 5=EXPIRED

for cert_dir in "$LIVE_DIR"/*/; do
  [ -d "$cert_dir" ] || continue
  name=$(basename "$cert_dir")
  cert="$cert_dir/cert.pem"

  [ -f "$cert" ] || continue

  not_after=$(openssl x509 -noout -enddate -in "$cert" 2>/dev/null | cut -d= -f2)
  if [ -z "$not_after" ]; then
    echo_log "WARN  $name: 无法读取 cert.pem 过期时间"
    continue
  fi

  expire_epoch=$(date -d "$not_after" +%s 2>/dev/null)
  if [ -z "$expire_epoch" ]; then
    echo_log "WARN  $name: 解析过期时间失败: $not_after"
    continue
  fi

  remain_days=$(( (expire_epoch - NOW_EPOCH) / ONE_DAY ))
  remain_human=$(openssl x509 -noout -subject -enddate -in "$cert" 2>/dev/null | tr '\n' ' ')

  if [ "$remain_days" -ge "$THRESHOLD" ]; then
    echo_log "OK    $name: 还剩 ${remain_days} 天  ($remain_human)"
    continue
  fi

  if [ "$remain_days" -lt 0 ]; then
    level=5; level_name=EXPIRED; marker=".cert-expired"
    echo_log "CRIT  $name: 已过期 ${remain_days} 天！  ($remain_human)"
    touch "$ACTION_DIR/$marker"
    continue
  fi

  # 剩余 0-5 天：分级告警
  if [ "$remain_days" -eq 0 ]; then
    level=4; level_name=CRIT; marker=".cert-action-needed-urgent"
  elif [ "$remain_days" -le 1 ]; then
    level=3; level_name=URGENT; marker=".cert-action-needed-urgent"
  elif [ "$remain_days" -le 3 ]; then
    level=2; level_name=WARN; marker=".cert-action-needed"
  else
    level=1; level_name=INFO; marker=".cert-action-needed"
  fi

  echo_log "$level_name $name: 还剩 ${remain_days} 天  ($remain_human)"
  [ "$level" -gt "$MAX_URGENCY" ] && MAX_URGENCY=$level
  touch "$ACTION_DIR/$marker"
done

# 总结行（方便 grep）
case $MAX_URGENCY in
  0) echo_log "STATE_OK 全部证书有效期均 ≥ 6 天（剩余 $THRESHOLD 天内才告警）" ;;
  1) echo_log "STATE_INFO 已进入 5 天提醒窗口" ;;
  2) echo_log "STATE_WARN  有证书 ≤ 3 天" ;;
  3) echo_log "STATE_URGENT  有证书 ≤ 1 天" ;;
  4) echo_log "STATE_CRIT   有证书当天过期！" ;;
  5) echo_log "STATE_EXPIRED 有证书已过期" ;;
esac
