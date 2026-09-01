'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { AuthShell } from '@/components/AuthShell';
import { Button } from '@/components/Button';
import { TextField } from '@/components/TextField';
import { useAuth } from '@/contexts/AuthContext';
import { toErrorMessage } from '@/lib/api';

/**
 * These mirror backend/src/auth/dto/register.dto.ts so the user sees the real
 * rule instead of discovering it after a 400 round-trip:
 *   email    3-320 chars, valid email
 *   password 8-128 chars, at least one letter AND one digit
 *   name     1-120 chars
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validate(name: string, email: string, password: string, confirm: string): string | null {
  if (!name.trim()) return '请输入昵称';
  if (name.trim().length > 120) return '昵称不能超过 120 个字符';

  if (!email.trim()) return '请输入邮箱';
  if (!EMAIL_RE.test(email.trim())) return '邮箱格式不正确';

  if (password.length < 8) return '密码至少 8 位';
  if (password.length > 128) return '密码不能超过 128 位';
  if (!/[A-Za-z]/.test(password)) return '密码需包含至少一个字母';
  if (!/\d/.test(password)) return '密码需包含至少一个数字';

  if (password !== confirm) return '两次输入的密码不一致';

  return null;
}

export default function RegisterPage() {
  const { register, user, loading } = useAuth();
  const router = useRouter();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && user) router.replace('/todos');
  }, [loading, user, router]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    // Client-side check first - cheap, and covers the rules the backend DTO
    // also enforces (defence in depth; the server stays the source of truth).
    const validationError = validate(name, email, password, confirm);
    if (validationError) {
      setFormError(validationError);
      return;
    }

    setFormError(null);
    setSubmitting(true);
    try {
      await register(name, email, password);
      router.replace('/todos');
    } catch (error) {
      const message = toErrorMessage(error);
      setFormError(message === 'Unauthorized' ? '注册失败，请稍后重试' : message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell
      title="创建账号"
      subtitle="一个邮箱即可开始，几秒钟完成。"
      footer={
        <>
          已经有账号了？{' '}
          <Link href="/login" className="font-medium text-teal-600 hover:text-teal-700">
            去登录
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-6">
        <TextField
          label="昵称"
          name="name"
          autoComplete="nickname"
          autoFocus
          placeholder="你的名字"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />

        <TextField
          label="邮箱"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />

        <TextField
          label="密码"
          name="password"
          type="password"
          autoComplete="new-password"
          placeholder="至少 8 位，含字母和数字"
          hint="至少 8 位，需同时包含字母和数字"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />

        <TextField
          label="确认密码"
          name="confirm"
          type="password"
          autoComplete="new-password"
          placeholder="再输入一次"
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
        />

        {formError ? (
          <p
            role="alert"
            className="rounded-md border border-red-100 bg-red-50 px-3 py-2 text-[13px] leading-5 text-red-600"
          >
            {formError}
          </p>
        ) : null}

        <Button loading={submitting} className="w-full">
          注册
        </Button>
      </form>
    </AuthShell>
  );
}
