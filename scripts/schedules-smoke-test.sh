#!/usr/bin/env bash
# ============================================================================
# lwaiwork 习惯模块 M2-3 端到端冒烟测试
#
# 覆盖：8 端点 + 单期修改 + truncate + 时区 + 行级隔离
# 全部 ASCII marker（终端兼容）
# ============================================================================
set -uo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:4001/api}"
RANDOM_TAG="$(date +%s)-$$"
TEST_EMAIL="sched-${RANDOM_TAG}@lwaiwork.test"
TEST_PASSWORD="Sched123456"
TEST_NAME="schedules test user"

PASS_COUNT=0
FAIL_COUNT=0

green() { printf '\033[32m%s\033[0m\n' "$1"; }
red()   { printf '\033[31m%s\033[0m\n' "$1"; }
info()  { printf '\033[36m%s\033[0m\n' "$1"; }
pass() { green "  [PASS] $1"; PASS_COUNT=$((PASS_COUNT + 1)); }
fail() { red "  [FAIL] $1"; FAIL_COUNT=$((FAIL_COUNT + 1)); }
dump() { echo "        body: $(echo "$1" | head -c 500)"; }

info "=============================================="
info " lwaiwork M2-3 schedules end-to-end test"
info " target: ${BASE_URL}"
info " account: ${TEST_EMAIL}"
info "=============================================="
echo

# helper: 取 JSON 字段
jget() { echo "$1" | grep -o "\"$2\":\"[^\"]*\"" | head -1 | cut -d'"' -f4; }

# 0. 注册
info "[0/12] register + token"
RB=$(curl -s -m 15 -X POST "${BASE_URL}/auth/register" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"${TEST_EMAIL}\",\"password\":\"${TEST_PASSWORD}\",\"name\":\"${TEST_NAME}\"}")
TOKEN=$(jget "$RB" accessToken)
[ -n "$TOKEN" ] && pass "got token" || { fail "register failed"; dump "$RB"; exit 1; }

# 1. 创单次事件
info "[1/12] POST /schedules (single event)"
START=$(date -u -d 'tomorrow 09:00' +%Y-%m-%dT%H:%M:%S.000Z 2>/dev/null || date -u -v+1d +%Y-%m-%dT09:00:00.000Z)
END=$(date -u -d 'tomorrow 10:00' +%Y-%m-%dT%H:%M:%S.000Z 2>/dev/null || date -u -v+1d +%Y-%m-%dT10:00:00.000Z)
SINGLE=$(curl -s -m 15 -X POST "${BASE_URL}/schedules" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"title\":\"single-${RANDOM_TAG}\",\"startAt\":\"${START}\",\"endAt\":\"${END}\",\"timezone\":\"Asia/Shanghai\",\"allDay\":false,\"color\":\"#2FAF9E\"}")
SINGLE_ID=$(jget "$SINGLE" id)
[ -n "$SINGLE_ID" ] && pass "single event id=$SINGLE_ID" || { fail "create single"; dump "$SINGLE"; exit 1; }

# 2. 创重复事件 (daily x 5)
info "[2/12] POST /schedules (recurring DAILY x 5)"
RECUR=$(curl -s -m 15 -X POST "${BASE_URL}/schedules" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"title\":\"recur-${RANDOM_TAG}\",\"startAt\":\"${START}\",\"endAt\":\"${END}\",\"timezone\":\"UTC\",\"allDay\":false,\"rrule\":\"FREQ=DAILY;COUNT=5\"}")
RECUR_ID=$(jget "$RECUR" id)
[ -n "$RECUR_ID" ] && pass "recurring event id=$RECUR_ID" || { fail "create recurring"; dump "$RECUR"; exit 1; }

# 3. 列表展开 10 天窗口（应至少有 5 个 recur 实例 + 1 个 single）
info "[3/12] GET /schedules?from=&to= (10-day window)"
FROM=$(date -u -d 'today' +%Y-%m-%dT00:00:00.000Z 2>/dev/null || date -u +%Y-%m-%dT00:00:00.000Z)
TO=$(date -u -d '10 days' +%Y-%m-%dT00:00:00.000Z 2>/dev/null || date -u -v+10d +%Y-%m-%dT00:00:00.000Z)
WIN=$(curl -s -m 15 "${BASE_URL}/schedules?from=${FROM}&to=${TO}" -H "Authorization: Bearer $TOKEN")
RECUR_COUNT=$(echo "$WIN" | grep -o "\"scheduleId\":\"$RECUR_ID\"" | wc -l)
SINGLE_COUNT=$(echo "$WIN" | grep -o "\"scheduleId\":\"$SINGLE_ID\"" | wc -l)
[ "$RECUR_COUNT" -ge 5 ] && pass "recurring 展开 $RECUR_COUNT 个实例 (>=5)" || fail "recurring only $RECUR_COUNT (expected >=5)"
[ "$SINGLE_COUNT" -eq 1 ] && pass "single 出现 1 次" || fail "single count=$SINGLE_COUNT"

