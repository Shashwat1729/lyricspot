export function Logo({ size = 34 }: { size?: number }) {
  return (
    <span
      className="flex items-center justify-center rounded-[10px] bg-go"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg width={size * 0.53} height={size * 0.53} viewBox="0 0 24 24" fill="none" stroke="#0E0F0C" strokeWidth="2.4" strokeLinecap="round">
        <path d="M4 10v4" />
        <path d="M8 6v12" />
        <path d="M12 3v18" />
        <path d="M16 7v10" />
        <path d="M20 10v4" />
      </svg>
    </span>
  );
}
