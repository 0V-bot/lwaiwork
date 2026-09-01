#!/usr/bin/env bash
# files-smoke-test.sh
#
# M2-4 文件模块端到端冒烟测试。
#
# 流程：
#   1. 注册两个测试用户（owner + intruder）以验证跨用户隔离
#   2. owner 登录拿 accessToken
#   3. POST upload-ticket 拿 OSS POST policy
#   4. curl PUT 一个 1x1 PNG 到 uploadUrl
#   5. POST confirm 拿 fileId
#   6. GET list / detail / download-url（302）验证可访问
#   7. intruder 用自己的 token 访问 owner 的 fileId，期望 404（隔离）
#   8. intruder 尝试 archive owner 的 fileId，期望 404
#   9. 大小超限测试：size=200MB -> 期望 413
#  10. contentType 白名单测试：application/octet-stream -> 期望 400
#  11. owner archive 自己的 fileId -> 200 message=File archived
#  12. 默认 list 不包含 archived；includeArchived=true 包含
#
# 依赖：
#   - BASE_URL（默认 https://wb.lwai.work）
#   - /usr/bin/curl、python3 或 node 用于解析 JSON
#
# 用法：
#   BASE_URL=https://wb.lwai.work bash scripts/files-smoke-test.sh
#
# 返回值：所有断言通过返回 0；任何失败返回非零并打印失败步骤。

set -u

BASE_URL="${BASE_URL:-https://wb.lwai.work}"
TS=$(date +%s)
OWNER_EMAIL="filestest-owner-${TS}@example.com"
INTRUDER_EMAIL="filestest-intruder-${TS}@example.com"
PASSWORD="SmokeTest-Pwd-123!"

PASS=0
FAIL=0

# ---------- helpers ----------
log_step() { printf '\n=== [%s] %s ===\n' "$1" "$2"; }
log_ok()   { printf '  PASS: %s\n' "$1"; PASS=$((PASS+1)); }
log_ko()   { printf '  FAIL: %s\n' "$1"; FAIL=$((FAIL+1)); }

# 用 node 做 JSON 解析（已确认在所有部署镜像里都可用）
jq_path() { node -e "process.stdout.write(JSON.stringify($1)$2 || '')"; }
get_json() {
  # $1: JSON string, $2: dot.path  (e.g. .data[0].id)
  node -e "
    const obj = JSON.parse(process.argv[1]);
    const path = process.argv[2].split('.').filter(Boolean);
    let cur = obj;
    for (const seg of path) {
      if (/^\d+\$/.test(seg)) cur = cur[parseInt(seg,10)];
      else cur = cur?.[seg];
      if (cur === undefined) { process.stdout.write(''); process.exit(0); }
    }
    process.stdout.write(typeof cur === 'string' ? cur : JSON.stringify(cur));
  " "$1" "$2"
}

# ---------- 1. 注册两个用户 ----------
log_step 1 "Register owner + intruder users"

REG_OWNER=$(curl -sS -X POST "$BASE_URL/api/auth/register" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$OWNER_EMAIL\",\"password\":\"$PASSWORD\"}")
REG_INTRUDER=$(curl -sS -X POST "$BASE_URL/api/auth/register" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$INTRUDER_EMAIL\",\"password\":\"$PASSWORD\"}")

OWNER_ID=$(get_json "$REG_OWNER" "user.id")
INTRUDER_ID=$(get_json "$REG_INTRUDER" "user.id")
if [ -n "$OWNER_ID" ] && [ -n "$INTRUDER_ID" ]; then
  log_ok "registered two users (owner=$OWNER_ID, intruder=$INTRUDER_ID)"
else
  log_ko "register failed: $REG_OWNER / $REG_INTRUDER"; exit 1
fi

# ---------- 2. owner 登录 ----------
log_step 2 "Owner login"

LOGIN=$(curl -sS -X POST "$BASE_URL/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$OWNER_EMAIL\",\"password\":\"$PASSWORD\"}")
OWNER_TOKEN=$(get_json "$LOGIN" "accessToken")
if [ -n "$OWNER_TOKEN" ]; then
  log_ok "owner got accessToken (${#OWNER_TOKEN} chars)"
