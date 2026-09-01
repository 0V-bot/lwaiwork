'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';

import { Button } from '@/components/Button';
import { TextField } from '@/components/TextField';
import { ColorPicker } from '@/components/ColorPicker';
import { TagChipEditor } from '@/components/TagChipEditor';
import { api, toErrorMessage } from '@/lib/api';
import {
  NOTE_COLOR_OPTIONS,
  NOTE_CONTENT_MAX_BYTES,
  NOTE_TAGS_MAX,
  NOTE_TAG_MAX_LEN,
  NOTE_TITLE_MAX_LEN,
  type NoteDetail,
  type UpdateNotePayload,
} from '@/types';

// ---------------------------------------------------------------------------
// utf-8 byte size for the content textarea (same as /notes/new).
// ---------------------------------------------------------------------------
const utf8 = new TextEncoder();
function utf8Bytes(value: string): number {
  return utf8.encode(value).length;
}

interface FormState {
  title: string;
  content: string;
  tags: string[];
  color: string;
}

function formFromNote(note: NoteDetail): FormState {
  return {
    title: note.title,
    content: note.content,
    tags: [...note.tags],
    color: note.color || NOTE_COLOR_OPTIONS[0],
  };
}

/** Build a PATCH payload that only carries fields the user actually changed.
 *  Mirrors the strip-empty patch pattern used by /habits/manage. */
function patchPayload(
  next: FormState,
  original: NoteDetail,
): UpdateNotePayload {
  const out: UpdateNotePayload = {};
  const trimmedTitle = next.title.trim();
  if (trimmedTitle !== original.title) out.title = trimmedTitle;
  if (next.content !== original.content) out.content = next.content;
  // Order-insensitive tag comparison: two arrays with the same set in any
  // order should NOT trigger a write.
  const sameTags =
    next.tags.length === original.tags.length &&
    next.tags.every((t, i) => t === original.tags[i]);
  if (!sameTags) out.tags = next.tags;
  if (next.color !== original.color) out.color = next.color;
  return out;
}

