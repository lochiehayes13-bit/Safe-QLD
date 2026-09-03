import React, { useMemo, useRef, useState } from 'react';
import { PanResponder, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useTheme } from '@/theme';
import { Button, Label, Rowed, Txt } from './ui';

/**
 * Signature capture.
 *
 * Drawn with SVG paths and a PanResponder rather than a WebView-backed canvas:
 * one fewer native dependency, no white flash on a dark screen, and the strokes
 * serialise directly to an SVG data URI that drops straight into the PDF.
 */

export interface SignatureValue {
  /** SVG data URI, or empty when nothing has been drawn. */
  dataUri: string;
}

export function SignaturePad({
  label,
  value,
  onChange,
  height = 170,
}: {
  label: string;
  value?: string;
  onChange: (v: string | undefined) => void;
  height?: number;
}) {
  const t = useTheme();
  const [strokes, setStrokes] = useState<string[]>([]);
  const current = useRef<string>('');
  const [, force] = useState(0);
  const [size, setSize] = useState({ w: 0, h: height });

  const responder = useMemo(
    () => {
      /** Keeps the stroke in progress, however the gesture ended. */
      const commit = () => {
        if (!current.current) return;
        const done = current.current;
        current.current = '';
        setStrokes((prev) => {
          const next = [...prev, done];
          onChange(toDataUri(next, size.w, size.h));
          return next;
        });
      };
      return PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        /*
         * The pad sits inside a scrolling form, and the ScrollView asks for
         * the gesture the moment a stroke drifts vertically. Yielding used to
         * drop the stroke in progress — half a signature, with the page
         * scrolled away underneath it. A finger that started on the pad is
         * signing, so the answer is no; and if the responder is taken anyway,
         * what was drawn so far is kept rather than thrown away.
         */
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (e) => {
          const { locationX, locationY } = e.nativeEvent;
          current.current = `M${round(locationX)},${round(locationY)}`;
          force((n) => n + 1);
        },
        onPanResponderMove: (e) => {
          const { locationX, locationY } = e.nativeEvent;
          current.current += ` L${round(locationX)},${round(locationY)}`;
          force((n) => n + 1);
        },
        onPanResponderRelease: commit,
        onPanResponderTerminate: commit,
      });
    },
    [onChange, size.w, size.h],
  );

  const clear = () => {
    current.current = '';
    setStrokes([]);
    onChange(undefined);
  };

  const allPaths = current.current ? [...strokes, current.current] : strokes;
  const hasSignature = strokes.length > 0 || !!value;

  return (
    <View style={{ gap: t.space(1.5) }}>
      <Rowed style={{ justifyContent: 'space-between' }}>
        <Label>{label}</Label>
        {hasSignature ? <Button title="Clear" variant="ghost" compact onPress={clear} /> : null}
      </Rowed>

      <View
        onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
        {...responder.panHandlers}
        style={{
          height,
          backgroundColor: t.color.surfaceAlt,
          borderRadius: t.radius.md,
          borderWidth: 1,
          borderColor: t.color.border,
          overflow: 'hidden',
        }}
      >
        <Svg width="100%" height="100%">
          {allPaths.map((d, i) => (
            <Path key={i} d={d} stroke={t.color.text} strokeWidth={2.4} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          ))}
        </Svg>
        {!allPaths.length ? (
          <View style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center' }} pointerEvents="none">
            <Txt tone="faint" size="sm">Sign here</Txt>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function round(n: number): number {
  // One decimal is plenty for a signature and keeps the data URI small.
  return Math.round(n * 10) / 10;
}

/**
 * Serialises strokes to an SVG data URI.
 *
 * Black ink on a transparent ground, so the same signature reads correctly on
 * the dark app screen and on a white printed page.
 */
function toDataUri(strokes: string[], width: number, height: number): string | undefined {
  if (!strokes.length || width <= 0) return undefined;
  const paths = strokes
    .map((d) => `<path d="${d}" stroke="black" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`)
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(width)}" height="${Math.round(height)}" viewBox="0 0 ${Math.round(width)} ${Math.round(height)}">${paths}</svg>`;
  // encodeURIComponent keeps this valid without needing base64.
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
