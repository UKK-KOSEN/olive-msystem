'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { PageHeader } from '@/components/PageHeader';

const OLIVE_VARIETIES = ['ルッカ', 'マンザニロ', 'ミッション', 'ネバディロ・ブランコ', 'アルベキーナ', 'コロネイキ', 'フラントイオ', 'ホホリンレ'];

export default function ProfilePage() {
  const { user, refresh } = useAuth();
  const [displayName, setDisplayName] = useState(user?.display_name ?? '');
  const [farmName, setFarmName] = useState(user?.farm_name ?? '');
  const [farmArea, setFarmArea] = useState(user?.farm_area ?? '');
  const [farmTrees, setFarmTrees] = useState(user?.farm_trees != null ? String(user.farm_trees) : '');
  const [farmVariety, setFarmVariety] = useState(user?.farm_variety ?? '');
  const [farmLocation, setFarmLocation] = useState(user?.farm_location ?? '');
  const [farmContact, setFarmContact] = useState(user?.farm_contact ?? '');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [canSeeOthers, setCanSeeOthers] = useState(!!user?.preferences?.can_see_others);
  const [error, setError] = useState<string | null>(null);
  const [snackbar, setSnackbar] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password && password !== confirm) {
      setError('パスワードが一致しません。');
      return;
    }
    if (password && password.length < 6) {
      setError('パスワードは6文字以上にしてください。');
      return;
    }
    let trees: number | null = null;
    if (farmTrees.trim() !== '') {
      trees = Number(farmTrees);
      if (!Number.isInteger(trees) || trees < 0) {
        setError('植栽本数は0以上の整数で入力してください。');
        return;
      }
    }
    setSaving(true);
    try {
      const payload: Record<string, any> = {
        display_name: displayName,
        farm_name: farmName,
        farm_area: farmArea,
        farm_trees: trees,
        farm_variety: farmVariety,
        farm_location: farmLocation,
        farm_contact: farmContact,
      };
      if (password) payload.password = password;
      // Always include preferences in case it changed
      payload.preferences = { can_see_others: canSeeOthers };
      await api.updateProfile(payload);
      await refresh();
      setPassword('');
      setConfirm('');
      setSnackbar('設定を保存しました');
      setTimeout(() => setSnackbar(null), 3000);
    } catch (e: any) {
      setError(e.message || '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const inputCls = "mt-1 block w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-olive-500 focus:outline-none focus:ring-1 focus:ring-olive-500";
  const labelCls = "block text-sm text-neutral-600";
  const sectionCls = "rounded-xl border border-neutral-200 bg-white p-5 shadow-sm";

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 md:px-8">
      <PageHeader
        title="プロフィール設定"
        description="あなたの農園情報・パスワード・データ共有を管理します。"
      />

      {saving && (
        <div className="mb-4 rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-600">
          保存中…
        </div>
      )}
      {snackbar && (
        <div className="mb-4 rounded-lg border border-olive-200 bg-olive-50 px-4 py-3 text-sm text-olive-800">
          ✓ {snackbar}
        </div>
      )}

      <form onSubmit={saveProfile} className="space-y-6">
        {/* Account info */}
        <section className={sectionCls}>
          <h2 className="mb-4 text-sm font-semibold text-neutral-500">アカウント情報</h2>
          <div className="space-y-4">
            <div>
              <label className={labelCls}>ユーザー名（変更不可）</label>
              <input type="text" value={user?.username ?? ''} disabled className={`${inputCls} bg-neutral-50 text-neutral-400`} />
            </div>
            <div>
              <label className={labelCls}>表示名（ニックネーム）</label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="例: 山田太郎"
                className={inputCls}
              />
            </div>
          </div>
        </section>

        {/* Farm info */}
        <section className={sectionCls}>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-neutral-500">農園情報</h2>
            <span className="text-xs text-neutral-400">解析結果や今のお手入れ提案に利用されます</span>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelCls}>農園名</label>
              <input
                type="text"
                value={farmName}
                onChange={(e) => setFarmName(e.target.value)}
                placeholder="例: 山田オリーブ園"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>品種</label>
              <input
                list="olive-varieties"
                type="text"
                value={farmVariety}
                onChange={(e) => setFarmVariety(e.target.value)}
                placeholder="例: ルッカ"
                className={inputCls}
              />
              <datalist id="olive-varieties">
                {OLIVE_VARIETIES.map((v) => (
                  <option key={v} value={v} />
                ))}
              </datalist>
            </div>
            <div>
              <label className={labelCls}>面積</label>
              <input
                type="text"
                value={farmArea}
                onChange={(e) => setFarmArea(e.target.value)}
                placeholder="例: 1.2 ha / 600 ㎡"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>植栽本数</label>
              <input
                type="number"
                min="0"
                step="1"
                value={farmTrees}
                onChange={(e) => setFarmTrees(e.target.value)}
                placeholder="例: 200"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>所在地</label>
              <input
                type="text"
                value={farmLocation}
                onChange={(e) => setFarmLocation(e.target.value)}
                placeholder="例: 香川県小豆郡"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>連絡先</label>
              <input
                type="text"
                value={farmContact}
                onChange={(e) => setFarmContact(e.target.value)}
                placeholder="例: 080-0000-0000"
                className={inputCls}
              />
            </div>
          </div>
        </section>

        {/* Data sharing (farmers only) */}
        {user?.role === 'farmer' && (
          <section className={sectionCls}>
            <h2 className="mb-3 text-sm font-semibold text-neutral-500">データ共有設定</h2>
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={canSeeOthers}
                onChange={(e) => setCanSeeOthers(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-neutral-300"
              />
              <span>
                <span className="block text-sm font-medium text-neutral-800">他の農家のデータを見る</span>
                <span className="mt-0.5 block text-xs leading-relaxed text-neutral-500">
                  チェックすると、観測データやカレンダーに他の農家さんの結果も表示されます。
                  オフなら、自分のデータのみが表示されます。
                </span>
              </span>
            </label>
          </section>
        )}

        {/* Change password */}
        <section className={sectionCls}>
          <h2 className="mb-4 text-sm font-semibold text-neutral-500">パスワード変更</h2>
          <div className="space-y-4">
            <div>
              <label className={labelCls}>新しいパスワード</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="6文字以上"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>確認用</label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="もう一度入力"
                className={inputCls}
              />
            </div>
          </div>
        </section>

        {error && <div className="rounded-lg bg-health-danger/10 px-4 py-3 text-sm text-health-danger">{error}</div>}

        <div className="flex justify-end">
          <button type="submit" disabled={saving} className="btn-primary">
            {saving ? '保存中…' : '設定を保存'}
          </button>
        </div>
      </form>
    </div>
  );
}