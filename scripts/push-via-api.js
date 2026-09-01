#!/usr/bin/env node
/**
 * 通过 GitHub Git Database API 推送代码（绕过 git push）
 *
 * 背景：github.com 的 HTTPS/SSH git 协议不可达，但 api.github.com 可达。
 * 本脚本用 Git Database API 手工构建 commit：
 *   1. 为每个文件创建 blob
 *   2. 构建完整 tree
 *   3. 创建 commit
 *   4. 更新 main 分支引用
 *
 * 用法：
 *   GITHUB_TOKEN=ghp_xxx node scripts/push-via-api.js
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const OWNER = '0V-bot';
const REPO = 'lwaiwork';
const BRANCH = 'main';
const TOKEN = process.env.GITHUB_TOKEN;
const ROOT = path.resolve(__dirname, '..');

if (!TOKEN) {
  console.error('缺少 GITHUB_TOKEN 环境变量');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// GitHub API 请求封装
// ---------------------------------------------------------------------------
function api(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = https.request(
      {
        hostname: 'api.github.com',
        path: urlPath,
        method,
        headers: {
          Authorization: `token ${TOKEN}`,
          'User-Agent': 'lwaiwork-push-script',
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': payload.length } : {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(data); } catch { /* 非 JSON 响应 */ }
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(json);
          } else {
            reject(new Error(`${method} ${urlPath} -> ${res.statusCode}: ${(json && json.message) || data.slice(0, 300)}`));
          }
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// 收集需要提交的文件（复用 git 的忽略规则，避免手工判断）
// ---------------------------------------------------------------------------
const { execSync } = require('child_process');
function listFiles() {
  const out = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' });
  return out.split('\n').map((l) => l.trim()).filter(Boolean);
}

// ---------------------------------------------------------------------------
// 读取本地最新 commit 的 message 作为远端 commit message
//
// 坑（2026-09-01 实战）：早期版本把 message 硬编码在脚本里，导致本地提交的是
// "fix: 数据库连接 SSL..."、推到远端却显示上一次的 "feat: lwaiwork M1..."。
// 现在改为直接复用本地 git 的提交信息，保证两边一致。
// ---------------------------------------------------------------------------
function localCommitMessage() {
  try {
    const msg = execSync('git log -1 --pretty=%B', { cwd: ROOT, encoding: 'utf8' }).trim();
    if (msg) return msg;
  } catch {
    /* 本地无 commit 时回退到默认文案 */
  }
  return 'chore: 通过 GitHub API 同步代码';
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
(async () => {
  const files = listFiles();
  console.log(`待提交文件: ${files.length} 个`);

  // 1) 为每个文件创建 blob
  console.log('\n[1/4] 创建 blob...');
  const blobs = [];
  for (let i = 0; i < files.length; i++) {
    const rel = files[i];
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) continue;
    const content = fs.readFileSync(abs);
    // 二进制文件（如 favicon.svg 是文本，图片等）用 base64
    const isBinary = /\.(png|jpg|jpeg|gif|ico|woff2?|ttf|eot)$/i.test(rel);
    const body = isBinary
      ? { content: content.toString('base64'), encoding: 'base64' }
      : { content: content.toString('utf8'), encoding: 'utf-8' };
    try {
      const r = await api('POST', `/repos/${OWNER}/${REPO}/git/blobs`, body);
      blobs.push({ path: rel, sha: r.sha, mode: '100644', type: 'blob' });
      if ((i + 1) % 15 === 0 || i === files.length - 1) {
        console.log(`  进度 ${i + 1}/${files.length}`);
      }
    } catch (e) {
      console.error(`  blob 失败: ${rel} -> ${e.message}`);
      process.exit(1);
    }
  }
  console.log(`  blob 创建完成: ${blobs.length} 个`);

  // 2) 构建 tree（Git Database API 会自动按路径创建子 tree）
  console.log('\n[2/4] 构建 tree...');
  const tree = await api('POST', `/repos/${OWNER}/${REPO}/git/trees`, { tree: blobs });
  console.log(`  tree sha: ${tree.sha}`);

  // 3) 创建 commit
  console.log('\n[3/4] 创建 commit...');

  // 获取当前分支 HEAD 作为 parent（仓库非空时必须带上，否则形成孤立提交，
  // 且新 tree 会整体替换旧快照，导致已有文件被"删除"）
  let parentSha = null;
  try {
    const ref = await api('GET', `/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`);
    parentSha = ref.object.sha;
    console.log(`  当前 HEAD: ${parentSha}`);
  } catch (e) {
    console.log('  仓库为空，创建首个 commit（无 parent）');
  }
  const message = localCommitMessage();
  console.log(`  使用本地 commit message: ${message.split('\n')[0]}`);

  const commitBody = { message, tree: tree.sha };
  if (parentSha) commitBody.parents = [parentSha];

  const commit = await api('POST', `/repos/${OWNER}/${REPO}/git/commits`, commitBody);
  console.log(`  commit sha: ${commit.sha}`);

  // 4) 更新分支引用（空仓库用 POST 创建 ref）
  console.log('\n[4/4] 更新分支引用...');
  let refOk = false;
  try {
    // 先尝试创建（空仓库场景）
    await api('POST', `/repos/${OWNER}/${REPO}/git/refs`, {
      ref: `refs/heads/${BRANCH}`,
      sha: commit.sha,
    });
    console.log(`  已创建 refs/heads/${BRANCH}`);
    refOk = true;
  } catch (e) {
    // 分支已存在则更新
    try {
      await api('PATCH', `/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`, {
        sha: commit.sha,
        force: false,
      });
      console.log(`  已更新 refs/heads/${BRANCH}`);
      refOk = true;
    } catch (e2) {
      console.error(`  引用更新失败: ${e2.message}`);
      process.exit(1);
    }
  }

  console.log('\n==============================================');
  console.log('推送成功');
  console.log(`  commit: ${commit.sha}`);
  console.log(`  分支:   ${BRANCH}`);
  console.log(`  文件数: ${blobs.length}`);
  console.log(`  查看:   https://github.com/${OWNER}/${REPO}/commit/${commit.sha}`);
  console.log('==============================================');
})().catch((e) => {
  console.error('推送失败:', e.message);
  process.exit(1);
});
