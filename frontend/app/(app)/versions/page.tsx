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
                  <DataFlowSVG />
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
    <svg viewBox="0 0 720 430" className="w-full max-w-[720px]" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="システム構成図">
      {/* Clean white background — no decorative tint */}
      <rect width="720" height="430" fill="#ffffff" />

      <defs>
        <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#9aa298" />
        </marker>
      </defs>

      {/* ===== top: user ===== */}
      <g>
        <rect x="315" y="18" width="90" height="34" rx="6" fill="#f2f2f0" stroke="#c9c9c4" strokeWidth="1" />
        <text x="360" y="39" textAnchor="middle" fontSize="12.5" fill="#44443f" fontWeight="600">ユーザー</text>
      </g>
      <line x1="360" y1="52" x2="360" y2="78" stroke="#9aa298" strokeWidth="1.4" markerEnd="url(#arr)" />

      {/* ===== frontend ===== */}
      <g>
        <rect x="220" y="80" width="280" height="44" rx="6" fill="#eef3ea" stroke="#6d8f5a" strokeWidth="1.2" />
        <text x="360" y="99" textAnchor="middle" fontSize="13" fill="#3c5233" fontWeight="700">フロントエンド (Next.js)</text>
        <text x="360" y="114" textAnchor="middle" fontSize="10" fill="#6d7f63">ページ UI・アップロード・グラフ描画</text>
      </g>
      <line x1="360" y1="124" x2="360" y2="150" stroke="#9aa298" strokeWidth="1.4" markerEnd="url(#arr)" />
      <text x="369" y="141" fontSize="9.5" fill="#8a9288">REST API</text>

      {/* ===== backend (center, wider) ===== */}
      <g>
        <rect x="180" y="152" width="360" height="56" rx="6" fill="#eef3ea" stroke="#6d8f5a" strokeWidth="1.2" />
        <text x="360" y="174" textAnchor="middle" fontSize="13.5" fill="#3c5233" fontWeight="700">バックエンド (FastAPI :8000)</text>
        <text x="360" y="190" textAnchor="middle" fontSize="10" fill="#6d7f63">認証 ・ 動画解析キュー ・ 土壌水分統合 ・ ユーザー管理</text>
        <text x="360" y="203" textAnchor="middle" fontSize="9.5" fill="#8c9884">センサー監視スレッド ・ 通知自動送信</text>
      </g>

      {/* ===== left: olive-p ===== */}
      <line x1="262" y1="208" x2="150" y2="250" stroke="#9aa298" strokeWidth="1.4" markerEnd="url(#arr)" />
      <text x="196" y="226" fontSize="9.5" fill="#8a9288">解析依頼</text>
      <line x1="150" y1="260" x2="262" y2="208" stroke="#9aa298" strokeWidth="1.2" strokeDasharray="4 3" markerEnd="url(#arr)" />
      <text x="196" y="262" fontSize="9.5" fill="#9a9980">検出結果</text>
      <g>
        <rect x="30" y="248" width="210" height="58" rx="6" fill="#f5f0e6" stroke="#b8a878" strokeWidth="1.1" />
        <text x="135" y="270" textAnchor="middle" fontSize="12.5" fill="#5d5438" fontWeight="700">解析エンジン (olive-p)</text>
        <text x="135" y="286" textAnchor="middle" fontSize="9.5" fill="#8a7f5e">OpenCV ・ フレーム抽出 ・ 検出</text>
        <text x="135" y="299" textAnchor="middle" fontSize="9" fill="#a89a78">葉数・実数・健康特徴</text>
      </g>

      {/* ===== right: soil API ===== */}
      <line x1="458" y1="208" x2="570" y2="250" stroke="#9aa298" strokeWidth="1.4" markerEnd="url(#arr)" />
      <text x="524" y="226" fontSize="9.5" fill="#8a9288">Bearer 認証</text>
      <line x1="570" y1="260" x2="458" y2="208" stroke="#9aa298" strokeWidth="1.2" strokeDasharray="4 3" markerEnd="url(#arr)" />
      <text x="524" y="262" fontSize="9.5" fill="#7d8ea0">センサーデータ</text>
      <g>
        <rect x="480" y="248" width="210" height="58" rx="6" fill="#edf1f5" stroke="#8a9db0" strokeWidth="1.1" />
        <text x="585" y="270" textAnchor="middle" fontSize="12.5" fill="#405d74" fontWeight="700">土壌水分 API (外部)</text>
        <text x="585" y="286" textAnchor="middle" fontSize="9.5" fill="#6a7f92">Cloudflare D1 ・ UKK-KOSEN</text>
        <text x="585" y="299" textAnchor="middle" fontSize="9" fill="#8a9cb0">sensor1/2 ・ 気温 ・ 湿度</text>
      </g>

      {/* ===== bottom: DB + notifications ===== */}
      <line x1="360" y1="208" x2="360" y2="360" stroke="#9aa298" strokeWidth="1.4" markerEnd="url(#arr)" />
      <text x="369" y="300" fontSize="9.5" fill="#8a9288">保存 / 参照</text>
      <g>
        <rect x="250" y="362" width="220" height="42" rx="6" fill="#f3f1f6" stroke="#a89db8" strokeWidth="1.1" />
        <text x="360" y="382" textAnchor="middle" fontSize="12.5" fill="#5c5470" fontWeight="700">SQLite データベース</text>
        <text x="360" y="397" textAnchor="middle" fontSize="9.5" fill="#8a8498">観測 ・ 動画 ・ 画像 ・ 通知</text>
      </g>

      <line x1="480" y1="208" x2="590" y2="362" stroke="#9aa298" strokeWidth="1.2" strokeDasharray="4 3" markerEnd="url(#arr)" />
      <text x="556" y="290" fontSize="9.5" fill="#8a9288">通知送信</text>
      <g>
        <rect x="500" y="362" width="180" height="42" rx="6" fill="#fbf1ec" stroke="#c48a68" strokeWidth="1.1" />
        <text x="590" y="382" textAnchor="middle" fontSize="12.5" fill="#7d4a2e" fontWeight="700">通知</text>
        <text x="590" y="397" textAnchor="middle" fontSize="9.5" fill="#a87858">体調アラート ・ センサー停止</text>
      </g>
    </svg>
  );
}

