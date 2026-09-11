'use client';

/**
 * Inline <video> player for uploaded videos (served via /media; Range requests
 * are supported so seeking works in browsers). `poster` shows a preview frame
 * (e.g. an analysed observation image) before playback starts.
 */
export default function VideoPreview({
  src,
  poster,
  title,
  durationText,
}: {
  src: string;
  poster?: string | null;
  title?: string;
  durationText?: string | null;
}) {
  return (
    <div className="relative w-full overflow-hidden rounded-lg bg-black">
      <video
        src={src}
        poster={poster || undefined}
        controls
        playsInline
        preload="metadata"
        className="mx-auto max-h-[60vh] w-full"
        aria-label={title ? `動画プレビュー: ${title}` : '動画プレビュー'}
      />
      {durationText && (
        <span className="pointer-events-none absolute bottom-3 right-3 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-white">
          {durationText}
        </span>
      )}
    </div>
  );
}