else
  log_ko "login failed: $LOGIN"; exit 1
fi

LOGIN2=$(curl -sS -X POST "$BASE_URL/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$INTRUDER_EMAIL\",\"password\":\"$PASSWORD\"}")
INTRUDER_TOKEN=$(get_json "$LOGIN2" "accessToken")
if [ -n "$INTRUDER_TOKEN" ]; then
  log_ok "intruder got accessToken"
else
  log_ko "intruder login failed: $LOGIN2"; exit 1
fi

AUTH_OWNER=(-H "Authorization: Bearer $OWNER_TOKEN")
AUTH_INTRUDER=(-H "Authorization: Bearer $INTRUDER_TOKEN")

# ---------- 3. POST upload-ticket ----------
log_step 3 "Owner requests upload-ticket"

# 1x1 transparent PNG, 67 bytes
PNG_B64='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
PNG_FILE=/tmp/files-smoke-test.png
echo -n "$PNG_B64" | base64 -d > "$PNG_FILE" 2>/dev/null
PNG_SIZE=$(stat -c '%s' "$PNG_FILE")
echo "  prepared test PNG: $PNG_SIZE bytes"

TICKET=$(curl -sS -X POST "$BASE_URL/api/files/upload-ticket" \
  "${AUTH_OWNER[@]}" \
  -H 'Content-Type: application/json' \
  -d "{\"filename\":\"smoke-test.png\",\"contentType\":\"image/png\",\"size\":$PNG_SIZE}")

UPLOAD_URL=$(get_json "$TICKET" "uploadUrl")
OSS_KEY=$(get_json "$TICKET" "ossKey")
FORM_KEY=$(get_json "$TICKET" "form.key")
FORM_POLICY=$(get_json "$TICKET" "form.policy")
FORM_AK=$(get_json "$TICKET" "form.OSSAccessKeyId")
FORM_SIG=$(get_json "$TICKET" "form.signature")
FORM_CT=$(get_json "$TICKET" "form.Content-Type")
FORM_SAS=$(get_json "$TICKET" "form.x-oss-success-action-status")

if [ -n "$UPLOAD_URL" ] && [ -n "$OSS_KEY" ]; then
  log_ok "got ticket (uploadUrl=${UPLOAD_URL:0:50}..., ossKey=$OSS_KEY)"
else
  log_ko "ticket failed: $TICKET"; exit 1
fi

# ---------- 4. PUT to OSS ----------
log_step 4 "PUT bytes to OSS via PostObject"

PUT_OUT=$(curl -sS -X POST "$UPLOAD_URL" \
  -F "key=$FORM_KEY" \
  -F "policy=$FORM_POLICY" \
  -F "OSSAccessKeyId=$FORM_AK" \
  -F "signature=$FORM_SIG" \
  -F "x-oss-success-action-status=$FORM_SAS" \
  -F "Content-Type=$FORM_CT" \
  -F "file=@$PNG_FILE;type=image/png" \
  -o /tmp/files-smoke-put.body -D /tmp/files-smoke-put.headers -w '%{http_code}')
ETAG=$(grep -i '^etag:' /tmp/files-smoke-put.headers | sed 's/^[Ee][Tt][Aa][Gg]: //; s/\r$//' | tr -d '"')
echo "  PUT HTTP $PUT_OUT, ETag=$ETAG"

if [ "$PUT_OUT" = "200" ] && [ -n "$ETAG" ]; then
  log_ok "OSS PUT 200, ETag captured"
else
  log_ko "OSS PUT failed (HTTP $PUT_OUT). Body head:"; head -c 300 /tmp/files-smoke-put.body
  exit 1
fi

# ---------- 5. POST /files/confirm ----------
log_step 5 "Owner confirms upload"

CONFIRM=$(curl -sS -X POST "$BASE_URL/api/files/confirm" \
  "${AUTH_OWNER[@]}" \
  -H 'Content-Type: application/json' \
  -d "{\"ossKey\":\"$OSS_KEY\",\"etag\":\"\\\"$ETAG\\\"\",\"size\":$PNG_SIZE,\"width\":1,\"height\":1}")
