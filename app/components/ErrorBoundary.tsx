import { captureError } from '@/app/lib/monitoring';
import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';

/**
 * The app's only React error boundary (LOOP-279).
 *
 * WHY THIS EXISTS. In a release build an unhandled JS exception during render
 * is not a red box — it reaches the native exception handler and the app dies.
 * That is what "the app broke when I typed X" looks like from the outside, and
 * with `app/lib/monitoring.ts` still a documented no-op there is no trace
 * afterwards either. A boundary converts a class of hard crashes into a screen
 * the tester can describe and recover from, which is worth having regardless of
 * whether any individual throw is ever found and fixed.
 *
 * It is NOT a substitute for fixing the throw. Anything that lands here is a
 * bug; `captureError` is called so it starts reporting the moment monitoring
 * stops being a stub.
 *
 * `resetKeys` exists because the interesting failures are input-driven: if the
 * subtree blew up on one search query, the next query should get a fresh
 * attempt rather than leaving the user stuck on the fallback until they kill
 * the app. Pass whatever input drives the subtree.
 */

interface Props {
  children: React.ReactNode;
  /** Where this boundary sits, e.g. 'explore'. Used as the capture label. */
  label: string;
  /** Re-render the children when any of these change (shallow compared). */
  resetKeys?: readonly unknown[];
  /** Copy shown in the fallback, above the retry button. */
  message?: string;
}

interface State {
  hasError: boolean;
}

function keysChanged(a: readonly unknown[] = [], b: readonly unknown[] = []): boolean {
  return a.length !== b.length || a.some((value, index) => !Object.is(value, b[index]));
}

export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidUpdate(prevProps: Props) {
    if (this.state.hasError && keysChanged(prevProps.resetKeys, this.props.resetKeys)) {
      this.setState({ hasError: false });
    }
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    captureError(this.props.label, error);
    // Kept even though monitoring is a stub: on a dev/TestFlight build this is
    // the only place the component stack is ever printed.
    console.error(`[ErrorBoundary:${this.props.label}]`, error, info?.componentStack);
  }

  private handleRetry = () => this.setState({ hasError: false });

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <View
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 }}
      >
        <Text
          className="font-roboto text-lhlMutedText"
          style={{ fontSize: 16, textAlign: 'center' }}
        >
          {this.props.message ?? 'Something went wrong here.'}
        </Text>
        <TouchableOpacity
          onPress={this.handleRetry}
          accessibilityRole="button"
          accessibilityLabel="Try again"
          hitSlop={8}
          style={{ marginTop: 16 }}
        >
          <Text className="font-roboto-semibold text-lhlBurntOrange" style={{ fontSize: 15 }}>
            Try again
          </Text>
        </TouchableOpacity>
      </View>
    );
  }
}
