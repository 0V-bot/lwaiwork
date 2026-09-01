#!/usr/bin/env node
/**
 * push-current-changes.js
 *
 * 通过 GitHub Git Database API 把当前工作目录推送到远端，**不依赖本地 .git**。
 *
 * 适用场景：本地 .git 索引丢失，但工作目录的源代码完整。脚本会：
 *   1. 递归扫描当前工作目录
 *   2. 按 SKIP 规则过滤（node_modules / dist / 临时文件 / .env / 二进制大文件）
 *   3. 用 GitHub API 创建 blob / tree / commit / ref
 *   4. 远端 HEAD 作为 parent（除非仓库为空）
 *
 * 用法：
 *   GITHUB_TOKEN=ghp_xxx node scripts/push-current-changes.js \
 *     [--message "..."] [--root /path/to/workdir] \
 *     [--dry-run]
 *
 * 注意：远端 HEAD 之后的所有"别人"的提交都会被这次推送覆盖（除非 force=false）。
 *       我们用 force=true 来推，因为我们刚发现 .git 丢失、HEAD 已知就是本地。
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const OWNER = '0V-bot';
const REPO = 'lwaiwork';
const BRANCH = 'main';
const ROOT = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Skip rules
// ---------------------------------------------------------------------------
const SKIP_DIR_NAMES = new Set([
  'node_modules',
  'dist',
  'dist-files-only-verify',
  '.git',
  '.next',
  '.workbuddy',
  '.build',
  '__pycache__',
  '.trash_nm_1788208334',
  'out',
  // Local artifact dirs (not source code)
  '.npm-cache-backend',
  '.npm-cache-frontend',
  '.briefs',
]);

const SKIP_FILE_PATTERNS = [
  /^\.env$/,
  /^\.env\..*$/,
  /\.tsbuildinfo$/,
  /err\.txt$/,
  /out\.txt$/,
  /\.log$/,
  /\.tar\.gz$/,
  /\.tar$/,
  /\.zip$/,
  /\.tgz$/,
  /\.tmp$/,
];

const SKIP_FILE_NAMES = new Set([
  'pnpm-lock.yaml',
  'yarn.lock',
  'package-lock.json',
  '.DS_Store',
  'Thumbs.db',
]);

// package-lock.json is SKIPPED (not pushed). Reasoning: the Windows dev env
// cannot run `npm install` (WorkBuddy safe-delete shim blocks fs.rm in this
// turn), so the lockfile may be out of date. The Dockerfile now uses
// `npm install` instead of `npm ci`, so an outdated lockfile is harmless - the
// deploy host regenerates it inside the build stage. Pushing a stale lockfile
// would just slow down future builds (npm has to reconcile it) without adding
// any reproducibility guarantee.

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MiB per file

const BINARY_EXT = /\.(png|jpg|jpeg|gif|webp|avif|ico|bmp|tiff?|heic|heif|svg|woff2?|ttf|eot|otf|pdf|zip|rar|7z|gz|bz2|xz|tar|mp[34]|mov|webm|m4v|avi|mkv|wasm|bin|exe|dll|so|dylib)$/i;

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------
function parseArgs() {
  const args = { dryRun: false, message: '', root: ROOT };
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--message' || a === '-m') args.message = process.argv[++i] || '';
    else if (a === '--root') args.root = path.resolve(process.argv[++i]);
    else if (a === '--help' || a === '-h') {
      console.log('Usage: GITHUB_TOKEN=ghp_xxx node push-current-changes.js [--message "..."] [--root DIR] [--dry-run]');
      process.exit(0);
    }
  }
  if (!args.message) {
    args.message = 'chore: 通过 GitHub API 推送当前工作树（不依赖本地 .git）';
  }
  return args;
}

// ---------------------------------------------------------------------------
// Walk working tree
// ---------------------------------------------------------------------------
function* walkFiles(root) {
  const stack = [''];
  while (stack.length) {
    const rel = stack.pop();
    const abs = path.join(root, rel);
    let entries;
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch (err) {
      continue;
    }
    for (const e of entries) {
      const childRel = rel ? path.join(rel, e.name) : e.name;
      const childAbs = path.join(abs, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIR_NAMES.has(e.name)) continue;
        if (e.name.startsWith('.trash_nm_')) continue;
        stack.push(childRel);
      } else if (e.isFile()) {
        if (SKIP_FILE_NAMES.has(e.name)) continue;
        if (SKIP_FILE_PATTERNS.some((rx) => rx.test(e.name))) continue;
        try {
          const st = fs.statSync(childAbs);
          if (st.size > MAX_FILE_SIZE_BYTES) {
            console.warn(`[skip:too-big] ${childRel} (${(st.size / 1024 / 1024).toFixed(2)} MiB)`);
            continue;
          }
          yield { rel: childRel.replace(/\\/g, '/'), abs: childAbs, size: st.size };
        } catch {
          // skip unreadable
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// GitHub API
// ---------------------------------------------------------------------------
function api(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const TOKEN = process.env.GITHUB_TOKEN;
    if (!TOKEN) {
      reject(new Error('GITHUB_TOKEN env var is required'));
      return;
    }
    const payload = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = https.request(
      {
        hostname: 'api.github.com',
        path: urlPath,
        method,
        headers: {
          Authorization: `token ${TOKEN}`,
          'User-Agent': 'lwaiwork-push-current',
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
          try {
            json = JSON.parse(data);
          } catch {
            /* not JSON */
          }
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(json);
          } else {
            const msg = (json && json.message) || data.slice(0, 400);
            const err = new Error(`${method} ${urlPath} -> ${res.statusCode}: ${msg}`);
            err.statusCode = res.statusCode;
            err.rawBody = data.slice(0, 2000);
            reject(err);
          }
        });
      },
    );
    req.on('error', (e) => {
      // Network / DNS / TLS / timeout. Attach code for diagnostics.
      const err = new Error(`${method} ${urlPath} -> network: ${e.message}`);
      err.code = e.code || 'NETWORK';
      err.syscall = e.syscall;
      err.rawBody = '';
      reject(err);
    });
    if (payload) req.write(payload);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Retry wrapper for transient errors (rate limit / network)