FILE_ID=$(get_json "$CONFIRM" "id")
DL_URL=$(get_json "$CONFIRM" "downloadUrl")

if [ -n "$FILE_ID" ] && [ -n "$DL_URL" ]; then
  log_ok "confirmed (id=$FILE_ID, downloadUrl starts with ${DL_URL:0:40}...)"
else
  log_ko "confirm failed: $CONFIRM"; exit 1
fi

# ---------- 6. list / detail / download-url ----------
log_step 6 "List + detail + 302 download"

LIST=$(curl -sS "$BASE_URL/api/files?page=1&limit=20" "${AUTH_OWNER[@]}")
LIST_ID=$(get_json "$LIST" "data.0.id")
if [ "$LIST_ID" = "$FILE_ID" ]; then
  log_ok "GET /files returns our id at top"
else
  log_ko "list mismatch: top id=$LIST_ID, want=$FILE_ID"; echo "list=$LIST"
fi

DETAIL=$(curl -sS "$BASE_URL/api/files/$FILE_ID" "${AUTH_OWNER[@]}")
DETAIL_ID=$(get_json "$DETAIL" "id")
DETAIL_DL=$(get_json "$DETAIL" "downloadUrl")
if [ "$DETAIL_ID" = "$FILE_ID" ] && [ -n "$DETAIL_DL" ]; then
  log_ok "GET /files/:id returns correct row + signed URL"
else
  log_ko "detail failed: $DETAIL"
fi

# 302 测试
DOWN_HEADERS=$(curl -sS -o /dev/null -D - "$BASE_URL/api/files/$FILE_ID/download-url" "${AUTH_OWNER[@]}")
LOC=$(printf '%s' "$DOWN_HEADERS" | grep -i '^location:' | head -1 | sed 's/^[Ll][Oo][Cc][Aa][Tt][Ii][Oo][Nn]: //; s/\r$//')
STATUS=$(printf '%s' "$DOWN_HEADERS" | head -1 | awk '{print $2}')
if [ "$STATUS" = "302" ] && [ -n "$LOC" ]; then
  log_ok "GET /files/:id/download-url -> 302 -> OSS"
else
  log_ko "download-url expected 302, got $STATUS. headers=$DOWN_HEADERS"
fi

# ---------- 7. intruder 越权 ----------
log_step 7 "Cross-user isolation"

# 7a. intruder 调 owner 的 detail -> 期望 404
INTRUDER_DETAIL=$(curl -sS -o /dev/null -w '%{http_code}' \
  "$BASE_URL/api/files/$FILE_ID" "${AUTH_INTRUDER[@]}")
if [ "$INTRUDER_DETAIL" = "404" ]; then
  log_ok "intruder GET /files/:id -> 404"
else
  log_ko "intruder detail should 404, got $INTRUDER_DETAIL"
fi

# 7b. intruder 调 owner 的 download-url -> 期望 404
INTRUDER_DL=$(curl -sS -o /dev/null -w '%{http_code}' \
  "$BASE_URL/api/files/$FILE_ID/download-url" "${AUTH_INTRUDER[@]}")
if [ "$INTRUDER_DL" = "404" ]; then
  log_ok "intruder GET download-url -> 404"
else
  log_ko "intruder download-url should 404, got $INTRUDER_DL"
fi

# 7c. intruder archive owner 的 file -> 期望 404
INTRUDER_DEL=$(curl -sS -o /dev/null -w '%{http_code}' \
  -X DELETE "$BASE_URL/api/files/$FILE_ID" "${AUTH_INTRUDER[@]}")
if [ "$INTRUDER_DEL" = "404" ]; then
  log_ok "intruder DELETE -> 404"
else
  log_ko "intruder delete should 404, got $INTRUDER_DEL"
fi

# 7d. intruder list 不包含 owner 的 file
INTRUDER_LIST=$(curl -sS "$BASE_URL/api/files?limit=100" "${AUTH_INTRUDER[@]}")
INTRUDER_LIST_DATA=$(get_json "$INTRUDER_LIST" "data")
if echo "$INTRUDER_LIST_DATA" | grep -q "$FILE_ID"; then
  log_ko "intruder list leaked owner's fileId"
