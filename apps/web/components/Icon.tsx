/* BlueDoor's icon set: Material Icons Round, loaded in the root layout — the
   same set the Hub uses. Decorative by default; pass `label` when the icon is
   the only thing that says what a control does. */
export function Icon({
  name, size = 20, className = '', label,
}: { name: string; size?: number; className?: string; label?: string }) {
  /* The outer span owns layout classes: Google's stylesheet sets `display` on
     .material-icons-round and would beat Tailwind's `hidden`. */
  return (
    <span
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
      className={`inline-flex shrink-0 items-center justify-center ${className}`}
      style={{ width: size, height: size }}
    >
      <span translate="no" className="material-icons-round select-none overflow-hidden leading-none" style={{ fontSize: size }}>
        {name}
      </span>
    </span>
  );
}
