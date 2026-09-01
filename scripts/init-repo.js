#!/usr/bin/env node
/**
 * 初始化空仓库：通过 contents API 创建第一个文件。
 * 目的：空仓库无法使用 Git Database API（会返回 409 Git Repository is empty），
 * 先塞入一个 README 让仓库具备初始 commit，之后即可用 blob/tree/commit 流程。
 */

const https = require('https');
const TOKEN = process.env.GITHUB_TOKEN;
const OWNER = '0V-bot';
const REPO = 'lwaiwork';

if (!TOKEN) {
  console.error('缺少 GITHUB_TOKEN');
  process.exit(1);
}

const readme = `# lwaiwork

模块化定制化工作台 —— Web + 小程序 + 管理后台 + 数据库。

## 当前阶段

B 路径 M1：跑通"代码 → 部署"最简链路（注册登录 + todos 端到端）。

## 技术栈

- 后端：NestJS 10 + TypeORM + PostgreSQL 16 + Redis 7
- 前端：Next.js 14（App Router）+ React 18 + TypeScript + Tailwind
- 部署：Docker Compose

## 端口规划

ECS 8.130.181.74 已占用 22 / 80 / 443 / 3000，本工程全部避开：

| 服务 | 宿主机端口 | 容器端口 |
| --- | --- | --- |
| postgres | 5433 | 5432 |
| redis | 6380 | 6379 |
| backend | 4001 | 4000 |
| frontend | 3001 | 3000 |
`;

function api(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(body));
    const req = https.request(
      {
        hostname: 'api.github.com',
        path: urlPath,
        method,
        headers: {
          Authorization: `token ${TOKEN}`,
          'User-Agent': 'lwaiwork-init',
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'Content-Length': payload.length,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(data); } catch {}
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(json);
          else reject(new Error(`${method} ${urlPath} -> ${res.statusCode}: ${(json && json.message) || data.slice(0, 300)}`));
        });
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

(async () => {
  const r = await api('PUT', `/repos/${OWNER}/${REPO}/contents/README.md`, {
    message: 'chore: 初始化仓库',
    content: Buffer.from(readme, 'utf8').toString('base64'),
  });
  console.log('初始化成功');
  console.log('  commit sha:', r.commit.sha);
  console.log('  README:', r.content.html_url);
})().catch((e) => {
  console.error('初始化失败:', e.message);
  process.exit(1);
});