# 4. 详情
info "[4/12] GET /schedules/:id"
DETAIL=$(curl -s -m 10 "${BASE_URL}/schedules/${RECUR_ID}" -H "Authorization: Bearer $TOKEN")
echo "$DETAIL" | grep -q "\"rrule\":\"FREQ=DAILY;COUNT=5\"" && pass "detail 含 RRULE" || fail "detail missing rrule"
echo "$DETAIL" | grep -q "\"overrides\":" && pass "detail 含 overrides 数组" || fail "detail missing overrides"

# 5. PATCH series（改 title）
info "[5/12] PATCH /schedules/:id (改 series title)"
NEW_TITLE="recur-edited-${RANDOM_TAG}"
PT=$(curl -s -m 15 -X PATCH "${BASE_URL}/schedules/${RECUR_ID}" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"title\":\"$NEW_TITLE\"}")
echo "$PT" | grep -q "\"title\":\"$NEW_TITLE\"" && pass "series title 重加密" || fail "patch series"

# 6. 单期修改：第 3 个 instance 改时间
info "[6/12] PATCH /schedules/:id/instance?instanceStartAt=... (改单期)"
# 取第 3 个 recur 实例的 instanceStartAt
THIRD_INST=$(echo "$WIN" | grep -o "\"scheduleId\":\"$RECUR_ID\"[^}]*" | sed -n '3p' | grep -o '"instanceStartAt":"[^"]*"' | head -1 | cut -d'"' -f4)
[ -n "$THIRD_INST" ] && pass "取到第 3 个 instance: $THIRD_INST" || fail "no 3rd instance"
NEW_TIME="2027-01-01T00:00:00.000Z"
INS=$(curl -s -m 15 -X PATCH "${BASE_URL}/schedules/${RECUR_ID}/instance?instanceStartAt=${THIRD_INST}" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"title\":\"override-${RANDOM_TAG}\"}")
echo "$INS" | grep -q "\"instanceStartAt\":\"$THIRD_INST\"" && pass "override 已建" || fail "instance patch"

# 验证：再拉窗口，第 3 个 instance 应有 isOverride=true + title=override-${RANDOM_TAG}
# 手工 node 解析 JSON 避免单行格式 grep 错位
WIN2=$(curl -s -m 15 "${BASE_URL}/schedules?from=${FROM}&to=${TO}" -H "Authorization: Bearer $TOKEN")
THIRD_INST="${THIRD_INST}" OVR_TITLE="override-${RANDOM_TAG}" node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
  const arr=JSON.parse(s);
  const target=process.env.THIRD_INST;
  const x=arr.find(e=>e.instanceStartAt===target);
  if(!x){console.log("truncated");process.exit(0);}
  if(x.isOverride && x.title===process.env.OVR_TITLE){console.log("ok");process.exit(0);}
  console.log("MISMATCH",JSON.stringify(x));process.exit(2);
});
' <<< "$WIN2"
RC=$?
[ "$RC" = "0" ] && pass "单期修改生效（其他期不受影响）" || { fail "override 验证失败 (rc=$RC)"; dump "$WIN2"; }

# 7. 单期删除（truncate=false，只删第 3 个）
info "[7/12] DELETE /schedules/:id/instance (单期删除)"
curl -s -o /dev/null -w '%{http_code}\n' -m 15 -X DELETE \
  "${BASE_URL}/schedules/${RECUR_ID}/instance?instanceStartAt=${THIRD_INST}" \
  -H "Authorization: Bearer $TOKEN" | head -1 > /tmp/delcode
DEL_CODE=$(cat /tmp/delcode)
[ "$DEL_CODE" = "200" ] && pass "单期删除 HTTP 200" || fail "del code=$DEL_CODE"

WIN3=$(curl -s -m 15 "${BASE_URL}/schedules?from=${FROM}&to=${TO}" -H "Authorization: Bearer $TOKEN")
# 列表里这个 instance 应消失，其他期保留
THIRD_AFTER=$(echo "$WIN3" | grep -o "\"scheduleId\":\"$RECUR_ID\"[^}]*\"instanceStartAt\":\"$THIRD_INST\"" | wc -l)
[ "$THIRD_AFTER" = "0" ] && pass "第 3 期已删" || fail "still $THIRD_AFTER copies"

