import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useTheme, type Theme } from '@/theme';

/**
 * Shared UI primitives.
 *
 * Sized for one-handed use on a ladder: nothing interactive is smaller than the
 * theme's touch target, and destructive actions are visually separated from
 * routine ones.
 */

export function Screen({
  children,
  scroll = true,
  padded = true,
  edges = ['top'],
}: {
  children: React.ReactNode;
  scroll?: boolean;
  padded?: boolean;
  edges?: ('top' | 'bottom' | 'left' | 'right')[];
}) {
  const t = useTheme();
  const inner = padded ? { padding: t.space(4), gap: t.space(3) } : undefined;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.color.bg }} edges={edges}>
      {scroll ? (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[inner, { paddingBottom: t.space(12) }]}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[{ flex: 1 }, inner]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

export function Card({
  children,
  style,
  onPress,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
}) {
  const t = useTheme();
  const base: ViewStyle = {
    backgroundColor: t.color.surface,
    borderRadius: t.radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.color.border,
    padding: t.space(4),
  };
  if (!onPress) return <View style={[base, style]}>{children}</View>;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [base, pressed && { backgroundColor: t.color.surfaceAlt }, style]}
      android_ripple={{ color: t.color.borderStrong }}
    >
      {children}
    </Pressable>
  );
}

type TextTone = 'default' | 'muted' | 'faint' | 'accent' | 'pass' | 'fail' | 'warn';

const toneColor = (t: Theme, tone: TextTone): string =>
  ({
    default: t.color.text,
    muted: t.color.textMuted,
    faint: t.color.textFaint,
    accent: t.color.accentText,
    pass: t.color.pass,
    fail: t.color.fail,
    warn: t.color.warn,
  })[tone];

