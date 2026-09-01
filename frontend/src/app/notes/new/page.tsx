'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

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
  type CreateNotePayload,
  type NoteDetail,
} from '@/types';

// ---------------------------------------------------------------------------
// utf-8 byte size for the content textarea.
// `Buffer` is Node-only; in the browser we use TextEncoder (built-in) which
// matches what the NestJS backend uses internally (`Buffer.byteLength(...,'utf8')`).
// ---------------------------------------------------------------------------
const utf8 = new TextEncoder();
function utf8Bytes(value: string): number {
  return utf8.encode(value).length;
}

// ---------------------------------------------------------------------------

interface FormState {
  title: string;
  content: string;
  tags: string[];
  color: string;
}

const EMPTY_FORM: FormState = {
  title: '',
  content: '',
  tags: [],
  color: NOTE_COLOR_OPTIONS[0],
};

export default function NewNotePage() {
  const router = useRouter();

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const contentBytes = useMemo(() => utf8Bytes(form.content), [form.content]);
  /** Backend clamps at 50 KiB; surface the limit before the user hits submit. */
  const contentOverCap = contentBytes > NOTE_CONTENT_MAX_BYTES;
  const titleTooLong = form.title.length > NOTE_TITLE_MAX_LEN;
  const tagsTooMany = form.tags.length > NOTE_TAGS_MAX;
  const tagsTooLong = form.tags.some((t) => t.length > NOTE_TAG_MAX_LEN);
  const canSubmit =
    !submitting &&
    !contentOverCap &&
    !titleTooLong &&
    !tagsTooMany &&
    !tagsTooLong &&
    form.title.trim().length > 0 &&
    form.content.trim().length > 0;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setSubmitting(true);

    const body: CreateNotePayload = {
      title: form.title.trim(),
      content: form.content,
      tags: form.tags,
      color: form.color,
    };

    try {
      const created = await api.post<NoteDetail>('/notes', body);
      // Hop straight into the detail view; the create response carries the
      // decrypted title + content so we don't pay a follow-up GET.
      router.push(`/notes/${created.id}`);
    } catch (err) {
      setError(toErrorMessage(err));
      setSubmitting(false);
    }
  }

  function handleCancel() {
    router.push('/notes');
  }

  return (
    <div>
      {/* ------------------------------------------------------- header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-ink">
            新建笔记
          </h1>
          <p className="mt-1.5 text-[13px] text-ink-muted">
            标题与正文加密保存，列表页只展示前 200 字摘要。
          </p>
        </div>
        <Link
          href="/notes"
          className="rounded text-[13px] font-medium text-teal-600 transition-colors hover:text-teal-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
        >
          取消
        </Link>
      </div>

      {/* ------------------------------------------------------------ form */}
      <form
        onSubmit={handleSubmit}
        noValidate
        className="mt-9 space-y-6"
        aria-busy={submitting || undefined}
      >
        <TextField
          label="标题"
          name="note-title"
          placeholder="例如：工程周会要点"
          value={form.title}
          maxLength={NOTE_TITLE_MAX_LEN}
          onChange={(event) =>
            setForm({ ...form, title: event.target.value })
          }
          error={form.title.length === 0 ? null : titleTooLong ? `最多 ${NOTE_TITLE_MAX_LEN} 字` : null}
          hint={`${form.title.length}/${NOTE_TITLE_MAX_LEN}`}
        />

        <div>
          <label
            htmlFor="note-content"
            className="block text-[13px] font-medium tracking-tight text-ink-soft"
          >
            正文
          </label>
          <textarea
            id="note-content"
            name="note-content"
            value={form.content}
            onChange={(event) =>
              setForm({ ...form, content: event.target.value })
            }
            rows={8}
            placeholder="写下你的想法…支持 Markdown 风格的换行与空格。"
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
          tags={form.tags}
          onChange={(next) => setForm({ ...form, tags: next })}
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
          value={form.color}
          onChange={(next) => setForm({ ...form, color: next })}
          hint="用作笔记左侧的色条，便于快速辨认。"
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
            保存笔记
          </Button>
          <button
            type="button"
            onClick={handleCancel}
            disabled={submitting}
            className="rounded text-[13px] text-ink-muted transition-colors hover:text-ink disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
          >
            放弃
          </button>
        </div>
      </form>
    </div>
  );
}