else
  log_ok "intruder list does not contain owner's file"
fi

# ---------- 8. 大小超限 ----------
log_step 8 "Size cap (100 MiB)"

# 101 MiB -> 400 (DTO max=100MB)
OVERSIZE_DTO=$(curl -sS -o /dev/null -w '%{http_code}' \
  -X POST "$BASE_URL/api/files/upload-ticket" \
  "${AUTH_OWNER[@]}" \
  -H 'Content-Type: application/json' \
  -d '{"filename":"big.bin","contentType":"application/zip","size":105906176}')
if [ "$OVERSIZE_DTO" = "400" ]; then
  log_ok "size=101MiB rejected by DTO -> 400"
else
  log_ko "DTO size cap should 400, got $OVERSIZE_DTO"
fi

# 50MB 合法
OK_SIZE=$(curl -sS -o /dev/null -w '%{http_code}' \
  -X POST "$BASE_URL/api/files/upload-ticket" \
  "${AUTH_OWNER[@]}" \
  -H 'Content-Type: application/json' \
  -d '{"filename":"50mb.bin","contentType":"application/zip","size":52428800}')
if [ "$OK_SIZE" = "200" ] || [ "$OK_SIZE" = "201" ]; then
  log_ok "size=50MiB accepted -> 200"
else
  log_ko "size=50MiB should be accepted, got $OK_SIZE"
fi

# ---------- 9. contentType 白名单 ----------
log_step 9 "Content-Type whitelist"

# application/octet-stream -> 400
BAD_CT=$(curl -sS -o /dev/null -w '%{http_code}' \
  -X POST "$BASE_URL/api/files/upload-ticket" \
  "${AUTH_OWNER[@]}" \
  -H 'Content-Type: application/json' \
  -d '{"filename":"x.bin","contentType":"application/octet-stream","size":1024}')
if [ "$BAD_CT" = "400" ]; then
  log_ok "application/octet-stream rejected -> 400"
else
  log_ko "octet-stream should 400, got $BAD_CT"
fi

# text/plain -> 200
GOOD_CT=$(curl -sS -o /dev/null -w '%{http_code}' \
  -X POST "$BASE_URL/api/files/upload-ticket" \
  "${AUTH_OWNER[@]}" \
  -H 'Content-Type: application/json' \
  -d '{"filename":"x.txt","contentType":"text/plain","size":1024}')
if [ "$GOOD_CT" = "200" ] || [ "$GOOD_CT" = "201" ]; then
  log_ok "text/plain accepted -> 200"
else
  log_ko "text/plain should 200, got $GOOD_CT"
fi

# ---------- 10. archive ----------
log_step 10 "Owner archives own file"

ARCH=$(curl -sS -X DELETE "$BASE_URL/api/files/$FILE_ID" "${AUTH_OWNER[@]}")
ARCH_MSG=$(get_json "$ARCH" "message")
if [ "$ARCH_MSG" = "File archived" ]; then
  log_ok "archive ok: $ARCH_MSG"
else
  log_ko "archive failed: $ARCH"
fi

# 默认 list 不包含 archived
LIST2=$(curl -sS "$BASE_URL/api/files" "${AUTH_OWNER[@]}")
LIST2_DATA=$(get_json "$LIST2" "data")
if echo "$LIST2_DATA" | grep -q "$FILE_ID"; then
  log_ko "archived file still in default list"
else
  log_ok "archived file hidden from default list"
fi

# includeArchived=true 包含
LIST3=$(curl -sS "$BASE_URL/api/files?includeArchived=true&limit=100" "${AUTH_OWNER[@]}")
LIST3_DATA=$(get_json "$LIST3" "data")
if echo "$LIST3_DATA" | grep -q "$FILE_ID"; then
  log_ok "includeArchived=true shows archived"
else
  log_ko "includeArchived=true should show archived"
fi

# ---------- 总结 ----------
echo ""
echo "==============================================="
echo "  Files smoke test summary"
echo "  PASS: $PASS"
echo "  FAIL: $FAIL"
echo "==============================================="
[ "$FAIL" -eq 0 ]
