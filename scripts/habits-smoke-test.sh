#!/usr/bin/env bash
# ============================================================================
# lwaiwork 习惯模块 M2 端到端冒烟测试
#
# 与 todos-smoke-test 并列使用，验证 8 个 habits 端点 + 数据库新建 2 张表。
#
# 用法：
#   BASE_URL=https://api.wb.lwai.work/api bash scripts/habits-smoke-test.sh
#   BASE_URL=http://127.0.0.1:4001/api bash scripts/habits-smoke-test.sh
# ============================================================================
set -uo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:4001/api}"
RANDOM_TAG="$(date +%s)-$$"
TEST_EMAIL="habit-${RANDOM_TAG}@lwaiwork.test"
TEST_PASSWORD="Habit123456"
TEST_NAME="习惯测试用户"

PASS_COUNT=0
FAIL_COUNT=0

green() { printf '\033[32m%s\033[0m\n' "$1"; }
red()   { printf '\033[31m%s\033[0m\n' "$1"; }
info()  { printf '\033[36m%s\033[0m\n' "$1"; }

pass() { green "  [PASS] $1"; PASS_COUNT=$((PASS_COUNT + 1)); }
fail() { red "  [FAIL] $1"; FAIL_COUNT=$((FAIL_COUNT + 1)); }
dump() { echo "        响应: $(echo "$1" | head -c 500)"; }

info "=============================================="
info " lwaiwork M2 习惯模块端到端冒烟测试"
info " 目标: ${BASE_URL}"
info " 测试账号: ${TEST_EMAIL}"
info "=============================================="
echo

# ---------------------------------------------------------------------------
# 预检 1：先确认后端能连
# ---------------------------------------------------------------------------
info "[0/8] 预检 健康检查"
HEALTH_CODE=$(curl -s -o /dev/null -w '%{http_code}' -m 10 "${BASE_URL}/health" 2>/dev/null)
if [ "${HEALTH_CODE}" = "200" ]; then
  pass "健康检查返回 200"
else
  fail "健康检查返回 ${HEALTH_CODE}（预期 200）"
  red "后端不可达，退出。"
  exit 1
fi

# ---------------------------------------------------------------------------
# 预检 2：注册 + 拿 token
# ---------------------------------------------------------------------------
info "[1/8] 注册测试账号"
REG_BODY=$(curl -s -m 15 -X POST "${BASE_URL}/auth/register" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"${TEST_EMAIL}\",\"password\":\"${TEST_PASSWORD}\",\"name\":\"${TEST_NAME}\"}")
ACCESS_TOKEN=$(echo "${REG_BODY}" | grep -o '"accessToken":"[^"]*"' | head -1 | cut -d'"' -f4)
if [ -n "${ACCESS_TOKEN}" ]; then
  pass "注册成功并拿到 accessToken"
else
  fail "注册失败"
  dump "${REG_BODY}"
  exit 1
fi

# ---------------------------------------------------------------------------
# 测试 1：创建习惯
# ---------------------------------------------------------------------------
info "[2/8] 创建习惯 POST /habits"
TODAY="$(date -u +%F)"

CREATE_BODY=$(curl -s -m 15 -X POST "${BASE_URL}/habits" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H 'Content-Type: application/json' \
  -d "{
    \"name\":\"每天 8 杯水\",
    \"color\":\"#2FAF9E\",
    \"icon\":\"💧\",
    \"frequencyType\":\"daily\",
    \"targetCount\":8
  }")
