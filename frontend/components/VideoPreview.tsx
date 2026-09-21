'use client';

export default function VideoPreview({
  src,
  poster,
  title,
  durationText,
  upscale,
}: {
  src: string;
  poster?: string | null;
  title?: string;
  durationText?: string | null;
  upscale?: boolean;
}) {
  return (
    <div className="relative mx-auto w-full max-w-3xl overflow-hidden rounded-lg bg-black">
      <div className="aspect-video w-full">
        <video
          src={src}
          poster={poster || undefined}
          controls
          playsInline
          preload="metadata"
          className="h-full w-full"
          aria-label={title ? `動画プレビュー: ${title}` : '動画プレビュー'}
        />
      </div>
      {upscale && (
        <span className="pointer-events-none absolute left-3 top-3 rounded bg-violet-600/90 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
          高解像度
        </span>
      )}
      {durationText && (
        <span className="pointer-events-none absolute bottom-3 right-3 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-white">
          {durationText}
        </span>
      )}
    </div>
  );
}
