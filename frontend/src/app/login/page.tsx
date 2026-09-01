'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { AuthShell } from '@/components/AuthShell';
import { Button } from '@/components/Button';
import { TextField } from '@/components/TextField';
import { useAuth } from '@/contexts/AuthContext';
import { toErrorMessage } from '@/lib/api';

export default function LoginPage() {
  const { login, user, loading } = useAuth();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Already signed in (e.g. arriving via a stale tab) - skip the form.
  useEffect(() => {
    if (!loading && user) router.replace('/todos');
  }, [loading, user, router]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    setFormError(null);

    if (!email.trim()) {
      setFormError('请输入邮箱');
      return;
    }
    if (!password) {
      setFormError('请输入密码');
      return;
    }

    setSubmitting(true);
    try {
      await login(email, password);
      router.replace('/todos');
    } catch (error) {
      // A 401 from the backend is deliberately generic ("Invalid email or
      // password") and class-validator may also return an array of rules, which
      // toErrorMessage already flattens into one line.
      const message = toErrorMessage(error);
      setFormError(message === 'Unauthorized' ? '邮箱或密码不正确' : message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell
      title="欢迎回来"
      subtitle="登录后继续管理你的待办。"
      footer={
        <>
          还没有账号？{' '}
          <Link href="/register" className="font-medium text-teal-600 hover:text-teal-700">
            创建账号
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-6">
        <TextField
          label="邮箱"
          name="email"
          type="email"
          autoComplete="email"
          autoFocus
          placeholder="you@example.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />

        <TextField
          label="密码"
          name="password"
          type="password"
          autoComplete="current-password"
          placeholder="••••••••"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
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
          登录
        </Button>
      </form>
    </AuthShell>
  );
}
