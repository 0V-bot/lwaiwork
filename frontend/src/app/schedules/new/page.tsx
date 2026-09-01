'use client';

import {
  useMemo,
  useState,
  type FormEvent,
} from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

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
  SCHEDULE_TIMEZONE_PRESETS,
  SCHEDULE_TITLE_MAX_LEN,
  type CreateSchedulePayload,
  type Schedule,
} from '@/types';

// ---------------------------------------------------------------------------
// Form shape. Local time is what the user sees while typing; on submit we
// convert each datetime field to ISO-8601 UTC via `new Date(value).toJSON()`.
// ---------------------------------------------------------------------------

interface FormState {
  title: string;
  description: string;
  startAt: string; // value for <input type="datetime-local">
  endAt: string;
  timezone: string;
  allDay: boolean;
  rrule: string;
  location: string;
  color: string;
  reminderMinutes: number[];
}

const EMPTY_FORM: FormState = {
  title: '',
  description: '',
  startAt: '',
  endAt: '',
  timezone: SCHEDULE_TIMEZONE_PRESETS[0], // Asia/Shanghai
  allDay: false,
  rrule: '',
  location: '',
  color: SCHEDULE_COLOR_OPTIONS[0], // #2FAF9E
  reminderMinutes: [],
};

// ---------------------------------------------------------------------------
// Wire conversion.
// ---------------------------------------------------------------------------

/** Convert a `<input type="datetime-local">` value (local-time string) to an
 *  ISO-8601 UTC string the backend accepts. Empty -> undefined. */
function toIso(value: string): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

/** Build the create payload, dropping undefined fields so the request body
 *  stays minimal. Backend validates each non-null field via class-validator. */
function toPayload(form: FormState): CreateSchedulePayload {
  const startAtIso = toIso(form.startAt);
  if (!startAtIso) {
    // Should be unreachable: the submit button is disabled until the user
    // types a valid startAt. Throw so the request never silently ships
    // without the required field.
    throw new Error('startAt 不能为空');
  }

  const payload: CreateSchedulePayload = {
    title: form.title.trim(),
    startAt: startAtIso,
    timezone: form.timezone.trim() || SCHEDULE_TIMEZONE_PRESETS[0],
  };
  if (form.description.trim()) payload.description = form.description;
  const endAtIso = toIso(form.endAt);
  if (endAtIso) payload.endAt = endAtIso;
  if (form.allDay) payload.allDay = true;
  if (form.rrule.trim()) payload.rrule = form.rrule.trim();
  if (form.location.trim()) payload.location = form.location.trim();
  if (form.color && form.color !== SCHEDULE_COLOR_OPTIONS[0]) {
    payload.color = form.color;
  }
  if (form.reminderMinutes.length > 0) {
    payload.reminderMinutes = form.reminderMinutes;
  }
  return payload;
}

// ---------------------------------------------------------------------------
// Validation.
// ---------------------------------------------------------------------------

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