function DataFlowSVG() {
  const steps = [
    { label: 'ユーザー', color: '#f2f2f0', border: '#c9c9c4', sub: '操作入力' },
    { label: 'フロント', color: '#eef3ea', border: '#6d8f5a', sub: 'リクエスト' },
    { label: 'バックエンド', color: '#eef3ea', border: '#6d8f5a', sub: '処理・統合' },
    { label: 'olive-p', color: '#f5f0e6', border: '#b8a878', sub: '画像解析' },
    { label: '外部API', color: '#edf1f5', border: '#8a9db0', sub: '土壌水分' },
    { label: 'SQLite', color: '#f3f1f6', border: '#a89db8', sub: '永続化' },
  ];

  return (
    <svg viewBox="0 0 720 170" className="w-full max-w-[720px]" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="データフロー図">
      <rect width="720" height="170" fill="#ffffff" />

      <defs>
        <marker id="arr2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#9aa298" />
        </marker>
      </defs>

      {steps.map((s, i) => {
        const x = 10 + i * 117;
        return (
          <g key={i}>
            <rect x={x} y="18" width="106" height="46" rx="6" fill={s.color} stroke={s.border} strokeWidth="1.1" />
            <text x={x + 53} y="37" textAnchor="middle" fontSize="11.5" fill="#3f463b" fontWeight="700">{s.label}</text>
            <text x={x + 53} y="52" textAnchor="middle" fontSize="8.5" fill="#8a9288">{s.sub}</text>
            {i < steps.length - 1 && (
              <line x1={x + 106} y1="41" x2={x + 114} y2="41" stroke="#9aa298" strokeWidth="1.4" markerEnd="url(#arr2)" />
            )}
          </g>
        );
      })}

      <text x="710" y="45" textAnchor="end" fontSize="9" fill="#8a9288">→ 検出・測定データ</text>

      {/* return flow */}
      <line x1="360" y1="82" x2="360" y2="96" stroke="#9aa298" strokeWidth="1.4" markerEnd="url(#arr2)" />
      <g>
        <rect x="160" y="98" width="400" height="40" rx="6" fill="#f7f3e8" stroke="#b8a878" strokeWidth="1" />
        <text x="360" y="116" textAnchor="middle" fontSize="10.5" fill="#5d5438" fontWeight="600">バックエンドが統合 → フロントに JSON で返却</text>
        <text x="360" y="130" textAnchor="middle" fontSize="9.5" fill="#8a7f5e">体調スコア ・ 検出結果 ・ 土壌水分 ・ アドバイス</text>
      </g>
    </svg>
  );
}

