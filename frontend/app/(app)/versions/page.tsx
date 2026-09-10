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
        title="システム構成"
        description="olive-msystem の全体構成・データフロー・API・体調判定の仕組みを図で解説します。"
      />

      {error && (
        <div className="card mb-6 text-sm text-health-danger">{error}</div>
      )}

      {info && (
        <>
          {/* Version info */}
          <section className="card mb-6">
            <h2 className="label mb-4">バージョン</h2>
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <VersionItem label="olive-msystem フロントエンド" value={info.olive_msystem.frontend} />
              <VersionItem label="olive-msystem バックエンド" value={info.olive_msystem.backend} />
              <VersionItem label="olive-p (解析エンジン)" value={info.olive_p ?? '—'} />
              <VersionItem label="Python" value={info.python} />
              <VersionItem label="実行環境" value={info.platform} small />
            </dl>
          </section>

          {/* Dependencies */}
          <section className="card mb-6">
            <h2 className="label mb-4">依存ライブラリ</h2>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {Object.entries(info.dependencies).map(([name, ver]) => (
                <VersionItem key={name} label={name} value={ver || '—'} />
              ))}
            </dl>
          </section>

          {arch && (
            <>
              {/* ===== SYSTEM ARCHITECTURE SVG ===== */}
              <section className="card mb-6">
                <h2 className="label mb-4">システム構成図</h2>
                <p className="text-xs text-neutral-400 mb-4">
                  olive-msystem は 5 つのコンポーネントで構成されています。それぞれの役割と接続関係を図で示します。
                </p>
                <div className="flex justify-center overflow-x-auto">
                  <SystemArchitectureSVG components={arch.components} />
                </div>
                <div className="mt-4 space-y-2">
                  {arch.components.map((c: ComponentInfo) => (
                    <div key={c.name} className="flex items-start gap-3 text-xs">
                      <span className="badge bg-olive-50 text-olive-700 shrink-0 mt-0.5">{c.tech}</span>
                      <div>
                        <span className="font-medium text-neutral-800">{c.name}</span>
                        {c.port && <span className="text-neutral-400 ml-1">(:{c.port})</span>}
                        <span className="text-neutral-500 ml-1">— {c.description}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* ===== DATA FLOW SVG ===== */}
              <section className="card mb-6">
                <h2 className="label mb-4">データフロー図</h2>
                <p className="text-xs text-neutral-400 mb-4">
                  ユーザーの操作からデータがどのように流れ、最終的に体調判定が出力されるかを示します。
                </p>
                <div className="flex justify-center overflow-x-auto">
                  <DataFlowSVG flows={arch.dataFlows} />
                </div>
              </section>

              {/* ===== HEALTH ASSESSMENT FLOW SVG ===== */}
              <section className="card mb-6">
                <h2 className="label mb-4">体調判定のフロー</h2>
                <p className="text-xs text-neutral-400 mb-4">
                  動画フレームからどのように体調スコアが算出されるかを図で示します。
                </p>
                <div className="flex justify-center overflow-x-auto">
                  <HealthAssessmentSVG />
                </div>
              </section>

              {/* ===== NOTIFICATION FLOW SVG ===== */}
              <section className="card mb-6">
                <h2 className="label mb-4">通知システム</h2>
                <p className="text-xs text-neutral-400 mb-4">
                  体調アラートやセンサー停止通知がどのようにユーザーに届くかを図で示します。
                </p>
                <div className="flex justify-center overflow-x-auto">
                  <NotificationFlowSVG />
                </div>
              </section>

              {/* ===== API ENDPOINTS ===== */}
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

              {/* ===== PAGE STRUCTURE ===== */}
              <section className="card mb-6">
                <h2 className="label mb-4">ページ構成</h2>
                <p className="text-xs text-neutral-400 mb-4">
                  各ページでどのような機能が利用できるかです。
                </p>
                <div className="space-y-3">
                  <PageFeature name="ダッシュボード (/)" features={[
                    '体調スコアのリアルタイム表示と判定（happy/good/caution/danger）',
                    '動画アップロード・解析実行（時間指定・土壌水分手動入力）',
                    '画像アップロード・解析実行',
                    '土壌水分・環境データの自動取得表示（UKK-KOSEN API連携）',
                    'センサー鮮度監視（オフライン検知・経過時間表示）',
                    '動画一覧・解析済み動画の観測結果表示',
                    '解析キューの進捗表示',
                    '農家選択（管理者のみ、スコア切り替え）',
                  ]} />
                  <PageFeature name="体調スコア推移 (/tracking)" features={[
                    '日別の体調スコア推移チャート（直線グラフ）',
                    '状態境界ガイド（0.35/0.55/0.75）',
                    '最新値ハイライト',
                    '農家選択フィルタ（管理者のみ）',
                  ]} />
                  <PageFeature name="カレンダー (/calendar)" features={[
                    '月別カレンダーで日別の体調状態を色分け表示',
                    '各日の観測回数と平均スコア',
                    '日付クリックで詳細ポップアップ',
                    '農家選択フィルタ（管理者のみ）',
                  ]} />
                  <PageFeature name="オリーブ (/olive)" features={[
                    'オリーブ全体のステータス概要',
                    '体調スコアの集計・判定',
                    '最新の観測結果リスト',
                  ]} />
                  <PageFeature name="画像 (/images)" features={[
                    '画像アップロード（jpg, png）',
                    '画像解析実行（土壌水分手動入力対応）',
                    '解析済み画像の一覧・結果表示',
                  ]} />
                  <PageFeature name="通知 (/notifications)" features={[
                    '体調アラート通知の受信',
                    'センサー停止通知の受信（一日一回）',
                    '既読・未読管理',
                  ]} />
                  <PageFeature name="プロフィール (/profile)" features={[
                    'ユーザープロフィール編集（表示名・農園情報）',
                    'パスワード変更',
                    '表示設定',
                  ]} />
                  <PageFeature name="管理者画面 (/admin)" features={[
                    'ダッシュボード統計',
                    '判定しきい値の設定',
                    '農家アカウント管理',
                    '土壌水分設定（APIキー・kit_id・接続テスト）',
                    'データ削除・一括削除',
                  ]} />
                </div>
              </section>

              {/* ===== SOIL SENSOR ===== */}
              <section className="card mb-6">
                <h2 className="label mb-4">土壌水分センサー情報</h2>
                <div className="space-y-3 text-xs text-neutral-600">
                  <p>小豆島フィールドに設置された 2 台の物理センサーから、土壌水分・気温・湿度を 20 分間隔で Cloudflare D1 経由に蓄積しています。</p>
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
                  <p>API認証は Bearer トークン方式。データが 6 時間以上更新されない場合、全ユーザーに一日一回センサー停止通知が自動送信されます。</p>
                </div>
              </section>

              {/* ===== SECURITY ===== */}
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

/* ===== SVG Diagram Components ===== */

function SystemArchitectureSVG({ components }: { components: ComponentInfo[] }) {
  return (
    <svg viewBox="0 0 720 420" className="w-full max-w-[720px]" xmlns="http://www.w3.org/2000/svg">
      {/* Background */}
      <rect width="720" height="420" fill="#fafaf8" rx="12" />

      {/* User */}
      <g transform="translate(360, 40)">
        <circle cx="0" cy="0" r="22" fill="#e8efe4" stroke="#6b8f5e" strokeWidth="2" />
        <text x="0" y="5" textAnchor="middle" fontSize="20">👤</text>
        <text x="0" y="38" textAnchor="middle" fontSize="11" fill="#4a5a42" fontWeight="600">ユーザー</text>
      </g>

      {/* Arrow: User -> Frontend */}
      <line x1="360" y1="62" x2="360" y2="95" stroke="#8aa87a" strokeWidth="2" markerEnd="url(#arrowGreen)" />

      {/* Frontend box */}
      <g transform="translate(220, 95)">
        <rect x="0" y="0" width="280" height="55" rx="8" fill="#f0f7ec" stroke="#7ba86a" strokeWidth="1.5" />
        <text x="140" y="22" textAnchor="middle" fontSize="13" fill="#3d5a32" fontWeight="700">フロントエンド (Next.js)</text>
        <text x="140" y="38" textAnchor="middle" fontSize="10" fill="#6b8f5e">ダッシュボード・動画・画像・カレンダー・推移・通知</text>
      </g>

      {/* Arrow: Frontend -> Backend */}
      <line x1="360" y1="150" x2="360" y2="185" stroke="#8aa87a" strokeWidth="2" markerEnd="url(#arrowGreen)" />
      <text x="372" y="172" fontSize="9" fill="#8aa87a">REST API</text>

      {/* Backend box */}
      <g transform="translate(160, 185)">
        <rect x="0" y="0" width="400" height="65" rx="8" fill="#f0f7ec" stroke="#7ba86a" strokeWidth="1.5" />
        <text x="200" y="22" textAnchor="middle" fontSize="13" fill="#3d5a32" fontWeight="700">バックエンド (FastAPI :8000)</text>
        <text x="200" y="38" textAnchor="middle" fontSize="10" fill="#6b8f5e">認証・動画解析キュー・土壌水分統合・ユーザー管理</text>
        <text x="200" y="52" textAnchor="middle" fontSize="9" fill="#95b588">センサー監視スレッド・通知自動送信</text>
      </g>

      {/* Arrow: Backend -> olive-p (left) */}
      <line x1="240" y1="250" x2="120" y2="295" stroke="#8aa87a" strokeWidth="2" markerEnd="url(#arrowGreen)" />
      <text x="155" y="275" fontSize="9" fill="#8aa87a">解析依頼</text>

      {/* Arrow: olive-p -> Backend */}
      <line x1="120" y1="295" x2="240" y2="250" stroke="#c9a84c" strokeWidth="1.5" strokeDasharray="4 3" markerEnd="url(#arrowGold)" />
      <text x="155" y="290" fontSize="9" fill="#c9a84c">検出結果</text>

      {/* olive-p box */}
      <g transform="translate(20, 295)">
        <rect x="0" y="0" width="200" height="55" rx="8" fill="#fdf6e8" stroke="#c9a84c" strokeWidth="1.5" />
        <text x="100" y="22" textAnchor="middle" fontSize="12" fill="#7a6420" fontWeight="700">解析エンジン (olive-p)</text>
        <text x="100" y="38" textAnchor="middle" fontSize="10" fill="#a08930">OpenCV・フレーム抽出・検出</text>
      </g>

      {/* Arrow: Backend -> Soil API (right) */}
      <line x1="480" y1="250" x2="600" y2="295" stroke="#8aa87a" strokeWidth="2" markerEnd="url(#arrowGreen)" />
      <text x="555" y="275" fontSize="9" fill="#8aa87a">Bearer認証</text>

      {/* Arrow: Soil API -> Backend */}
      <line x1="600" y1="295" x2="480" y2="250" stroke="#5b9bd5" strokeWidth="1.5" strokeDasharray="4 3" markerEnd="url(#arrowBlue)" />
      <text x="555" y="290" fontSize="9" fill="#5b9bd5">センサーデータ</text>

      {/* Soil API box */}
      <g transform="translate(500, 295)">
        <rect x="0" y="0" width="200" height="55" rx="8" fill="#e8f2fc" stroke="#5b9bd5" strokeWidth="1.5" />
        <text x="100" y="22" textAnchor="middle" fontSize="12" fill="#2a5a8a" fontWeight="700">UKK-KOSEN API</text>
        <text x="100" y="38" textAnchor="middle" fontSize="10" fill="#4a7ab0">Cloudflare D1・土壌水分</text>
        <text x="100" y="52" textAnchor="middle" fontSize="9" fill="#7aa0c5">sensor1/2・気温・湿度</text>
      </g>

      {/* Arrow: Backend -> DB (bottom) */}
      <line x1="360" y1="250" x2="360" y2="370" stroke="#8aa87a" strokeWidth="2" markerEnd="url(#arrowGreen)" />
      <text x="372" y="315" fontSize="9" fill="#8aa87a">永続化</text>

      {/* DB box */}
      <g transform="translate(280, 370)">
        <rect x="0" y="0" width="160" height="40" rx="8" fill="#f5f0fa" stroke="#9a7ab5" strokeWidth="1.5" />
        <text x="80" y="18" textAnchor="middle" fontSize="12" fill="#5a3a7a" fontWeight="700">SQLite DB</text>
        <text x="80" y="32" textAnchor="middle" fontSize="9" fill="#8a6aaa">観測・動画・画像・通知</text>
      </g>

      {/* Arrow: Backend -> Notification bell (right of DB) */}
      <line x1="520" y1="250" x2="600" y2="380" stroke="#d4764e" strokeWidth="1.5" strokeDasharray="4 3" markerEnd="url(#arrowOrange)" />
      <text x="580" y="320" fontSize="9" fill="#d4764e">通知送信</text>

      {/* Notification bell */}
      <g transform="translate(580, 370)">
        <rect x="0" y="0" width="120" height="40" rx="8" fill="#fdf0eb" stroke="#d4764e" strokeWidth="1.5" />
        <text x="60" y="18" textAnchor="middle" fontSize="12" fill="#8a4a2a" fontWeight="700">🔔 通知</text>
        <text x="60" y="32" textAnchor="middle" fontSize="9" fill="#b06a3a">アラート・センサー停止</text>
      </g>

      {/* Arrow markers */}
      <defs>
        <marker id="arrowGreen" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#8aa87a" />
        </marker>
        <marker id="arrowGold" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#c9a84c" />
        </marker>
        <marker id="arrowBlue" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#5b9bd5" />
        </marker>
        <marker id="arrowOrange" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#d4764e" />
        </marker>
      </defs>
    </svg>
  );
}

function DataFlowSVG({ flows }: { flows: DataFlow[] }) {
  const steps = [
    { label: 'ユーザー', icon: '👤', color: '#e8efe4', border: '#6b8f5e' },
    { label: 'フロント', icon: '🖥️', color: '#f0f7ec', border: '#7ba86a' },
    { label: 'バックエンド', icon: '⚙️', color: '#f0f7ec', border: '#7ba86a' },
    { label: 'olive-p', icon: '🔍', color: '#fdf6e8', border: '#c9a84c' },
    { label: 'UKK API', icon: '📡', color: '#e8f2fc', border: '#5b9bd5' },
    { label: 'SQLite', icon: '💾', color: '#f5f0fa', border: '#9a7ab5' },
  ];

  return (
    <svg viewBox="0 0 720 160" className="w-full max-w-[720px]" xmlns="http://www.w3.org/2000/svg">
      <rect width="720" height="160" fill="#fafaf8" rx="12" />

      {/* Flow arrows and labels */}
      {flows.slice(0, 5).map((f, i) => {
        const x = 10 + i * 142;
        return (
          <g key={i} transform={`translate(${x}, 20)`}>
            <rect x="0" y="0" width="120" height="50" rx="8" fill={steps[i].color} stroke={steps[i].border} strokeWidth="1.5" />
            <text x="60" y="22" textAnchor="middle" fontSize="16">{steps[i].icon}</text>
            <text x="60" y="38" textAnchor="middle" fontSize="10" fill="#3d5a32" fontWeight="600">{steps[i].label}</text>
            {i < 5 && (
              <>
                <line x1="120" y1="25" x2="138" y2="25" stroke="#8aa87a" strokeWidth="1.5" markerEnd="url(#arrowGreen2)" />
                <text x="60" y="75" textAnchor="middle" fontSize="8" fill="#8aa87a">{flows[i]?.description?.slice(0, 15)}</text>
              </>
            )}
          </g>
        );
      })}

      {/* Return flow */}
      <g transform="translate(10, 100)">
        <rect x="0" y="0" width="700" height="45" rx="8" fill="#fdf6e8" stroke="#c9a84c" strokeWidth="1" strokeDasharray="4 3" />
        <text x="350" y="18" textAnchor="middle" fontSize="10" fill="#7a6420" fontWeight="600">戻り値: 体調スコア・検出結果・土壌水分・アドバイス</text>
        <text x="350" y="34" textAnchor="middle" fontSize="9" fill="#a08930">バックエンドが統合し、フロントエンドにJSONで返す → ユーザーに表示</text>
      </g>

      <defs>
        <marker id="arrowGreen2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#8aa87a" />
        </marker>
      </defs>
    </svg>
  );
}

function HealthAssessmentSVG() {
  return (
    <svg viewBox="0 0 720 340" className="w-full max-w-[720px]" xmlns="http://www.w3.org/2000/svg">
      <rect width="720" height="340" fill="#fafaf8" rx="12" />

      {/* Step 1: Input */}
      <g transform="translate(20, 20)">
        <rect x="0" y="0" width="160" height="60" rx="8" fill="#f0f7ec" stroke="#7ba86a" strokeWidth="1.5" />
        <text x="80" y="25" textAnchor="middle" fontSize="11" fill="#3d5a32" fontWeight="700">動画/画像</text>
        <text x="80" y="42" textAnchor="middle" fontSize="9" fill="#6b8f5e">フレーム抽出</text>
      </g>

      {/* Arrow 1 */}
      <line x1="180" y1="50" x2="220" y2="50" stroke="#8aa87a" strokeWidth="2" markerEnd="url(#arrowGreen3)" />

      {/* Step 2: Detection */}
      <g transform="translate(220, 20)">
        <rect x="0" y="0" width="160" height="60" rx="8" fill="#fdf6e8" stroke="#c9a84c" strokeWidth="1.5" />
        <text x="80" y="25" textAnchor="middle" fontSize="11" fill="#7a6420" fontWeight="700">olive-p 検出</text>
        <text x="80" y="42" textAnchor="middle" fontSize="9" fill="#a08930">葉数・実数・面積</text>
      </g>

      {/* Arrow 2 */}
      <line x1="380" y1="50" x2="420" y2="50" stroke="#8aa87a" strokeWidth="2" markerEnd="url(#arrowGreen3)" />

      {/* Step 3: Soil */}
      <g transform="translate(420, 20)">
        <rect x="0" y="0" width="140" height="60" rx="8" fill="#e8f2fc" stroke="#5b9bd5" strokeWidth="1.5" />
        <text x="70" y="25" textAnchor="middle" fontSize="11" fill="#2a5a8a" fontWeight="700">土壌水分統合</text>
        <text x="70" y="42" textAnchor="middle" fontSize="9" fill="#4a7ab0">センサー1/2・温湿度</text>
      </g>

      {/* Arrow 3 */}
      <line x1="560" y1="50" x2="600" y2="50" stroke="#8aa87a" strokeWidth="2" markerEnd="url(#arrowGreen3)" />

      {/* Step 4: Health State */}
      <g transform="translate(600, 20)">
        <rect x="0" y="0" width="100" height="60" rx="8" fill="#f5f0fa" stroke="#9a7ab5" strokeWidth="1.5" />
        <text x="50" y="25" textAnchor="middle" fontSize="11" fill="#5a3a7a" fontWeight="700">判定</text>
        <text x="50" y="42" textAnchor="middle" fontSize="9" fill="#8a6aaa">health_state</text>
      </g>

      {/* Arrow down from Step 4 */}
      <line x1="650" y1="80" x2="650" y2="110" stroke="#9a7ab5" strokeWidth="2" markerEnd="url(#arrowPurple)" />

      {/* Score output */}
      <g transform="translate(560, 110)">
        <rect x="0" y="0" width="180" height="45" rx="8" fill="#f5f0fa" stroke="#9a7ab5" strokeWidth="1.5" />
        <text x="90" y="20" textAnchor="middle" fontSize="11" fill="#5a3a7a" fontWeight="700">スコア 0.0 ~ 1.0</text>
        <text x="90" y="36" textAnchor="middle" fontSize="9" fill="#8a6aaa">total_health_score</text>
      </g>

      {/* Health states breakdown */}
      <g transform="translate(20, 130)">
        <text x="0" y="15" fontSize="11" fill="#3d5a32" fontWeight="700">判定基準:</text>
      </g>

      {/* happy */}
      <g transform="translate(20, 160)">
        <rect x="0" y="0" width="150" height="36" rx="6" fill="#4c9a5a" opacity="0.15" />
        <rect x="0" y="0" width="6" height="36" rx="3" fill="#4c9a5a" />
        <text x="18" y="15" fontSize="11" fill="#3d6a32" fontWeight="700">happy</text>
        <text x="18" y="28" fontSize="9" fill="#5a8a4a">≥ 0.75  順調</text>
      </g>

      {/* good */}
      <g transform="translate(185, 160)">
        <rect x="0" y="0" width="150" height="36" rx="6" fill="#84a841" opacity="0.15" />
        <rect x="0" y="0" width="6" height="36" rx="3" fill="#84a841" />
        <text x="18" y="15" fontSize="11" fill="#5a7a30" fontWeight="700">good</text>
        <text x="18" y="28" fontSize="9" fill="#7a9a40">0.55-0.75  良好</text>
      </g>

      {/* caution */}
      <g transform="translate(350, 160)">
        <rect x="0" y="0" width="150" height="36" rx="6" fill="#c99a2e" opacity="0.15" />
        <rect x="0" y="0" width="6" height="36" rx="3" fill="#c99a2e" />
        <text x="18" y="15" fontSize="11" fill="#8a6a10" fontWeight="700">caution</text>
        <text x="18" y="28" fontSize="9" fill="#a08a20">0.35-0.55  注意</text>
      </g>

      {/* danger */}
      <g transform="translate(515, 160)">
        <rect x="0" y="0" width="150" height="36" rx="6" fill="#c25a4a" opacity="0.15" />
        <rect x="0" y="0" width="6" height="36" rx="3" fill="#c25a4a" />
        <text x="18" y="15" fontSize="11" fill="#8a3a2a" fontWeight="700">danger</text>
        <text x="18" y="28" fontSize="9" fill="#a04a3a">&lt; 0.35  要管理</text>
      </g>

      {/* Input factors */}
      <g transform="translate(20, 220)">
        <text x="0" y="15" fontSize="11" fill="#3d5a32" fontWeight="700">使用する入力情報:</text>
      </g>

      <g transform="translate(20, 245)">
        {['葉数', '実数', '土壌水分1', '土壌水分2', '気温', '湿度'].map((label, i) => (
          <g key={i} transform={`translate(${i * 115}, 0)`}>
            <rect x="0" y="0" width="105" height="30" rx="6" fill="#f0f7ec" stroke="#c5d9b8" strokeWidth="1" />
            <text x="52" y="19" textAnchor="middle" fontSize="10" fill="#4a6a3a">{label}</text>
          </g>
        ))}
      </g>

      {/* Explanation */}
      <g transform="translate(20, 295)">
        <rect x="0" y="0" width="680" height="35" rx="6" fill="#fdf6e8" stroke="#e0d0a0" strokeWidth="1" />
        <text x="340" y="14" textAnchor="middle" fontSize="9" fill="#7a6420">
          動画フレームから葉と実を検出し、土壌水分センサーデータと統合してスコアを算出。
        </text>
        <text x="340" y="28" textAnchor="middle" fontSize="9" fill="#7a6420">
          スコアは 0.0〜1.0 の範囲で、しきい値（happy≥0.75, good≥0.55, caution≥0.35）で 4 段階に分類されます。
        </text>
      </g>

      <defs>
        <marker id="arrowGreen3" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#8aa87a" />
        </marker>
        <marker id="arrowPurple" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#9a7ab5" />
        </marker>
      </defs>
    </svg>
  );
}

function NotificationFlowSVG() {
  return (
    <svg viewBox="0 0 720 200" className="w-full max-w-[720px]" xmlns="http://www.w3.org/2000/svg">
      <rect width="720" height="200" fill="#fafaf8" rx="12" />

      {/* Trigger: Sensor offline */}
      <g transform="translate(20, 20)">
        <rect x="0" y="0" width="160" height="50" rx="8" fill="#fdf0eb" stroke="#d4764e" strokeWidth="1.5" />
        <text x="80" y="20" textAnchor="middle" fontSize="11" fill="#8a4a2a" fontWeight="700">📡 センサー停止検知</text>
        <text x="80" y="36" textAnchor="middle" fontSize="9" fill="#b06a3a">6h以上データなし</text>
      </g>

      {/* Arrow */}
      <line x1="180" y1="45" x2="220" y2="45" stroke="#d4764e" strokeWidth="2" markerEnd="url(#arrowOrange2)" />

      {/* Monitor thread */}
      <g transform="translate(220, 20)">
        <rect x="0" y="0" width="160" height="50" rx="8" fill="#f0f7ec" stroke="#7ba86a" strokeWidth="1.5" />
        <text x="80" y="20" textAnchor="middle" fontSize="11" fill="#3d5a32" fontWeight="700">⚙️ 監視スレッド</text>
        <text x="80" y="36" textAnchor="middle" fontSize="9" fill="#6b8f5e">1時間ごとにチェック</text>
      </g>

      {/* Arrow */}
      <line x1="380" y1="45" x2="420" y2="45" stroke="#d4764e" strokeWidth="2" markerEnd="url(#arrowOrange2)" />

      {/* Cooldown check */}
      <g transform="translate(420, 20)">
        <rect x="0" y="0" width="140" height="50" rx="8" fill="#fdf6e8" stroke="#c9a84c" strokeWidth="1.5" />
        <text x="70" y="20" textAnchor="middle" fontSize="11" fill="#7a6420" fontWeight="700">🕐 24hクールダウン</text>
        <text x="70" y="36" textAnchor="middle" fontSize="9" fill="#a08930">一日一回のみ送信</text>
      </g>

      {/* Arrow */}
      <line x1="560" y1="45" x2="600" y2="45" stroke="#d4764e" strokeWidth="2" markerEnd="url(#arrowOrange2)" />

      {/* Notification */}
      <g transform="translate(600, 20)">
        <rect x="0" y="0" width="100" height="50" rx="8" fill="#fdf0eb" stroke="#d4764e" strokeWidth="1.5" />
        <text x="50" y="20" textAnchor="middle" fontSize="16">🔔</text>
        <text x="50" y="38" textAnchor="middle" fontSize="10" fill="#8a4a2a" fontWeight="600">通知作成</text>
      </g>

      {/* Arrow down */}
      <line x1="650" y1="70" x2="650" y2="100" stroke="#d4764e" strokeWidth="2" markerEnd="url(#arrowOrange2)" />

      {/* Targets */}
      <g transform="translate(20, 100)">
        <text x="0" y="15" fontSize="11" fill="#3d5a32" fontWeight="700">通知先:</text>
      </g>

      {/* Admin */}
      <g transform="translate(20, 125)">
        <rect x="0" y="0" width="200" height="40" rx="8" fill="#f0f7ec" stroke="#7ba86a" strokeWidth="1.5" />
        <text x="100" y="18" textAnchor="middle" fontSize="11" fill="#3d5a32" fontWeight="700">👤 管理者アカウント</text>
        <text x="100" y="33" textAnchor="middle" fontSize="9" fill="#6b8f5e">全農家のデータを管理</text>
      </g>

      {/* Farmers */}
      <g transform="translate(240, 125)">
        <rect x="0" y="0" width="200" height="40" rx="8" fill="#f0f7ec" stroke="#7ba86a" strokeWidth="1.5" />
        <text x="100" y="18" textAnchor="middle" fontSize="11" fill="#3d5a32" fontWeight="700">👨‍🌾 農家アカウント</text>
        <text x="100" y="33" textAnchor="middle" fontSize="9" fill="#6b8f5e">自分の農園のデータのみ</text>
      </g>

      {/* All farmers */}
      <g transform="translate(460, 125)">
        <rect x="0" y="0" width="240" height="40" rx="8" fill="#fdf6e8" stroke="#c9a84c" strokeWidth="1" strokeDasharray="4 3" />
        <text x="120" y="18" textAnchor="middle" fontSize="10" fill="#7a6420" fontWeight="600">全アカウントに target_role=&quot;all&quot; で送信</text>
        <text x="120" y="33" textAnchor="middle" fontSize="9" fill="#a08930">通知一覧ページで確認可能</text>
      </g>

      {/* Other notifications */}
      <g transform="translate(20, 175)">
        <rect x="0" y="0" width="680" height="18" rx="4" fill="#f5f0fa" stroke="#c5b8d5" strokeWidth="0.5" />
        <text x="340" y="13" textAnchor="middle" fontSize="8" fill="#8a6aaa">
          その他: 体調アラート（解析時に自動判定）・管理者からの手動通知
        </text>
      </g>

      <defs>
        <marker id="arrowOrange2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#d4764e" />
        </marker>
      </defs>
    </svg>
  );
}

/* ===== Helper Components ===== */

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