export default function NewSchedulePage() {
  const router = useRouter();

  const [form, setForm] = useState<FormState>(() => ({
    ...EMPTY_FORM,
    startAt: defaultStartAt(),
  }));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const errors = useMemo(() => validate(form), [form]);
  const hasErrors = Object.keys(errors).length > 0;
  const canSubmit = !submitting && !hasErrors;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setSubmitting(true);

    let payload: CreateSchedulePayload;
    try {
      payload = toPayload(form);
    } catch (err) {
      // Missing required field caught client-side; surface immediately.
      setError(err instanceof Error ? err.message : '提交失败');
      setSubmitting(false);
      return;
    }

    try {
      const created = await api.post<Schedule>('/schedules', payload);
      router.push(`/schedules/${created.id}`);
    } catch (err) {
      setError(toErrorMessage(err));
      setSubmitting(false);
    }
  }

  function handleCancel() {
    router.push('/schedules');
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-ink">
            新建日程
          </h1>
          <p className="mt-1.5 text-[13px] text-ink-muted">
            标题、时间和时区是必填 — 重复、提醒和位置按需添加。
          </p>
        </div>
        <Link
          href="/schedules"
          className="rounded text-[13px] font-medium text-teal-600 transition-colors hover:text-teal-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
        >
          取消
        </Link>
      </div>

      <form
        onSubmit={handleSubmit}
        noValidate
        className="mt-9 space-y-6"
        aria-busy={submitting || undefined}
      >
        <TextField
          label="标题"
          name="schedule-title"
          placeholder="例如：周一站会、客户沟通、阅读时间"
          value={form.title}
          maxLength={SCHEDULE_TITLE_MAX_LEN}
          onChange={(event) =>
            setForm({ ...form, title: event.target.value })
          }
          error={errors.title ?? null}
          hint={`${form.title.length}/${SCHEDULE_TITLE_MAX_LEN}`}
        />

        <div>
          <label
            htmlFor="schedule-description"
            className="block text-[13px] font-medium tracking-tight text-ink-soft"
          >
            描述（可选）
          </label>
          <textarea
            id="schedule-description"
            name="schedule-description"
            value={form.description}
            onChange={(event) =>
              setForm({ ...form, description: event.target.value })
            }
            rows={4}
            placeholder="写点说明也行，留空也行。"
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
              `${form.description.length}/${SCHEDULE_DESCRIPTION_MAX_LEN} 字`}
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <div>
            <label
              htmlFor="schedule-startAt"
              className="block text-[13px] font-medium tracking-tight text-ink-soft"
            >
              开始时间
            </label>
            <input
              id="schedule-startAt"
              name="schedule-startAt"
              type="datetime-local"
              value={form.startAt}
              onChange={(event) =>
                setForm({ ...form, startAt: event.target.value })
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
              htmlFor="schedule-endAt"
              className="block text-[13px] font-medium tracking-tight text-ink-soft"
            >
              结束时间（可选）
            </label>
            <input
              id="schedule-endAt"
              name="schedule-endAt"
              type="datetime-local"
              value={form.endAt}
              onChange={(event) =>
                setForm({ ...form, endAt: event.target.value })
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
          value={form.timezone}
          onChange={(next) => setForm({ ...form, timezone: next })}
          error={errors.timezone ?? null}
        />

        <label className="flex items-center gap-2 text-[14px] text-ink-soft">
          <input
            type="checkbox"
            checked={form.allDay}
            onChange={(event) =>
              setForm({ ...form, allDay: event.target.checked })
            }
            className="h-4 w-4 rounded border-line text-teal-500 focus:ring-teal-500/40"
          />
          全天（不显示具体时间）
        </label>

        <RRuleField
          value={form.rrule}
          onChange={(next) => setForm({ ...form, rrule: next })}
        />

        <TextField
          label="位置（可选）"
          name="schedule-location"
          placeholder="例如：会议室 A、客户办公室"
          value={form.location}
          maxLength={SCHEDULE_LOCATION_MAX_LEN}
          onChange={(event) =>
            setForm({ ...form, location: event.target.value })
          }
          error={errors.location ?? null}
        />

        <ColorPicker
          value={form.color}
          onChange={(next) => setForm({ ...form, color: next })}
          hint="左侧色彩条，便于在列表里快速识别。"
        />

        <ReminderChips
          value={form.reminderMinutes}
          onChange={(next) => setForm({ ...form, reminderMinutes: next })}
          error={errors.reminders ?? null}
        />

        {error ? (
          <p
            role="alert"
            className="rounded-md border border-red-100 bg-red-50 px-3 py-2 text-[13px] leading-5 text-red-600"
          >
            {error}
          </p>
        ) : null}

        <div className="flex items-center gap-3">
          <Button type="submit" loading={submitting} disabled={!canSubmit}>
            创建日程
          </Button>
          <button
            type="button"
            onClick={handleCancel}
            disabled={submitting}
            className="text-[13px] text-ink-muted transition-colors hover:text-ink disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
          >
            放弃
          </button>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers kept module-local to avoid leaking into the public surface.

/** Default startAt: the next rounded-up half-hour in browser local time.
 *  Avoids landing the user on `00:00` or in the past on first open. */
function defaultStartAt(): string {
  const now = new Date();
  const minutes = now.getMinutes();
  const rounded = Math.ceil((minutes + 30) / 30) * 30;
  const t = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), 0, 0, 0);
  t.setMinutes(rounded);
  // Format for <input type="datetime-local">: YYYY-MM-DDTHH:mm (local).
  const yyyy = t.getFullYear();
  const mm = String(t.getMonth() + 1).padStart(2, '0');
  const dd = String(t.getDate()).padStart(2, '0');
  const hh = String(t.getHours()).padStart(2, '0');
  const mi = String(t.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}
