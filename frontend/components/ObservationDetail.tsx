'use client';

import { Observation } from '@/lib/api';
import { HealthGauge, MetricBar } from './HealthGauge';
import { healthJa, healthColor } from './charts';
import { IconLeaf, IconOlive, IconActivity, IconClipboard } from './icons';

/**
 * Rich observation detail card showing all olive-p analysis results
 * in a farmer-friendly format.
 */
export function ObservationDetail({ obs }: { obs: Observation }) {
  const hs = obs.health_state;
  const result = obs.result as Record<string, any> | undefined;
  const details = result?.analysis_details as Record<string, any> | undefined;
  const stress = details?.stress as Record<string, any> | undefined;
  const leaf = details?.leaf as Record<string, any> | undefined;
  const fruit = details?.fruit as Record<string, any> | undefined;
  const canopy = details?.canopy as Record<string, any> | undefined;

  const score = hs?.score ?? stress?.overall_health_score ?? 0;
  const label = hs?.label ?? 'unknown';
  const color = healthColor(label);

  // thumbnail from annotated/raw frame
  const thumb = obs.annotated_path || obs.raw_frame_path;
  const srcType = obs.source_type || (obs.image_id ? 'image' : 'video');
  const srcBadge = srcType === 'image' ? '画像' : '動画';

  // Wrinkle summary from result
  const wrinkleSummary = result?.fruit_wrinkle_summary as Record<string, number> | undefined;
  const maturityBreakdown = result?.fruit_maturity_breakdown as Record<string, number> | undefined;

  return (
    <div className="rounded-xl border border-neutral-200 bg-white shadow-sm overflow-hidden">
      {/* Header: thumbnail + health gauge */}
      <div className="flex flex-wrap items-center gap-4 p-4 border-b border-neutral-100" style={{ background: `${color}08` }}>
        {thumb && (
          <div className="relative h-16 w-24 shrink-0 overflow-hidden rounded-lg bg-neutral-100">
            <img src={thumb} alt="観測フレーム" className="h-full w-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
            {srcBadge && (
              <span className="absolute left-1 top-1 rounded bg-black/50 px-1.5 text-[9px] font-medium text-white">{srcBadge}</span>
            )}
          </div>
        )}
        <HealthGauge score={score} size={100} strokeWidth={8} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-semibold"
              style={{ background: `${color}18`, color }}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: color }} />
              {healthJa(label)}
            </span>
            <span className="text-xs tabular-nums text-neutral-400">スコア {(score * 100).toFixed(0)}</span>
          </div>
          <div className="mt-1 text-lg font-bold" style={{ color }}>
            {hs?.message ?? '解析結果'}
          </div>
          <div className="text-xs text-neutral-500">
            {obs.observed_at ? new Date(obs.observed_at).toLocaleString('ja-JP') : ''}
            {obs.tree_id && (
              <span className="ml-2 inline-flex items-center rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                {obs.tree_id}
              </span>
            )}
            {result?.upscaled && (
              <span className="ml-2 inline-flex items-center rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-700">
                AIアップスケール
                {result?.upscale_model ? `（${result.upscale_model}）` : ''}
              </span>
            )}
            {obs.owner && (
              <span className="ml-2">・ {obs.owner.farm_name ?? obs.owner.display_name ?? obs.owner.username}</span>
            )}
          </div>
        </div>
      </div>

      {/* Key metrics grid */}
      <div className="grid grid-cols-3 gap-3 p-4">
        <MetricCard icon={<IconLeaf size={18} />} label="葉数" value={obs.leaf_count ?? result?.leaf_count ?? '-'} />
        <MetricCard icon={<IconOlive size={18} />} label="果実数" value={obs.fruit_count ?? result?.fruit_count ?? '-'} />
        <MetricCard icon={<IconActivity size={18} />} label="緑度" value={obs.green_coverage != null ? `${obs.green_coverage.toFixed(1)}%` : (result?.green_coverage != null ? `${result.green_coverage.toFixed(1)}%` : '-')} />
      </div>

      {/* Stress indicators */}
      <div className="px-4 pb-4 space-y-2">
        <h4 className="text-xs font-semibold text-neutral-500 uppercase tracking-wide">健康指標</h4>
        <MetricBar
          label="健康スコア"
          value={score}
          max={1}
          color={color}
        />
        <MetricBar
          label="水分ストレス"
          value={stress?.water_stress ?? hs?.water_stress ?? 0}
          max={1}
          unit=""
          color="#8a8a8a"
        />
        <MetricBar
          label="葉反り指数"
          value={stress?.components?.curl_factor != null ? (1 - stress.components.curl_factor) : (result?.leaf_curl_index ?? 0)}
          max={1}
          unit=""
          color="#8a8a8a"
        />
        <MetricBar
          label="シワ度"
          value={stress?.components?.wrinkle_factor != null ? (1 - stress.components.wrinkle_factor) : 0}
          max={1}
          unit=""
          color="#8a8a8a"
        />
        <MetricBar
          label="緑度ファクター"
          value={stress?.components?.green_coverage_factor ?? 0}
          max={1}
          unit=""
          color="#8a8a8a"
        />
        <MetricBar
          label="彩度ファクター"
          value={stress?.components?.saturation_factor ?? 0}
          max={1}
          unit=""
          color="#8a8a8a"
        />
      </div>

      {/* Leaf detail */}
      {leaf && (
        <div className="px-4 pb-4">
          <h4 className="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-2">葉の分析</h4>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <DetailItem label="色分布" value={`${leaf.color_distribution?.green_pct ?? 0}% 緑 / ${leaf.color_distribution?.yellow_pct ?? 0}% 黄`} />
            <DetailItem label="サイズ" value={`平均 ${leaf.size_distribution?.mean_area ?? 0}px`} />
            <DetailItem label="反り率" value={`${leaf.health?.curled_leaf_pct ?? 0}%`} />
            <DetailItem label="老化度" value={leaf.health?.senescence ?? '-'} />
            <DetailItem label="彩度" value={`${leaf.health?.mean_saturation ?? 0}`} />
            <DetailItem label="粗糙度" value={`${leaf.health?.roughness ?? 0}`} />
          </div>
        </div>
      )}

      {/* Fruit detail */}
      {fruit && (
        <div className="px-4 pb-4">
          <h4 className="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-2">果実の分析</h4>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <DetailItem label="サイズ" value={`平均 ${fruit.size_distribution?.mean_area ?? 0}px`} />
            <DetailItem label="色の均一性" value={`${fruit.color?.mean_color_consistency ?? 0}`} />
            {maturityBreakdown && Object.keys(maturityBreakdown).length > 0 && (
              <DetailItem
                label="成熟度"
                value={Object.entries(maturityBreakdown).map(([k, v]) => `${k}: ${v}`).join(', ')}
                wide
              />
            )}
            {wrinkleSummary && Object.keys(wrinkleSummary).length > 0 && (
              <DetailItem
                label="シワ分布"
                value={Object.entries(wrinkleSummary).filter(([, v]) => (v as number) > 0).map(([k, v]) => `${k}: ${v}`).join(', ')}
                wide
              />
            )}
          </div>
        </div>
      )}

      {/* Canopy */}
      {canopy && (
        <div className="px-4 pb-4">
          <h4 className="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-2">樹冠分析</h4>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <DetailItem label="被覆率" value={`${canopy.fullness_pct ?? 0}%`} />
            <DetailItem label="光貫通率" value={`${canopy.light_penetration_ratio ?? 0}`} />
            {canopy.spatial_density && (
              <DetailItem
                label="密度分布"
                value={`上${canopy.spatial_density.top ?? 0}% 中${canopy.spatial_density.mid ?? 0}% 下${canopy.spatial_density.bottom ?? 0}%`}
                wide
              />
            )}
          </div>
        </div>
      )}

      {/* Explanation text - prominent display with summary first */}
      {obs.explain_text && (
        <div className="px-4 pb-4">
          <ExplainSection text={obs.explain_text} />
        </div>
      )}
    </div>
  );
}

function MetricCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | number }) {
  return (
    <div className="flex flex-col items-center rounded-lg bg-neutral-50 p-2">
      <span className="text-lg">{icon}</span>
      <span className="text-xs text-neutral-500 mt-0.5">{label}</span>
      <span className="text-sm font-bold text-neutral-800">{value}</span>
    </div>
  );
}

function DetailItem({
  label,
  value,
  wide,
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <div className={wide ? 'col-span-2' : ''}>
      <span className="text-neutral-500">{label}: </span>
      <span className="text-neutral-800">{value}</span>
    </div>
  );
}

/**
 * Prominent explain section: shows SUMMARY first, full report collapsible.
 */
function ExplainSection({ text }: { text: string }) {
  // Extract SUMMARY section for quick view
  const summaryMatch = text.match(/SUMMARY\n={20,}\n([\s\S]*?)(?=\n[A-Z]{2,}\n={20,}|$)/);
  const summary = summaryMatch?.[1]?.trim();

  return (
    <div className="rounded-lg border border-neutral-200 bg-neutral-50 overflow-hidden">
      {/* Summary - always visible */}
      <div className="px-3 py-2 bg-neutral-100 border-b border-neutral-200">
        <div className="flex items-center gap-2">
          <IconClipboard size={16} className="text-neutral-500" />
          <span className="text-xs font-bold text-neutral-700 uppercase tracking-wide">検出レポート</span>
        </div>
      </div>
      {summary && (
        <div className="px-3 py-2 text-xs text-neutral-700 leading-relaxed border-b border-neutral-200">
          {summary.split('\n').map((line, i) => {
            const trimmed = line.trim();
            if (!trimmed) return <div key={i} className="h-1" />;
            if (trimmed.startsWith('- ')) {
              return (
                <div key={i} className="flex gap-1 ml-1">
                  <span className="text-neutral-400">•</span>
                  <span>{trimmed.slice(2)}</span>
                </div>
              );
            }
            return <div key={i}>{trimmed}</div>;
          })}
        </div>
      )}
      {/* Full report - collapsible */}
      <details className="group">
        <summary className="px-3 py-2 text-xs text-neutral-500 cursor-pointer hover:bg-neutral-100 transition-colors">
          全体の検出詳細を見る ▸
        </summary>
        <div className="px-3 py-2 max-h-64 overflow-y-auto">
          <ExplainText text={text} />
        </div>
      </details>
    </div>
  );
}

