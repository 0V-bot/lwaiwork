#!/usr/bin/env bash
# =============================================================================
# lwaiwork - B 路径 M1 端到端冒烟测试
#
# 验证"注册 -> 登录 -> 取用户信息 -> todos 全链路 CRUD"是否真的跑通。
# 这是判断 M1 里程碑是否达成的唯一标准。
#
# 用法：
#   bash scripts/smoke-test.sh                    # 默认打 http://localhost:4001/api
#   BASE_URL=http://8.130.181.74:4001/api bash scripts/smoke-test.sh
#
# 端口说明：backend 容器监听 4000，docker-compose 映射到宿主机 4001
#（ECS 的 3000 端口已被现有项目占用，故 backend 从 3000 迁到 4000/4001）
# =============================================================================

set -uo pipefail

BASE_URL="${BASE_URL:-http://localhost:4001/api}"
# 随机邮箱避免重复注册导致 409
RANDOM_TAG="$(date +%s)-$$"
TEST_EMAIL="smoke-${RANDOM_TAG}@lwaiwork.test"
TEST_PASSWORD="Smoke123456"
TEST_NAME="冒烟测试用户"

PASS_COUNT=0
FAIL_COUNT=0

# ---------------------------------------------------------------------------
# 工具函数
# ---------------------------------------------------------------------------
green() { printf '\033[32m%s\033[0m\n' "$1"; }
red()   { printf '\033[31m%s\033[0m\n' "$1"; }
info()  { printf '\033[36m%s\033[0m\n' "$1"; }

pass() { green "  [PASS] $1"; PASS_COUNT=$((PASS_COUNT + 1)); }
fail() { red   "  [FAIL] $1"; FAIL_COUNT=$((FAIL_COUNT + 1)); }

# 打印响应体（截断到 500 字符，避免刷屏）
dump() { echo "        响应: $(echo "$1" | head -c 500)"; }

info "=============================================="
info " lwaiwork M1 端到端冒烟测试"
info " 目标: ${BASE_URL}"
info " 测试账号: ${TEST_EMAIL}"
info "=============================================="
echo

# ---------------------------------------------------------------------------
# 检查点 1：健康检查
# ---------------------------------------------------------------------------
info "[1/5] 健康检查 GET /health"
HEALTH_CODE=$(curl -s -o /tmp/lw_health.json -w '%{http_code}' -m 10 "${BASE_URL}/health" 2>/dev/null)
HEALTH_BODY=$(cat /tmp/lw_health.json 2>/dev/null)
if [ "${HEALTH_CODE}" = "200" ]; then
  pass "健康检查返回 200"
else
  fail "健康检查返回 ${HEALTH_CODE}（预期 200）"
  dump "${HEALTH_BODY}"
  echo
  red "后端不可达，后续检查无法继续。请确认容器已启动：docker compose ps"
  exit 1
fi

# ---------------------------------------------------------------------------
# 检查点 2：注册
# ---------------------------------------------------------------------------
info "[2/5] 注册 POST /auth/register"
REG_CODE=$(curl -s -o /tmp/lw_reg.json -w '%{http_code}' -m 15 -X POST "${BASE_URL}/auth/register" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"${TEST_EMAIL}\",\"password\":\"${TEST_PASSWORD}\",\"name\":\"${TEST_NAME}\"}" 2>/dev/null)
REG_BODY=$(cat /tmp/lw_reg.json 2>/dev/null)
if [ "${REG_CODE}" = "201" ]; then
  pass "注册返回 201"
  ACCESS_TOKEN=$(echo "${REG_BODY}" | grep -o '"accessToken":"[^"]*"' | head -1 | cut -d'"' -f4)
  if [ -n "${ACCESS_TOKEN}" ]; then
    pass "注册返回 accessToken"
  else
    fail "注册响应里没有 accessToken"
    dump "${REG_BODY}"
  fi
else
  fail "注册返回 ${REG_CODE}（预期 201）"
  dump "${REG_BODY}"
  echo
  red "注册失败，后续检查无法继续。"
  exit 1
fi

# ---------------------------------------------------------------------------
# 检查点 3：登录
# ---------------------------------------------------------------------------
info "[3/5] 登录 POST /auth/login"
LOGIN_CODE=$(curl -s -o /tmp/lw_login.json -w '%{http_code}' -m 15 -X POST "${BASE_URL}/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"${TEST_EMAIL}\",\"password\":\"${TEST_PASSWORD}\"}" 2>/dev/null)
LOGIN_BODY=$(cat /tmp/lw_login.json 2>/dev/null)
if [ "${LOGIN_CODE}" = "200" ]; then
  pass "登录返回 200"
  ACCESS_TOKEN=$(echo "${LOGIN_BODY}" | grep -o '"accessToken":"[^"]*"' | head -1 | cut -d'"' -f4)
  if [ -n "${ACCESS_TOKEN}" ]; then
    pass "登录返回 accessToken"
  else
    fail "登录响应里没有 accessToken"
    dump "${LOGIN_BODY}"
    exit 1
  fi
else
  fail "登录返回 ${LOGIN_CODE}（预期 200）"
  dump "${LOGIN_BODY}"
  exit 1
fi

