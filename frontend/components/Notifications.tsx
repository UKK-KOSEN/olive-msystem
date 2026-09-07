'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, Notification } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { IconBell, IconChevron, IconSend, IconTrash } from '@/components/icons';

export function NotificationsList({ showBadge }: { showBadge?: boolean }) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [notifs, setNotifs] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [targetRole, setTargetRole] = useState('all');
  const [sending, setSending] = useState(false);
  const [farmers, setFarmers] = useState<any[]>([]);
  const [targetUserId, setTargetUserId] = useState<string>('');
  const [openId, setOpenId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const [ns, uc] = await Promise.all([
        api.notifications().catch(() => []),
        api.unreadCount().catch(() => ({ count: 0 })),
      ]);
      setNotifs(ns);
      setUnread(uc.count);
      setError(null);
    } catch {
      setError('バックエンドに接続できません。');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (isAdmin && showForm) {
      api.listFarmers().then(setFarmers).catch(() => {});
    }
  }, [isAdmin, showForm]);

  const markRead = async (n: Notification) => {
    if (n.is_read) return;
    await api.markNotificationRead(n.id);
    setNotifs((prev) => prev.map((x) => (x.id === n.id ? { ...x, is_read: 1 } : x)));
    setUnread((u) => Math.max(0, u - 1));
  };

  const toggle = (id: number) => setOpenId((cur) => (cur === id ? null : id));

  const handleCardClick = (n: Notification) => {
    // expand/collapse and mark as read
    toggle(n.id);
    if (!n.is_read) markRead(n);
  };

  const createNotif = async () => {
    if (!title.trim() || !body.trim()) return;
    setSending(true);
    try {
      await api.createNotification({
        title: title.trim(),
        body: body.trim(),
        target_role: targetRole,
        target_user_id: targetUserId ? Number(targetUserId) : null,
      });
      setTitle('');
      setBody('');
      setShowForm(false);
      await load();
    } catch (e: any) {
      setError(e.message || '作成に失敗しました');
    } finally {
      setSending(false);
    }
  };

  const deleteNotif = async (n: Notification) => {
    if (!window.confirm('このお知らせを削除しますか？')) return;
    await api.deleteNotification(n.id);
    setNotifs((prev) => prev.filter((x) => x.id !== n.id));
  };

  const fmtTime = (iso?: string) => {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString('ja-JP', { dateStyle: 'medium', timeStyle: 'short' });
  };

  const targetLabel = (n: Notification) => {
    if (n.target_user_id) return '特定農家へ';
    if (n.target_role === 'admin') return '管理者向け';
    if (n.target_role === 'farmer') return '農家向け';
    return '全体向け';
  };

  if (loading) {
    return <div className="card text-center text-sm text-neutral-400">読み込み中…</div>;
  }

  return (
    <div className="space-y-4">
      {/* Unread badge */}
      {showBadge && unread > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-olive-200 bg-olive-50 px-3 py-2 text-sm text-olive-800">
          <span className="h-2 w-2 rounded-full bg-olive-600 animate-pulse" />
          <span>未読のお知らせが {unread} 件あります</span>
        </div>
      )}

      {/* Admin - create form */}
      {isAdmin && (
        <div className="rounded-xl border border-neutral-200 bg-white shadow-sm">
          <button
            onClick={() => setShowForm(!showForm)}
            className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-neutral-700 hover:bg-neutral-50 rounded-t-xl"
          >
            <span className="flex items-center gap-2">
              <IconBell size={18} className="text-neutral-500" />
              お知らせを送信
            </span>
            <span className="text-neutral-400">{showForm ? '▲' : '▼'}</span>
          </button>
          {showForm && (
            <div className="p-4 border-t border-neutral-100 space-y-3">
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="タイトル（例: 本日の水やりについて）"
                className="input w-full px-3 py-2 text-sm"
              />
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="本文（農家さんへのお知らせ内容）"
                rows={3}
                className="input w-full px-3 py-2 text-sm"
              />
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <select
                  value={targetRole}
                  onChange={(e) => { setTargetRole(e.target.value); setTargetUserId(''); }}
                  className="input px-3 py-2 text-sm"
                >
                  <option value="all">全体向け</option>
                  <option value="farmer">農家向け</option>
                  <option value="admin">管理者向け</option>
                  <option value="specific">特定の農家へ</option>
                </select>
                {targetRole === 'specific' && (
                  <select
                    value={targetUserId}
                    onChange={(e) => setTargetUserId(e.target.value)}
                    className="input px-3 py-2 text-sm"
                  >
                    <option value="">農家を選択…</option>
                    {farmers.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.farm_name || f.display_name || f.username}
                      </option>
                    ))}
                  </select>
                )}
                <button
                  onClick={createNotif}
                  disabled={sending || !title.trim() || !body.trim()}
                  className="btn-primary ml-auto"
                >
                  <IconSend size={16} />
                  {sending ? '送信中…' : '送信'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {error && <div className="card text-sm text-health-danger">{error}</div>}

      {/* Notification list */}
      {notifs.length === 0 ? (
        <div className="card text-center text-sm text-neutral-400">
          お知らせはありません。
        </div>
      ) : (
        <div className="space-y-2">
          {notifs.map((n) => {
            const open = openId === n.id;
            return (
              <div
                key={n.id}
                onClick={() => handleCardClick(n)}
                className={`cursor-pointer rounded-xl border bg-white transition-colors ${
                  open ? 'border-neutral-300 shadow-sm' : 'border-neutral-200 hover:border-neutral-300'
                }`}
              >
                <div className="flex items-start justify-between gap-3 p-4">
                  <div className="flex items-start gap-2.5 min-w-0 flex-1">
                    {!n.is_read && (
                      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-olive-600" />
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-neutral-800">{n.title}</span>
                        <span className="badge bg-neutral-100 text-neutral-500 text-[10px]">{targetLabel(n)}</span>
                      </div>
                      <div className="mt-1 text-xs text-neutral-400">
                        {fmtTime(n.created_at)}
                        {n.creator_name ? ` · ${n.creator_name}` : ''}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {isAdmin && (
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteNotif(n); }}
                        className="rounded-md p-1.5 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-health-danger"
                        aria-label="削除"
                      >
                        <IconTrash size={16} />
                      </button>
                    )}
                    <span
                      className={`grid place-items-center rounded-md transition-transform ${
                        open ? 'rotate-180' : ''
                      }`}
                    >
                      <IconChevron size={16} className="text-neutral-400" />
                    </span>
                  </div>
                </div>
                {open && (
                  <div className="border-t border-neutral-100 px-4 py-3">
                    <p className="text-sm text-neutral-600 whitespace-pre-wrap">{n.body}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