/**
 * Parse and render olive-p's explain_detection text with section headers
 * and formatted content for farmer-friendly display.
 */
function ExplainText({ text }: { text: string }) {
  const lines = text.split('\n');
  const sections: { title: string; content: string[] }[] = [];
  let current = { title: '', content: [] as string[] };

  for (const line of lines) {
    // Section headers: lines that are all caps or start with "DETECTION", "SUMMARY", "DETAILED"
    if (/^[A-Z]{2,}/.test(line.trim()) && line.trim().length < 60 && !line.includes(':')) {
      if (current.title || current.content.length > 0) {
        sections.push(current);
      }
      current = { title: line.trim(), content: [] };
    } else {
      current.content.push(line);
    }
  }
  if (current.title || current.content.length > 0) {
    sections.push(current);
  }

  // If no sections found, just render as plain text
  if (sections.length === 0 || (sections.length === 1 && !sections[0].title)) {
    return (
      <pre className="text-xs text-neutral-700 whitespace-pre-wrap font-sans leading-relaxed">
        {text}
      </pre>
    );
  }

  return (
    <div className="space-y-3">
      {sections.map((section, i) => (
        <div key={i}>
          {section.title && (
            <div className="text-xs font-bold text-neutral-700 mb-1 uppercase tracking-wide">
              {section.title}
            </div>
          )}
          <div className="text-xs text-neutral-600 leading-relaxed space-y-0.5">
            {section.content.map((line, j) => {
              const trimmed = line.trim();
              if (!trimmed) return <div key={j} className="h-1" />;
              // Highlight bullet points
              if (trimmed.startsWith('- ') || trimmed.startsWith('  -')) {
                return (
                  <div key={j} className="pl-2 flex gap-1">
                    <span className="text-neutral-400">•</span>
                    <span>{trimmed.replace(/^-\s*/, '')}</span>
                  </div>
                );
              }
              // Highlight indented details
              if (trimmed.startsWith('  ')) {
                return (
                  <div key={j} className="pl-3 text-neutral-500">
                    {trimmed}
                  </div>
                );
              }
              // Highlight labels like "WARNING:" or "NOTE:"
              if (/^(WARNING|NOTE):/.test(trimmed)) {
                return (
                  <div key={j} className="font-medium text-amber-700 bg-amber-50 rounded px-2 py-0.5">
                    {trimmed}
                  </div>
                );
              }
              return <div key={j}>{trimmed}</div>;
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
