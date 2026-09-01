#!/usr/bin/env bash
# ============================================================================
# lwaiwork 笔记模块 M2-2 端到端冒烟测试
#
# 覆盖：6 端点 + 行级隔离 + 跨用户隔离 + 搜索 + 解密正确性
# 注意：明文永远只在 API 响应里走，DB 里存的是密文
# ============================================================================
set -uo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:4001/api}"
RANDOM_TAG="$(date +%s)-$$"
TEST_EMAIL="note-${RANDOM_TAG}@lwaiwork.test"
TEST_PASSWORD="Note123456"
TEST_NAME="笔记测试用户"

PASS_COUNT=0
FAIL_COUNT=0

green() { printf '\033[32m%s\033[0m\n' "$1"; }
red()   { printf '\033[31m%s\033[0m\n' "$1"; }
info()  { printf '\033[36m%s\033[0m\n' "$1"; }

pass() { green "  [PASS] $1"; PASS_COUNT=$((PASS_COUNT + 1)); }
fail() { red "  [FAIL] $1"; FAIL_COUNT=$((FAIL_COUNT + 1)); }
dump() { echo "        响应: $(echo "$1" | head -c 500)"; }

info "=============================================="
info " lwaiwork M2-2 笔记模块端到端冒烟测试"
info " 目标: ${BASE_URL}"
info " 测试账号: ${TEST_EMAIL}"
info "=============================================="
echo

# ---------------------------------------------------------------------------
# 0. 注册账号 + 拿 token
# ---------------------------------------------------------------------------
info "[1/11] 注册拿 token"
REG_BODY=$(curl -s -m 15 -X POST "${BASE_URL}/auth/register" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"${TEST_EMAIL}\",\"password\":\"${TEST_PASSWORD}\",\"name\":\"${TEST_NAME}\"}")
TOKEN=$(echo "${REG_BODY}" | grep -o '"accessToken":"[^"]*"' | head -1 | cut -d'"' -f4)
if [ -n "${TOKEN}" ]; then
  pass "注册成功 + 拿 token"
else
  fail "注册失败"
  dump "${REG_BODY}"
  exit 1
fi

UNIQUE_MARK="lwaiwork-smoke-${RANDOM_TAG}"
TITLE_1="${UNIQUE_MARK} 一键三连"
CONTENT_1="这是我用 ${UNIQUE_TAG:-RANDOM} 标记的唯一内容，搜索应该命中。$(printf '一二三四五六七八九十.'%.0s {1..40})"
TAGS_1='["工作","重要"]'

# ---------------------------------------------------------------------------
# 2. 创建笔记
# ---------------------------------------------------------------------------
info "[2/11] 创建笔记 POST /notes"
CREATE_BODY=$(curl -s -m 15 -X POST "${BASE_URL}/notes" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H 'Content-Type: application/json' \
  -d "{\"title\":\"${TITLE_1}\",\"content\":\"${CONTENT_1}\",\"tags\":${TAGS_1},\"color\":\"#2FAF9E\"}")
