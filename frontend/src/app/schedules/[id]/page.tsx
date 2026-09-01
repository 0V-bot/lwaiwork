'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';

import { Button } from '@/components/Button';
import { TextField } from '@/components/TextField';
import { ColorPicker } from '@/components/ColorPicker';
import { RRuleField } from '@/components/RRuleField';
import { TimezoneSelect } from '@/components/TimezoneSelect';
import { ReminderChips } from '@/components/ReminderChips';
import { api, toErrorMessage } from '@/lib/api';
import {
  SCHEDULE_COLOR_OPTIONS,
  SCHEDULE_DESCRIPTION_MAX_LEN,
  SCHEDULE_LOCATION_MAX_LEN,
  SCHEDULE_REMINDER_MAX_LEN,
  SCHEDULE_REMINDER_MAX_VAL,
  SCHEDULE_TITLE_MAX_LEN,
  type MessageResponse,
  type Schedule,
  type ScheduleDetail as ScheduleDetailShape,
  type ScheduleOverride,
  type UpdateInstancePayload,
  type UpdateSchedulePayload,
} from '@/types';

/**
 * /schedules/:id — series detail + per-instance ops.
 *
 * Three concerns live here:
 *   1. View: GET /schedules/:id → ScheduleDetail { schedule, overrides }.
 *      Renders the series meta plus the override table.
 *   2. Series edit: PATCH /schedules/:id. Same form shape as /schedules/new
 *      so the user recognises the inputs; only changed fields are sent so
 *      blank cells on the form don't accidentally null out the row.
 *   3. Per-instance ops: the user picks a target occurrence via `?at=`
 *      (the EventCard writes that param when clicked from the list). The
 *      page exposes "仅修改本实例" and "删除本次" wired to that value.
 *
 * When `?at=` is absent we still let the user act by typing / picking a
 * datetime-local. The backend's `isPlausibleInstance` only requires the
 * value to be >= the series startAt - cheap guard, no expansion needed.
 */

// ---------------------------------------------------------------------------
// Local form shape mirrors the new page so we can reuse validation logic.
// ---------------------------------------------------------------------------

interface FormState {
  title: string;
  description: string;
  startAt: string;
  endAt: string;
  timezone: string;
  allDay: boolean;
  rrule: string;
  location: string;
  color: string;
  reminderMinutes: number[];
}

function formFromSchedule(s: Schedule): FormState {
  return {
    title: s.title || '',
    description: s.description || '',
    startAt: isoToLocalInput(s.startAt),
    endAt: s.endAt ? isoToLocalInput(s.endAt) : '',
    timezone: s.timezone || '',
    allDay: !!s.allDay,
    rrule: s.rrule || '',
    location: s.location || '',
    color: s.color || SCHEDULE_COLOR_OPTIONS[0],
    reminderMinutes: [...s.reminderMinutes],
  };
}

/** Convert an ISO-8601 UTC string into the `YYYY-MM-DDTHH:mm` form a
 *  datetime-local input expects (browser-local time). */
function isoToLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

function toIso(value: string): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

// ---------------------------------------------------------------------------
// Build a PATCH payload that only carries fields the user actually changed.
// Empty string on RRULE = "explicitly clear recurrence"; we still want that
// diffed (otherwise the user can't downgrade a recurring series).
// ---------------------------------------------------------------------------

function patchPayload(next: FormState, original: Schedule): UpdateSchedulePayload {
  const out: UpdateSchedulePayload = {};
  const trimmedTitle = next.title.trim();
  if (trimmedTitle !== original.title) out.title = trimmedTitle;
  if ((next.description || '') !== (original.description || '')) {
    out.description = next.description;
  }
  const nextStart = toIso(next.startAt);
  if (nextStart && nextStart !== original.startAt) out.startAt = nextStart;
  const nextEnd = next.endAt ? toIso(next.endAt) : null;
  if ((nextEnd ?? null) !== (original.endAt ?? null)) out.endAt = nextEnd;
  if (next.timezone.trim() && next.timezone !== original.timezone)
    out.timezone = next.timezone.trim();
  if (next.allDay !== original.allDay) out.allDay = next.allDay;
  // RRULE: trim then compare. null/empty on either side counts as "no
  // recurrence" so the user can clear it by clearing the field.
  const nextRrule = next.rrule.trim() || null;
  if (nextRrule !== (original.rrule ?? null)) out.rrule = nextRrule;
  if ((next.location.trim() || null) !== (original.location ?? null))
    out.location = next.location.trim() || null;
  if (next.color !== original.color) out.color = next.color;

  const sameReminders =
    next.reminderMinutes.length === original.reminderMinutes.length &&
    next.reminderMinutes.every((v, i) => v === original.reminderMinutes[i]);
  if (!sameReminders) out.reminderMinutes = [...next.reminderMinutes];
  return out;
}

