# lwaiwork

模块化定制化工作台 —— Web + 小程序 + 管理后台 + 数据库。

## 当前阶段

**B 路径 M1**：跑通"代码 → 部署"最简链路（注册登录 + todos 端到端）。

## 技术栈

- **后端**：NestJS 10 + TypeORM + PostgreSQL 16 + Redis 7
- **前端**：Next.js 14（App Router）+ React 18 + TypeScript + Tailwind
- **部署**：Docker Compose

## 目录结构

```
lwaiwork/
├── backend/            NestJS 后端
│   ├── src/
│   │   ├── auth/       注册/登录/refresh/logout/me
│   │   ├── todos/      待办 CRUD（端到端验证模块）
│   │   ├── users/
│   │   ├── health/     健康检查
│   │   ├── database/   PostgreSQL 连接
│   │   └── redis/      Redis 连接
│   └── migrations/
├── frontend/           Next.js 前端
│   └── src/
│       ├── app/        / /login /register /todos
│       ├── lib/        api.ts（Bearer + 401 自动 refresh）
│       ├── contexts/   AuthContext
│       └── components/ AuthGuard / TodoItem 等
├── scripts/
│   ├── smoke-test.sh   端到端冒烟测试（5 检查点）
│   ├── push-via-api.js GitHub API 推送（git 协议不可达时的备用方案）
│   └── init-repo.js    空仓库初始化
└── docker-compose.yml
```

## 端口规划

ECS 8.130.181.74 已占用 **22 / 80 / 443 / 3000**，本工程全部避开：

| 服务 | 宿主机端口 | 容器端口 |
| --- | --- | --- |
| postgres | 5433 | 5432 |
| redis | 6380 | 6379 |
| backend | 4001 | 4000 |
| frontend | 3001 | 3000 |

## 快速开始

```bash
# 1. 准备环境变量
cp .env.example .env
# 编辑 .env，填入 JWT_SECRET / JWT_REFRESH_SECRET / 数据库密码

# 2. 启动全部服务
docker compose up -d

# 3. 查看服务状态
docker compose ps

# 4. 跑端到端冒烟测试
bash scripts/smoke-test.sh
```

## API 契约

- 全局前缀：`/api`
- Swagger：`/api-json`
- 鉴权：JWT Bearer（access 15min / refresh 7d）

| 方法 | 端点 | 说明 |
| --- | --- | --- |
| POST | `/auth/register` | 注册（201） |
| POST | `/auth/login` | 登录（200） |
| POST | `/auth/refresh` | 刷新 token（200） |
| POST | `/auth/logout` | 登出（需 Bearer） |
| GET | `/auth/me` | 当前用户（需 Bearer） |
| GET | `/todos` | 待办列表（分页） |
| POST | `/todos` | 创建待办 |
| PATCH | `/todos/:id` | 更新待办 |
| DELETE | `/todos/:id` | 软删除 |
| GET | `/health` | 健康检查 |

> ValidationPipe 开启了 `whitelist + forbidNonWhitelisted`，**多传字段会返回 400**。

## 环境要求

- Docker 20+
- Docker Compose v2+

## 注意事项

- 前端 `NEXT_PUBLIC_API_BASE_URL` 在**构建时**内联进浏览器包，运行时修改无效，改了必须重新构建镜像
- 由于内联进浏览器包，该地址**不能填 docker 服务名**，必须是浏览器可解析的地址（IP 或域名）
- `TYPEORM_SYNCHRONIZE=true` 仅用于 M1 验证期，生产必须关闭并改用 migrations
