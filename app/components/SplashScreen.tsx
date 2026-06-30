import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';

interface Props {
  onFinish: () => void;
}

export default function SplashScreen({ onFinish }: Props) {
  const ringScale = useRef(new Animated.Value(0.4)).current;
  const ringOpacity = useRef(new Animated.Value(0.8)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const logoScale = useRef(new Animated.Value(0.85)).current;
  const taglineOpacity = useRef(new Animated.Value(0)).current;
  const containerOpacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.sequence([
      // Ring expands outward as logo fades in
      Animated.parallel([
        Animated.timing(ringScale, { toValue: 1.6, duration: 700, useNativeDriver: true }),
        Animated.timing(ringOpacity, { toValue: 0, duration: 700, useNativeDriver: true }),
        Animated.timing(logoOpacity, { toValue: 1, duration: 500, useNativeDriver: true }),
        Animated.spring(logoScale, { toValue: 1, friction: 7, useNativeDriver: true }),
      ]),
      // Tagline fades in
      Animated.timing(taglineOpacity, { toValue: 1, duration: 400, useNativeDriver: true }),
      // Hold
      Animated.delay(900),
      // Fade out
      Animated.timing(containerOpacity, { toValue: 0, duration: 450, useNativeDriver: true }),
    ]).start(() => onFinish());
  }, []);

  return (
    <Animated.View style={[styles.container, { opacity: containerOpacity }]}>
      {/* Expanding ring */}
      <Animated.View
        style={[styles.ring, { opacity: ringOpacity, transform: [{ scale: ringScale }] }]}
      />

      {/* Logo */}
      <Animated.View
        style={{ opacity: logoOpacity, transform: [{ scale: logoScale }], alignItems: 'center' }}
      >
        <Text style={styles.emoji}>🤘</Text>
        <Text style={styles.title}>LONGHORN</Text>
        <View style={styles.loopRow}>
          <View style={styles.loopLine} />
          <Text style={styles.loopText}>LOOP</Text>
          <View style={styles.loopLine} />
        </View>
      </Animated.View>

      {/* Tagline */}
      <Animated.Text style={[styles.tagline, { opacity: taglineOpacity }]}>
        THE UT EVENTS PLATFORM
      </Animated.Text>
    </Animated.View>
  );
}

const ORANGE = '#BF5700';

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: ORANGE,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 999,
  },
  ring: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 110,
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.5)',
  },
  emoji: {
    fontSize: 72,
    marginBottom: 12,
  },
  title: {
    color: '#fff',
    fontSize: 38,
    fontWeight: '900',
    letterSpacing: 10,
  },
  loopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 6,
  },
  loopLine: {
    height: 1,
    width: 28,
    backgroundColor: 'rgba(255,255,255,0.6)',
  },
  loopText: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 22,
    fontWeight: '300',
    letterSpacing: 12,
  },
  tagline: {
    position: 'absolute',
    bottom: 80,
    color: 'rgba(255,255,255,0.55)',
    fontSize: 11,
    letterSpacing: 3,
  },
});
