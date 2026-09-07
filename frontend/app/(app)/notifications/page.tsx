'use client';

import { NotificationsList } from '@/components/Notifications';
import { PageHeader } from '@/components/PageHeader';

export default function NotificationsPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 md:px-8">
      <PageHeader
        title="お知らせ"
        description="管理者からのお知らせや、重要なメッセージを確認できます。"
      />
      <NotificationsList />
    </div>
  );
}
