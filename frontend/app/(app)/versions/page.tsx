'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, VersionInfo, FeatureArchitecture, ComponentInfo, DataFlow, ApiEndpointGroup } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';

export default function VersionsPage() {
  const [info, setInfo] = useState<VersionInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setInfo(await api.versions());
      setError(null);
    } catch {
      setError('バックエンドに接続できません。');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const arch = info?.architecture;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 md:px-8">
      <PageHeader
        title="バージョン情報"
        description="このダッシュボードで使用しているソフトウェアのバージョンとシステム構成です。"
      />

      {error && (
        <div className="card mb-6 text-sm text-health-danger">{error}</div>
      )}

      {info && (
        <>
          {/* Version info */}
          <section className="card mb-6">
            <h2 className="label mb-4">アプリケーション</h2>
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <VersionItem label="olive-msystem フロントエンド" value={info.olive_msystem.frontend} />
              <VersionItem label="olive-msystem バックエンド" value={info.olive_msystem.backend} />
              <VersionItem label="olive-p (解析エンジン)" value={info.olive_p ?? '—'} />
              <VersionItem label="実行環境" value={info.platform} small />
            </dl>
          </section>

          {/* Dependencies */}
          <section className="card mb-6">
            <h2 className="label mb-4">ランタイム・依存ライブラリ</h2>
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <VersionItem label="Python" value={info.python} />
              {Object.entries(info.dependencies).map(([name, ver]) => (
                <VersionItem key={name} label={name} value={ver || '—'} />
              ))}
            </dl>
          </section>

          {/* Architecture */}
          {arch && (
            <>
              {/* Components */}
              <section className="card mb-6">
                <h2 className="label mb-4">システム構成</h2>
                <p className="text-xs text-neutral-400 mb-4">
                  olive-msystem は 5 つのコンポーネントで構成されています。
                </p>
                <div className="space-y-3">
                  {arch.components.map((c: ComponentInfo) => (
                    <div key={c.name} className="rounded-lg border border-neutral-200 p-4">
                      <div className="flex items-center gap-3 mb-2">
                        <span className="badge bg-olive-50 text-olive-700">{c.tech}</span>
                        {c.port && <span className="badge bg-neutral-100 text-neutral-500">:{c.port}</span>}
                      </div>
                      <p className="text-sm font-medium text-neutral-800">{c.name}</p>
                      <p className="text-xs text-neutral-500 mt-1">{c.description}</p>
                    </div>
                  ))}
                </div>
              </section>

              {/* Data flows */}
              <section className="card mb-6">
                <h2 className="label mb-4">データフロー</h2>
                <p className="text-xs text-neutral-400 mb-4">
                  各コンポーネント間でどのようにデータが流れているかです。
                </p>
                <div className="space-y-2">
                  {arch.dataFlows.map((f: DataFlow, i: number) => (
                    <div key={i} className="flex items-center gap-2 text-sm">
                      <span className="badge bg-olive-50 text-olive-700 text-[11px] shrink-0">{f.from}</span>
                      <span className="text-neutral-300">→</span>
                      <span className="badge bg-neutral-100 text-neutral-600 text-[11px] shrink-0">{f.to}</span>
                      <span className="text-neutral-500 text-xs">{f.description}</span>
                    </div>
                  ))}
                </div>
              </section>

              {/* API Endpoints */}
              <section className="card mb-6">
                <h2 className="label mb-4">API エンドポイント一覧</h2>
                <p className="text-xs text-neutral-400 mb-4">
                  バックエンドが公開しているすべての REST API エンドポイントです。
                </p>
                <div className="space-y-4">
                  {arch.apiEndpoints.map((g: ApiEndpointGroup) => (
                    <div key={g.group}>
                      <h3 className="text-sm font-semibold text-neutral-700 mb-2">{g.group}</h3>
                      <div className="rounded-lg border border-neutral-200 overflow-hidden">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="bg-neutral-50 border-b border-neutral-200">
                              <th className="px-3 py-2 text-left text-neutral-500 font-medium w-16">Method</th>
                              <th className="px-3 py-2 text-left text-neutral-500 font-medium">Path</th>
                              <th className="px-3 py-2 text-left text-neutral-500 font-medium">説明</th>
                            </tr>
                          </thead>
                          <tbody>
                            {g.endpoints.map((ep) => (
                              <tr key={ep.path + ep.method} className="border-b border-neutral-100 last:border-0">
                                <td className="px-3 py-2">
                                  <span className={`badge text-[10px] ${
                                    ep.method === 'GET' ? 'bg-health-good/10 text-health-good' :
                                    ep.method === 'POST' ? 'bg-blue-50 text-blue-600' :
                                    ep.method === 'PUT' ? 'bg-health-caution/10 text-health-caution' :
                                    'bg-health-danger/10 text-health-danger'
                                  }`}>
                                    {ep.method}
                                  </span>
                                </td>
                                <td className="px-3 py-2 font-mono text-neutral-700">{ep.path}</td>
                                <td className="px-3 py-2 text-neutral-500">{ep.description}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* Page structure */}
              <section className="card mb-6">
                <h2 className="label mb-4">ページ構成</h2>
                <p className="text-xs text-neutral-400 mb-4">
                  各ページでどのような機能が利用できるかです。
                </p>
                <div className="space-y-3">
                  <PageFeature
                    name="ダッシュボード (/)"
                    features={[
                      '体調スコアのリアルタイム表示と判定（happy/good/caution/danger）',
                      '動画アップロード・解析実行（時間指定・土壌水分手動入力）',
                      '画像アップロード・解析実行',
                      '土壌水分・環境データの自動取得表示（UKK-KOSEN API連携）',
                      'センサー鮮度監視（オフライン検知・経過時間表示）',
                      '動画一覧・解析済み動画の観測結果表示',
                      '解析キューの進捗表示',
                      '農家選択（管理者のみ、スコア切り替え）',
                    ]}
                  />
                  <PageFeature
                    name="体調スコア推移 (/tracking)"
                    features={[
                      '日別の体調スコア推移チャート（直線グラフ）',
                      '状態境界ガイド（0.35/0.55/0.75）',
                      '最新値ハイライト',
                      '農家選択フィルタ（管理者のみ）',
                      '全農家選択時は推移不可の案内表示',
                    ]}
                  />
                  <PageFeature
                    name="カレンダー (/calendar)"
                    features={[
                      '月別カレンダーで日別の体調状態を色分け表示',
                      '各日の観測回数と平均スコア',
                      '日付クリックで詳細ポップアップ',
                      '前月・翌月ナビゲーション',
                      '農家選択フィルタ（管理者のみ）',
                    ]}
                  />
                  <PageFeature
                    name="オリーブ (/olive)"
                    features={[
                      'オリーブ全体のステータス概要',
                      '体調スコアの集計・判定',
                      '最新の観測結果リスト',
                      '土壌水分データ表示',
                    ]}
                  />
                  <PageFeature
                    name="画像 (/images)"
                    features={[
                      '画像アップロード（対応形式: jpg, png）',
                      '画像解析実行（土壌水分手動入力対応）',
                      '解析済み画像の一覧・結果表示',
                      '観測結果の土壌水分表示',
                      '画像削除',
                    ]}
                  />
                  <PageFeature
                    name="通知 (/notifications)"
                    features={[
                      '体調アラート通知の受信',
                      '既読・未読管理',
                      '通知削除',
                    ]}
                  />
                  <PageFeature
                    name="プロフィール (/profile)"
                    features={[
                      'ユーザープロフィール編集（表示名・農園情報）',
                      'パスワード変更',
                      '表示設定（カレンダーで他農家を表示するか）',
                    ]}
                  />
                  <PageFeature
                    name="よくある質問 (/faq)"
                    features={[
                      'システムの使い方に関するFAQ',
                      '土壌水分データの取得元説明',
                      '体調スコアの計算方法説明',
                    ]}
                  />
                  <PageFeature
                    name="管理者画面 (/admin)"
                    features={[
                      'ダッシュボード統計（観測数・動画数・画像数・ユーザー数）',
                      '判定しきい値の設定（happy/good/caution）',
                      'サイト名・アクセントカラー設定',
                      '農家アカウント管理（一覧・情報編集・パスワード変更・削除）',
                      '土壌水分設定（APIキー・kit_id・接続テスト）',
                      '動画・画像・観測の削除・一括削除',
                    ]}
                  />
                </div>
              </section>

              {/* Health assessment */}
              <section className="card mb-6">
                <h2 className="label mb-4">体調判定の仕組み</h2>
                <div className="space-y-3 text-xs text-neutral-600">
                  <p>
                    動画フレームからオリーブの葉・実を検出し、以下の要素を総合的に判定します。
                  </p>
                  <div className="rounded-lg border border-neutral-200 overflow-hidden">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-neutral-50 border-b border-neutral-200">
                          <th className="px-3 py-2 text-left text-neutral-500 font-medium">判定</th>
                          <th className="px-3 py-2 text-left text-neutral-500 font-medium">スコア範囲</th>
                          <th className="px-3 py-2 text-left text-neutral-500 font-medium">色</th>
                          <th className="px-3 py-2 text-left text-neutral-500 font-medium">アドバイス</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="border-b border-neutral-100">
                          <td className="px-3 py-2 font-medium">happy</td>
                          <td className="px-3 py-2">≥ 0.75</td>
                          <td className="px-3 py-2"><span className="inline-block h-3 w-3 rounded-full" style={{background:'#4c9a5a'}} /></td>
                          <td className="px-3 py-2">順調です。この調子で観察を続けましょう。</td>
                        </tr>
                        <tr className="border-b border-neutral-100">
                          <td className="px-3 py-2 font-medium">good</td>
                          <td className="px-3 py-2">0.55 - 0.75</td>
                          <td className="px-3 py-2"><span className="inline-block h-3 w-3 rounded-full" style={{background:'#84a841'}} /></td>
                          <td className="px-3 py-2">良好です。定期的な観察を継続してください。</td>
                        </tr>
                        <tr className="border-b border-neutral-100">
                          <td className="px-3 py-2 font-medium">caution</td>
                          <td className="px-3 py-2">0.35 - 0.55</td>
                          <td className="px-3 py-2"><span className="inline-block h-3 w-3 rounded-full" style={{background:'#c99a2e'}} /></td>
                          <td className="px-3 py-2">注意が必要です。対策を検討してください。</td>
                        </tr>
                        <tr>
                          <td className="px-3 py-2 font-medium">danger</td>
                          <td className="px-3 py-2">&lt; 0.35</td>
                          <td className="px-3 py-2"><span className="inline-block h-3 w-3 rounded-full" style={{background:'#c25a4a'}} /></td>
                          <td className="px-3 py-2">早めの対応が必要です。灌水・剪定・土壌水分の確認を優先。</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <p>
                    判定には以下の情報が使用されます: 葉数・実数・土壌水分（センサー1/2）・気温・湿度。
                    土壌水分データは UKK-KOSEN の物理センサーから自動取得され、動画の撮影時刻に最も近い値が紐付けられます。
                  </p>
                </div>
              </section>

              {/* Soil sensor info */}
              <section className="card mb-6">
                <h2 className="label mb-4">土壌水分センサー情報</h2>
                <div className="space-y-3 text-xs text-neutral-600">
                  <p>
                    小豆島フィールドに設置された 2 台の物理センサーから、土壌水分・気温・湿度を 20 分間隔で Cloudflare D1 経由に蓄積しています。
                  </p>
                  <div className="rounded-lg border border-neutral-200 overflow-hidden">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-neutral-50 border-b border-neutral-200">
                          <th className="px-3 py-2 text-left text-neutral-500 font-medium">Kit ID</th>
                          <th className="px-3 py-2 text-left text-neutral-500 font-medium">用途</th>
                          <th className="px-3 py-2 text-left text-neutral-500 font-medium">観測間隔</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="border-b border-neutral-100">
                          <td className="px-3 py-2 font-mono">shodoshima-field-01</td>
                          <td className="px-3 py-2">1号機（定時観測）</td>
                          <td className="px-3 py-2">約20分</td>
                        </tr>
                        <tr>
                          <td className="px-3 py-2 font-mono">shodoshima-field-02</td>
                          <td className="px-3 py-2">2号機（通年観測）</td>
                          <td className="px-3 py-2">約20分</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <p>
                    APIの認証は Bearer トークン方式です。APIキーはバックエンドの設定ファイルで管理しており、GitHubにコミットされません。
                    データが 6 時間以上更新されない場合、ダッシュボードに「センサー停止中」の警告が表示されます。
                  </p>
                </div>
              </section>

              {/* Security */}
              <section className="card mb-6">
                <h2 className="label mb-4">セキュリティ</h2>
                <div className="space-y-2 text-xs text-neutral-600">
                  <p>• <strong>認証</strong>: JWT トークンベース。農家は自分のデータのみ閲覧可能。</p>
                  <p>• <strong>管理者</strong>: 全農家のデータにアクセス可能。農家選択でスコープ切替。</p>
                  <p>• <strong>API キー</strong>: 土壌水分 API キーは .gitignore 対象。GitHub にコミットされません。</p>
                  <p>• <strong>管理者パスワード</strong>: 初回起動時にランダム 10 桁数値に自動変更。ログに出力。</p>
                  <p>• <strong>CORS</strong>: 開発環境では localhost:3001 のみ許可。</p>
                </div>
              </section>
            </>
          )}

          <p className="text-center text-xs text-neutral-400">
            更新日時: {new Date().toLocaleString('ja-JP')}
          </p>
        </>
      )}
    </div>
  );
}

function VersionItem({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-neutral-50 px-4 py-3">
      <dt className="text-sm text-neutral-500">{label}</dt>
      <dd className={`ml-4 font-medium tabular-nums text-neutral-800 ${small ? 'text-xs' : 'text-sm'}`}>
        {value}
      </dd>
    </div>
  );
}

function PageFeature({ name, features }: { name: string; features: string[] }) {
  return (
    <div className="rounded-lg border border-neutral-200 p-4">
      <p className="text-sm font-semibold text-neutral-800 mb-2">{name}</p>
      <ul className="space-y-1">
        {features.map((f, i) => (
          <li key={i} className="text-xs text-neutral-500 flex items-start gap-2">
            <span className="text-olive-500 mt-0.5">•</span>
            {f}
          </li>
        ))}
      </ul>
    </div>
  );
}
