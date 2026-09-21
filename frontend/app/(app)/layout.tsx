'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import TaskBar from '@/components/TaskBar';
import BackendStatusBanner from '@/components/BackendStatusBanner';
import { useAuth } from '@/lib/auth';

export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!loading) {
      if (!user) {
        router.replace('/login');
      } else {
        setChecked(true);
      }
    }
  }, [loading, user, router]);

  const isLoading = loading || !checked;

  if (isLoading) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#f5f5f5]" aria-busy="true" aria-live="polite" role="status">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-neutral-200 border-t-olive-600" />
          <p className="text-sm text-neutral-400">読み込み中…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="min-w-0 flex-1">{children}</main>
      <TaskBar />
      <BackendStatusBanner />
    </div>
  );
}