function validate(form: FormState): {
  title?: string;
  description?: string;
  location?: string;
  startAt?: string;
  endAt?: string;
  timezone?: string;
  reminders?: string;
} {
  const errors: ReturnType<typeof validate> = {};
  if (form.title.trim().length === 0) errors.title = '标题不能为空';
  else if (form.title.length > SCHEDULE_TITLE_MAX_LEN)
    errors.title = `最多 ${SCHEDULE_TITLE_MAX_LEN} 字`;
  if (form.description.length > SCHEDULE_DESCRIPTION_MAX_LEN)
    errors.description = `最多 ${SCHEDULE_DESCRIPTION_MAX_LEN} 字（UTF-8）`;
  if (form.location.length > SCHEDULE_LOCATION_MAX_LEN)
    errors.location = `最多 ${SCHEDULE_LOCATION_MAX_LEN} 字`;

  if (!form.startAt) errors.startAt = '开始时间不能为空';
  else if (Number.isNaN(new Date(form.startAt).getTime()))
    errors.startAt = '请输入有效的时间';

  if (form.endAt) {
    const startMs = new Date(form.startAt).getTime();
    const endMs = new Date(form.endAt).getTime();
    if (Number.isNaN(endMs)) errors.endAt = '请输入有效的时间';
    else if (!Number.isNaN(startMs) && endMs < startMs)
      errors.endAt = '结束时间不能早于开始';
  }

  if (!form.timezone.trim()) errors.timezone = '时区不能为空';

  if (form.reminderMinutes.length > SCHEDULE_REMINDER_MAX_LEN) {
    errors.reminders = `最多 ${SCHEDULE_REMINDER_MAX_LEN} 个提醒`;
  } else if (
    form.reminderMinutes.some((m) => m < 0 || m > SCHEDULE_REMINDER_MAX_VAL)
  ) {
    errors.reminders = `单个提醒需在 0–${SCHEDULE_REMINDER_MAX_VAL} 分钟之间`;
  }
  return errors;
}

// ---------------------------------------------------------------------------
// RRULE-humaniser. Parses the few FREQ values the brief asks us to support
// plus a couple of common BYDAY expansions - we don't try to be a full
// RFC-5545 renderer. Anything we can't decode falls back to the raw line
// with a help cursor.
// ---------------------------------------------------------------------------

function describeRRule(raw: string | null, locale: 'zh' = 'zh'): string {
  if (!raw) return '单次事件，不重复';
  const parts = raw
    .split(';')
    .map((p) => p.trim())
    .filter(Boolean);
  const map: Record<string, string> = {};
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    map[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1);
  }
  const freq = (map.FREQ || '').toUpperCase();
  const byday = map.BYDAY ? map.BYDAY.split(',').map((s) => s.trim()).filter(Boolean) : [];
  const count = map.COUNT;
  const interval = map.INTERVAL;

  const weekdayMap: Record<string, string> = {
    MO: '周一',
    TU: '周二',
    WE: '周三',
    TH: '周四',
    FR: '周五',
    SA: '周六',
    SU: '周日',
  };

  const everyN =
    interval && interval !== '1'
      ? locale === 'zh'
        ? `每 ${interval} 个`
        : `every ${interval} `
      : '';

  let body = '';
  switch (freq) {
    case 'DAILY':
      body = '每天';
      break;
    case 'WEEKLY': {
      const days = byday.map((d) => weekdayMap[d.toUpperCase()] ?? d).join('、');
      body = days ? `每周${days}` : '每周';
      break;
    }
    case 'MONTHLY': {
      if (map.BYMONTHDAY) body = `每月 ${map.BYMONTHDAY} 日`;
      else body = '每月';
      break;
    }
    case 'YEARLY':
      body = '每年';
      break;
    default:
      body = raw; // unknown - echo as a "raw" hint
  }

  let suffix = '';
  if (count) suffix = ` · 共 ${count} 次`;
  return `${everyN}${body}${suffix}`;
}

// ---------------------------------------------------------------------------
// A self-contained, scaled-down instance-edit form. Keeps it inline in the
// operations panel; only the fields UpdateInstanceDto accepts.
// ---------------------------------------------------------------------------

interface InstanceDraft {
  title: string;
  startAt: string;
  endAt: string;
  allDay: boolean;
  location: string;
  reminderMinutes: number[];
  color: string;
}

