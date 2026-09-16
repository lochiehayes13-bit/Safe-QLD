import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  FORMATS, LIFE_SOURCE, RECOMMENDED_LIFE_YEARS, readDateCode, serviceLife,
  type DateReading,
} from '@/calc/deviceAge';
import { WHY_PHOTO_READING, readLabelFromPhoto, type LabelResult } from '@/ai/labelReading';
import { encodeLabelPhoto } from '@/services/labelPhoto';
import { describeActionFailure } from '@/domain/loadFailure';
import { showAlert } from '@/components/alert';
import { useTheme } from '@/theme';
import {
  Banner, Button, Card, Chip, Divider, Field, H2, Label, Rowed, Screen, Segmented, Txt,
} from '@/components/ui';

/**
 * How old a detector is, from the code on its own label.
 *
 * This is the calculation behind a fire system effectiveness assessment: heads
 * sampled, date codes photographed, and a finding written that the devices have
 * passed the manufacturer's recommended replacement age while being in no way
 * defective. Doing it by hand from a photograph is where a wrong year gets into
 * a client's report.
 *
 * The screen deliberately shows every reading the code allows rather than one.
 * A single-digit year repeats every decade, and two manufacturers use four
 * digits that differ only in what the last one means — so certainty here has to
 * be earned with an install date, not assumed.
 */

const BRANDS = [
  { value: 'any', label: 'Any' },
  { value: 'Notifier', label: 'Notifier' },
  { value: 'Hochiki', label: 'Hochiki' },
  { value: 'Apollo', label: 'Apollo' },
] as const;

type BrandChoice = (typeof BRANDS)[number]['value'];

const TONE_FOR: Record<DateReading['confidence'], 'pass' | 'warn' | 'fail'> = {
  high: 'pass', medium: 'warn', low: 'warn',
};

