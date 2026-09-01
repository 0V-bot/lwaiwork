'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

import { Button } from '@/components/Button';
import { TextField } from '@/components/TextField';
import { api, toErrorMessage } from '@/lib/api';
import type { HabitFrequencyType, HabitWithToday } from '@/types';

// ---------------------------------------------------------------------------
// Constants driving the picker UI.
// ---------------------------------------------------------------------------

/** Curated palette — every swatch stays muted enough to live on white. */
const COLOR_OPTIONS = [
  '#2FAF9E', // teal-500 (default)
  '#5B8DEF', // sky
  '#F59E0B', // amber
  '#E26D8A', // rose
  '#8B5CF6', // violet
  '#1D9A75', // emerald
] as const;

/** 12 options. The first one doubles as the default. */
const ICON_OPTIONS = [
  '✓', '💧', '📚', '🏃', '🧘', '☕', '🍎', '✍️', '🎨', '🎵', '🌙', '🌞',
] as const;

const FREQUENCY_OPTIONS: { value: HabitFrequencyType; label: string }[] = [
  { value: 'daily', label: '每天' },
  { value: 'weekdays', label: '工作日' },
  { value: 'custom', label: '自定义' },
  { value: 'every_n_days', label: '每 N 天' },
];

interface FormState {
  name: string;
  color: string;
  icon: string;
  frequencyType: HabitFrequencyType;
  frequencyDays: number;
  targetCount: number;
}

const EMPTY_FORM: FormState = {
  name: '',
  color: '#2FAF9E',
  icon: '✓',
  frequencyType: 'daily',
  frequencyDays: 1,
  targetCount: 1,
};

function formFromHabit(habit: HabitWithToday): FormState {
  return {
    name: habit.name,
    color: habit.color,
    icon: habit.icon,
    frequencyType: habit.frequencyType,
    frequencyDays: habit.frequencyDays,
    targetCount: habit.targetCount,
  };
}

/** Strip empty fields so PATCH sends only what the user actually touched. */
function patchPayload(form: FormState, original: HabitWithToday): Partial<FormState> {
  const out: Partial<FormState> = {};
  if (form.name.trim() !== original.name) out.name = form.name.trim();
  if (form.color !== original.color) out.color = form.color;
  if (form.icon !== original.icon) out.icon = form.icon;
  if (form.frequencyType !== original.frequencyType) out.frequencyType = form.frequencyType;
  if (form.frequencyDays !== original.frequencyDays) out.frequencyDays = form.frequencyDays;
  if (form.targetCount !== original.targetCount) out.targetCount = form.targetCount;
  return out;
}

// ---------------------------------------------------------------------------