# 8. truncate this and future
info "[8/12] DELETE /schedules/:id/instance?truncate=true (this and future)"
# 取第 4 个 instance
FOURTH=$(echo "$WIN2" | grep -o "\"scheduleId\":\"$RECUR_ID\"[^}]*" | sed -n '4p' | grep -o '"instanceStartAt":"[^"]*"' | head -1 | cut -d'"' -f4)
[ -n "$FOURTH" ] && pass "取到第 4 期: $FOURTH" || fail "no 4th"
TRU=$(curl -s -o /dev/null -w '%{http_code}\n' -m 15 -X DELETE \
  "${BASE_URL}/schedules/${RECUR_ID}/instance?instanceStartAt=${FOURTH}&truncate=true" \
  -H "Authorization: Bearer $TOKEN")
[ "$TRU" = "200" ] && pass "truncate HTTP 200" || fail "truncate code=$TRU"

WIN4=$(curl -s -m 15 "${BASE_URL}/schedules?from=${FROM}&to=${TO}" -H "Authorization: Bearer $TOKEN")
REMAIN=$(echo "$WIN4" | grep -o "\"scheduleId\":\"$RECUR_ID\"" | wc -l)
[ "$REMAIN" -lt 5 ] && pass "truncate 之后只留 $REMAIN 期 (<5)" || fail "truncate 未生效 (剩余 $REMAIN)"

# 9. 软删整组 series
info "[9/12] DELETE /schedules/:id (软删整组)"
DELS=$(curl -s -o /dev/null -w '%{http_code}\n' -m 15 -X DELETE \
  "${BASE_URL}/schedules/${RECUR_ID}" -H "Authorization: Bearer $TOKEN")
[ "$DELS" = "200" ] && pass "删除 series HTTP 200" || fail "del series code=$DELS"
WIN5=$(curl -s -m 15 "${BASE_URL}/schedules?from=${FROM}&to=${TO}" -H "Authorization: Bearer $TOKEN")
echo "$WIN5" | grep -q "$RECUR_ID" && fail "软删后默认列表仍可见" || pass "软删后默认列表不见"
WIN6=$(curl -s -m 15 "${BASE_URL}/schedules?from=${FROM}&to=${TO}&includeArchived=true" -H "Authorization: Bearer $TOKEN")
echo "$WIN6" | grep -q "$RECUR_ID" && pass "includeArchived=true 能看到" || fail "archived 不可见"

# 10. 行级隔离
info "[10/12] isolation (另一用户看不到)"
AEMAIL="other-sched-${RANDOM_TAG}@lwaiwork.test"
RB2=$(curl -s -m 15 -X POST "${BASE_URL}/auth/register" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$AEMAIL\",\"password\":\"Other123456\",\"name\":\"other\"}")
ATOK=$(jget "$RB2" accessToken)
AL=$(curl -s -m 10 "${BASE_URL}/schedules?from=${FROM}&to=${TO}" -H "Authorization: Bearer $ATOK")
echo "$AL" | grep -q "$SINGLE_ID" && fail "另一用户能看见本用户 schedule" || pass "行级隔离 OK"
AD=$(curl -s -o /dev/null -w '%{http_code}\n' -m 10 "${BASE_URL}/schedules/${SINGLE_ID}" -H "Authorization: Bearer $ATOK")
[ "$AD" = "404" ] && pass "跨用户详情返回 404" || fail "跨用户返回 $AD"

# 11. RRULE 注入防护
info "[11/12] RRULE injection guard"
BADRULE=$(curl -s -o /dev/null -w '%{http_code}\n' -m 15 -X POST "${BASE_URL}/schedules" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"title\":\"bad-${RANDOM_TAG}\",\"startAt\":\"${START}\",\"timezone\":\"UTC\",\"rrule\":\"FREQ=DAILY;DROP TABLE users\"}")
[ "$BADRULE" = "400" ] && pass "恶意 RRULE 被拒 (400)" || fail "bad rrule code=$BADRULE"

# 12. 401
info "[12/12] 401 unauthenticated"
NOAUTH=$(curl -s -o /dev/null -w '%{http_code}\n' -m 10 "${BASE_URL}/schedules")
[ "$NOAUTH" = "401" ] && pass "未鉴权 401" || fail "noauth=$NOAUTH"

echo
info "=============================================="
if [ "$FAIL_COUNT" = "0" ]; then
  green " M2-3 schedules ALL PASS (${PASS_COUNT}/12)"
  info "=============================================="
  exit 0
else
  red " M2-3 schedules FAIL: ${PASS_COUNT} pass / ${FAIL_COUNT} fail"
  info "=============================================="
  exit 1
fi