function HealthAssessmentSVG() {
  const box = { rx: 6, sw: 1.1 };
  return (
    <svg viewBox="0 0 720 330" className="w-full max-w-[720px]" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="体調判定のフロー図">
      <rect width="720" height="330" fill="#ffffff" />

      <defs>
        <marker id="arr3" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#9aa298" />
        </marker>
        <marker id="arrP" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#a89db8" />
        </marker>
      </defs>

      {/* Step 1 input */}
      <g>
        <rect x="24" y="20" width="150" height="54" rx={box.rx} fill="#f2f2f0" stroke="#c9c9c4" strokeWidth={box.sw} />
        <text x="99" y="42" textAnchor="middle" fontSize="12" fill="#44443f" fontWeight="700">動画 / 画像</text>
        <text x="99" y="58" textAnchor="middle" fontSize="9.5" fill="#8a9288">フレーム抽出</text>
      </g>
      <line x1="174" y1="47" x2="212" y2="47" stroke="#9aa298" strokeWidth="1.4" markerEnd="url(#arr3)" />

      {/* Step 2 detection */}
      <g>
        <rect x="214" y="20" width="150" height="54" rx={box.rx} fill="#f5f0e6" stroke="#b8a878" strokeWidth={box.sw} />
        <text x="289" y="42" textAnchor="middle" fontSize="12" fill="#5d5438" fontWeight="700">olive-p が検出</text>
        <text x="289" y="58" textAnchor="middle" fontSize="9.5" fill="#8a7f5e">葉数 ・ 実数 ・ 面積</text>
      </g>
      <line x1="364" y1="47" x2="402" y2="47" stroke="#9aa298" strokeWidth="1.4" markerEnd="url(#arr3)" />

      {/* Step 3 soil */}
      <g>
        <rect x="404" y="20" width="140" height="54" rx={box.rx} fill="#edf1f5" stroke="#8a9db0" strokeWidth={box.sw} />
        <text x="474" y="42" textAnchor="middle" fontSize="12" fill="#405d74" fontWeight="700">土壌水分を統合</text>
        <text x="474" y="58" textAnchor="middle" fontSize="9.5" fill="#6a7f92">sensor1/2 ・ 温湿度</text>
      </g>
      <line x1="544" y1="47" x2="576" y2="47" stroke="#9aa298" strokeWidth="1.4" markerEnd="url(#arr3)" />

      {/* Step 4 score */}
      <g>
        <rect x="578" y="20" width="118" height="54" rx={box.rx} fill="#f3f1f6" stroke="#a89db8" strokeWidth={box.sw} />
        <text x="637" y="42" textAnchor="middle" fontSize="12" fill="#5c5470" fontWeight="700">スコア算出</text>
        <text x="637" y="58" textAnchor="middle" fontSize="9.5" fill="#8a8498">0.0 〜 1.0</text>
      </g>

      <text x="60" y="104" fontSize="11" fill="#44443f" fontWeight="700">判定基準（4 段階）:</text>

      {/* states */}
      {[
        { name: 'happy', range: '≥ 0.75', note: '順調', color: '#4c9a5a' },
        { name: 'good', range: '0.55 – 0.75', note: '良好', color: '#84a841' },
        { name: 'caution', range: '0.35 – 0.55', note: '注意', color: '#c99a2e' },
        { name: 'danger', range: '< 0.35', note: '要管理', color: '#c25a4a' },
      ].map((s, i) => (
        <g key={s.name} transform={`translate(${24 + i * 172}, 112)`}>
          <rect x="0" y="0" width="160" height="34" rx="5" fill="#ffffff" stroke="#deded8" strokeWidth="0.8" />
          <rect x="0" y="0" width="4" height="34" rx="2" fill={s.color} />
          <text x="14" y="15" fontSize="11.5" fill="#44443f" fontWeight="700">{s.name}</text>
          <text x="14" y="28" fontSize="9.5" fill="#8a9288">{s.range}</text>
          <text x="150" y="15" textAnchor="end" fontSize="9.5" fill={s.color} fontWeight="600">{s.note}</text>
        </g>
      ))}

      <text x="60" y="176" fontSize="11" fill="#44443f" fontWeight="700">使用する入力情報:</text>

      {/* input chips */}
      <g transform="translate(24, 186)">
        {['葉数', '実数', '土壌水分 1', '土壌水分 2', '気温', '湿度'].map((label, i) => (
          <g key={i} transform={`translate(${i * 114}, 0)`}>
            <rect x="0" y="0" width="104" height="28" rx="14" fill="#f5f5f2" stroke="#d8d8d2" strokeWidth="0.8" />
            <text x="52" y="18" textAnchor="middle" fontSize="10" fill="#5b6255">{label}</text>
          </g>
        ))}
      </g>

      {/* note */}
      <rect x="24" y="236" width="672" height="70" rx="6" fill="#fafaf7" stroke="#e3e3dd" strokeWidth="0.8" />
      <text x="360" y="258" textAnchor="middle" fontSize="9.5" fill="#6a6f63">
        動画フレームから葉と実を検出し、土壌水分センサーの値を統合して健康スコアを算出。
      </text>
      <text x="360" y="274" textAnchor="middle" fontSize="9.5" fill="#6a6f63">
        スコアは 0.0〜1.0 で、しきい値（0.75 / 0.55 / 0.35）によって 4 段階に分類されます。
      </text>
      <text x="360" y="290" textAnchor="middle" fontSize="9.5" fill="#6a6f63">
        判定結果は観測として保存され、ダッシュボード・推移・カレンダーで確認できます。
      </text>
    </svg>
  );
}

