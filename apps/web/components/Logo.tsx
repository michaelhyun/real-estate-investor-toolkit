/* The BlueDoor mark: a blue rounded tile holding a white arched door. Same
   drawing as the Hub's (BlueDoorCRM src/components/Logo.tsx); keep them in
   step. Rules: minimum 20px, never recoloured outside blue or white. */
export function LogoMark({ size = 32, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className={`shrink-0 ${className}`}>
      <rect width="32" height="32" rx="8" fill="var(--primary)" />
      <path d="M10.5 24V13.5a5.5 5.5 0 0 1 11 0V24z" fill="#ffffff" />
      <circle cx="18.6" cy="17.6" r="1.3" fill="var(--primary)" />
    </svg>
  );
}