function emptyInstanceDraft(): InstanceDraft {
  return {
    title: '',
    startAt: '',
    endAt: '',
    allDay: false,
    location: '',
    reminderMinutes: [],
    color: SCHEDULE_COLOR_OPTIONS[0],
  };
}

// ---------------------------------------------------------------------------

export default function ScheduleDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
  const router = useRouter();
  const searchParams = useSearchParams();
  const focusAt = searchParams.get('at');

  // Top-level state.
  const [detail, setDetail] = useState<ScheduleDetailShape | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  // Edit (series) state.
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [draft, setDraft] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Archive (soft-delete) state.
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  // Per-instance state.
  const [atDraft, setAtDraft] = useState(focusAt ?? '');
  const [instanceDraft, setInstanceDraft] = useState<InstanceDraft>(emptyInstanceDraft);
  const [savingInstance, setSavingInstance] = useState(false);
  const [instanceError, setInstanceError] = useState<string | null>(null);

  const [confirmInstanceDelete, setConfirmInstanceDelete] = useState(false);
  const [truncateFuture, setTruncateFuture] = useState(false);
  const [deletingInstance, setDeletingInstance] = useState(false);
  const [deleteInstanceError, setDeleteInstanceError] = useState<string | null>(null);

  // When ?at changes (e.g. user clicks a different card from the list),
  // mirror it into our local state so the operations panel tracks it.
  useEffect(() => {
    if (focusAt) setAtDraft(focusAt);
  }, [focusAt]);

  // ---------------------------------------------------------------- load
  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setLoadError(null);
    setNotFound(false);
    try {
      const data = await api.get<ScheduleDetailShape>(`/schedules/${id}`);
      setDetail(data);
    } catch (err) {
      const message = toErrorMessage(err);
      const status = (err as { status?: number }).status;
      if (status === 404) setNotFound(true);
      else setLoadError(message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // -------------------------------------------------------- edit-mode
  const errors = useMemo(() => (draft ? validate(draft) : {}), [draft]);
  const canSave = useMemo(() => {
    if (!draft || !detail || saving) return false;
    if (Object.keys(errors).length > 0) return false;
    return Object.keys(patchPayload(draft, detail.schedule)).length > 0;
  }, [draft, detail, saving, errors]);

  function startEdit() {
    if (!detail) return;
    setDraft(formFromSchedule(detail.schedule));
    setSaveError(null);
    setMode('edit');
  }

  function cancelEdit() {
    setDraft(null);
    setSaveError(null);
    setMode('view');
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || !detail || !canSave) return;
    setSaving(true);
    setSaveError(null);
    const patch = patchPayload(draft, detail.schedule);
    try {
      const updated = await api.patch<Schedule>(`/schedules/${detail.schedule.id}`, patch);
      setDetail({ schedule: updated, overrides: detail.overrides });
      cancelEdit();
    } catch (err) {
      setSaveError(toErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  // -------------------------------------------------- archive (soft-delete)
  async function confirmArchiveNow() {
    if (!detail) return;
    setArchiving(true);
    setArchiveError(null);
    try {
      await api.del<MessageResponse>(`/schedules/${detail.schedule.id}`);
      // After soft-archive the inbox list filters this id out. Push user
      // back there so the operation has visible effect.
      router.replace('/schedules');
    } catch (err) {
      setArchiveError(toErrorMessage(err));
      setArchiving(false);
      setConfirmArchive(false);
    }
  }

  // ---------------------------------------------------- per-instance ops

  /** Resolve the per-instance target. Pulls from `?at=` first, then falls
   *  back to the user-editable atDraft input. Empty string means none. */
  const resolvedAt = (focusAt && focusAt.trim()) || atDraft.trim();

  async function handlePatchInstance(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail || !resolvedAt) {
      setInstanceError('请先填写要修改的实例时间');
      return;
    }
    setSavingInstance(true);
    setInstanceError(null);

    const payload: UpdateInstancePayload = {};
    if (instanceDraft.title.trim()) payload.title = instanceDraft.title.trim();
    if (instanceDraft.location.trim()) payload.location = instanceDraft.location.trim();
    if (instanceDraft.color) payload.color = instanceDraft.color;
    const startIso = toIso(instanceDraft.startAt);
    if (startIso) payload.startAt = startIso;
    const endIso = toIso(instanceDraft.endAt);
    if (endIso) payload.endAt = endIso;
    if (instanceDraft.allDay) payload.allDay = true;
    if (instanceDraft.reminderMinutes.length > 0) {
      payload.reminderMinutes = [...instanceDraft.reminderMinutes];
    }

    try {
      const override = await api.patch<ScheduleOverride>(
        `/schedules/${detail.schedule.id}/instance`,
        payload,
        { query: { instanceStartAt: resolvedAt } },
      );
      // Merge the override back into local state so the override table
      // reflects what just got written without a refetch.
      setDetail((prev) => {
        if (!prev) return prev;
        const idx = prev.overrides.findIndex(
          (o) => o.instanceStartAt === override.instanceStartAt,
        );
        const next = [...prev.overrides];
        if (idx >= 0) next[idx] = override;
        else next.push(override);
        return { ...prev, overrides: next };
      });
      setInstanceDraft(emptyInstanceDraft);
    } catch (err) {
      setInstanceError(toErrorMessage(err));
    } finally {
      setSavingInstance(false);
    }
  }

  async function handleDeleteInstance() {
    if (!detail || !resolvedAt) {
      setDeleteInstanceError('请先填写要删除的实例时间');
      return;
    }
    setDeletingInstance(true);
    setDeleteInstanceError(null);
    try {
      await api.del<MessageResponse>(
        `/schedules/${detail.schedule.id}/instance`,
        undefined,
        {
          query: {
            instanceStartAt: resolvedAt,
            truncate: truncateFuture ? 'true' : 'false',
          },
        },
      );
      // Optimistically clear the dialog and bump the response: if we
      // deleted the last override / last non-truncate row, the next
      // GET will reflect that. For UX brevity we don't refetch here -
      // the override table is informational and lags by one view.
      setConfirmInstanceDelete(false);
    } catch (err) {
      setDeleteInstanceError(toErrorMessage(err));
    } finally {
      setDeletingInstance(false);
    }
  }

  // ---------------------------------------------------------------- render

  if (loading) {
    return (
      <div>
        <div className="h-8 w-40 animate-pulse rounded bg-line" />
        <div className="mt-6 h-3 w-3/4 animate-pulse rounded bg-line" />
        <div className="mt-2 h-3 w-1/2 animate-pulse rounded bg-line" />
      </div>
    );
  }

  if (notFound) {
    return (
      <div>
        <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-ink">
          日程不存在
        </h1>
        <p className="mt-2 text-[13px] text-ink-muted">
          这条日程可能已被归档，或链接已失效。
        </p>
        <Link
          href="/schedules"
          className="mt-6 inline-flex h-11 items-center justify-center rounded-md bg-teal-500 px-6 text-[15px] font-medium text-white transition-colors hover:bg-teal-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
        >
          返回日程
        </Link>
      </div>
    );
  }

  if (loadError) {
    return (
      <div>
        <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-ink">
          日程
        </h1>
        <p
          role="alert"
          className="mt-6 rounded-md border border-red-100 bg-red-50 px-3 py-2 text-[13px] leading-5 text-red-600"
        >
          {loadError}
        </p>
        <Link
          href="/schedules"
          className="mt-6 inline-block text-[13px] font-medium text-teal-600 hover:text-teal-700"
        >
          ← 返回日程
        </Link>
      </div>
    );
  }

  if (!detail) return null;
  const schedule = detail.schedule;

  return (
    <div>
      {/* ----------------------------------------------------- top bar */}
      <div className="flex items-center justify-between">
        <Link
          href="/schedules"
          className="rounded text-[13px] font-medium text-teal-600 transition-colors hover:text-teal-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
        >
          ← 返回日程
        </Link>
        {mode === 'view' ? (
          <div className="flex items-center gap-4 text-[13px]">
            <button
              type="button"
              onClick={startEdit}
              className="text-teal-600 transition-colors hover:text-teal-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
            >
              编辑整组
            </button>
            <button
              type="button"
              onClick={() => setConfirmArchive(true)}
              className="text-ink-muted transition-colors hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
            >
              归档
            </button>
          </div>
        ) : null}
      </div>

      {/* ----------------------------------------------------- view */}
      {mode === 'view' ? (
        <article
          className="relative mt-7 overflow-hidden rounded-lg border border-line bg-white"
          aria-label={`日程 ${schedule.title}`}
        >
          <span
            aria-hidden
            className="absolute inset-y-0 left-0 w-1.5"
            style={{ backgroundColor: schedule.color }}
          />
          <div className="px-6 py-7 pl-7">
            <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-ink">
              {schedule.title || '（无标题）'}
            </h1>
            <p className="mt-2 text-[12px] text-ink-muted">
              {formatDateTime(schedule.startAt)}
              {schedule.endAt
                ? ` – ${formatDateTime(schedule.endAt)}`
                : ' · 仅开始'}
              {' · '}
              {schedule.allDay ? '全天' : '具体时间'}
              {' · '}
              时区 {schedule.timezone}
              {schedule.archivedAt
                ? ` · 已归档于 ${formatDateTime(schedule.archivedAt)}`
                : ''}
            </p>

            <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-line px-3 py-1 text-[12px] text-ink-soft">
              <svg viewBox="0 0 16 16" className="h-3 w-3" aria-hidden>
                <path
                  d="M3.5 6.5a2.5 2.5 0 0 1 2.5-2.5h4a2.5 2.5 0 0 1 2.5 2.5M3.5 9.5a2.5 2.5 0 0 0 2.5 2.5h4a2.5 2.5 0 0 0 2.5-2.5M2 5l1.5 1.5L5 5M11 11l1.5-1.5L14 11"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              {describeRRule(schedule.rrule)}
            </div>

            {schedule.description ? (
              <div className="mt-5 whitespace-pre-wrap break-words text-[15px] leading-7 text-ink">
                {schedule.description}
              </div>
            ) : null}

            <dl className="mt-6 grid grid-cols-1 gap-y-3 text-[14px] sm:grid-cols-2">
              {schedule.location ? (
                <div>
                  <dt className="text-[12px] uppercase tracking-wider text-ink-muted">
                    位置
                  </dt>
                  <dd className="mt-0.5 text-ink">{schedule.location}</dd>
                </div>
              ) : null}
              <div>
                <dt className="text-[12px] uppercase tracking-wider text-ink-muted">
                  提醒
                </dt>
                <dd className="mt-0.5 text-ink">
                  {schedule.reminderMinutes.length > 0
                    ? schedule.reminderMinutes
                        .map((m) =>
                          m >= 60 ? `${m / 60} 小时` : `${m} 分钟`,
                        )
                        .join('、') + ' 前'
                    : '无'}
                </dd>
              </div>
              <div>
                <dt className="text-[12px] uppercase tracking-wider text-ink-muted">
                  创建
                </dt>
                <dd className="mt-0.5 text-ink">{formatDateTime(schedule.createdAt)}</dd>
              </div>
              <div>
                <dt className="text-[12px] uppercase tracking-wider text-ink-muted">
                  更新
                </dt>
                <dd className="mt-0.5 text-ink">{formatDateTime(schedule.updatedAt)}</dd>
              </div>
            </dl>
          </div>
        </article>
      ) : null}

      {/* ----------------------------------------------------- edit */}
      {mode === 'edit' && draft ? (
        <form
          onSubmit={handleSave}
          noValidate
          className="mt-7 space-y-6 rounded-lg border border-line bg-white p-5"
          aria-busy={saving || undefined}
        >
          <p className="text-[12px] text-ink-muted">
            编辑会修改整个日程系列；已被单独修改的实例会保持它们自己的样子。
          </p>

          <TextField
            label="标题"
            name="schedule-edit-title"
            value={draft.title}
            maxLength={SCHEDULE_TITLE_MAX_LEN}
            onChange={(event) =>
              setDraft({ ...draft, title: event.target.value })
            }
            error={
              draft.title.trim().length === 0
                ? '标题不能为空'
                : errors.title ?? null
            }
          />

          <div>
            <label
              htmlFor="schedule-edit-description"
              className="block text-[13px] font-medium tracking-tight text-ink-soft"
            >
              描述
            </label>
            <textarea
              id="schedule-edit-description"
              value={draft.description}
              onChange={(event) =>
                setDraft({ ...draft, description: event.target.value })
              }
              rows={4}
              spellCheck={false}
              className={[
                'mt-1.5 block w-full resize-y rounded-md border bg-white px-3 py-2.5',
                'text-[15px] leading-6 text-ink outline-none transition-colors',
                'placeholder:text-ink-muted/50',
                errors.description
                  ? 'border-red-400 focus:border-red-500'
                  : 'border-line focus:border-teal-500',
              ].join(' ')}
            />
            <p
              className={[
                'mt-1.5 text-[12px] leading-4',
                errors.description ? 'text-red-600' : 'text-ink-muted',
              ].join(' ')}
            >
              {errors.description ??
                `${draft.description.length}/${SCHEDULE_DESCRIPTION_MAX_LEN} 字`}
            </p>
          </div>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div>
              <label
                htmlFor="schedule-edit-startAt"
                className="block text-[13px] font-medium tracking-tight text-ink-soft"
              >
                开始时间
              </label>
              <input
                id="schedule-edit-startAt"
                type="datetime-local"
                value={draft.startAt}
                onChange={(event) =>
                  setDraft({ ...draft, startAt: event.target.value })
                }
                aria-invalid={errors.startAt ? true : undefined}
                className={[
                  'mt-1.5 w-full rounded-md border bg-white px-3 py-2.5 text-[15px] text-ink outline-none transition-colors',
                  errors.startAt
                    ? 'border-red-400 focus:border-red-500'
                    : 'border-line focus:border-teal-500',
                ].join(' ')}
              />
              {errors.startAt ? (
                <p className="mt-1.5 text-[12px] leading-4 text-red-600">
                  {errors.startAt}
                </p>
              ) : null}
            </div>

            <div>
              <label
                htmlFor="schedule-edit-endAt"
                className="block text-[13px] font-medium tracking-tight text-ink-soft"
              >
                结束时间
              </label>
              <input
                id="schedule-edit-endAt"
                type="datetime-local"
                value={draft.endAt}
                onChange={(event) =>
                  setDraft({ ...draft, endAt: event.target.value })
                }
                aria-invalid={errors.endAt ? true : undefined}
                className={[
                  'mt-1.5 w-full rounded-md border bg-white px-3 py-2.5 text-[15px] text-ink outline-none transition-colors',
                  errors.endAt
                    ? 'border-red-400 focus:border-red-500'
                    : 'border-line focus:border-teal-500',
                ].join(' ')}
              />
              {errors.endAt ? (
                <p className="mt-1.5 text-[12px] leading-4 text-red-600">
                  {errors.endAt}
                </p>
              ) : null}
            </div>
          </div>

          <TimezoneSelect
            value={draft.timezone}
            onChange={(next) => setDraft({ ...draft, timezone: next })}
            error={errors.timezone ?? null}
          />

          <label className="flex items-center gap-2 text-[14px] text-ink-soft">
            <input
              type="checkbox"
              checked={draft.allDay}
              onChange={(event) =>
                setDraft({ ...draft, allDay: event.target.checked })
              }
              className="h-4 w-4 rounded border-line text-teal-500 focus:ring-teal-500/40"
            />
            全天
          </label>

          <RRuleField
            value={draft.rrule}
            onChange={(next) => setDraft({ ...draft, rrule: next })}
            hint="清空 = 转为单次事件（不会丢失现有的实例覆盖）。"
          />

          <TextField
            label="位置"
            name="schedule-edit-location"
            value={draft.location}
            maxLength={SCHEDULE_LOCATION_MAX_LEN}
            onChange={(event) =>
              setDraft({ ...draft, location: event.target.value })
            }
            error={errors.location ?? null}
          />

          <ColorPicker
            value={draft.color}
            onChange={(next) => setDraft({ ...draft, color: next })}
          />

          <ReminderChips
            value={draft.reminderMinutes}
            onChange={(next) => setDraft({ ...draft, reminderMinutes: next })}
            error={errors.reminders ?? null}
          />

          {saveError ? (
            <p
              role="alert"
              className="rounded-md border border-red-100 bg-red-50 px-3 py-2 text-[13px] leading-5 text-red-600"
            >
              {saveError}
            </p>
          ) : null}

          <div className="flex items-center gap-3 pt-1">
            <Button type="submit" loading={saving} disabled={!canSave}>
              保存修改
            </Button>
            <button
              type="button"
              onClick={cancelEdit}
              disabled={saving}
              className="text-[13px] text-ink-muted transition-colors hover:text-ink disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
            >
              取消
            </button>
          </div>
        </form>
      ) : null}

      {/* -------------------------------------------- per-instance panel */}
      {mode === 'view' ? (
        <section className="mt-12 rounded-lg border border-line bg-white p-5">
          <header>
            <h2 className="text-[15px] font-medium tracking-tight text-ink">
              本实例操作
            </h2>
            <p className="mt-1 text-[12px] leading-5 text-ink-muted">
              针对某一次具体的发生时间修改或删除 — 其它次保持原样。
              {' '}从「日程」列表点击某一项会自动带上这个时间。
            </p>
          </header>

          {/* target instance time picker */}
          <div className="mt-5 max-w-xs">
            <label
              htmlFor="instance-at"
              className="block text-[13px] font-medium tracking-tight text-ink-soft"
            >
              操作的实例时间
            </label>
            <input
              id="instance-at"
              type="datetime-local"
              value={atDraft ? isoToLocalInput(atDraft) : ''}
              onChange={(event) => setAtDraft(toIso(event.target.value) ?? '')}
              className="mt-1.5 w-full rounded-md border border-line bg-white px-3 py-2.5 text-[15px] text-ink outline-none transition-colors focus:border-teal-500"
            />
            <p className="mt-1 text-[11px] text-ink-muted">
              {focusAt
                ? '已自动带入列表点击的那次；可手动覆盖。'
                : '从列表页打开会自动带入。'}
            </p>
          </div>

          {/* 仅修改本实例 */}
          <form
            onSubmit={handlePatchInstance}
            noValidate
            className="mt-7 space-y-4 border-t border-line pt-6"
          >
            <h3 className="text-[13px] font-medium tracking-tight text-ink">
              仅修改本实例
            </h3>
            <p className="text-[12px] leading-5 text-ink-muted">
              留空的字段不会被改动（沿用日程系列的默认值）。
            </p>

            <TextField
              label="新标题（留空不改）"
              name="instance-title"
              value={instanceDraft.title}
              maxLength={SCHEDULE_TITLE_MAX_LEN}
              onChange={(event) =>
                setInstanceDraft({ ...instanceDraft, title: event.target.value })
              }
            />

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="instance-startAt"
                  className="block text-[13px] font-medium tracking-tight text-ink-soft"
                >
                  新开始时间（留空不改）
                </label>
                <input
                  id="instance-startAt"
                  type="datetime-local"
                  value={instanceDraft.startAt}
                  onChange={(event) =>
                    setInstanceDraft({ ...instanceDraft, startAt: event.target.value })
                  }
                  className="mt-1.5 w-full rounded-md border border-line bg-white px-3 py-2.5 text-[15px] text-ink outline-none transition-colors focus:border-teal-500"
                />
              </div>
              <div>
                <label
                  htmlFor="instance-endAt"
                  className="block text-[13px] font-medium tracking-tight text-ink-soft"
                >
                  新结束时间（留空不改）
                </label>
                <input
                  id="instance-endAt"
                  type="datetime-local"
                  value={instanceDraft.endAt}
                  onChange={(event) =>
                    setInstanceDraft({ ...instanceDraft, endAt: event.target.value })
                  }
                  className="mt-1.5 w-full rounded-md border border-line bg-white px-3 py-2.5 text-[15px] text-ink outline-none transition-colors focus:border-teal-500"
                />
              </div>
            </div>

            <TextField
              label="新位置（留空不改）"
              name="instance-location"
              value={instanceDraft.location}
              maxLength={SCHEDULE_LOCATION_MAX_LEN}
              onChange={(event) =>
                setInstanceDraft({ ...instanceDraft, location: event.target.value })
              }
            />

            <ReminderChips
              value={instanceDraft.reminderMinutes}
              onChange={(next) =>
                setInstanceDraft({ ...instanceDraft, reminderMinutes: next })
              }
              hint="留空不发送，留非空数组会覆盖日程的提醒设置。"
            />

            {instanceError ? (
              <p
                role="alert"
                className="rounded-md border border-red-100 bg-red-50 px-3 py-2 text-[13px] leading-5 text-red-600"
              >
                {instanceError}
              </p>
            ) : null}

            <Button type="submit" loading={savingInstance}>
              保存本次修改
            </Button>
          </form>

          {/* 删除本次 */}
          <div className="mt-7 space-y-4 border-t border-line pt-6">
            <h3 className="text-[13px] font-medium tracking-tight text-ink">
              删除本次
            </h3>
            <p className="text-[12px] leading-5 text-ink-muted">
              默认只把这次加到日程的黑名单里，其它次不变。勾选「本实例及之后」会把日程的重复规则截断到这次。
            </p>
            <label className="flex items-center gap-2 text-[13px] text-ink-soft">
              <input
                type="checkbox"
                checked={truncateFuture}
                onChange={(event) => setTruncateFuture(event.target.checked)}
                className="h-4 w-4 rounded border-line text-teal-500 focus:ring-teal-500/40"
              />
              本实例及之后（含）一并删除
            </label>

            {deleteInstanceError ? (
              <p
                role="alert"
                className="rounded-md border border-red-100 bg-red-50 px-3 py-2 text-[13px] leading-5 text-red-600"
              >
                {deleteInstanceError}
              </p>
            ) : null}

            <button
              type="button"
              onClick={() => {
                setDeleteInstanceError(null);
                setConfirmInstanceDelete(true);
              }}
              className="text-[13px] text-ink-muted transition-colors hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
            >
              删除这次 →
            </button>
          </div>
        </section>
      ) : null}

      {/* --------------------------------------- override table */}
      {mode === 'view' && detail.overrides.length > 0 ? (
        <section className="mt-12">
          <h2 className="text-[14px] font-medium tracking-tight text-ink">
            实例覆盖（{detail.overrides.length}）
          </h2>
          <p className="mt-1 text-[12px] leading-5 text-ink-muted">
            这些是对该日程系列里某一次做的「局部修改」，展开时优先使用。
          </p>
          <ul className="mt-4 divide-y divide-line rounded-lg border border-line bg-white">
            {detail.overrides.map((ov) => (
              <li
                key={ov.instanceStartAt}
                className="flex items-start gap-3 px-4 py-3"
              >
                <span
                  className="mt-1 inline-flex h-2 w-2 shrink-0 rounded-full bg-teal-500"
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium tracking-tight text-ink">
                    {formatDateTime(ov.instanceStartAt)}
                  </div>
                  <div className="mt-0.5 text-[12px] text-ink-muted">
                    {ov.truncate
                      ? '已截断系列到这次之前'
                      : summaryOfOverride(ov)}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* ------------------------------------------- archive dialog */}
      {confirmArchive ? (
        <Dialog
          title="归档这条日程？"
          body={
            schedule.rrule
              ? `「${schedule.title}」及未来生成的实例将从主列表移除，原始数据保留。`
              : `「${schedule.title}」将从主列表移除，原始数据保留。`
          }
          confirmLabel={archiving ? '归档中…' : '归档'}
          disabled={archiving}
          error={archiveError}
          onCancel={() => !archiving && setConfirmArchive(false)}
          onConfirm={() => void confirmArchiveNow()}
        />
      ) : null}

      {/* --------------------------------------- instance-delete dialog */}
      {confirmInstanceDelete ? (
        <Dialog
          title={
            truncateFuture ? '删除这次及之后？' : '只删除这次？'
          }
          body={
            truncateFuture
              ? '会把日程的重复规则截断到这里 — 之后再生成的实例全部消失。'
              : '只是把这次加进黑名单 — 其它次照常出现。'
          }
          confirmLabel={deletingInstance ? '删除中…' : '确认删除'}
          disabled={deletingInstance}
          error={deleteInstanceError}
          onCancel={() => !deletingInstance && setConfirmInstanceDelete(false)}
          onConfirm={() => void handleDeleteInstance()}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small presentational helpers - kept module-local so the page file reads as
// one cohesive unit.
// ---------------------------------------------------------------------------

/** Local-time stamp for display on detail / edit. */
function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

/** Compress a ScheduleOverride into a short, scannable summary. */
function summaryOfOverride(ov: ScheduleOverride): string {
  const parts: string[] = [];
  if (ov.title) parts.push(`标题：${ov.title}`);
  if (ov.startAt) parts.push(`时间：${formatDateTime(ov.startAt)}`);
  if (ov.endAt) parts.push(`结束：${formatDateTime(ov.endAt)}`);
  if (ov.allDay) parts.push('全天');
  if (ov.location) parts.push(`位置：${ov.location}`);
  if (ov.reminderMinutes && ov.reminderMinutes.length > 0) {
    parts.push(
      `提醒：${ov.reminderMinutes
        .map((m) => (m >= 60 ? `${m / 60}h` : `${m}m`))
        .join('、')}`,
    );
  }
  return parts.length > 0 ? parts.join(' · ') : '（无字段覆盖）';
}

interface DialogProps {
  title: string;
  body: string;
  confirmLabel: string;
  disabled: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Lightweight confirm dialog. Reused by both the archive and instance-delete
 * flows so the visual rhythm stays identical between destructive actions.
 */
function Dialog({
  title,
  body,
  confirmLabel,
  disabled,
  error,
  onCancel,
  onConfirm,
}: DialogProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 px-4 py-6 sm:items-center"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <h3
          id="confirm-title"
          className="text-[16px] font-semibold tracking-tight text-ink"
        >
          {title}
        </h3>
        <p className="mt-2 text-[13px] leading-5 text-ink-muted">{body}</p>
        {error ? (
          <p
            role="alert"
            className="mt-3 rounded-md border border-red-100 bg-red-50 px-3 py-2 text-[13px] leading-5 text-red-600"
          >
            {error}
          </p>
        ) : null}
        <div className="mt-5 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={disabled}
            className="rounded text-[13px] text-ink-muted transition-colors hover:text-ink disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
          >
            取消
          </button>
          <Button onClick={onConfirm} loading={disabled}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
