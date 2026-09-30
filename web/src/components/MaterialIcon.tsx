/**
 * A Material Symbols icon by name (https://fonts.google.com/icons). The font is
 * bundled (material-symbols package), so icons work offline.
 */
import 'material-symbols/outlined.css';
import { clsx } from 'clsx';

export function MaterialIcon({ name, className, size }: { name: string; className?: string; size?: number }) {
  return (
    <span className={clsx('material-symbols-outlined select-none leading-none', className)} style={size ? { fontSize: size } : undefined} aria-hidden>
      {name}
    </span>
  );
}
