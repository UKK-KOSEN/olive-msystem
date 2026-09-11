'use client';

/**
 * Inline <video> player used for video previews (uploads served via /media).
 * Range requests are supported by the backend, so seeking works in browser.
 */
export default function VideoPreview({ src, title }: { src: string; title?: string }) {
  return (
    <div className="w-full overflow-hidden rounded-lg bg-black">
      <video
        src={src}
        controls
        preload="metadata"
        className="mx-auto max-h-[420px] w-full"
        aria-label={title ? `動画プレビュー: ${title}` : '動画プレビュー'}
      />
    </div>
  );
}