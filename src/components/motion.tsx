import React, { useEffect, useRef } from 'react';
import { Animated, Easing, LayoutAnimation, Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';
import Svg, { Circle } from 'react-native-svg';
import { useTheme } from '@/theme';

/**
 * Motion, in one place.
 *
 * Everything here uses React Native's own Animated driver on the native
 * thread, so it needs no worklet plugin and cannot fall over on a build that
 * lacks one. The rules are the same everywhere: motion confirms a press,
 * introduces what just arrived, and shows what moved — and it is over in a
 * quarter of a second, because a technician is not here to watch the app.
 */

const SPRING = { friction: 6, tension: 220, useNativeDriver: true } as const;

/**
 * A pressable that gives a little under the thumb.
 *
 * A gloved press on a flat card gives no sign it landed; the scale does, and
 * it is felt as much as seen because the haptic fires on the same frame.
 */
export function Bounce({
  children, onPress, onLongPress, disabled, style, haptic = 'light', scaleTo = 0.97, accessibilityLabel, accessibilityRole = 'button',
}: {
  children: React.ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  haptic?: 'light' | 'medium' | 'selection' | 'none';
  scaleTo?: number;
  accessibilityLabel?: string;
  accessibilityRole?: 'button' | 'link' | 'tab';
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const down = () => Animated.spring(scale, { toValue: scaleTo, ...SPRING }).start();
  const up = () => Animated.spring(scale, { toValue: 1, ...SPRING }).start();
  return (
    <Pressable
      onPress={() => {
        if (disabled || !onPress) return;
        if (haptic === 'selection') void Haptics.selectionAsync();
        else if (haptic !== 'none') {
          void Haptics.impactAsync(haptic === 'medium' ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light);
        }
        onPress();
      }}
      onLongPress={onLongPress}
      onPressIn={disabled ? undefined : down}
      onPressOut={disabled ? undefined : up}
      disabled={disabled}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!disabled }}
    >
      <Animated.View style={[{ transform: [{ scale }] }, style]}>{children}</Animated.View>
    </Pressable>
  );
}

/**
 * Fades and rises a block into place when it mounts.
 *
 * Staggered by index so a list arrives as a cascade rather than a slab. The
 * stagger is capped: past the tenth item nobody is watching the animation,
 * they are scrolling, and a row that arrives late under a moving thumb is a
 * row they cannot press.
 */
export function Reveal({
  children, index = 0, style, distance = 14,
}: { children: React.ReactNode; index?: number; style?: StyleProp<ViewStyle>; distance?: number }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const rise = useRef(new Animated.Value(distance)).current;
  useEffect(() => {
    const delay = Math.min(index, 10) * 40;
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 260, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(rise, { toValue: 0, duration: 320, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
  }, [opacity, rise, index]);
  return (
    <Animated.View style={[{ opacity, transform: [{ translateY: rise }] }, style]}>{children}</Animated.View>
  );
}

/**
 * A breathing placeholder for a row that is still being read.
 *
 * Shown instead of nothing, because a blank screen for the half second the
 * database takes reads as an empty list, and an empty list reads as "there
 * is no work here".
 */
export function Skeleton({ height = 72, style }: { height?: number; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  const pulse = useRef(new Animated.Value(0.35)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 0.9, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0.35, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return (
    <Animated.View
      style={[{ height, borderRadius: t.radius.lg, backgroundColor: t.color.surfaceAlt, opacity: pulse }, style]}
    />
  );
}

/**
 * Animates the next layout change: a tile moving, a row leaving.
 *
 * Call it just before the state change. On the new architecture Android
 * needs no flag for this; the old flag is deliberately not set, since on
 * Fabric it only logs a warning.
 */
export function animateNextLayout(): void {
  LayoutAnimation.configureNext({
    duration: 240,
    create: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
    update: { type: LayoutAnimation.Types.spring, springDamping: 0.8 },
    delete: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
  });
}

/**
 * A ring that fills to a fraction, for hours against a week or checks
 * against a routine. Drawn rather than animated: the value it shows changes
 * when a person acts, and the act is the animation.
 */
export function ProgressRing({
  fraction, size = 64, stroke = 7, colour, track, children,
}: { fraction: number; size?: number; stroke?: number; colour?: string; track?: string; children?: React.ReactNode }) {
  const t = useTheme();
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const f = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0));
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={track ?? t.color.surfaceAlt} strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={colour ?? t.color.accent}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${c} ${c}`}
          strokeDashoffset={c * (1 - f)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      {children}
    </View>
  );
}
