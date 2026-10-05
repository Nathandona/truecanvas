/** The Truecanvas mark (a coral T) and wordmark. */
export function Logo({ size = 22, wordmark = true }: { size?: number; wordmark?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2 font-semibold tracking-tight text-ink">
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
        <path fill="#f2774a" fillRule="evenodd" d="M4 5h56v18H4z M22 14h20v46H22z" />
      </svg>
      {wordmark && <span className="text-[17px]">Truecanvas</span>}
    </span>
  );
}