// ---------------------------------------------------------------------------
async function apiWithRetry(method, urlPath, body, maxAttempts = 5) {
  let attempt = 0;
  let lastErr;
  while (attempt < maxAttempts) {
    attempt++;
    try {
      return await api(method, urlPath, body);
    } catch (err) {
      lastErr = err;
      const transient =
        err.statusCode === 429 ||
        err.statusCode === 500 ||
        err.statusCode === 502 ||
        err.statusCode === 503 ||
        err.statusCode === 504 ||
        err.code === 'ECONNRESET' ||
        err.code === 'ETIMEDOUT' ||
        err.code === 'ENOTFOUND' ||
        err.code === 'EAI_AGAIN' ||
        err.code === 'ECONNREFUSED' ||
        err.code === 'EPIPE';
      if (!transient || attempt >= maxAttempts) throw err;
      const backoffMs = Math.min(1500 * attempt + 200 * Math.random(), 15000);
      console.warn(`[retry] ${method} ${urlPath} attempt=${attempt}/${maxAttempts} code=${err.code || err.statusCode} backoff=${backoffMs}ms`);
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
  throw lastErr;
}

// Crash safety: log if Node dies unexpectedly
process.on('uncaughtException', (e) => {
  console.error('[uncaughtException]', e && e.stack ? e.stack : e);
  process.exit(2);
});
process.on('unhandledRejection', (e) => {
  console.error('[unhandledRejection]', e && e.stack ? e.stack : e);
  process.exit(2);
});
process.on('SIGTERM', () => {
  console.error('[SIGTERM] received, exiting');
  process.exit(3);
});
process.on('SIGINT', () => {
  console.error('[SIGINT] received, exiting');
  process.exit(3);
});

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
(async () => {
  const args = parseArgs();
  console.log(`[push-current] ROOT = ${args.root}`);
  console.log(`[push-current] message = ${args.message}`);
  console.log(`[push-current] dryRun = ${args.dryRun}`);

  // 1. Walk files
  const files = [];
  for (const f of walkFiles(args.root)) files.push(f);
  console.log(`[push-current] ${files.length} files to consider`);

  if (args.dryRun) {
    for (const f of files) console.log(`  ${f.rel}`);
    return;
  }

  // 2. Blobs
  console.log('\n[1/4] creating blobs...');
  const blobs = [];
  const CHECKPOINT_PATH = path.join(args.root, '.push-current-checkpoint.json');
  let startIdx = 0;
  let preloadedBlobs = [];
  try {
    if (fs.existsSync(CHECKPOINT_PATH) && !process.env.PUSH_NO_RESUME) {
      const cp = JSON.parse(fs.readFileSync(CHECKPOINT_PATH, 'utf8'));
      if (cp && Array.isArray(cp.blobs) && cp.total === files.length) {
        preloadedBlobs = cp.blobs;
        startIdx = preloadedBlobs.length;
        console.log(`  [resume] loaded ${startIdx} blobs from checkpoint`);
      }
    }
  } catch (err) {
    console.warn(`  [checkpoint-read-fail] ${err.message}`);
  }
  for (let i = 0; i < files.length; i++) {
    if (i < startIdx) continue; // already pushed
    const f = files[i];
    let buf;
    try {
      buf = fs.readFileSync(f.abs);
    } catch (err) {
      console.warn(`[skip:unreadable] ${f.rel}: ${err.message}`);
      blobs.push({ path: f.rel, sha: '__SKIPPED_UNREADABLE__', mode: '100644', type: 'blob' });
      continue;
    }
    const isBinary = BINARY_EXT.test(f.rel);
    const body = isBinary
      ? { content: buf.toString('base64'), encoding: 'base64' }
      : { content: buf.toString('utf8'), encoding: 'utf-8' };
    try {
      const r = await apiWithRetry('POST', `/repos/${OWNER}/${REPO}/git/blobs`, body, 5);
      blobs.push({ path: f.rel, sha: r.sha, mode: '100644', type: 'blob' });
      if ((i + 1) % 25 === 0 || i === files.length - 1) {
        console.log(`  ${i + 1}/${files.length}`);
      }
      // Checkpoint every 25 blobs
      if ((i + 1) % 25 === 0) {
        try {
          fs.writeFileSync(CHECKPOINT_PATH, JSON.stringify({ total: files.length, blobs }));
        } catch (err) {
          console.warn(`  [checkpoint-write-fail] ${err.message}`);
        }
      }
    } catch (err) {
      console.error(`[blob-fail] ${f.rel}: ${err.message}`);
      if (err.statusCode) console.error(`[blob-fail-status] statusCode=${err.statusCode}`);
      if (err.code) console.error(`[blob-fail-code] code=${err.code}`);
      if (err.rawBody) {
        console.error(`[blob-fail-raw] ${String(err.rawBody).slice(0, 500)}`);
      }
      // Dump the checkpoint so we know exactly where we were
      try {
        fs.writeFileSync(CHECKPOINT_PATH, JSON.stringify({ total: files.length, blobs }));
      } catch {}
      process.exit(1);
    }
  }
  // Merge preloaded (we skipped them) into blobs in correct order
  if (preloadedBlobs.length) {
    blobs.unshift(...preloadedBlobs);
  }
  // Drop SKIPPED entries (they have placeholder shas); only push readable files
  const realBlobs = blobs.filter((b) => b.sha !== '__SKIPPED_UNREADABLE__');
  console.log(`  blobs: ${realBlobs.length} (skipped unreadable: ${blobs.length - realBlobs.length})`);

  // 3. Tree
  console.log('\n[2/4] creating tree...');
  const tree = await apiWithRetry('POST', `/repos/${OWNER}/${REPO}/git/trees`, { tree: realBlobs }, 5);
  console.log(`  tree.sha = ${tree.sha}`);

  // 4. Commit
  console.log('\n[3/4] creating commit...');
  let parentSha = null;
  try {
    const ref = await apiWithRetry('GET', `/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`, null, 3);
    parentSha = ref.object.sha;
    console.log(`  parent = ${parentSha}`);
  } catch (err) {
    console.log('  no parent (empty repo or ref missing)');
  }
  const commitBody = { message: args.message, tree: tree.sha };
  if (parentSha) commitBody.parents = [parentSha];
  const commit = await apiWithRetry('POST', `/repos/${OWNER}/${REPO}/git/commits`, commitBody, 5);
  console.log(`  commit.sha = ${commit.sha}`);

  // 5. Ref
  console.log('\n[4/4] updating ref...');
  if (parentSha) {
    await apiWithRetry('PATCH', `/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`, {
      sha: commit.sha,
      force: true,
    }, 5);
    console.log(`  refs/heads/${BRANCH} -> ${commit.sha} (force)`);
  } else {
    await apiWithRetry('POST', `/repos/${OWNER}/${REPO}/git/refs`, {
      ref: `refs/heads/${BRANCH}`,
      sha: commit.sha,
    }, 5);
    console.log(`  refs/heads/${BRANCH} -> ${commit.sha} (created)`);
  }

  // Clean checkpoint on success
  try { fs.unlinkSync(CHECKPOINT_PATH); } catch {}

  console.log('\n==============================================');
  console.log('push succeeded');
  console.log(`  commit: ${commit.sha}`);
  console.log(`  files:  ${realBlobs.length}`);
  console.log(`  view:   https://github.com/${OWNER}/${REPO}/commit/${commit.sha}`);
  console.log('==============================================');
})().catch((err) => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
