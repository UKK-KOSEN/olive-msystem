'use client';

import { useMemo, useState } from 'react';
import {
  IconChevron,
  IconActivity,
  IconCamera,
  IconDroplet,
  IconInfo,
  IconSettings,
} from '@/components/icons';
import { PageHeader } from '@/components/PageHeader';

interface Faq {
  cat: Exclude<CategoryKey, 'all'>;
  q: string;
  a: string;
}

const CATEGORIES = [
  { key: 'all', label: 'すべて', icon: <IconInfo size={14} /> },
  { key: 'about', label: 'システムについて', icon: <IconSettings size={14} /> },
  { key: 'score', label: '判定の仕組み', icon: <IconActivity size={14} /> },
  { key: 'usage', label: '解析の使い方', icon: <IconCamera size={14} /> },
  { key: 'data', label: 'データと管理', icon: <IconDroplet size={14} /> },
] as const;

type CategoryKey = (typeof CATEGORIES)[number]['key'];

const CATEGORY_LABEL: Record<Exclude<CategoryKey, 'all'>, string> = {
  about: 'システムについて',
  score: '判定の仕組み',
  usage: '解析の使い方',
  data: 'データと管理',
};

const FAQS: Faq[] = [
  {
    cat: 'about',
    q: 'このダッシュボードは何をするものですか？',
    a: 'オリーブの生育状態を「画像」や「動画」から自動で判定し、健康スコアとして表示するシステムです。農家の方が数値で体調を把握できるように、検出アルゴリズム（olive-p）の結果をわかりやすい形でお見せします。',
  },
  {
    cat: 'about',
    q: 'このダッシュボードの開発に使っているのは？',
    a: 'フロントエンドは Next.js、バックエンドは FastAPI（Python）、検出アルゴリズムは olive-p（OpenCVベース）を使っています。システム全体の構成は「検出アルゴリズム・システム構成」ページをご覧ください。',
  },
  {
    cat: 'score',
    q: '健康スコアはどうやって計算されるのですか？',
    a: '緑度（30%）、葉の反り（25%）、果実のシワ（25%）、彩度（20%）の4つの要素を重み付けして0〜1の範囲のスコアを計算します。これに基づいて「健康・良好・注意・要管理」の4段階に分類します。',
  },
  {
    cat: 'score',
    q: '「健康」「良好」「注意」「要管理」はどう違うのですか？',
    a: '・健康（75点以上）：葉も果実も良好な状態\n・良好（55〜75点）：概ね健康ですが、様子を見てください\n・注意（35〜55点）：水分や葉の状態に注意が必要です\n・要管理（35点未満）：体調不良が疑われます。早めの対応を',
  },
  {
    cat: 'score',
    q: '「検出レポート」には何が書かれていますか？',
    a: '解析結果の詳細です。葉の数や緑被率、果実の数と成熟度、水分ストレス、カール指数、シワ度などが数値で表示されます。農家の方が「なぜこの判定になったか」を理解するためのレポートです。',
  },
  {
    cat: 'usage',
    q: '画像をアップロードしてから結果が出るまでどれくらいかかりますか？',
    a: '画像のサイズによりますが、数秒〜数十秒程度です。解析中はスピナーとプログレスバーが表示されるので、お待ちください。動画の場合、選択した時間の数だけ解析が実行され、少し時間がかかります。',
  },
  {
    cat: 'usage',
    q: '解析に使える画像・動画の形式は？',
    a: '画像はJPG / PNG / BMP / TIFF / WebP、動画はMP4 / AVI / MOV / MKV / WEBM / M4Vに対応しています。',
  },
  {
    cat: 'usage',
    q: '写真を撮るときのコツはありますか？',
    a: '葉が複数枚写るように、できるだけ画面を葉で覆うように撮影してください。逆光や強い影は避け、明るい場所で撮ると精度が上がります。ピンぼけにもご注意ください。',
  },
  {
    cat: 'usage',
    q: '「注意」や「要管理」のときはどうすればいいですか？',
    a: '水分不足や葉の変色が疑われるため、まずは水やりや日当たりを確認してください。同じ環境で撮影し続けて推移を見ることで、改善傾向を把握できます。',
  },
  {
    cat: 'usage',
    q: 'お知らせ（通知）はどうやって届きますか？',
    a: '管理者から送られたお知らせが「お知らせ」ページに表示されます。未読のものはドット付きで表示され、クリックすると本文を読んで既読になります。',
  },
  {
    cat: 'data',
    q: '土壌水分の情報はどこから来ていますか？',
    a: '設定ファイルがあれば自動取得（センサー）を優先し、なければ手動入力を使えます。自動取得のデータには「自動取得」、手動で入力した場合は「手動入力」と表示されます。',
  },
  {
    cat: 'data',
    q: '他の農家さんのデータは見えますか？',
    a: 'プロフィール設定で「他の農家のデータを見る」を有効にすると、他の農家さんの観測データも一覧で確認できます。通常は、ご自身のデータのみが表示されます。管理者はすべての農家を確認できます。',
  },
  {
    cat: 'data',
    q: '解析結果を削除できますか？',
    a: 'はい。観測記録や画像、動画は、ご自身がアップロードしたものに限り削除できます。削除すると元に戻せないのでご注意ください。',
  },
  {
    cat: 'data',
    q: 'パスワードを変更するには？',
    a: '「プロフィール」ページから表示名や農園名、パスワードを変更できます。パスワードは6文字以上で設定してください。',
  },
];