export default function ManageHabitsPage() {
  const [habits, setHabits] = useState<HabitWithToday[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // New-habit form (the create form is always visible at the top).
  const [draft, setDraft] = useState<FormState>(EMPTY_FORM);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Edit state - one habit at a time, identified by id.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<FormState>(EMPTY_FORM);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Archive confirm.
  const [pendingArchive, setPendingArchive] = useState<HabitWithToday | null>(null);
  const [archiving, setArchiving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await api.get<HabitWithToday[]>('/habits');
      setHabits(list);
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const createDisabled = useMemo(
    () => draft.name.trim().length === 0 || creating,
    [draft, creating],
  );

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (createDisabled) return;
    setCreateError(null);
    setCreating(true);
    const body = {
      name: draft.name.trim(),
      color: draft.color,
      icon: draft.icon,
      frequencyType: draft.frequencyType,
      // Backend defaults these to 1 if omitted, but we always send so the
      // form state matches the request payload exactly (helps debugging).
      frequencyDays: draft.frequencyType === 'every_n_days' ? Math.max(1, draft.frequencyDays) : 1,
      targetCount: Math.max(1, draft.targetCount),
    };
    try {
      const created = await api.post<HabitWithToday>('/habits', body);
      setHabits((prev) => [created, ...prev]);
      setDraft(EMPTY_FORM);
    } catch (err) {
      setCreateError(toErrorMessage(err));
    } finally {
      setCreating(false);
    }
  }

  function startEdit(habit: HabitWithToday) {
    setEditingId(habit.id);
    setEditDraft(formFromHabit(habit));
    setEditError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditError(null);
    setEditDraft(EMPTY_FORM);
  }

  async function saveEdit(habit: HabitWithToday) {
    setSavingEdit(true);
    setEditError(null);
    const patch = patchPayload(editDraft, habit);
    if (Object.keys(patch).length === 0) {
      // Nothing changed - close the editor without a network call.
      cancelEdit();
      setSavingEdit(false);
      return;
    }
    try {
      const updated = await api.patch<HabitWithToday>(`/habits/${habit.id}`, patch);
      setHabits((prev) => prev.map((h) => (h.id === habit.id ? updated : h)));
      cancelEdit();
    } catch (err) {
      setEditError(toErrorMessage(err));
    } finally {
      setSavingEdit(false);
    }
  }

  async function confirmArchive() {
    if (!pendingArchive) return;
    setArchiving(true);
    try {
      await api.del<{ message: string }>(`/habits/${pendingArchive.id}`);
      // Backend filters archived out of GET /habits, so the row silently
      // disappears from the list once we drop it client-side too.
      setHabits((prev) => prev.filter((h) => h.id !== pendingArchive.id));
      if (editingId === pendingArchive.id) cancelEdit();
      setPendingArchive(null);
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setArchiving(false);
    }
  }

  return (
    <div>
      {/* ---------------------------------------------------------- header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-ink">
            习惯管理
          </h1>
          <p className="mt-1.5 text-[13px] text-ink-muted">
            新建、调整或归档你的习惯。
          </p>
        </div>
        <Link
          href="/habits"
          className="rounded text-[13px] font-medium text-teal-600 transition-colors hover:text-teal-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
        >
          ← 返回今日
        </Link>
      </div>

      {/* ------------------------------------ create form (inline, always-on) */}
      <section className="mt-9 rounded-lg border border-line p-5">
        <h2 className="text-[14px] font-medium tracking-tight text-ink">
          添加新习惯
        </h2>

        <form onSubmit={handleCreate} noValidate className="mt-4 space-y-5">
          <TextField
            label="名称"
            name="name"
            placeholder="例如：早起、阅读、补水"
            value={draft.name}
            maxLength={64}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            hint={`${draft.name.length}/64`}
          />

          {/* ----- color swatches ----- */}
          <div>
            <p className="block text-[13px] font-medium tracking-tight text-ink-soft">
              颜色
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {COLOR_OPTIONS.map((hex) => {
                const active = draft.color === hex;
                return (
                  <button
                    key={hex}
                    type="button"
                    onClick={() => setDraft({ ...draft, color: hex })}
                    aria-label={`颜色 ${hex}`}
                    aria-pressed={active}
                    className={[
                      'h-7 w-7 rounded-full transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40',
                      active ? 'ring-2 ring-offset-2 ring-teal-500' : 'ring-0',
                    ].join(' ')}
                    style={{ backgroundColor: hex }}
                  />
                );
              })}
            </div>
          </div>

          {/* ----- icon picker ----- */}
          <div>
            <p className="block text-[13px] font-medium tracking-tight text-ink-soft">
              图标
            </p>
            <div className="mt-2 grid grid-cols-12 gap-1.5">
              {ICON_OPTIONS.map((emoji) => {
                const active = draft.icon === emoji;
                return (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => setDraft({ ...draft, icon: emoji })}
                    aria-pressed={active}
                    aria-label={`图标 ${emoji}`}
                    className={[
                      'flex aspect-square items-center justify-center rounded-md border text-[16px] transition-colors',
                      active
                        ? 'border-teal-500 bg-teal-50'
                        : 'border-line bg-white hover:border-teal-300',
                    ].join(' ')}
                  >
                    {emoji}
                  </button>
                );
              })}
            </div>
          </div>

          {/* ----- frequency tabs ----- */}
          <div>
            <p className="block text-[13px] font-medium tracking-tight text-ink-soft">
              频率
            </p>
            <div className="mt-2 grid grid-cols-4 gap-2">
              {FREQUENCY_OPTIONS.map((opt) => {
                const active = draft.frequencyType === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setDraft({ ...draft, frequencyType: opt.value })}
                    aria-pressed={active}
                    className={[
                      'rounded-md border px-2 py-2 text-[13px] transition-colors',
                      active
                        ? 'border-teal-500 bg-teal-50 text-teal-700'
                        : 'border-line bg-white text-ink-soft hover:border-teal-300 hover:text-ink',
                    ].join(' ')}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
            {draft.frequencyType === 'every_n_days' ? (
              <div className="mt-3 max-w-[160px]">
                <label
                  htmlFor="frequency-days"
                  className="block text-[12px] text-ink-muted"
                >
                  每多少天
                </label>
                <input
                  id="frequency-days"
                  type="number"
                  min={1}
                  max={365}
                  value={Number.isFinite(draft.frequencyDays) ? draft.frequencyDays : ''}
                  onChange={(event) => {
                    const next = Number.parseInt(event.target.value, 10);
                    setDraft({
                      ...draft,
                      frequencyDays: Number.isFinite(next) && next >= 1 ? next : 1,
                    });
                  }}
                  className="mt-1 w-full border-0 border-b border-line bg-transparent px-0 py-1.5 text-[15px] text-ink outline-none transition-colors focus:border-teal-500"
                />
              </div>
            ) : null}
          </div>

          {/* ----- target count ----- */}
          <div className="max-w-[160px]">
            <label
              htmlFor="target-count"
              className="block text-[13px] font-medium tracking-tight text-ink-soft"
            >
              每次目标次数
            </label>
            <input
              id="target-count"
              type="number"
              min={1}
              max={100}
              value={Number.isFinite(draft.targetCount) ? draft.targetCount : ''}
              onChange={(event) => {
                const next = Number.parseInt(event.target.value, 10);
                setDraft({
                  ...draft,
                  targetCount: Number.isFinite(next) && next >= 1 ? next : 1,
                });
              }}
              className="mt-1.5 w-full border-0 border-b border-line bg-transparent px-0 py-1.5 text-[15px] text-ink outline-none transition-colors focus:border-teal-500"
            />
            <p className="mt-1 text-[12px] text-ink-muted">
              例如：喝水 8 次、深呼吸 3 次、阅读 1 次。
            </p>
          </div>

          {createError ? (
            <p
              role="alert"
              className="rounded-md border border-red-100 bg-red-50 px-3 py-2 text-[13px] leading-5 text-red-600"
            >
              {createError}
            </p>
          ) : null}

          <div className="flex items-center gap-3">
            <Button type="submit" loading={creating} disabled={createDisabled}>
              创建习惯
            </Button>
            <button
              type="button"
              onClick={() => setDraft(EMPTY_FORM)}
              disabled={creating}
              className="text-[13px] text-ink-muted transition-colors hover:text-ink disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
            >
              清空
            </button>
          </div>
        </form>
      </section>

      {/* ------------------------------ list of existing habits */}
      <section className="mt-12">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[14px] font-medium tracking-tight text-ink">
            已有习惯
          </h2>
          <span className="text-[12px] text-ink-muted">
            {loading ? '加载中…' : `${habits.length} 个`}
          </span>
        </div>

        {error ? (
          <p
            role="alert"
            className="mt-4 rounded-md border border-red-100 bg-red-50 px-3 py-2 text-[13px] leading-5 text-red-600"
          >
            {error}
          </p>
        ) : null}

        {loading ? (
          <div className="mt-4 space-y-3" aria-busy>
            {[0, 1].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded-md bg-line" />
            ))}
          </div>
        ) : habits.length === 0 ? (
          <p className="mt-4 text-[14px] leading-6 text-ink-muted">
            还没有习惯 — 在上面的表单里添加一个吧。
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-line">
            {habits.map((habit) => (
              <HabitRow
                key={habit.id}
                habit={habit}
                isEditing={editingId === habit.id}
                editDraft={editDraft}
                savingEdit={savingEdit}
                editError={editError}
                onStartEdit={() => startEdit(habit)}
                onCancelEdit={cancelEdit}
                onSaveEdit={() => void saveEdit(habit)}
                onEditDraftChange={setEditDraft}
                onArchive={() => setPendingArchive(habit)}
              />
            ))}
          </ul>
        )}

        <p className="mt-6 text-[12px] leading-5 text-ink-muted">
          注：归档后，该习惯将从今日页面移除。已归档的习惯暂未提供集中列表入口 —
          如需恢复请通过 API（<code className="rounded bg-line px-1">PATCH /habits/:id</code>
          {' '}并设置 <code className="rounded bg-line px-1">archivedAt: null</code>）。
        </p>
      </section>

      {/* ----------------------- archive-confirm dialog */}
      {pendingArchive ? (
        <ConfirmDialog
          title="归档这个习惯？"
          body={`「${pendingArchive.name}」的今日打卡不再出现，历史记录会保留。`}
          confirmLabel={archiving ? '归档中…' : '归档'}
          disabled={archiving}
          onCancel={() => !archiving && setPendingArchive(null)}
          onConfirm={() => void confirmArchive()}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------

interface HabitRowProps {
  habit: HabitWithToday;
  isEditing: boolean;
  editDraft: FormState;
  savingEdit: boolean;
  editError: string | null;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onEditDraftChange: (next: FormState) => void;
  onArchive: () => void;
}

function HabitRow({
  habit,
  isEditing,
  editDraft,
  savingEdit,
  editError,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onEditDraftChange,
  onArchive,
}: HabitRowProps) {
  return (
    <li className="py-4">
      <div className="flex items-center gap-3">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-[18px] leading-none"
          style={{ backgroundColor: habit.color + '22' }}
          aria-hidden
        >
          {habit.icon || '✓'}
        </span>
        <div className="flex-1 truncate">
          <div className="truncate text-[15px] tracking-tight text-ink">
            {habit.name}
          </div>
          <div className="mt-0.5 text-[12px] text-ink-muted">
            {habit.frequencyType === 'every_n_days'
              ? `每 ${habit.frequencyDays} 天 · 目标 ${habit.targetCount} 次/天`
              : habit.frequencyType === 'weekdays'
                ? `工作日 · 目标 ${habit.targetCount} 次/天`
                : `每天 · 目标 ${habit.targetCount} 次/天`}
          </div>
        </div>

        {!isEditing ? (
          <div className="flex items-center gap-3">
            <Link
              href={`/habits/${habit.id}/stats`}
              className="text-[13px] text-ink-muted transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
            >
              统计
            </Link>
            <button
              type="button"
              onClick={onStartEdit}
              className="text-[13px] text-teal-600 transition-colors hover:text-teal-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
            >
              编辑
            </button>
            <button
              type="button"
              onClick={onArchive}
              className="text-[13px] text-ink-muted transition-colors hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
            >
              归档
            </button>
          </div>
        ) : null}
      </div>

      {isEditing ? (
        <div className="mt-4 rounded-md border border-line bg-white p-4">
          <EditForm
            draft={editDraft}
            onChange={onEditDraftChange}
            saving={savingEdit}
            error={editError}
            onCancel={onCancelEdit}
            onSubmit={onSaveEdit}
          />
        </div>
      ) : null}
    </li>
  );
}

interface EditFormProps {
  draft: FormState;
  onChange: (next: FormState) => void;
  saving: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: () => void;
}

function EditForm({ draft, onChange, saving, error, onCancel, onSubmit }: EditFormProps) {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
      noValidate
      className="space-y-4"
    >
      <TextField
        label="名称"
        name="edit-name"
        value={draft.name}
        maxLength={64}
        onChange={(event) => onChange({ ...draft, name: event.target.value })}
      />

      <div>
        <p className="block text-[13px] font-medium tracking-tight text-ink-soft">颜色</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {COLOR_OPTIONS.map((hex) => {
            const active = draft.color === hex;
            return (
              <button
                key={hex}
                type="button"
                onClick={() => onChange({ ...draft, color: hex })}
                aria-pressed={active}
                aria-label={`颜色 ${hex}`}
                className={[
                  'h-6 w-6 rounded-full transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40',
                  active ? 'ring-2 ring-offset-2 ring-teal-500' : '',
                ].join(' ')}
                style={{ backgroundColor: hex }}
              />
            );
          })}
        </div>
      </div>

      <div>
        <p className="block text-[13px] font-medium tracking-tight text-ink-soft">图标</p>
        <div className="mt-2 grid grid-cols-12 gap-1.5">
          {ICON_OPTIONS.map((emoji) => {
            const active = draft.icon === emoji;
            return (
              <button
                key={emoji}
                type="button"
                onClick={() => onChange({ ...draft, icon: emoji })}
                aria-pressed={active}
                aria-label={`图标 ${emoji}`}
                className={[
                  'flex aspect-square items-center justify-center rounded-md border text-[14px]',
                  active
                    ? 'border-teal-500 bg-teal-50'
                    : 'border-line bg-white hover:border-teal-300',
                ].join(' ')}
              >
                {emoji}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <p className="block text-[13px] font-medium tracking-tight text-ink-soft">频率</p>
        <div className="mt-2 grid grid-cols-4 gap-2">
          {FREQUENCY_OPTIONS.map((opt) => {
            const active = draft.frequencyType === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => onChange({ ...draft, frequencyType: opt.value })}
                aria-pressed={active}
                className={[
                  'rounded-md border px-2 py-1.5 text-[12px]',
                  active
                    ? 'border-teal-500 bg-teal-50 text-teal-700'
                    : 'border-line bg-white text-ink-soft hover:border-teal-300 hover:text-ink',
                ].join(' ')}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
        {draft.frequencyType === 'every_n_days' ? (
          <div className="mt-2 max-w-[140px]">
            <label htmlFor="edit-frequency-days" className="block text-[12px] text-ink-muted">
              每多少天
            </label>
            <input
              id="edit-frequency-days"
              type="number"
              min={1}
              max={365}
              value={Number.isFinite(draft.frequencyDays) ? draft.frequencyDays : ''}
              onChange={(event) => {
                const next = Number.parseInt(event.target.value, 10);
                onChange({
                  ...draft,
                  frequencyDays: Number.isFinite(next) && next >= 1 ? next : 1,
                });
              }}
              className="mt-1 w-full border-0 border-b border-line bg-transparent px-0 py-1.5 text-[15px] text-ink outline-none transition-colors focus:border-teal-500"
            />
          </div>
        ) : null}
      </div>

      <div className="max-w-[140px]">
        <label htmlFor="edit-target-count" className="block text-[13px] font-medium tracking-tight text-ink-soft">
          每次目标次数
        </label>
        <input
          id="edit-target-count"
          type="number"
          min={1}
          max={100}
          value={Number.isFinite(draft.targetCount) ? draft.targetCount : ''}
          onChange={(event) => {
            const next = Number.parseInt(event.target.value, 10);
            onChange({
              ...draft,
              targetCount: Number.isFinite(next) && next >= 1 ? next : 1,
            });
          }}
          className="mt-1 w-full border-0 border-b border-line bg-transparent px-0 py-1.5 text-[15px] text-ink outline-none transition-colors focus:border-teal-500"
        />
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-md border border-red-100 bg-red-50 px-3 py-2 text-[13px] leading-5 text-red-600"
        >
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <Button type="submit" loading={saving}>
          保存修改
        </Button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="text-[13px] text-ink-muted transition-colors hover:text-ink disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
        >
          取消
        </button>
      </div>
    </form>
  );
}

interface ConfirmDialogProps {
  title: string;
  body: string;
  confirmLabel: string;
  disabled: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Lightweight modal built on a translucent overlay. Lighter than a real
 * dialog library and consistent with the rest of the white-and-teal palette.
 */
function ConfirmDialog({
  title,
  body,
  confirmLabel,
  disabled,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
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
        <h3 id="confirm-title" className="text-[16px] font-semibold tracking-tight text-ink">
          {title}
        </h3>
        <p className="mt-2 text-[13px] leading-5 text-ink-muted">{body}</p>
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
