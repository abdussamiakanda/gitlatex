/**
 * Guard against effects that return something other than a cleanup function.
 *
 * React calls whatever an effect returned when the component unmounts; a
 * non-function there crashes the whole tree ("TypeError: l is not a function"
 * in production builds). One such effect took the editor down when the
 * command palette opened, in a state we could not reproduce. This keeps the
 * app running and names the effect in the console so it can be fixed.
 *
 * It works because the bundle reads hooks from React's exports object at call
 * time (`(0, import_react.useEffect)(...)`), so patching that object reaches
 * every component.
 */
import React from 'react';

type Effect = () => unknown;
type Hook = (create: Effect, deps?: unknown[]) => void;

const hooks = React as unknown as Record<'useEffect' | 'useLayoutEffect', Hook & { guarded?: boolean }>;

for (const name of ['useEffect', 'useLayoutEffect'] as const) {
  const original = hooks[name];
  if (original.guarded) continue;
  const guarded: Hook & { guarded?: boolean } = (create, deps) =>
    original(() => {
      const cleanup = create();
      if (cleanup === undefined || typeof cleanup === 'function') return cleanup;
      console.error(`[gitlatex] A ${name} returned ${String(cleanup)} instead of a cleanup function; ignoring it. Effect:\n${String(create).slice(0, 400)}`);
      return undefined;
    }, deps);
  guarded.guarded = true;
  hooks[name] = guarded;
}
