'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, VersionInfo, FeatureArchitecture, ComponentInfo, ApiEndpointGroup } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import ErrorNotice from '@/components/ErrorNotice';

/**
 * Detailed explanation of the olive-p detection algorithm used by this dashboard,
 * plus the overall system architecture (merged from the old /versions page).
 * Farmer-friendly, structured content.
 */
export default function AlgorithmPage() {
  const [info, setInfo] = useState<VersionInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setInfo(await api.versions());
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'バックエンドに接続できません。');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const arch = info?.architecture;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 md:px-8">
      <PageHeader
        title="検出アルゴリズム・システム構成"
        description="olive-p が画像・動画からオリーブの状態をどう解析しているかと、システム全体の構成をくわしく解説します。"
      />
      <div className="space-y-8">
        {/* Overview */}
        <section className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
          <SectionTitle n={1} title="はじめに：このシステムの仕組み" />
          <p className="text-sm leading-relaxed text-neutral-600">
            このダッシュボードは、<strong>olive-p</strong> という検出エンジンが計算した結果をそのまま表示しています。
            アップロードされた画像（または動画の1フレーム）から、<strong>葉</strong>と<strong>果実</strong>を自動で見つけ出し、
            それぞれの色・形・しわ・反りを数値化します。そして、それらの数値から<strong>健康スコア</strong>を算出します。
          </p>
          <div className="mt-4 rounded-lg bg-neutral-50 p-4">
            <p className="text-xs font-semibold text-neutral-500 mb-2">処理の全体像</p>
            <div className="flex flex-wrap items-center gap-2 text-sm text-neutral-700">
              <span className="rounded-md bg-white border border-neutral-200 px-2.5 py-1">画像入力</span>
              <Arrow />
              <span className="rounded-md bg-white border border-neutral-200 px-2.5 py-1">前処理</span>
              <Arrow />
              <span className="rounded-md bg-white border border-neutral-200 px-2.5 py-1">葉・果実の検出</span>
              <Arrow />
              <span className="rounded-md bg-white border border-neutral-200 px-2.5 py-1">特徴の分析</span>
              <Arrow />
              <span className="rounded-md bg-white border border-neutral-200 px-2.5 py-1">健康スコア算出</span>
            </div>
          </div>
        </section>

        {/* Detection steps in detail */}
        <section className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
          <SectionTitle n={2} title="検出の流れ（詳細）" />
          <ol className="space-y-5">
            <Step
              n={1}
              title="画像の前処理（Preprocessing）"
              desc="いろいろな撮影環境でも安定して解析できるよう、画像を調整します。明るさ・コントラストの補正、ぼやけの軽減、必要に応じて解像度の自動調整（アップスケール）を行います。"
            />
            <Step
              n={2}
              title="葉の検出（Leaf Detection）"
              desc="緑色の色相（hue）と彩度（saturation）を手がかりに、画像の中から葉と思われる領域を特定します。各領域について面積・形（縦横比・充実度）を計測し、「これは葉だ」と確信度つきで認識します。"
            />
            <Step
              n={3}
              title="果実の検出（Fruit Detection）"
              desc="成熟したオリーブの色（黄緑・紫・黒など）と丸い形を手がかりに、果実を検出します。サイズや円形度の条件を満たすものを果実として識別します。"
            />
            <Step
              n={4}
              title="葉の分析（Leaf Analysis）"
              desc="検出した各葉について、①色（緑の濃淡・老き具合）②大きさ ③反り具合（カール指数） ④粗糙度（表面のキメ） ⑤彩度を計測します。葉全体の平均値・分布を集計します。"
            />
            <Step
              n={5}
              title="果実の分析（Fruit Analysis）"
              desc="各果実の成熟度（未熟・中間・完熟）と、表面のしわ具合（滑らか・ややしわ・しわ・強いしわ）を自動で分類します。しわの数は水分不足の重要なサインです。"
            />
            <Step
              n={6}
              title="健康スコアの算出（Health Score）"
              desc="上記で得られた値を、重み付けして1つのスコア（0〜1）に統合します。数値をそのまま使うため、同じ条件で撮影し続ければ「推移（グラフ）」として比較できます。"
            />
          </ol>
        </section>

        {/* Score formula */}
        <section className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
          <SectionTitle n={3} title="健康スコアの計算式" />
          <p className="mb-4 text-sm text-neutral-600">
            以下の4つの指標を、それぞれの基準で0〜1に正規化してから合成します。
          </p>
          <div className="space-y-2.5">
            <FormulaRow weight={0.3} label="緑度（緑被率）" desc="画像に占める健康な緑色の葉の割合。葉が豊かで元気かを示します。" />
            <FormulaRow weight={0.25} label="葉の反り（カール指数）" desc="水分不足で葉が丸まっていないかを反映。反っていればストレスのサインです。" />
            <FormulaRow weight={0.25} label="果実のシワ" desc="果実が乾燥してしぼんでいないかを反映。シワが多いほど要注意です。" />
            <FormulaRow weight={0.2} label="彩度（色の鮮やかさ）" desc="葉色の鮮やかさ。彩度が高いほど葉が健康で活力があることを示します。" />
          </div>
          <div className="mt-5 rounded-lg bg-neutral-50 p-4 font-mono text-xs text-neutral-700">
            <div className="mb-1 font-sans font-semibold text-neutral-700">健康スコア =</div>
            <div>0.30 × 緑度 ＋ 0.25 × 葉反り ＋ 0.25 × シワ ＋ 0.20 × 彩度</div>
          </div>
        </section>

        {/* Score interpretation */}
        <section className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
          <SectionTitle n={4} title="スコアの見方（判定基準）" />
          <div className="space-y-2.5">
            <StateRow score="0.75（75点）以上" label="健康" color="#4c9a5a" desc="葉も果実も良好な状態です。この状態を保ちましょう。" />
            <StateRow score="0.55 〜 0.75" label="良好" color="#84a841" desc="概ね健康ですが、水分や葉の様子をときどき観察してください。" />
            <StateRow score="0.35 〜 0.55" label="注意" color="#c99a2e" desc="水分不足や葉の変色の可能性があります。水やりや環境を見直しましょう。" />
            <StateRow score="0.35（35点）未満" label="要管理" color="#c25a4a" desc="体調不良が疑われます。早めに対応しましょう。" />
          </div>
          <p className="mt-4 text-xs text-neutral-400">
            この閾値（0.75 / 0.55 / 0.35）は管理者が設定画面から調整できます。
          </p>
        </section>

        {/* Technical details */}
        <section className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
          <SectionTitle n={5} title="よりくわしい技術解説" />
          <div className="space-y-4 text-sm text-neutral-600 leading-relaxed">
            <div>
              <h4 className="font-semibold text-neutral-800 mb-1">検出方式</h4>
              <p>
                機械学習の「学習済みモデル」を使うのではなく、<strong>色空間（HSV）と画像の幾何学的特徴</strong>を組み合わせた
                ルールベースのアルゴリズムです。これにより、追加の学習データなしでランタイムに高速に動作します。
              </p>
            </div>
            <div>
              <h4 className="font-semibold text-neutral-800 mb-1">マルチシグナル検出</h4>
              <p>
                葉・果実それぞれについて、複数のシグナル（色・形・大きさ）を組み合わせて検出します。単一の条件で誤検出するのを
                防ぎ、確信度（confidence）付きで結果を返します。薄暗い・逆光などの条件下でもある程度安定します。
              </p>
            </div>
            <div>
              <h4 className="font-semibold text-neutral-800 mb-1">ぼやけ・画質の診断</h4>
              <p>
                画像の鮮明さ（ブラー）を自動評価します。ぼやけた画像では判定精度が下がるため、その旨がレポートに記されます。
                できるだけピントの合った画像を撮影してください。
              </p>
            </div>
            <div>
              <h4 className="font-semibold text-neutral-800 mb-1">解像度の自動調整</h4>
              <p>
                高解像度画像はそのままでは処理が重くなるため、必要に応じて縮小（ローレゾリューション）して解析し、
                精度が必要な箇所は元解像度で詳細解析を行います。アップスケール処理が入る場合はレポートに記載されます。
              </p>
            </div>
          </div>
        </section>

        {/* Limitations */}
        <section className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
          <SectionTitle n={6} title="知っておくと良いこと（限界）" />
          <ul className="space-y-2 text-sm text-neutral-600 leading-relaxed">
            <li>• 葉がほとんど写っていない・逆光・強くぼやけた画像では、精度が落ちることがあります。</li>
            <li>• 検出スコアは「その1枚の画像」に対する評価です。複数回・複数日で観測して推移を見るのがおすすめです。</li>
            <li>• 実際の圃場での判断（農薬・剪定など）は、数値とあわせてご自身の目視確認を優先してください。</li>
          </ul>
        </section>

        {/* ===== SYSTEM OVERVIEW (merged from /versions) ===== */}
        <section className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
          <SectionTitle n={7} title="システム構成" />
          <p className="mb-4 text-sm leading-relaxed text-neutral-600">
            「検出エンジン（olive-p）」だけでなく、フロント・バックエンド・データベース・外部API・通知まで、
            このシステム全体がどのようにつながっているかを確認できます。バージョン情報や API 一覧は管理者のご確認にもどうぞ。
          </p>

          <ErrorNotice message={error} onRetry={load} />

          {!info && !error && (
            <p className="py-6 text-center text-sm text-neutral-400">システム情報を読み込み中…</p>
          )}

          {info && (
            <div className="space-y-6">
              {/* Version info */}
              <div className="rounded-lg border border-neutral-200 p-5">
                <h3 className="label mb-3">バージョン</h3>
                <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <VersionItem label="olive-msystem フロントエンド" value={info.olive_msystem.frontend} />
                  <VersionItem label="olive-msystem バックエンド" value={info.olive_msystem.backend} />
                  <VersionItem label="olive-p (解析エンジン)" value={info.olive_p ?? '—'} />
                  <VersionItem label="Python" value={info.python} />
                  <VersionItem label="実行環境" value={info.platform} small />
                </dl>
              </div>

              {/* Dependencies */}
              <div className="rounded-lg border border-neutral-200 p-5">
                <h3 className="label mb-3">依存ライブラリ</h3>
                <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {Object.entries(info.dependencies).map(([name, ver]) => (
                    <VersionItem key={name} label={name} value={ver || '—'} />
                  ))}
                </dl>
              </div>

              {arch && (
                <>
                  {/* ===== SYSTEM ARCHITECTURE SVG ===== */}
                  <div className="rounded-lg border border-neutral-200 p-5">
                    <h3 className="label mb-3">システム構成図</h3>
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
                  </div>

                  {/* ===== DATA FLOW SVG ===== */}
                  <div className="rounded-lg border border-neutral-200 p-5">
                    <h3 className="label mb-3">データフロー図</h3>
                    <p className="text-xs text-neutral-400 mb-4">
                      ユーザーの操作からデータがどのように流れ、最終的に体調判定が出力されるかを示します。
                    </p>
                    <div className="flex justify-center overflow-x-auto">
                      <DataFlowSVG />
                    </div>
                  </div>

                  {/* ===== HEALTH ASSESSMENT FLOW SVG ===== */}
                  <div className="rounded-lg border border-neutral-200 p-5">
                    <h3 className="label mb-3">体調判定のフロー</h3>
                    <p className="text-xs text-neutral-400 mb-4">
                      動画フレームからどのように体調スコアが算出されるかを図で示します。
                    </p>
                    <div className="flex justify-center overflow-x-auto">
                      <HealthAssessmentSVG />
                    </div>
                  </div>

                  {/* ===== NOTIFICATION FLOW SVG ===== */}
                  <div className="rounded-lg border border-neutral-200 p-5">
                    <h3 className="label mb-3">通知システム</h3>
                    <p className="text-xs text-neutral-400 mb-4">
                      体調アラートやセンサー停止通知がどのようにユーザーに届くかを図で示します。
                    </p>
                    <div className="flex justify-center overflow-x-auto">
                      <NotificationFlowSVG />
                    </div>
                  </div>

                  {/* ===== API ENDPOINTS ===== */}
                  <div className="rounded-lg border border-neutral-200 p-5">
                    <h3 className="label mb-3">API エンドポイント一覧</h3>
                    <p className="text-xs text-neutral-400 mb-4">
                      バックエンドが公開しているすべての REST API エンドポイントです。
                    </p>
                    <div className="space-y-4">
                      {arch.apiEndpoints.map((g: ApiEndpointGroup) => (
                        <div key={g.group}>
                          <h4 className="text-sm font-semibold text-neutral-700 mb-2">{g.group}</h4>
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
                  </div>

                  {/* ===== PAGE STRUCTURE ===== */}
                  <div className="rounded-lg border border-neutral-200 p-5">
                    <h3 className="label mb-3">ページ構成</h3>
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
                  </div>

                  {/* ===== SOIL SENSOR ===== */}
                  <div className="rounded-lg border border-neutral-200 p-5">
                    <h3 className="label mb-3">土壌水分センサー情報</h3>
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
                  </div>

                  {/* ===== SECURITY ===== */}
                  <div className="rounded-lg border border-neutral-200 p-5">
                    <h3 className="label mb-3">セキュリティ</h3>
                    <div className="space-y-2 text-xs text-neutral-600">
                      <p>• <strong>認証</strong>: JWT トークンベース。農家は自分のデータのみ閲覧可能。</p>
                      <p>• <strong>管理者</strong>: 全農家のデータにアクセス可能。農家選択でスコープ切替。</p>
                      <p>• <strong>API キー</strong>: 土壌水分 API キーは .gitignore 対象。GitHub にコミットされません。</p>
                      <p>• <strong>管理者パスワード</strong>: 初回起動時にランダム 10 桁数値に自動変更。ログに出力。</p>
                      <p>• <strong>CORS</strong>: 開発環境では localhost:3001 のみ許可。</p>
                    </div>
                  </div>
                </>
              )}

              <p className="text-center text-xs text-neutral-400">
                更新日時: {new Date().toLocaleString('ja-JP')}
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function SectionTitle({ n, title }: { n: number; title: string }) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-neutral-900 text-sm font-bold text-white">
        {n}
      </span>
      <h2 className="text-base font-semibold text-neutral-900">{title}</h2>
    </div>
  );
}

function Arrow() {
  return <span className="text-neutral-300">➜</span>;
}

function FormulaRow({ weight, label, desc }: { weight: number; label: string; desc: string }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-neutral-100 bg-neutral-50 px-3 py-2.5">
      <span className="w-16 shrink-0 text-center font-mono text-lg font-bold text-neutral-800">
        {Math.round(weight * 100)}%
      </span>
      <div>
        <div className="text-sm font-medium text-neutral-800">{label}</div>
        <div className="mt-0.5 text-xs text-neutral-500">{desc}</div>
      </div>
    </div>
  );
}

function Step({ n, title, desc }: { n: number; title: string; desc: string }) {
  return (
    <li className="flex items-start gap-3">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-neutral-100 text-sm font-bold text-neutral-700">
        {n}
      </span>
      <div>
        <div className="text-sm font-medium text-neutral-800">{title}</div>
        <div className="mt-1 text-xs leading-relaxed text-neutral-500">{desc}</div>
      </div>
    </li>
  );
}

function StateRow({ score, label, color, desc }: { score: string; label: string; color: string; desc: string }) {
  return (
    <div className="flex items-start gap-3 rounded-lg bg-neutral-50 px-3 py-2.5">
      <span className="mt-0.5 h-3 w-3 shrink-0 rounded-full" style={{ background: color }} />
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-bold" style={{ color }}>{label}</span>
          <span className="font-mono text-xs text-neutral-500">{score}</span>
        </div>
        <div className="mt-0.5 text-xs text-neutral-500">{desc}</div>
      </div>
    </div>
  );
}

/* ===== SVG Diagram Components (from /versions) ===== */

function SystemArchitectureSVG({ components }: { components: ComponentInfo[] }) {
  return (
    <svg viewBox="0 0 720 430" className="w-full max-w-[720px]" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="システム構成図">
      <rect width="720" height="430" fill="#ffffff" />

      <defs>
        <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#9aa298" />
        </marker>
      </defs>

      <g>
        <rect x="315" y="18" width="90" height="34" rx="6" fill="#f2f2f0" stroke="#c9c9c4" strokeWidth="1" />
        <text x="360" y="39" textAnchor="middle" fontSize="12.5" fill="#44443f" fontWeight="600">ユーザー</text>
      </g>
      <line x1="360" y1="52" x2="360" y2="78" stroke="#9aa298" strokeWidth="1.4" markerEnd="url(#arr)" />

      <g>
        <rect x="220" y="80" width="280" height="44" rx="6" fill="#eef3ea" stroke="#6d8f5a" strokeWidth="1.2" />
        <text x="360" y="99" textAnchor="middle" fontSize="13" fill="#3c5233" fontWeight="700">フロントエンド (Next.js)</text>
        <text x="360" y="114" textAnchor="middle" fontSize="10" fill="#6d7f63">ページ UI・アップロード・グラフ描画</text>
      </g>
      <line x1="360" y1="124" x2="360" y2="150" stroke="#9aa298" strokeWidth="1.4" markerEnd="url(#arr)" />
      <text x="369" y="141" fontSize="9.5" fill="#8a9288">REST API</text>

      <g>
        <rect x="180" y="152" width="360" height="56" rx="6" fill="#eef3ea" stroke="#6d8f5a" strokeWidth="1.2" />
        <text x="360" y="174" textAnchor="middle" fontSize="13.5" fill="#3c5233" fontWeight="700">バックエンド (FastAPI :8000)</text>
        <text x="360" y="190" textAnchor="middle" fontSize="10" fill="#6d7f63">認証 ・ 動画解析キュー ・ 土壌水分統合 ・ ユーザー管理</text>
        <text x="360" y="203" textAnchor="middle" fontSize="9.5" fill="#8c9884">センサー監視スレッド ・ 通知自動送信</text>
      </g>

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

      <g>
        <rect x="24" y="20" width="150" height="54" rx={box.rx} fill="#f2f2f0" stroke="#c9c9c4" strokeWidth={box.sw} />
        <text x="99" y="42" textAnchor="middle" fontSize="12" fill="#44443f" fontWeight="700">動画 / 画像</text>
        <text x="99" y="58" textAnchor="middle" fontSize="9.5" fill="#8a9288">フレーム抽出</text>
      </g>
      <line x1="174" y1="47" x2="212" y2="47" stroke="#9aa298" strokeWidth="1.4" markerEnd="url(#arr3)" />

      <g>
        <rect x="214" y="20" width="150" height="54" rx={box.rx} fill="#f5f0e6" stroke="#b8a878" strokeWidth={box.sw} />
        <text x="289" y="42" textAnchor="middle" fontSize="12" fill="#5d5438" fontWeight="700">olive-p が検出</text>
        <text x="289" y="58" textAnchor="middle" fontSize="9.5" fill="#8a7f5e">葉数 ・ 実数 ・ 面積</text>
      </g>
      <line x1="364" y1="47" x2="402" y2="47" stroke="#9aa298" strokeWidth="1.4" markerEnd="url(#arr3)" />

      <g>
        <rect x="404" y="20" width="140" height="54" rx={box.rx} fill="#edf1f5" stroke="#8a9db0" strokeWidth={box.sw} />
        <text x="474" y="42" textAnchor="middle" fontSize="12" fill="#405d74" fontWeight="700">土壌水分を統合</text>
        <text x="474" y="58" textAnchor="middle" fontSize="9.5" fill="#6a7f92">sensor1/2 ・ 温湿度</text>
      </g>
      <line x1="544" y1="47" x2="576" y2="47" stroke="#9aa298" strokeWidth="1.4" markerEnd="url(#arr3)" />

      <g>
        <rect x="578" y="20" width="118" height="54" rx={box.rx} fill="#f3f1f6" stroke="#a89db8" strokeWidth={box.sw} />
        <text x="637" y="42" textAnchor="middle" fontSize="12" fill="#5c5470" fontWeight="700">スコア算出</text>
        <text x="637" y="58" textAnchor="middle" fontSize="9.5" fill="#8a8498">0.0 〜 1.0</text>
      </g>

      <text x="60" y="104" fontSize="11" fill="#44443f" fontWeight="700">判定基準（4 段階）:</text>

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

      <g transform="translate(24, 186)">
        {['葉数', '実数', '土壌水分 1', '土壌水分 2', '気温', '湿度'].map((label, i) => (
          <g key={i} transform={`translate(${i * 114}, 0)`}>
            <rect x="0" y="0" width="104" height="28" rx="14" fill="#f5f5f2" stroke="#d8d8d2" strokeWidth="0.8" />
            <text x="52" y="18" textAnchor="middle" fontSize="10" fill="#5b6255">{label}</text>
          </g>
        ))}
      </g>

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

      <g>
        <rect x="20" y="20" width="150" height="50" rx="6" fill="#f5f2f0" stroke="#c9b8b0" strokeWidth="1.1" />
        <text x="95" y="39" textAnchor="middle" fontSize="11.5" fill="#5a504b" fontWeight="700">センサー停止を検知</text>
        <text x="95" y="55" textAnchor="middle" fontSize="9" fill="#8a807a">6 時間以上データなし</text>
      </g>
      <line x1="170" y1="45" x2="210" y2="45" stroke="#9aa298" strokeWidth="1.4" markerEnd="url(#arr4)" />

      <g>
        <rect x="212" y="20" width="150" height="50" rx="6" fill="#eef3ea" stroke="#6d8f5a" strokeWidth="1.1" />
        <text x="287" y="39" textAnchor="middle" fontSize="11.5" fill="#3c5233" fontWeight="700">監視スレッド</text>
        <text x="287" y="55" textAnchor="middle" fontSize="9" fill="#6d7f63">1 時間ごとに確認</text>
      </g>
      <line x1="362" y1="45" x2="402" y2="45" stroke="#9aa298" strokeWidth="1.4" markerEnd="url(#arr4)" />

      <g>
        <rect x="404" y="20" width="140" height="50" rx="6" fill="#f5f0e6" stroke="#b8a878" strokeWidth="1.1" />
        <text x="474" y="39" textAnchor="middle" fontSize="11.5" fill="#5d5438" fontWeight="700">24 時間クールダウン</text>
        <text x="474" y="55" textAnchor="middle" fontSize="9" fill="#8a7f5e">一日一回のみ送信</text>
      </g>
      <line x1="544" y1="45" x2="576" y2="45" stroke="#9aa298" strokeWidth="1.4" markerEnd="url(#arr4)" />

      <g>
        <rect x="578" y="20" width="122" height="50" rx="6" fill="#eef3ea" stroke="#6d8f5a" strokeWidth="1.1" />
        <text x="639" y="39" textAnchor="middle" fontSize="11.5" fill="#3c5233" fontWeight="700">通知を作成</text>
        <text x="639" y="55" textAnchor="middle" fontSize="9" fill="#6d7f63">全アカウント宛</text>
      </g>

      <line x1="639" y1="70" x2="639" y2="100" stroke="#9aa298" strokeWidth="1.4" markerEnd="url(#arr4)" />

      <text x="40" y="116" fontSize="11" fill="#44443f" fontWeight="700">通知先:</text>

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

      <rect x="40" y="182" width="660" height="20" rx="4" fill="#fafaf7" stroke="#e3e3dd" strokeWidth="0.8" />
      <text x="370" y="195" textAnchor="middle" fontSize="9" fill="#8a9288">
        その他の通知: 体調アラート（解析時に自動判定）・ 管理者からの手動通知
      </text>
    </svg>
  );
}

/* ===== Helper Components (from /versions) ===== */

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