export default function DetectorAgeScreen() {
  const t = useTheme();
  const [code, setCode] = useState('');
  const [brand, setBrand] = useState<BrandChoice>('any');
  const [inService, setInService] = useState('');
  const [earliest, setEarliest] = useState('');
  const [life, setLife] = useState(String(RECOMMENDED_LIFE_YEARS));
  const [reading, setReading] = useState(false);
  const [label, setLabel] = useState<LabelResult | null>(null);

  const year = (v: string) => {
    const n = Number(v.trim());
    return Number.isInteger(n) && n > 1900 && n < 2200 ? n : undefined;
  };

  const today = useMemo(() => new Date(), []);

  const readings = useMemo(() => readDateCode(code, {
    brand: brand === 'any' ? undefined : brand,
    today,
    knownInServiceYear: year(inService),
    earliestYear: year(earliest),
  }), [code, brand, inService, earliest, today]);

  const lifeYears = Number(life) > 0 ? Number(life) : RECOMMENDED_LIFE_YEARS;
  const typed = code.trim().length > 0;

  /**
   * Photographs the label and lets the model transcribe it.
   *
   * The model only transcribes. Whatever it read is put into the code box
   * above as if it had been typed, the make is set where the label named one
   * this app knows, and the readings below are the decoder's — exactly what
   * a typed code gets. The transcription and the chain of reasoning stay on
   * screen so the head can be held up against them.
   */
  const photograph = async (fromCamera: boolean) => {
    setReading(true);
    try {
      const perm = fromCamera
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        showAlert('Permission needed', 'Safe QLD needs the camera to read the label.');
        return;
      }
      const result = fromCamera
        ? await ImagePicker.launchCameraAsync({ quality: 0.9 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.9 });
      if (result.canceled || !result.assets[0]) return;
      const image = await encodeLabelPhoto(result.assets[0].uri);
      const read = await readLabelFromPhoto(image, {
        today,
        knownInServiceYear: year(inService),
        earliestYear: year(earliest),
      });
      setLabel(read);
      const usable = read.codes.find((c) => c.readings.length);
      if (usable) {
        setCode(usable.code);
        const known = read.transcription?.knownBrand;
        setBrand(known ?? 'any');
      } else if (read.transcription?.codes.length) {
        // Transcribed but not decodable: still worth putting in the box so
        // it can be corrected by hand rather than retyped from scratch.
        setCode(read.transcription.codes[0]!.text.replace(/\s+/g, ''));
      }
    } catch (e) {
      showAlert('Could not read the label', describeActionFailure(e, 'reading the photograph'));
    } finally {
      setReading(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Detector age' }} />
      <Screen>
        <Txt tone="muted" size="sm" style={{ lineHeight: 20 }}>
          Read the code off the head and it gives every date that code can mean. It gives more than
          one on purpose — the year is a single digit, so the same code comes round every ten years.
        </Txt>

        <Rowed gap={2}>
          <View style={{ flex: 1 }}>
            <Button
              title="Photograph the label"
              loading={reading}
              onPress={() => { void photograph(true); }}
              icon={<MaterialCommunityIcons name="camera-outline" size={20} color={t.color.onAccent} />}
            />
          </View>
          <Button title="From photos" variant="secondary" disabled={reading} onPress={() => { void photograph(false); }} />
        </Rowed>

        {label?.refusal ? (
          <Banner tone="warn" title="Nothing usable came off the photograph" body={label.refusal} />
        ) : null}

        {label && !label.refusal ? (
          <Card>
            <Label>Read from the photograph</Label>
            {label.transcription ? (
              <Txt size="sm" style={{ marginTop: t.space(1.5), lineHeight: 20 }}>
                {label.transcription.brand || 'No make printed'}
                {label.transcription.model ? ` · ${label.transcription.model}` : ''}
                {label.transcription.dateText ? ` · "${label.transcription.dateText}"` : ''}
              </Txt>
            ) : null}
            <Rowed gap={2} wrap style={{ marginTop: t.space(2) }}>
              {label.codes.map((c) => (
                <Chip
                  key={`${c.code}-${c.where}`}
                  label={c.readings.length ? c.code : `${c.code} · no format`}
                  selected={code === c.code}
                  onPress={() => setCode(c.code)}
                />
              ))}
            </Rowed>
            <Divider />
            <Label>How it was read</Label>
            {label.howRead.map((line, i) => (
              <Txt key={i} size="sm" tone="muted" style={{ marginTop: t.space(1), lineHeight: 19 }}>{i + 1}. {line}</Txt>
            ))}
            <Txt size="xs" tone="faint" style={{ marginTop: t.space(2), lineHeight: 17 }}>
              Hold the head up and check the digits above against the label. If the transcription is wrong, correct the
              code in the box below — the dates come from the box, not from the photograph.
            </Txt>
          </Card>
        ) : null}

        <Card>
          <Field
            label="Date code or serial"
            value={code}
            onChangeText={setCode}
            placeholder="6015"
            autoCapitalize="characters"
            hint="From the label on the back of the head, not the address. Or photograph it above."
          />
          <View style={{ height: t.space(2.5) }} />
          <Label>Make</Label>
          <Segmented
            value={brand}
            onChange={(v) => setBrand(v)}
            options={BRANDS.map((b) => ({ value: b.value, label: b.label }))}
          />
          <View style={{ height: t.space(2.5) }} />
          <Rowed gap={2} align="flex-start">
            <View style={{ flex: 1 }}>
              <Field
                label="In service by"
                value={inService}
                onChangeText={setInService}
                keyboardType="numeric"
                placeholder="2016"
                hint="Install or commissioning year"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Field
                label="Not before"
                value={earliest}
                onChangeText={setEarliest}
                keyboardType="numeric"
                placeholder="2010"
                hint="Building or system age"
              />
            </View>
          </Rowed>
          <Txt size="xs" tone="faint" style={{ marginTop: t.space(2), lineHeight: 17 }}>
            Both together are the only thing that makes a one-digit year certain. One on its own
            narrows the list without settling it.
          </Txt>
        </Card>

        {typed && !readings.length ? (
          <Banner
            tone="warn"
            title="These digits fit nothing this app knows"
            body={
              'Rather than offer the nearest thing, it gives nothing. Check the code, or read the '
              + 'make off the head and set it above — the same digits can be a valid code for one '
              + 'manufacturer and meaningless for another.'
            }
          />
        ) : null}

        {readings.length ? (
          <>
            <H2>{readings.length === 1 ? 'One reading' : `${readings.length} possible readings`}</H2>
            {readings.map((r, i) => {
              const verdict = serviceLife(r, today, lifeYears);
              return (
                <Card key={`${r.format}-${r.manufactured}-${i}`}>
                  <Rowed style={{ justifyContent: 'space-between' }} align="flex-start">
                    <View style={{ flex: 1 }}>
                      <Txt weight="700">
                        {MONTHS[r.month - 1]} {r.year}
                        {r.day ? ` — ${r.day}${ordinal(r.day)}` : r.week ? ` — week ${r.week}` : ''}
                      </Txt>
                      <Txt size="xs" tone="faint">{r.formatLabel}</Txt>
                    </View>
                    <Chip label={r.confidence} tone={TONE_FOR[r.confidence]} />
                  </Rowed>

                  {r.place ? (
                    <Txt size="sm" tone="muted" style={{ marginTop: t.space(1.5) }}>{r.place}</Txt>
                  ) : null}

                  <Txt
                    size="sm"
                    tone={verdict.past ? 'warn' : 'muted'}
                    style={{ marginTop: t.space(2), lineHeight: 19 }}
                  >
                    {verdict.label}
                  </Txt>

                  {r.notes.map((n) => (
                    <Txt key={n} size="xs" tone="faint" style={{ marginTop: t.space(1.5), lineHeight: 16 }}>
                      {n}
                    </Txt>
                  ))}

                  <Txt size="xs" tone="faint" style={{ marginTop: t.space(1.5), lineHeight: 16 }}>
                    Source: {r.source}
                  </Txt>
                </Card>
              );
            })}
          </>
        ) : null}

        <H2>Replacement age</H2>
        <Card>
          <Field
            label="Recommended life"
            value={life}
            onChangeText={setLife}
            keyboardType="numeric"
            suffix="years"
          />
          <Txt size="xs" tone="faint" style={{ marginTop: t.space(2), lineHeight: 17 }}>
            {LIFE_SOURCE}
          </Txt>
          <Txt size="xs" tone="faint" style={{ marginTop: t.space(1.5), lineHeight: 17 }}>
            A head past its recommended age is not a defect and must not be written up as one. It is
            a lifecycle finding: the device works, the manufacturer no longer stands behind its age.
          </Txt>
        </Card>

        <H2>Why photograph it</H2>
        <Card>
          {WHY_PHOTO_READING.map((why, i) => (
            <Rowed key={i} gap={2} align="flex-start" style={{ marginTop: i ? t.space(2) : 0 }}>
              <MaterialCommunityIcons name="check-circle-outline" size={16} color={t.color.accentText} style={{ marginTop: 2 }} />
              <Txt size="sm" tone="muted" style={{ flex: 1, lineHeight: 19 }}>{why}</Txt>
            </Rowed>
          ))}
        </Card>

        <H2>The formats</H2>
        {Object.values(FORMATS).map((spec) => (
          <Card key={spec.id}>
            <Rowed style={{ justifyContent: 'space-between' }} align="flex-start">
              <Txt size="sm" weight="700" style={{ flex: 1 }}>{spec.label}</Txt>
              <Chip label={spec.confidence} tone={TONE_FOR[spec.confidence]} />
            </Rowed>
            <Txt size="xs" tone="muted" style={{ marginTop: t.space(1.5), lineHeight: 17 }}>
              {spec.layout}
            </Txt>
            <Txt size="xs" tone="faint" style={{ marginTop: t.space(1), lineHeight: 16 }}>
              {spec.source}
            </Txt>
          </Card>
        ))}
      </Screen>
    </>
  );
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const ordinal = (d: number) => {
  if (d % 100 >= 11 && d % 100 <= 13) return 'th';
  return ['th', 'st', 'nd', 'rd'][d % 10] ?? 'th';
};
