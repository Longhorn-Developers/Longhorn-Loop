// A stable Animated.Value for the life of a component.
//
// WHY THIS EXISTS. The RN idiom for this has always been
//
//     const opacity = useRef(new Animated.Value(0)).current;
//
// and Expo SDK 57 brought eslint-plugin-react-hooks v6, whose new
// `react-hooks/refs` rule makes it an ERROR: reading `.current` during render
// is exactly what that line does. It was the single largest source of lint
// failures in this repo (12 sites across 5 files).
//
// The rule is right in general even though the idiom is harmless here — a ref
// read during render is invisible to React, so if the value ever DID change
// the component would not re-render. It never changes, which is the whole
// point, and that is what makes useState the honest primitive for it:
// useState's lazy initializer runs exactly once and its value is guaranteed
// stable for the component's lifetime.
//
// NOT useMemo. useMemo is a performance hint that React is explicitly allowed
// to discard and recompute; a fresh Animated.Value mid-animation would reset
// the thing being animated. useState makes the stability a guarantee rather
// than an observation about current React internals.
//
// The setter is deliberately dropped: an Animated.Value is mutated through its
// own API (setValue, or by being handed to Animated.timing), never replaced.

import { useState } from 'react';
import { Animated } from 'react-native';

/**
 * @param initial Starting value, read once on first render.
 */
export function useAnimatedValue(initial: number): Animated.Value {
  const [value] = useState(() => new Animated.Value(initial));
  return value;
}
