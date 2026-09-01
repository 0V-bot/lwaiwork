# lwaiwork frontend

Next.js 14 (App Router) 前端，Milestone 1 的最小可运行链路：注册 → 登录 → 待办 CRUD → 登出。

技术栈：Next.js 14.2 · React 18.3 · TypeScript 5.5 (strict) · Tailwind CSS 3.4

---

## 快速开始

```bash
cd frontend
cp .env.example .env.local   # Windows: copy .env.example .env.local
npm install
npm run dev                  # http://localhost:3001
```

> 开发端口是 **3001**，刻意避开后端占用的 4000（见 `backend/.env` 的 `PORT=4000`）。
> 后端原来是 3000，但目标机 ECS `8.130.181.74` 的 3000 已被另一个项目占用，已迁到 4000。

### 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:4000/api` | 后端地址，**已含** `/api` 前缀（`main.ts` 的 `setGlobalPrefix('api')`） |

`NEXT_PUBLIC_*` 会在 **构建时** 内联进 bundle。运行时再改无效，改完必须重新 `npm run build`。

### CORS（第一次跑之前必须确认）

后端 `main.ts` 用白名单而非 `*`，默认值是 `https://wb.lwai.work,http://localhost:3001`。
前端 dev 跑在 3001，已在默认白名单里：

```bash
# backend/.env
CORS_ORIGINS=https://wb.lwai.work,http://localhost:3001,http://8.130.181.74:3001
```

`http://8.130.181.74:3001` 只是 Nginx 接管域名前的临时直连入口，域名上线后删掉它。

改完重启后端。

---

## 与后端的真实契约

全部路径都带 `/api` 前缀。

### Auth — `backend/src/auth/auth.controller.ts`

| 方法 | 路径 | 状态 | 请求体 | 响应 |
| --- | --- | --- | --- | --- |
| POST | `/api/auth/register` | 201 | `{ email, password, name }` | `AuthResponse` |
| POST | `/api/auth/login` | 200 | `{ email, password }` | `AuthResponse` |
| POST | `/api/auth/refresh` | 200 | `{ refreshToken }` | `AuthResponse` |
| POST | `/api/auth/logout` | 200 | `{ refreshToken? }` | `{ message }` |
| GET | `/api/auth/me` | 200 | — | `User` |

`AuthResponse` = `{ accessToken, refreshToken, tokenType: 'Bearer', expiresIn: 900, user: { id, email, name, createdAt } }`

字段校验（`register.dto.ts`）：email 3–320 且合法；password 8–128 且**至少含一个字母和一个数字**；name 1–120。

### Todos — `backend/src/todos/todos.controller.ts`

全部需要 `Authorization: Bearer <accessToken>`，且后端按 JWT 里的 `userId` 做行级隔离。

| 方法 | 路径 | 状态 | 请求体 | 响应 |
| --- | --- | --- | --- | --- |
| GET | `/api/todos` | 200 | query: `page` `limit`(≤100) `done` `sortBy` `order` | `{ data: Todo[], meta: { page, limit, total, totalPages } }` |
| POST | `/api/todos` | 201 | `{ title, done?, dueAt? }` | `Todo` |
| PATCH | `/api/todos/:id` | 200 | `{ title?, done?, dueAt?\|null }` | `Todo` |
| DELETE | `/api/todos/:id` | 200 | — | `{ message }` （软删除） |

`Todo` = `{ id, userId, title, done, dueAt, createdAt, updatedAt, deletedAt }`，时间是 ISO-8601 字符串。

> 后端开了 `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })`，
> **多传一个字段就是 400**，所以前端不要附带额外属性。

---

## 目录结构

```
src/
├── app/
│   ├── layout.tsx        根布局 + <AuthProvider>
│   ├── globals.css       Tailwind 指令 + 基础样式
│   ├── page.tsx          入口重定向（已登录 → /todos，否则 → /login）
│   ├── login/page.tsx
│   ├── register/page.tsx
│   └── todos/page.tsx    核心页：列表 / 新增 / 勾选 / 删除
├── components/
│   ├── AuthGuard.tsx     客户端路由保护
│   ├── AuthShell.tsx     登录 & 注册共用外壳
│   ├── Button.tsx
│   ├── TextField.tsx
│   └── TodoItem.tsx
├── contexts/AuthContext.tsx   全局登录态
├── lib/
│   ├── api.ts            fetch 封装：Bearer / 401 自动 refresh / 统一错误
│   └── auth.ts           localStorage token 读写
└── types/index.ts        与后端 DTO 一一对应的类型
```

## Token 刷新策略

`src/lib/api.ts` 里：任意 authenticated 请求拿到 401 → 调一次 `POST /auth/refresh` →
换新 token → 重放原请求。多个并发 401 会共享同一个 in-flight 的 refresh promise
（single-flight），否则轮换式 refresh 会互相把对方的 token 作废、导致被踢下线。
refresh 失败则清空本地 session。

---

## 脚本

```bash
npm run dev        # 开发，3001
npm run build      # 生产构建
npm run start      # 起生产服务，3001
npm run typecheck  # tsc --noEmit
```

## Docker

```bash
# NEXT_PUBLIC_API_BASE_URL 必须作为 build-arg 传入（构建期内联）
docker build \
  --build-arg NEXT_PUBLIC_API_BASE_URL=https://api.lwai.work/api \
  -t lwaiwork-frontend .

docker run -p 3001:3000 lwaiwork-frontend
```

> **⚠️ 浏览器端取值陷阱**：`NEXT_PUBLIC_*` 在构建期内联进**浏览器** bundle，
> 而浏览器解析不了 docker 服务名。所以通过 compose 构建时这个值必须是
> **浏览器可达**的地址（如 `http://8.130.181.74:4001/api` 或反代后的
> `https://api.lwai.work/api`），填 `http://backend:4000/api` 只有 SSR 请求能用。
> 详见根目录 `docker-compose.yml` 的 frontend 注释。

多阶段构建：`deps` → `builder` → `runner`（`node:20-alpine`，非 root 用户，
依赖 `next.config.mjs` 的 `output: 'standalone'`）。

---

## 已知风险与未做的事

| 项 | 说明 |
| --- | --- |
| **token 存 localStorage** | 后端只支持 `Authorization: Bearer`，没有 httpOnly cookie 可用，因此 XSS = 账号失守。已做：全局无 `dangerouslySetInnerHTML`；服务端 refresh 轮换使泄露半径有限。**下一步**：加 BFF（Route Handler）把 token 收进 httpOnly cookie 代理后端。 |
| **路由保护只是 UX** | `AuthGuard` 只是前端跳转，真正的权限在后端 `JwtAuthGuard` + `userId` 行级过滤。 |
| 无分页 UI | 直接取 `limit=100`。列表变大后需要接 `meta.totalPages`。 |
| 无 `dueAt` UI | 后端支持，Milestone 1 未做日期选择器。 |
| 未做忘记密码 / 改密 / 邮箱验证 | 后端暂无对应端点。 |
| 未做 ESLint / Prettier 配置 | `npm run lint` 需要先初始化 eslint 配置。 |
| 未做测试 | 无单测 / e2e。建议下一步加 Playwright 跑注册→CRUD 的冒烟。 |
| 无错误边界 | 未加 `error.tsx` / `global-error.tsx`。 |
