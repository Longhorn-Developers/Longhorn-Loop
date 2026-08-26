import { useEffect, useState } from 'react';

/**
 * Trailing-edge debounce.
 *
 * Returns `value` only after it has stopped changing for `delayMs`. Every
 * keystroke restarts the timer, so a settled value is what callers key their
 * queries off — a React Query key built from this fires one request per pause
 * instead of one per character.
 *
 * Lifted out of app/org/register.tsx, which had the only copy, so Explore
 * search (LOOP-175) doesn't grow a second one that drifts.
 */
export function useDebounced<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const id = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);

  return settled;
}

export default useDebounced;
