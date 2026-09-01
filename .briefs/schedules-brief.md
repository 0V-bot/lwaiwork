# M2-3 日程模块实施方案（待 backend-developer 接手执行）

> 写到 `.briefs/schedules-brief.md` 是为了 build 期间把方案 ready，build 完成立刻派活。

## 业务需求

日程（Schedules）：用户可创建重复/单次事件，支持：
- 单条事件：一次性的会议、约会
- 重复事件：每天、每周、每月、自定义（RRULE）
- 单期修改：改一个实例不影响其它期（之前对话提到的 BUG-001 概念，需做对）
- 单期删除：删除某一期
- 时区：每事件可指定 IANA 时区（如 "Asia/Shanghai"）
- 提醒：提前 N 分钟（可选纯字段存，不一定要实现通知推送，M2 不带通知推送）
- 软删除

## 数据模型

```sql
schedule
  id               UUID PK
  userId           UUID FK
  title            VARCHAR(200)         明文（不加密，与 todo/habit 一致）
  description      TEXT                 明文，可选
  startAt          TIMESTAMPTZ         首次开始时间
  endAt            TIMESTAMPTZ          可选，未指定 = open-ended（仅 startAt）
  timezone         VARCHAR(64)         IANA tz, e.g. "Asia/Shanghai"
  allDay           BOOLEAN DEFAULT false
  rrule            TEXT                 nullable（无 rrule = 单次事件）
                                          e.g. "FREQ=DAILY;COUNT=5"
                                          e.g. "FREQ=WEEKLY;BYDAY=MO,WE,FR"
                                          e.g. "FREQ=MONTHLY;BYMONTHDAY=15"
  exdates          TIMESTAMPTZ[]       已删除的 instance 起止（展开时跳过）
  location         VARCHAR(200)         可选
  reminderMinutes  INT[]                e.g. {15, 60} = 提前 15 分钟 + 60 分钟
  color            VARCHAR(16)          色板 token
  archivedAt       TIMESTAMPTZ NULL
  createdAt        TIMESTAMPTZ
  updatedAt        TIMESTAMPTZ

schedule_override (单期覆盖)
  scheduleId         UUID FK
  instanceStartAt    TIMESTAMPTZ     原实例实际开始
  -- 覆盖字段（任意可空 = 继承 series）
  title              VARCHAR(200)
  description        TEXT
  startAt            TIMESTAMPTZ
  endAt              TIMESTAMPTZ
  allDay             BOOLEAN
  location           VARCHAR(200)
  reminderMinutes    INT[]
  -- 删除标记（"this and future" 用）
  truncate           BOOLEAN DEFAULT false
  PRIMARY KEY (scheduleId, instanceStartAt)
```

索引：
- `(user_id, start_at)` 窗口查询
- `(user_id) WHERE archived_at IS NULL` active schedules

## 接口契约

```
POST   /schedules                                   创建（body 含 title/startAt/timezone?/rrule?）
GET    /schedules?from=&to=&includeArchived=        展开 series 为 instances（窗口内）
                                                          返回数组 [{scheduleId, instanceStartAt, title, endAt?}]
GET    /schedules/:id                              详情（含 overrides）
PATCH  /schedules/:id                              修改 series（影响所有未覆盖的实例）
DELETE /schedules/:id                              软删 series
PATCH  /schedules/:id/instance?instanceStartAt=... 改单期（写 schedule_override）
DELETE /schedules/:id/instance?instanceStartAt=... 删单期
                                                          可选 ?truncate=true 表示「本 instance 及后续全部」
```

## 关键技术要求

1. **RRULE 解析**：用 `rrule.js` npm 包
2. **窗口展开**：GET /schedules?from=&to= 调用 rrule.between(from, to) 拿实例
3. **覆盖优先级**：override 存在 → 用 override，否则用 series 原值
4. **exdates**：展开时跳过这些时间
5. **truncate**：DELETE /schedules/:id/instance?truncate=true 时，往 schedule_override 写 `truncate=true` + 调整 schedule.rrule 的 UNTIL 到 instanceStartAt - 1ms
6. **修改 series 影响**已有 instance：让 override 决定优先级
7. **时区**：startAt/endAt 用 TIMESTAMPTZ（server 存为 UTC），timezone 字段用于显示
8. **行级隔离**：userId 从 JWT 取

## 接口响应：GET /schedules?from=&to=&includeArchived=

```ts
[
  {
    scheduleId,                // 用于前端 deep link
    instanceStartAt,           // 本实例的开始
    endAt?,                    // 本实例的结束（继承 series 或 override）
    title,                     // 继承或 override
    description?,
    location?,
    allDay,
    timezone,
    color,
    reminderMinutes,
    isOverride,                // 标记本次是 series 默认还是单期覆盖
  },
  ...
]
```

## smoke test 必须覆盖

1. 创建单次事件
2. 创建重复事件（daily, count=5）
3. 窗口展开 + 实例计数正确
4. 改单期：检查其它期不变
5. 单期删除不影响其它期
6. truncate=true：后续实例消失
7. 跨用户隔离
8. 软删除

> 这次必引 npm 包：rrule.js、rrule（同名）或类似库
> 之后要 npm install + Dockerfile 重 build（backend 装机即可，不像 Next.js 复杂）

---

## 配套前端（之后 dispatcher 再写）

`/schedules` —— 月/周视图（先做列表 + 按日期分组，简单日历先不做）
`/schedules/new`
`/schedules/[id]`（详情 + 编辑单期）
`/schedules/[id]/instance/[instanceStartAt]`（编辑单期实例）