NOTE_ID=$(echo "${CREATE_BODY}" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
DECRYPTED_TITLE=$(echo "${CREATE_BODY}" | grep -o "\"title\":\"[^\"]*${UNIQUE_MARK}[^\"]*\"" | head -1)
if [ -n "${NOTE_ID}" ] && [ -n "${DECRYPTED_TITLE}" ]; then
  pass "创建成功 id=${NOTE_ID}（返回明文 title 与 content 已解密）"
else
  fail "创建失败或返回未解密"
  dump "${CREATE_BODY}"
  exit 1
fi

# ---------------------------------------------------------------------------
# 3. 列表 GET /notes（只返回 summary 不含 content）
# ---------------------------------------------------------------------------
info "[3/11] 列表 GET /notes（确认 summary 不含 content 字段）"
LIST_BODY=$(curl -s -m 10 "${BASE_URL}/notes" -H "Authorization: Bearer ${TOKEN}")
if echo "${LIST_BODY}" | grep -q "${NOTE_ID}" && \
   echo "${LIST_BODY}" | grep -q "\"title\":\"${TITLE_1}\"" && \
   echo "${LIST_BODY}" | grep -q '"preview":' && \
   ! echo "${LIST_BODY}" | grep -q "\"content\":\""; then
  pass "列表含该笔记 + title + preview，但不含 content 字段"
else
  fail "列表结构异常（应只含 summary，不含 content）"
  dump "${LIST_BODY}"
fi

# ---------------------------------------------------------------------------
# 4. 详情 GET /notes/:id（返回明文 content）
# ---------------------------------------------------------------------------
info "[4/11] 详情 GET /notes/:id（含明文 content）"
DETAIL_BODY=$(curl -s -m 10 "${BASE_URL}/notes/${NOTE_ID}" -H "Authorization: Bearer ${TOKEN}")
if echo "${DETAIL_BODY}" | grep -q "${NOTE_ID}" && \
   echo "${DETAIL_BODY}" | grep -q "\"content\":\"[^\"]*${UNIQUE_MARK}"; then
  pass "详情返回明文 content（搜索标记命中）"
else
  fail "详情 content 未解密或不完整"
  dump "${DETAIL_BODY}"
fi

# ---------------------------------------------------------------------------
# 5. PATCH 改 title
# ---------------------------------------------------------------------------
info "[5/11] PATCH /notes/:id（改 title 与加 tag）"
NEW_TITLE="${UNIQUE_MARK} 修改版"
PATCH_BODY=$(curl -s -m 15 -X PATCH "${BASE_URL}/notes/${NOTE_ID}" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H 'Content-Type: application/json' \
  -d "{\"title\":\"${NEW_TITLE}\",\"tags\":[\"工作\",\"重要\",\"编辑后\"]}")
if echo "${PATCH_BODY}" | grep -q "\"title\":\"${NEW_TITLE}\"" && \
   echo "${PATCH_BODY}" | grep -q '编辑后'; then
  pass "修改成功（title 重加密成功，tags 增量更新）"
else
  fail "修改失败"
  dump "${PATCH_BODY}"
fi

# ---------------------------------------------------------------------------
# 6. 内容上限防护（51KB 应该被拒）
# ---------------------------------------------------------------------------
info "[6/11] 内容超长防护（51KB 应返回 4xx）"
BIG_CONTENT=$(printf 'A%.0s' {1..52224})
BIG_CODE=$(curl -s -o /dev/null -w '%{http_code}' -m 15 -X POST "${BASE_URL}/notes" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H 'Content-Type: application/json' \
  -d "{\"title\":\"${UNIQUE_MARK} BIG\",\"content\":\"${BIG_CONTENT}\"}")
case "$BIG_CODE" in
  4*) pass "超长内容被服务端拒绝 (HTTP ${BIG_CODE})" ;;
  *) fail "超长内容未被拒绝 (HTTP ${BIG_CODE})" ;;
esac

# ---------------------------------------------------------------------------
# 7. 搜索（只命中 preview）
# ---------------------------------------------------------------------------
info "[7/11] POST /notes/search（按 preview 命中）"
SEARCH_BODY=$(curl -s -m 10 -X POST "${BASE_URL}/notes/search" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H 'Content-Type: application/json' \
  -d "{\"query\":\"${UNIQUE_MARK}\"}")
if echo "${SEARCH_BODY}" | grep -q "${NOTE_ID}"; then
  pass "搜索命中唯一标记"
else
  fail "搜索未命中"
  dump "${SEARCH_BODY}"
fi

# ---------------------------------------------------------------------------
# 8. 行级隔离：另一用户看不到这条笔记
# ---------------------------------------------------------------------------
info "[8/11] 行级隔离（另一用户列表/详情都不可见）"
ALT_EMAIL="other-${RANDOM_TAG}@lwaiwork.test"
ALT_BODY=$(curl -s -m 15 -X POST "${BASE_URL}/auth/register" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"${ALT_EMAIL}\",\"password\":\"Other123456\",\"name\":\"另一用户\"}")
ALT_TOKEN=$(echo "${ALT_BODY}" | grep -o '"accessToken":"[^"]*"' | head -1 | cut -d'"' -f4)
if [ -n "${ALT_TOKEN}" ]; then
  ALT_LIST=$(curl -s -m 10 "${BASE_URL}/notes" -H "Authorization: Bearer ${ALT_TOKEN}")
  if echo "${ALT_LIST}" | grep -q "${NOTE_ID}"; then
    fail "行级隔离失效：另一用户列表里出现本用户笔记"
  else
    pass "行级隔离生效：另一用户列表无本用户笔记"
  fi
  # 跨用户访问应 404（防探测）
  ALT_DETAIL_CODE=$(curl -s -o /dev/null -w '%{http_code}' -m 10 "${BASE_URL}/notes/${NOTE_ID}" \
    -H "Authorization: Bearer ${ALT_TOKEN}")
  if [ "${ALT_DETAIL_CODE}" = "404" ]; then
    pass "跨用户访问返回 404（不泄漏资源是否存在）"
  else
    fail "跨用户访问返回 ${ALT_DETAIL_CODE}（应为 404）"
  fi