export default function NoteDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
  const router = useRouter();

  const [note, setNote] = useState<NoteDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [draft, setDraft] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setLoadError(null);
    setNotFound(false);
    try {
      const data = await api.get<NoteDetail>(`/notes/${id}`);
      setNote(data);
    } catch (err) {
      const message = toErrorMessage(err);
      // Status 404 from NotesService.findOne maps to NotFoundException.
      const isNotFound = (err as { status?: number }).status === 404;
      if (isNotFound) {
        setNotFound(true);
      } else {
        setLoadError(message);
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // ------------------------------------------------- edit-mode guards
  const contentBytes = useMemo(
    () => (draft ? utf8Bytes(draft.content) : 0),
    [draft],
  );
  const contentOverCap =
    draft != null && contentBytes > NOTE_CONTENT_MAX_BYTES;
  const titleTooLong =
    draft != null && draft.title.length > NOTE_TITLE_MAX_LEN;
  const tagsTooMany = draft != null && draft.tags.length > NOTE_TAGS_MAX;
  const tagsTooLong =
    draft != null && draft.tags.some((t) => t.length > NOTE_TAG_MAX_LEN);

  const canSave = useMemo(() => {
    if (!draft || !note || saving) return false;
    if (contentOverCap || titleTooLong || tagsTooMany || tagsTooLong) return false;
    if (draft.title.trim().length === 0 || draft.content.trim().length === 0) {
      return false;
    }
    return Object.keys(patchPayload(draft, note)).length > 0;
  }, [
    contentOverCap,
    draft,
    note,
    saving,
    tagsTooLong,
    tagsTooMany,
    titleTooLong,
  ]);

  // ------------------------------------------------- handlers
  function startEdit() {
    if (!note) return;
    setDraft(formFromNote(note));
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
    if (!draft || !note || !canSave) return;
    setSaving(true);
    setSaveError(null);
    const patch = patchPayload(draft, note);
    try {
      const updated = await api.patch<NoteDetail>(`/notes/${note.id}`, patch);
      setNote(updated);
      setMode('view');
      setDraft(null);
    } catch (err) {
      setSaveError(toErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  function handleDeleteClick() {
    setConfirmDelete(true);
    setDeleteError(null);
  }

  async function confirmDeleteNow() {
    if (!note) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.del<{ message: string }>(`/notes/${note.id}`);
      // Soft-archive: the backend filters archived rows out of the default
      // list, so the list will not show this id any more.
      router.replace('/notes');
    } catch (err) {
      setDeleteError(toErrorMessage(err));
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  // ------------------------------------------------- render branches
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
          笔记不存在
        </h1>
        <p className="mt-2 text-[13px] text-ink-muted">
          这条笔记可能已被归档，或链接已失效。
        </p>
        <Link
          href="/notes"
          className="mt-6 inline-flex h-11 items-center justify-center rounded-md bg-teal-500 px-6 text-[15px] font-medium text-white transition-colors hover:bg-teal-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
        >
          返回笔记列表
        </Link>
      </div>
    );
  }

  if (loadError) {
    return (
      <div>
        <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-ink">
          笔记
        </h1>
        <p
          role="alert"
          className="mt-6 rounded-md border border-red-100 bg-red-50 px-3 py-2 text-[13px] leading-5 text-red-600"
        >
          {loadError}
        </p>
        <Link
          href="/notes"
          className="mt-6 inline-block text-[13px] font-medium text-teal-600 hover:text-teal-700"
        >
          ← 返回笔记列表
        </Link>
      </div>
    );
  }

  if (!note) return null;

  return (
    <div>
      {/* ----------------------------------------------------- header */}
      <div className="flex items-center justify-between">
        <Link
          href="/notes"
          className="rounded text-[13px] font-medium text-teal-600 transition-colors hover:text-teal-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
        >
          ← 返回笔记
        </Link>
        {mode === 'view' ? (
          <div className="flex items-center gap-4 text-[13px]">
            <button
              type="button"
              onClick={startEdit}
              className="text-teal-600 transition-colors hover:text-teal-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
            >
              编辑
            </button>
            <button
              type="button"
              onClick={handleDeleteClick}
              className="text-ink-muted transition-colors hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
            >
              归档
            </button>
          </div>
        ) : null}
      </div>

      {/* ------------------------------------------------------ view */}
      {mode === 'view' ? (
        <article
          className="relative mt-7 overflow-hidden rounded-lg border border-line bg-white"
          aria-label={`笔记 ${note.title}`}
        >
          <span
            aria-hidden
            className="absolute inset-y-0 left-0 w-1.5"
            style={{ backgroundColor: note.color }}
          />
          <div className="px-6 py-7 pl-7">
            <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-ink">
              {note.title || '（无标题）'}
            </h1>
            <p className="mt-2 text-[12px] text-ink-muted">
              创建于 {formatDate(note.createdAt)} · 更新于{' '}
              {formatDate(note.updatedAt)}
              {note.archivedAt
                ? ` · 已归档于 ${formatDate(note.archivedAt)}`
                : ''}
            </p>

            {note.tags.length > 0 ? (
              <div className="mt-4 flex flex-wrap items-center gap-1.5">
                {note.tags.map((tag) => (
                  <Link
                    key={tag}
                    href={`/notes?tag=${encodeURIComponent(tag)}`}
                    className="inline-flex items-center rounded-full bg-line px-2 py-0.5 text-[12px] text-ink-soft transition-colors hover:bg-teal-50 hover:text-teal-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
                  >
                    #{tag}
                  </Link>
                ))}
              </div>
            ) : null}

            <div className="mt-6 whitespace-pre-wrap break-words text-[15px] leading-7 text-ink">
              {note.content || (
                <span className="italic text-ink-muted">（空白笔记）</span>
              )}
            </div>
          </div>
        </article>
      ) : null}

      {/* ------------------------------------------------------ edit */}
      {mode === 'edit' && draft ? (
        <form
          onSubmit={handleSave}
          noValidate
          className="mt-7 space-y-6 rounded-lg border border-line bg-white p-5"
          aria-busy={saving || undefined}
        >
          <TextField
            label="标题"
            name="note-edit-title"
            value={draft.title}
            maxLength={NOTE_TITLE_MAX_LEN}
            onChange={(event) =>
              setDraft({ ...draft, title: event.target.value })
            }
            error={
              draft.title.trim().length === 0
                ? '标题不能为空'
                : titleTooLong
                  ? `最多 ${NOTE_TITLE_MAX_LEN} 字`
                  : null
            }
            hint={`${draft.title.length}/${NOTE_TITLE_MAX_LEN}`}
          />

          <div>
            <label
              htmlFor="note-edit-content"
              className="block text-[13px] font-medium tracking-tight text-ink-soft"
            >
              正文
            </label>
            <textarea
              id="note-edit-content"
              value={draft.content}
              onChange={(event) =>
                setDraft({ ...draft, content: event.target.value })
              }
              rows={8}
              spellCheck={false}
              className={[
                'mt-1.5 block w-full resize-y rounded-md border bg-white px-3 py-2.5',
                'text-[15px] leading-6 text-ink outline-none transition-colors',
                'placeholder:text-ink-muted/50',
                contentOverCap
                  ? 'border-red-400 focus:border-red-500'
                  : 'border-line focus:border-teal-500',
              ].join(' ')}
            />
            <p
              className={[
                'mt-1.5 text-[12px] leading-4',
                contentOverCap ? 'text-red-600' : 'text-ink-muted',
              ].join(' ')}
            >
              {contentOverCap
                ? `内容超出 ${NOTE_CONTENT_MAX_BYTES} 字节（当前 ${contentBytes}）`
                : `${contentBytes} / ${NOTE_CONTENT_MAX_BYTES} 字节（UTF-8）`}
            </p>
          </div>

          <TagChipEditor
            tags={draft.tags}
            onChange={(next) => setDraft({ ...draft, tags: next })}
            max={NOTE_TAGS_MAX}
            maxLength={NOTE_TAG_MAX_LEN}
            hint={
              tagsTooMany
                ? `最多 ${NOTE_TAGS_MAX} 个`
                : tagsTooLong
                  ? `单个标签最多 ${NOTE_TAG_MAX_LEN} 字`
                  : undefined
            }
          />

          <ColorPicker
            value={draft.color}
            onChange={(next) => setDraft({ ...draft, color: next })}
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

      {/* ------------------------------------------- delete-confirm dialog */}
      {confirmDelete ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-title"
          className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 px-4 py-6 sm:items-center"
          onClick={() => !deleting && setConfirmDelete(false)}
        >
          <div
            className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h3
              id="delete-title"
              className="text-[16px] font-semibold tracking-tight text-ink"
            >
              归档这条笔记？
            </h3>
            <p className="mt-2 text-[13px] leading-5 text-ink-muted">
              「{note.title}」将从主列表移除。如需恢复，可通过 API
              把 archivedAt 重新置空。
            </p>
            {deleteError ? (
              <p
                role="alert"
                className="mt-3 rounded-md border border-red-100 bg-red-50 px-3 py-2 text-[13px] leading-5 text-red-600"
              >
                {deleteError}
              </p>
            ) : null}
            <div className="mt-5 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => !deleting && setConfirmDelete(false)}
                disabled={deleting}
                className="rounded text-[13px] text-ink-muted transition-colors hover:text-ink disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
              >
                取消
              </button>
              <Button onClick={confirmDeleteNow} loading={deleting}>
                归档
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------

/** "YYYY-MM-DD HH:mm" - local-time formatter for detail / edit meta lines. */
function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}
