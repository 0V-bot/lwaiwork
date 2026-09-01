# lwaiwork

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
