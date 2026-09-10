'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AdminSidebar from '@/components/AdminSidebar';
import BackendStatusBanner from '@/components/BackendStatusBanner';
import { useAuth } from '@/lib/auth';

export default function AdminLayout({
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
      } else if (user.role !== 'admin') {
        router.replace('/');
      } else {
        setChecked(true);
      }
    }
  }, [loading, user, router]);

  if (loading || !checked) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#171717]">
        <p className="text-sm text-neutral-400">読み込み中…</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-neutral-50">
      <AdminSidebar />
      <main className="min-w-0 flex-1">{children}</main>
      <BackendStatusBanner />
    </div>
  );
}