export function Txt({
  children,
  size = 'md',
  tone = 'default',
  weight = '400',
  mono,
  style,
  numberOfLines,
}: {
  children: React.ReactNode;
  size?: keyof Theme['font']['size'];
  tone?: TextTone;
  weight?: TextStyle['fontWeight'];
  mono?: boolean;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
}) {
  const t = useTheme();
  return (
    <Text
      numberOfLines={numberOfLines}
      style={[
        { color: toneColor(t, tone), fontSize: t.font.size[size], fontWeight: weight },
        mono && { fontFamily: t.font.mono },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

export function H1({ children }: { children: React.ReactNode }) {
  // Tighter tracking as the size goes up: at display sizes the default spacing
  // reads as gappy rather than confident.
  return <Txt size="xxl" weight="800" style={{ letterSpacing: -0.8 }}>{children}</Txt>;
}

/**
 * A section heading, marked with a short flame rule.
 *
 * These screens are long — a settings page runs to a dozen sections — and a
 * heading that differs from body text only by weight disappears when someone is
 * scrolling with one hand on a ladder. The bar gives every section a fixed
 * left edge to scan down, and it is the one place the brand colour appears
 * purely as identity rather than as something to press.
 */
export function H2({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space(2.5), marginTop: t.space(4) }}>
      <View
        style={{
          width: 4,
          height: t.font.size.lg,
          borderRadius: 2,
          backgroundColor: t.color.accent,
        }}
      />
      <Txt size="lg" weight="800" style={{ letterSpacing: -0.2 }}>{children}</Txt>
    </View>
  );
}

export function Label({ children }: { children: React.ReactNode }) {
  return (
    <Txt size="xs" tone="muted" weight="700" style={{ textTransform: 'uppercase', letterSpacing: 0.8 }}>
      {children}
    </Txt>
  );
}

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  icon,
  style,
  compact,
}: {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  icon?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  compact?: boolean;
}) {
  const t = useTheme();
  const bg: Record<ButtonVariant, string> = {
    primary: t.color.accent,
    secondary: t.color.surfaceAlt,
    ghost: 'transparent',
    danger: t.color.failBg,
  };
  const fg: Record<ButtonVariant, string> = {
    primary: t.color.onAccent,
    secondary: t.color.text,
    ghost: t.color.accentText,
    danger: t.color.fail,
  };

  const isDisabled = disabled || loading;

  return (
    <Pressable
      onPress={() => {
        if (isDisabled) return;
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress();
      }}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!isDisabled }}
      style={({ pressed }) => [
        {
          // 44 rather than 40 even when compact: 40 was under the 44dp floor,
          // and these are pressed with gloves on.
          minHeight: compact ? 44 : t.touch,
          paddingHorizontal: t.space(compact ? 3.5 : 5),
          borderRadius: t.radius.md,
          backgroundColor: bg[variant],
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: t.space(2),
          borderWidth: variant === 'ghost' ? StyleSheet.hairlineWidth : 0,
          borderColor: t.color.border,
          opacity: isDisabled ? 0.45 : pressed ? 0.9 : 1,
          // The primary action throws a little of its own colour onto the
          // surface under it, so the one button that matters is findable in
          // peripheral vision without reading anything. Dropped while pressed
          // and while disabled, so the glow always means "this is live".
          ...(variant === 'primary' && !isDisabled
            ? {
                shadowColor: t.color.accent,
                shadowOpacity: pressed ? 0.25 : 0.55,
                shadowRadius: pressed ? 6 : 14,
                shadowOffset: { width: 0, height: pressed ? 2 : 5 },
                // Android draws the tinted shadow from elevation, API 28+.
                elevation: pressed ? 3 : 8,
              }
            : null),
        },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg[variant]} size="small" /> : icon}
      <Text
        style={{
          color: fg[variant],
          fontWeight: '800',
          // Tracking opens the label up at these weights; without it a bold
          // short word on a saturated fill reads as a solid block.
          letterSpacing: 0.3,
          fontSize: compact ? t.font.size.sm : t.font.size.md,
        }}
      >
        {title}
      </Text>
    </Pressable>
  );
}

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  multiline,
  suffix,
  autoCapitalize,
  hint,
  editable = true,
  onBlur,
}: {
  label?: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'numeric' | 'decimal-pad' | 'email-address';
  multiline?: boolean;
  suffix?: string;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  hint?: string;
  editable?: boolean;
  /** Fires when the box loses focus, for a field that saves a draft only once it is finished with. */
  onBlur?: () => void;
}) {
  const t = useTheme();
  return (
    <View style={{ gap: t.space(1.5) }}>
      {label ? <Label>{label}</Label> : null}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: t.color.surfaceAlt,
          borderRadius: t.radius.md,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: t.color.border,
          paddingHorizontal: t.space(3),
          minHeight: t.touch,
          opacity: editable ? 1 : 0.6,
        }}
      >
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={t.color.textFaint}
          keyboardType={keyboardType}
          multiline={multiline}
          editable={editable}
          autoCapitalize={autoCapitalize}
          onBlur={onBlur}
          style={{
            flex: 1,
            color: t.color.text,
            fontSize: t.font.size.md,
            paddingVertical: multiline ? t.space(3) : 0,
            minHeight: multiline ? 96 : undefined,
            textAlignVertical: multiline ? 'top' : 'center',
          }}
        />
        {suffix ? <Txt tone="muted" size="sm">{suffix}</Txt> : null}
      </View>
      {hint ? <Txt size="xs" tone="faint">{hint}</Txt> : null}
    </View>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const t = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        backgroundColor: t.color.surfaceAlt,
        borderRadius: t.radius.md,
        padding: 3,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: t.color.border,
      }}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => {
              void Haptics.selectionAsync();
              onChange(o.value);
            }}
            style={{
              flex: 1,
              minHeight: 42,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: t.radius.sm,
              backgroundColor: active ? t.color.accent : 'transparent',
            }}
          >
            <Text
              numberOfLines={1}
              style={{
                color: active ? t.color.onAccent : t.color.textMuted,
                fontWeight: active ? '700' : '500',
                fontSize: t.font.size.sm,
              }}
            >
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Chip({
  label,
  tone = 'default',
  onPress,
  selected,
}: {
  label: string;
  tone?: TextTone;
  onPress?: () => void;
  selected?: boolean;
}) {
  const t = useTheme();
  const bgFor: Partial<Record<TextTone, string>> = {
    pass: t.color.passBg,
    fail: t.color.failBg,
    warn: t.color.warnBg,
    accent: t.color.infoBg,
  };
  const body = (
    <View
      style={{
        paddingHorizontal: t.space(2.5),
        paddingVertical: t.space(1.5),
        borderRadius: t.radius.pill,
        backgroundColor: selected ? t.color.accent : (bgFor[tone] ?? t.color.surfaceAlt),
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: selected ? t.color.accent : t.color.border,
      }}
    >
      <Text
        style={{
          color: selected ? t.color.onAccent : toneColor(t, tone),
          fontSize: t.font.size.xs,
          fontWeight: '700',
        }}
      >
        {label}
      </Text>
    </View>
  );
  return onPress ? (
    <Pressable
      onPress={() => {
        void Haptics.selectionAsync();
        onPress();
      }}
      // The pill stays compact so a row of chips still reads as one, but the
      // thing being pressed is the 44dp floor a gloved thumb needs. hitSlop
      // alone was not enough: Android clips a touch to the parent's bounds,
      // and a wrapped row of chips is exactly as tall as the chips in it.
      style={{ minHeight: 44, justifyContent: 'center' }}
      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
    >
      {body}
    </Pressable>
  ) : (
    body
  );
}

