export function UpscaledBadge({ model, large }: { model?: string | null; large?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full bg-violet-600 font-semibold text-white shadow-sm ${
        large ? 'px-2.5 py-1 text-xs' : 'px-2 py-0.5 text-[10px]'
      }`}
      title={`この観測データは高解像度化（${model || 'realesrgan-x4plus'}）して解析されました`}
    >
      <svg viewBox="0 0 20 20" fill="currentColor" className={large ? 'h-3.5 w-3.5' : 'h-3 w-3'}>
        <path
          fillRule="evenodd"
          d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z"
          clipRule="evenodd"
        />
      </svg>
      高解像度解析
      {model ? <span className="opacity-80">{model}</span> : null}
    </span>
  );
}