# ---------------------------------------------------------------------------
# 检查点 4：鉴权有效性
# ---------------------------------------------------------------------------
info "[4/5] 鉴权校验"
# 4a 带 token 取用户信息
ME_CODE=$(curl -s -o /tmp/lw_me.json -w '%{http_code}' -m 10 "${BASE_URL}/auth/me" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" 2>/dev/null)
ME_BODY=$(cat /tmp/lw_me.json 2>/dev/null)
if [ "${ME_CODE}" = "200" ]; then
  pass "GET /auth/me 带 token 返回 200"
else
  fail "GET /auth/me 返回 ${ME_CODE}（预期 200）"
  dump "${ME_BODY}"
fi

# 4b 不带 token 访问受保护接口，预期 401
NOAUTH_CODE=$(curl -s -o /dev/null -w '%{http_code}' -m 10 "${BASE_URL}/todos" 2>/dev/null)
if [ "${NOAUTH_CODE}" = "401" ]; then
  pass "无 token 访问 /todos 返回 401（鉴权生效）"
else
  fail "无 token 访问 /todos 返回 ${NOAUTH_CODE}（预期 401）"
fi

# ---------------------------------------------------------------------------
# 检查点 5：todos 全链路 CRUD
# ---------------------------------------------------------------------------
info "[5/5] todos 全链路 CRUD"

# 5a 创建
CREATE_CODE=$(curl -s -o /tmp/lw_todo.json -w '%{http_code}' -m 15 -X POST "${BASE_URL}/todos" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H 'Content-Type: application/json' \
  -d '{"title":"冒烟测试待办"}' 2>/dev/null)
CREATE_BODY=$(cat /tmp/lw_todo.json 2>/dev/null)
TODO_ID=""
if [ "${CREATE_CODE}" = "201" ] || [ "${CREATE_CODE}" = "200" ]; then
  pass "创建待办返回 ${CREATE_CODE}"
  TODO_ID=$(echo "${CREATE_BODY}" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
  if [ -n "${TODO_ID}" ]; then
    pass "拿到待办 id: ${TODO_ID}"
  else
    fail "创建响应里没有 id"
    dump "${CREATE_BODY}"
  fi
else
  fail "创建待办返回 ${CREATE_CODE}（预期 201）"
  dump "${CREATE_BODY}"
fi

if [ -n "${TODO_ID}" ]; then
  # 5b 列表
  LIST_CODE=$(curl -s -o /tmp/lw_list.json -w '%{http_code}' -m 10 "${BASE_URL}/todos" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" 2>/dev/null)
  LIST_BODY=$(cat /tmp/lw_list.json 2>/dev/null)
  if [ "${LIST_CODE}" = "200" ] && echo "${LIST_BODY}" | grep -q "${TODO_ID}"; then
    pass "列表查询返回 200 且包含新建待办"
  else
    fail "列表查询返回 ${LIST_CODE} 或未包含新建待办"
    dump "${LIST_BODY}"
  fi

  # 5c 更新（标记完成）
  PATCH_CODE=$(curl -s -o /tmp/lw_patch.json -w '%{http_code}' -m 15 -X PATCH "${BASE_URL}/todos/${TODO_ID}" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" \
    -H 'Content-Type: application/json' \
    -d '{"done":true}' 2>/dev/null)
  PATCH_BODY=$(cat /tmp/lw_patch.json 2>/dev/null)
  if [ "${PATCH_CODE}" = "200" ]; then
    pass "标记完成返回 200"
  else
    fail "标记完成返回 ${PATCH_CODE}（预期 200）"
    dump "${PATCH_BODY}"
  fi

  # 5d 删除（软删除）
  DEL_CODE=$(curl -s -o /tmp/lw_del.json -w '%{http_code}' -m 15 -X DELETE "${BASE_URL}/todos/${TODO_ID}" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" 2>/dev/null)
  DEL_BODY=$(cat /tmp/lw_del.json 2>/dev/null)
  if [ "${DEL_CODE}" = "200" ] || [ "${DEL_CODE}" = "204" ]; then
    pass "删除待办返回 ${DEL_CODE}"
  else
    fail "删除待办返回 ${DEL_CODE}（预期 200/204）"
    dump "${DEL_BODY}"
  fi

  # 5e 删除后列表不应再包含该 id（软删除生效）
  LIST2_BODY=$(curl -s -m 10 "${BASE_URL}/todos" -H "Authorization: Bearer ${ACCESS_TOKEN}" 2>/dev/null)
  if echo "${LIST2_BODY}" | grep -q "${TODO_ID}"; then
    fail "删除后列表仍能查到该待办（软删除可能未生效）"
  else
    pass "删除后列表不再包含该待办（软删除生效）"
  fi
fi

# ---------------------------------------------------------------------------
# 汇总
# ---------------------------------------------------------------------------
echo
info "=============================================="
if [ "${FAIL_COUNT}" -eq 0 ]; then
  green " M1 端到端冒烟测试全部通过（${PASS_COUNT} 项）"
  green " 链路已跑通：注册 -> 登录 -> 鉴权 -> todos CRUD"
  info "=============================================="
  exit 0
else
  red   " M1 冒烟测试失败：通过 ${PASS_COUNT} 项，失败 ${FAIL_COUNT} 项"
  info "=============================================="
  exit 1
fi
