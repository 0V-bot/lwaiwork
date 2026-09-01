# lwaiwork backend

NestJS 10 + TypeScript + TypeORM(PostgreSQL) + Redis 最小可运行骨架。
第一里程碑目标：**1 周内跑通「代码 → 部署」最简链路**。

技术栈：Node 20 / NestJS 10 / TypeScript 5 / TypeORM 0.3 / PostgreSQL / Redis / JWT(access+refresh) / Swagger

---

## 1. 本地启动 3 步

```bash
# 0) 前置：本机需可连接 PostgreSQL 与 Redis（见下面「依赖服务」）
cd backend

# 1) 安装依赖
npm install

# 2) 配置环境变量
cp .env.example .env        # Windows: copy .env.example .env
# 编辑 .env，至少修改 JWT_SECRET / JWT_REFRESH_SECRET / DATABASE_URL / REDIS_URL

# 3) 启动
npm run start:dev           # 开发（热重载）；生产用 npm run build && npm run start:prod
```

启动后：

- API 根路径：`http://localhost:4000/api`
- Swagger UI：`http://localhost:4000/api-docs`
- Swagger JSON：`http://localhost:4000/api-json`
- 健康检查（无需鉴权）：`GET http://localhost:4000/api/health`

> **端口为何是 4000**：目标机 ECS `8.130.181.74` 已占用 `22 / 80 / 443 / 3000`，
> 3000 被另一个现有项目占着，直接部署会 `EADDRINUSE`。因此后端迁到 **4000**
> （容器/进程端口），docker-compose 再把它以 **4001** 暴露到宿主机。
> 改动端口必须同步：`.env` 的 `PORT`、`Dockerfile` 的 `ENV PORT`/`EXPOSE`/`HEALTHCHECK`、
> `CORS_ORIGINS` 里的前端地址，以及 frontend 的 `NEXT_PUBLIC_API_BASE_URL`。

---

## 2. 依赖服务（PostgreSQL / Redis）

最简方式（需要 Docker）：

```bash
# 宿主机端口用 5433 / 6380，避开常见默认端口，也避开 ECS 已占用的 22/80/443/3000
docker run -d --name lwaiwork-pg  -p 5433:5432 -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=lwaiwork postgres:16-alpine
docker run -d --name lwaiwork-rds -p 6380:6379 redis:7-alpine
```

或直接用仓库根目录的 `docker-compose.yml`（推荐）：

```bash
cp .env.example .env          # 仓库根目录
docker compose up -d --build
docker compose ps             # 4 个服务都应 healthy
bash scripts/smoke-test.sh    # 端到端冒烟：health / 注册 / 登录 / me / todos 全链路
```

首次建库后，表结构由 TypeORM `synchronize` 依据 entity 自动创建（见下方⚠️）。

---

## 3. ⚠️ synchronize 说明（生产必须关闭）

- 当前 `.env` 中 `TYPEORM_SYNCHRONIZE=true`，启动时会**按 entity 自动建表/改表**，便于 MVP 快速迭代。
- **生产环境必须设置 `TYPEORM_SYNCHRONIZE=false`**，改用版本化迁移：

  ```bash
  npm run migration:generate -- migrations/InitSchema
  npm run migration:run
  npm run migration:revert     # 回滚最近一次
  ```

- `synchronize: true` 在三处风险：(1) 并发实例同时启动会竞争改表；(2) 无法回滚；(3) 可能静默丢列/丢数据。
- 代码层面已加防御：`NODE_ENV=production` 且 `TYPEORM_SYNCHRONIZE=true` 时会打印**红色告警**；`dropSchema` 恒为 `false`。

---

## 4. Docker 构建与运行

```bash
docker build -t lwaiwork-backend:local .
# 容器端口 4000 -> 宿主机 4001（宿主机 3000 已被占用，不能再用）
docker run -p 4001:4000 --env-file .env lwaiwork-backend:local
```

| 场景         | 地址                          |
| ------------ | ----------------------------- |
| 容器内       | `http://0.0.0.0:4000/api`     |
| 宿主机（本机/裸跑） | `http://localhost:4000/api`   |
| 宿主机（compose） | `http://localhost:4001/api`   |

多阶段构建：deps（编译原生模块 bcrypt）→ builder（`nest build` + prune）→ runner（仅 node_modules + dist，非 root 用户运行）。

---

## 5. 目录结构

```
src/
├─ main.ts                  # 全局前缀 /api、Swagger、ValidationPipe、CORS
├─ app.module.ts
├─ database/database.module.ts
├─ redis/redis.module.ts, redis.service.ts
├─ auth/                    # 注册/登录/刷新/登出、JWT 策略、守卫
├─ users/                   # user entity + service
└─ todos/                   # 端到端验证模块：完整 CRUD
migrations/
```

---

## 6. 认证设计

| Token  | 有效期 | 存储位置                    | 撤销方式                         |
| ------ | ------ | --------------------------- | -------------------------------- |
| access | 15min  | 客户端内存（不落盘）        | 天然短过期 + 主动 jti 黑名单     |
| refresh| 7d     | 服务端 Redis（`rt:<jti>`）  | 删除 Redis key（登出/轮换）      |

- 每次刷新令牌会**轮换 refresh token**（旧 jti 立即失效，可检测重放）。
- 登出：把 access jti 加入黑名单（`bl:<jti>`，TTL=剩余有效期）+ 删除 refresh key。
- 密码：`bcrypt`（cost 12）哈希存储，**永不出参**（entity 字段加 `select: false`，响应经序列化剥离）。

---

## 7. API 一览

| 方法   | 路径                    | 鉴权 | 说明                     |
| ------ | ----------------------- | ---- | ------------------------ |
| GET    | /api/health             | 否   | 健康检查                 |
| POST   | /api/auth/register      | 否   | 注册（返回 token 对）    |
| POST   | /api/auth/login         | 否   | 登录（返回 token 对）    |
| POST   | /api/auth/refresh       | 否   | 用 refresh 换新一轮 token |
| POST   | /api/auth/logout        | 是   | 登出（拉黑 access + 删 refresh） |
| GET    | /api/auth/me            | 是   | 当前用户信息             |
| GET    | /api/todos              | 是   | 列表（分页 + done 筛选） |
| POST   | /api/todos              | 是   | 创建                     |
| GET    | /api/todos/:id          | 是   | 详情                     |
| PATCH  | /api/todos/:id          | 是   | 更新（局部）             |
| DELETE | /api/todos/:id          | 是   | 软删除                   |

`todos` 所有查询都强制带 `userId` 条件，越权访问返回 404（不泄露资源是否存在）。

---

## 8. 待办（尚未完成）

- [ ] 单元 / e2e 测试（`npm test` 目前无用例，仅预留 jest 配置）
- [ ] 数据库迁移文件未生成（当前依赖 synchronize）
- [ ] 限流（`@nestjs/throttler`）、审计日志、软删除回收站
- [ ] CI 流水线与部署清单