else
  fail "另一用户注册失败"
fi

# ---------------------------------------------------------------------------
# 9. 软删除（archivedAt）
# ---------------------------------------------------------------------------
info "[9/11] 软删除（DELETE）"
DEL_CODE=$(curl -s -o /dev/null -w '%{http_code}' -m 15 -X DELETE "${BASE_URL}/notes/${NOTE_ID}" \
  -H "Authorization: Bearer ${TOKEN}")
if [ "$DEL_CODE" = "200" ] || [ "$DEL_CODE" = "204" ]; then
  pass "删除返回 ${DEL_CODE}"
else
  fail "删除返回 $DEL_CODE"
fi
# 默认列表应不再返回
LIST2_BODY=$(curl -s -m 10 "${BASE_URL}/notes" -H "Authorization: Bearer ${TOKEN}")
if echo "${LIST2_BODY}" | grep -q "${NOTE_ID}"; then
  fail "软删除后默认列表仍含该笔记"
else
  pass "软删除后默认列表已不含该笔记"
fi
# includeArchived=true 应能查回
ARC_BODY=$(curl -s -m 10 "${BASE_URL}/notes?includeArchived=true" -H "Authorization: Bearer ${TOKEN}")
if echo "${ARC_BODY}" | grep -q "${NOTE_ID}"; then
  pass "includeArchived=true 能看到已归档笔记"
else
  fail "includeArchived=true 看不到已归档笔记"
fi

# ---------------------------------------------------------------------------
# 10. 标签过滤
# ---------------------------------------------------------------------------
info "[10/11] 标签过滤 ?tag=工作"
# 先创建一条带"工作"tag 的笔记，再过滤
ALT_NOTE_BODY=$(curl -s -m 10 -X POST "${BASE_URL}/notes" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H 'Content-Type: application/json' \
  -d "{\"title\":\"${UNIQUE_MARK} 工作笔记\",\"content\":\"用于标签过滤测试\",\"tags\":[\"工作\"]}")
ALT_NOTE_ID=$(echo "${ALT_NOTE_BODY}" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
FILTER_BODY=$(curl -s -m 10 "${BASE_URL}/notes?tag=%E5%B7%A5%E4%BD%9C" -H "Authorization: Bearer ${TOKEN}")
if [ -n "${ALT_NOTE_ID}" ] && echo "${FILTER_BODY}" | grep -q "${ALT_NOTE_ID}"; then
  pass "标签过滤命中"
else
  fail "标签过滤失败（UTF-8 URL 编码可能需调整）"
  dump "${FILTER_BODY}"
fi

# ---------------------------------------------------------------------------
# 11. 401 / 没 token 直接跳 401
# ---------------------------------------------------------------------------
info "[11/11] 未鉴权调用返回 401"
NOAUTH_CODE=$(curl -s -o /dev/null -w '%{http_code}' -m 10 "${BASE_URL}/notes")
if [ "${NOAUTH_CODE}" = "401" ]; then
  pass "未鉴权返回 401"
else
  fail "未鉴权调用返回 ${NOAUTH_CODE}"
fi

# ---------------------------------------------------------------------------
# 汇总
# ---------------------------------------------------------------------------
echo
info "=============================================="
if [ "${FAIL_COUNT}" -eq 0 ]; then
  green " M2-2 笔记模块端到端冒烟测试全部通过（${PASS_COUNT} 项）"
  info "=============================================="
  exit 0
else
  red " M2-2 笔记测试失败：通过 ${PASS_COUNT} / 失败 ${FAIL_COUNT}"
  info "=============================================="
  exit 1
fi