export function Divider() {
  const t = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: t.color.border, marginVertical: t.space(1) }} />;
}

export function Rowed({
  children,
  gap = 2,
  align = 'center',
  wrap,
  style,
}: {
  children: React.ReactNode;
  gap?: number;
  align?: ViewStyle['alignItems'];
  wrap?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  return (
    <View
      style={[
        { flexDirection: 'row', alignItems: align, gap: t.space(gap), flexWrap: wrap ? 'wrap' : 'nowrap' },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: React.ReactNode;
}) {
  const t = useTheme();
  return (
    <View style={{ alignItems: 'center', paddingVertical: t.space(12), paddingHorizontal: t.space(6), gap: t.space(2) }}>
      <Txt size="lg" weight="700">{title}</Txt>
      {body ? <Txt tone="muted" style={{ textAlign: 'center', lineHeight: 21 }}>{body}</Txt> : null}
      {action ? <View style={{ marginTop: t.space(2) }}>{action}</View> : null}
    </View>
  );
}

export function StatTile({ label, value, tone = 'default' }: { label: string; value: string | number; tone?: TextTone }) {
  const t = useTheme();
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: t.color.surface,
        borderRadius: t.radius.md,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: t.color.border,
        paddingVertical: t.space(2.5),
        paddingHorizontal: t.space(3),
        gap: 2,
      }}
    >
      <Txt size="xs" tone="muted" weight="700" style={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>
        {label}
      </Txt>
      <Txt size="xl" weight="700" tone={tone}>{value}</Txt>
    </View>
  );
}

/** Result readout for calculator screens: a big answer with its unit and context. */
export function ResultBlock({
  label,
  value,
  unit,
  tone = 'accent',
  detail,
}: {
  label: string;
  value: string;
  unit?: string;
  tone?: TextTone;
  detail?: string;
}) {
  const t = useTheme();
  return (
    <View
      style={{
        backgroundColor: t.color.surfaceAlt,
        borderRadius: t.radius.lg,
        borderWidth: 1,
        borderColor: t.color.borderStrong,
        padding: t.space(4),
        gap: t.space(1),
      }}
    >
      <Label>{label}</Label>
      <Rowed gap={2} align="baseline">
        <Txt size="display" weight="700" tone={tone}>{value}</Txt>
        {unit ? <Txt size="lg" tone="muted" weight="600">{unit}</Txt> : null}
      </Rowed>
      {detail ? <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>{detail}</Txt> : null}
    </View>
  );
}

export function Banner({
  tone,
  title,
  body,
}: {
  tone: 'info' | 'warn' | 'fail' | 'pass';
  title: string;
  body?: string;
}) {
  const t = useTheme();
  const bg = { info: t.color.infoBg, warn: t.color.warnBg, fail: t.color.failBg, pass: t.color.passBg }[tone];
  const fg = { info: t.color.info, warn: t.color.warn, fail: t.color.fail, pass: t.color.pass }[tone];
  return (
    <View style={{ backgroundColor: bg, borderRadius: t.radius.md, padding: t.space(3), gap: 3, borderLeftWidth: 3, borderLeftColor: fg }}>
      <Text style={{ color: fg, fontWeight: '700', fontSize: t.font.size.sm }}>{title}</Text>
      {body ? <Text style={{ color: t.color.text, fontSize: t.font.size.sm, lineHeight: 19 }}>{body}</Text> : null}
    </View>
  );
}