function NotificationFlowSVG() {
  return (
    <svg viewBox="0 0 720 210" className="w-full max-w-[720px]" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="通知システムのフロー図">
      <rect width="720" height="210" fill="#ffffff" />

      <defs>
        <marker id="arr4" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#9aa298" />
        </marker>
      </defs>

      {/* step 1 */}
      <g>
        <rect x="20" y="20" width="150" height="50" rx="6" fill="#f5f2f0" stroke="#c9b8b0" strokeWidth="1.1" />
        <text x="95" y="39" textAnchor="middle" fontSize="11.5" fill="#5a504b" fontWeight="700">センサー停止を検知</text>
        <text x="95" y="55" textAnchor="middle" fontSize="9" fill="#8a807a">6 時間以上データなし</text>
      </g>
      <line x1="170" y1="45" x2="210" y2="45" stroke="#9aa298" strokeWidth="1.4" markerEnd="url(#arr4)" />

      {/* step 2 */}
      <g>
        <rect x="212" y="20" width="150" height="50" rx="6" fill="#eef3ea" stroke="#6d8f5a" strokeWidth="1.1" />
        <text x="287" y="39" textAnchor="middle" fontSize="11.5" fill="#3c5233" fontWeight="700">監視スレッド</text>
        <text x="287" y="55" textAnchor="middle" fontSize="9" fill="#6d7f63">1 時間ごとに確認</text>
      </g>
      <line x1="362" y1="45" x2="402" y2="45" stroke="#9aa298" strokeWidth="1.4" markerEnd="url(#arr4)" />

      {/* step 3 */}
      <g>
        <rect x="404" y="20" width="140" height="50" rx="6" fill="#f5f0e6" stroke="#b8a878" strokeWidth="1.1" />
        <text x="474" y="39" textAnchor="middle" fontSize="11.5" fill="#5d5438" fontWeight="700">24 時間クールダウン</text>
        <text x="474" y="55" textAnchor="middle" fontSize="9" fill="#8a7f5e">一日一回のみ送信</text>
      </g>
      <line x1="544" y1="45" x2="576" y2="45" stroke="#9aa298" strokeWidth="1.4" markerEnd="url(#arr4)" />

      {/* step 4 */}
      <g>
        <rect x="578" y="20" width="122" height="50" rx="6" fill="#eef3ea" stroke="#6d8f5a" strokeWidth="1.1" />
        <text x="639" y="39" textAnchor="middle" fontSize="11.5" fill="#3c5233" fontWeight="700">通知を作成</text>
        <text x="639" y="55" textAnchor="middle" fontSize="9" fill="#6d7f63">全アカウント宛</text>
      </g>

      <line x1="639" y1="70" x2="639" y2="100" stroke="#9aa298" strokeWidth="1.4" markerEnd="url(#arr4)" />

      <text x="40" y="116" fontSize="11" fill="#44443f" fontWeight="700">通知先:</text>

      {/* targets */}
      <g>
        <rect x="40" y="126" width="190" height="40" rx="6" fill="#f2f2f0" stroke="#c9c9c4" strokeWidth="1" />
        <text x="135" y="143" textAnchor="middle" fontSize="11" fill="#44443f" fontWeight="600">管理者</text>
        <text x="135" y="157" textAnchor="middle" fontSize="9" fill="#8a9288">全農家のデータを管理</text>
      </g>
      <g>
        <rect x="250" y="126" width="190" height="40" rx="6" fill="#f2f2f0" stroke="#c9c9c4" strokeWidth="1" />
        <text x="345" y="143" textAnchor="middle" fontSize="11" fill="#44443f" fontWeight="600">農家</text>
        <text x="345" y="157" textAnchor="middle" fontSize="9" fill="#8a9288">自分の農園のデータのみ</text>
      </g>
      <g>
        <rect x="460" y="126" width="240" height="40" rx="6" fill="#f7f3e8" stroke="#b8a878" strokeWidth="1" strokeDasharray="4 3" />
        <text x="580" y="143" textAnchor="middle" fontSize="10.5" fill="#5d5438" fontWeight="600">target_role = &quot;all&quot; で送信</text>
        <text x="580" y="157" textAnchor="middle" fontSize="9" fill="#8a7f5e">通知一覧ページで確認できる</text>
      </g>

      {/* other triggers */}
      <rect x="40" y="182" width="660" height="20" rx="4" fill="#fafaf7" stroke="#e3e3dd" strokeWidth="0.8" />
      <text x="370" y="195" textAnchor="middle" fontSize="9" fill="#8a9288">
        その他の通知: 体調アラート（解析時に自動判定）・ 管理者からの手動通知
      </text>
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
