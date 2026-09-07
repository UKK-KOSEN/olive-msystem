'use client';

import { PageHeader } from '@/components/PageHeader';

/**
 * Detailed explanation of the olive-p detection algorithm used by this dashboard.
 * Farmer-friendly, structured content.
 */
export default function AlgorithmPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 md:px-8">
      <PageHeader
        title="検出アルゴリズムについて"
        description="olive-p が画像・動画からオリーブの状態をどう解析しているかを、くわしく説明します。"
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