export default function FaqPage() {
  const [open, setOpen] = useState<number | null>(0);
  const [cat, setCat] = useState<CategoryKey>('all');
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return FAQS.filter((faq) => {
      if (cat !== 'all' && faq.cat !== cat) return false;
      if (!q) return true;
      return faq.q.toLowerCase().includes(q) || faq.a.toLowerCase().includes(q);
    });
  }, [cat, query]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 md:px-8">
      <PageHeader
        title="よくある質問（Q&A）"
        description="使い方や判定の仕組みについて、知りたい項目を選ぶだけで探せます。"
      />

      {/* Category filter */}
      <div className="mb-4 flex flex-wrap gap-1.5">
        {CATEGORIES.map((c) => (
          <button
            key={c.key}
            onClick={() => setCat(c.key)}
            className={`badge flex items-center gap-1.5 transition-colors ${
              cat === c.key
                ? 'bg-neutral-900 text-white'
                : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
            }`}
          >
            {c.icon}
            {c.label}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative mb-5">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" />
          </svg>
        </span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="質問を検索（例: パスワード、土壌水分）"
          className="w-full rounded-xl border border-neutral-200 bg-white py-2.5 pl-9 pr-9 text-sm shadow-sm focus:border-olive-500 focus:outline-none focus:ring-1 focus:ring-olive-500"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md px-1.5 py-0.5 text-xs text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
            aria-label="検索をクリア"
          >
            クリア
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-neutral-200 bg-white px-6 py-12 text-center shadow-sm">
          <p className="text-sm font-medium text-neutral-700">該当する質問が見つかりませんでした</p>
          <p className="mt-1 text-xs text-neutral-400">キーワードを変えたり、カテゴリを「すべて」に戻してみてください。</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((faq, i) => {
            const isOpen = open === i;
            return (
              <div
                key={faq.q}
                className={`overflow-hidden rounded-xl border bg-white transition-colors ${
                  isOpen ? 'border-neutral-300 shadow-sm' : 'border-neutral-200 hover:border-neutral-300'
                }`}
              >
                <button
                  onClick={() => setOpen(isOpen ? null : i)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-neutral-100 text-sm font-bold text-neutral-700">
                      Q
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-neutral-800 sm:whitespace-normal">
                        {faq.q}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-neutral-400">
                        {CATEGORY_LABEL[faq.cat]}
                      </span>
                    </span>
                  </span>
                  <span className={`shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}>
                    <IconChevron size={16} className="text-neutral-400" />
                  </span>
                </button>
                {isOpen && (
                  <div className="border-t border-neutral-100 px-4 py-3.5">
                    <div className="flex gap-3">
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-neutral-900 text-sm font-bold text-white">
                        A
                      </span>
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-neutral-600">
                        {faq.a}
                      </p>
                    </div>
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