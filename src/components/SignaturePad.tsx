import React, { useMemo, useRef, useState } from 'react';
import { PanResponder, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { STROKE_WIDTH, strokePath, strokesToSvg, svgDataUri, type Stroke } from '@/domain/signature';
import { useTheme } from '@/theme';
import { Button, Label, Rowed, Txt } from './ui';

/**
 * Signature capture.
 *
 * Drawn with SVG paths and a PanResponder rather than a WebView-backed canvas:
 * one fewer native dependency, no white flash on a dark screen, and the strokes
 * serialise directly to an SVG the PDF can embed and the job card can file as
 * an attachment. The strokes are points, and @/domain/signature turns them
 * into path data and the document, so what is drawn and what is sent cannot
 * disagree and the document itself is tested without a screen.
 *
 * Two outputs, because two callers want two things: the statutory forms want
 * a data URI for an <img> in a PDF, and the job card wants the SVG document
 * to write to a file. Both are given on every stroke.
 */

export interface SignatureValue {
  /** SVG data URI, or empty when nothing has been drawn. */
  dataUri: string;
}

export function SignaturePad({
  label,
  value,
  onChange,
  onSvg,
  height = 170,
}: {
  label: string;
  value?: string;
  /** The signature as a data URI, or undefined once cleared. */
  onChange: (v: string | undefined) => void;
  /** The same signature as a complete SVG document, for a file. */
  onSvg?: (svg: string | undefined) => void;
  height?: number;
}) {
  const t = useTheme();
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const current = useRef<Stroke>([]);
  const [, force] = useState(0);
  const [size, setSize] = useState({ w: 0, h: height });
  // The latest callbacks, read at the end of a stroke rather than captured
  // when the responder was made: a parent that re-renders mid-signature
  // would otherwise be told through a stale closure.
  const handlers = useRef({ onChange, onSvg });
  handlers.current = { onChange, onSvg };

  const responder = useMemo(
    () => {
      /** Keeps the stroke in progress, however the gesture ended. */
      const commit = () => {
        if (!current.current.length) return;
        const done = current.current;
        current.current = [];
        setStrokes((prev) => {
          const next = [...prev, done];
          const svg = strokesToSvg(next, size.w, size.h);
          handlers.current.onChange(svgDataUri(svg));
          handlers.current.onSvg?.(svg);
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
          current.current = [{ x: locationX, y: locationY }];
          force((n) => n + 1);
        },
        onPanResponderMove: (e) => {
          const { locationX, locationY } = e.nativeEvent;
          current.current.push({ x: locationX, y: locationY });
          force((n) => n + 1);
        },
        onPanResponderRelease: commit,
        onPanResponderTerminate: commit,
      });
    },
    [size.w, size.h],
  );

  const clear = () => {
    current.current = [];
    setStrokes([]);
    onChange(undefined);
    onSvg?.(undefined);
  };

  const allStrokes = current.current.length ? [...strokes, current.current] : strokes;
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
          {allStrokes.map((s, i) => (
            <Path key={i} d={strokePath(s)} stroke={t.color.text} strokeWidth={STROKE_WIDTH} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          ))}
        </Svg>
        {!allStrokes.length ? (
          <View style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center' }} pointerEvents="none">
            <Txt tone="faint" size="sm">Sign here</Txt>
          </View>
        ) : null}
      </View>
    </View>
  );
}