HABIT_ID=$(echo "${CREATE_BODY}" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
if [ -n "${HABIT_ID}" ]; then
  pass "创建习惯成功 id=${HABIT_ID}"
else
  fail "创建失败"
  dump "${CREATE_BODY}"
  exit 1
fi

# ---------------------------------------------------------------------------
# 测试 2：列表（含今日完成情况）
# ---------------------------------------------------------------------------
info "[3/8] 列习惯 GET /habits（验证今日未完成）"
LIST_BODY=$(curl -s -m 10 "${BASE_URL}/habits" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}")

if echo "${LIST_BODY}" | grep -q "${HABIT_ID}" && \
   echo "${LIST_BODY}" | grep -q '"todayCount":0' && \
   echo "${LIST_BODY}" | grep -q '"todayCompleted":false'; then
  pass "列表返回该习惯 + todayCount=0 + todayCompleted=false"
else
  fail "列表结构异常"
  dump "${LIST_BODY}"
fi

# ---------------------------------------------------------------------------
# 测试 3：打卡（累积到 8 次，让 todayCompleted 变 true）
# ---------------------------------------------------------------------------
info "[4/8] 打卡 8 次（累加测试）"
for i in 1 2 3 4 5 6 7 8; do
  CHECK_CODE=$(curl -s -o /tmp/h_check.json -w '%{http_code}' -m 10 -X POST "${BASE_URL}/habits/${HABIT_ID}/check" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" \
    -H 'Content-Type: application/json' \
    -d '{"count":1}' 2>/dev/null)
  if [ "${CHECK_CODE}" != "201" ] && [ "${CHECK_CODE}" != "200" ]; then
    fail "第 ${i} 次打卡返回 ${CHECK_CODE}"
    dump "$(cat /tmp/h_check.json)"
    exit 1
  fi
done
pass "8 次打卡全部接受（HTTP 200/201）"

# 验证 todayCount 是 8
VERIFY_BODY=$(curl -s -m 10 "${BASE_URL}/habits" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}")
if echo "${VERIFY_BODY}" | grep -q '"todayCount":8' && \
   echo "${VERIFY_BODY}" | grep -q '"todayCompleted":true'; then
  pass "列表确认 todayCount=8 + todayCompleted=true"
else
  fail "todayCount 未累加到 8"
  dump "${VERIFY_BODY}"
fi

# ---------------------------------------------------------------------------
# 测试 4：获取 stats（streak 计算）
# ---------------------------------------------------------------------------
info "[5/8] 单习惯统计 GET /habits/:id/stats?range=30d"
STATS_BODY=$(curl -s -m 15 "${BASE_URL}/habits/${HABIT_ID}/stats?range=30d" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}")

if echo "${STATS_BODY}" | grep -q '"currentStreak":1' && \
   echo "${STATS_BODY}" | grep -q '"longestStreak":1' && \
   echo "${STATS_BODY}" | grep -q '"totalCheckins":8' && \
   echo "${STATS_BODY}" | grep -q '"heatmap"'; then
  pass "stats 含 streak=1 / totalCheckins=8 / heatmap 数组"
else
  fail "stats 结构异常"
  dump "${STATS_BODY}"
fi

# ---------------------------------------------------------------------------
# 测试 5：PATCH 修改习惯
# ---------------------------------------------------------------------------
info "[6/8] 修改习惯 PATCH /habits/:id（改 targetCount 为 6）"
PATCH_CODE=$(curl -s -o /tmp/h_patch.json -w '%{http_code}' -m 15 -X PATCH "${BASE_URL}/habits/${HABIT_ID}" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H 'Content-Type: application/json' \
  -d '{"targetCount":6}')
PATCH_BODY=$(cat /tmp/h_patch.json)
if [ "${PATCH_CODE}" = "200" ] && echo "${PATCH_BODY}" | grep -q '"targetCount":6'; then
  pass "修改成功 targetCount=6"
else
  fail "修改返回 ${PATCH_CODE}"
  dump "${PATCH_BODY}"
fi

# ---------------------------------------------------------------------------
# 测试 6：跨用户行级隔离（用新账号查老账号的习惯）
# ---------------------------------------------------------------------------
info "[7/8] 行级隔离测试（另一用户看不到本用户的 habit）"
ALT_EMAIL="other-${RANDOM_TAG}@lwaiwork.test"
ALT_BODY=$(curl -s -m 15 -X POST "${BASE_URL}/auth/register" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"${ALT_EMAIL}\",\"password\":\"Other123456\",\"name\":\"另一用户\"}")
ALT_TOKEN=$(echo "${ALT_BODY}" | grep -o '"accessToken":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -n "${ALT_TOKEN}" ]; then
  ALT_LIST=$(curl -s -m 10 "${BASE_URL}/habits" -H "Authorization: Bearer ${ALT_TOKEN}")
  if echo "${ALT_LIST}" | grep -q "${HABIT_ID}"; then
    fail "行级隔离失效：另一用户的列表能看到本用户的 habit id"
    dump "${ALT_LIST}"
  else
    pass "行级隔离生效：另一用户列表无本用户的 habit"
  fi

  # 跨用户尝试获取习惯详情应该 404 而非 403（防探测）
  ALT_DETAIL=$(curl -s -o /dev/null -w '%{http_code}' -m 10 "${BASE_URL}/habits/${HABIT_ID}" \
    -H "Authorization: Bearer ${ALT_TOKEN}")
  if [ "${ALT_DETAIL}" = "404" ]; then
    pass "跨用户访问返回 404（不泄漏资源是否存在）"
  else
    fail "跨用户访问返回 ${ALT_DETAIL}（应为 404）"
  fi
else
  fail "另一用户注册失败，跳过隔离测试"
fi

# ---------------------------------------------------------------------------
# 测试 7：软删除 + GET /habits 不再返回
# ---------------------------------------------------------------------------
info "[8/8] 软删除 + 重新列入验证"
DEL_CODE=$(curl -s -o /dev/null -w '%{http_code}' -m 15 -X DELETE "${BASE_URL}/habits/${HABIT_ID}" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}")
if [ "${DEL_CODE}" = "200" ] || [ "${DEL_CODE}" = "204" ]; then
  pass "删除返回 ${DEL_CODE}"
else
  fail "删除返回 ${DEL_CODE}"
fi

# 再列一次应不包含这个 id
LIST2_BODY=$(curl -s -m 10 "${BASE_URL}/habits" -H "Authorization: Bearer ${ACCESS_TOKEN}")
if echo "${LIST2_BODY}" | grep -q "${HABIT_ID}"; then
  fail "软删除后列表仍能找到该习惯"
else
  pass "软删除后列表已不显示该习惯"
fi

# ---------------------------------------------------------------------------
# 汇总
# ---------------------------------------------------------------------------
echo
info "=============================================="
if [ "${FAIL_COUNT}" -eq 0 ]; then
  green " M2 习惯模块端到端冒烟测试全部通过（${PASS_COUNT} 项）"
  green " 链路已跑通：建习惯 → 列表 → 打卡 8 次 → stats → 修改 → 跨用户隔离 → 软删"
  info "=============================================="
  exit 0
else
  red   " M2 习惯模块测试失败：通过 ${PASS_COUNT} 项 / 失败 ${FAIL_COUNT} 项"
  info "=============================================="
  exit 1
fi
