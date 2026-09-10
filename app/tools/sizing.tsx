import React, { useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';
import { Stack, router, useFocusEffect } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { hasKey } from '@/ai/client';
import { readInstall, type SizingBrief } from '@/ai/sizingChat';
import { answerFromBrief, answerHeadline, answerWorking, type SizingAnswer } from '@/domain/sizingChat';
import { candidateRowsFor, capacityColumns, describeColumn } from '@/domain/wiringCables';
import { describeActionFailure } from '@/domain/loadFailure';
import { useTheme } from '@/theme';
import {
  Banner, Button, Card, Chip, Divider, Field, H2, Label, ResultBlock, Rowed, Screen, StatusPill, Txt,
} from '@/components/ui';

/**
 * Describe the install, get the cable and the breaker.
 *
 * The manual calculator next door wants fourteen fields, and a sparky
 * standing in a switchroom has the whole thing in one sentence: "feeding a
 * 15 kW three phase pump 60 metres away, TPS in conduit in a wall, four other
 * circuits in the same conduit". This screen takes the sentence.
 *
 * What it does not do is let a model answer. The model reads the sentence and
 * produces facts — load, volts, phase, length, how it runs — and every one of
 * those is shown beside the words that produced it, so the reading can be
 * checked. The size and the device come from the same tables and the same
 * four checks the manual screen uses, and if the model volunteers a size
 * anyway the screen says it tried and ignores it.
 *
 * When the facts do not reach far enough, it asks rather than guesses. A run
 * with no length cannot be sized, and a confident answer from a guessed length
 * is the one outcome worse than no answer.
 */
export default function SizingChatScreen() {
  const t = useTheme();
  const [description, setDescription] = useState('');
  const [brief, setBrief] = useState<SizingBrief | null>(null);
  const [answer, setAnswer] = useState<SizingAnswer | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [aiOn, setAiOn] = useState<boolean | null>(null);
  const [overrideColumnId, setOverrideColumnId] = useState<string | null>(null);

  useFocusEffect(useCallback(() => {
    let live = true;
    void hasKey().then((on) => { if (live) setAiOn(on); });
    return () => { live = false; };
  }, []));

  const columns = useMemo(() => capacityColumns(), []);
  const arrangements = useMemo(
    () => [...new Set(columns.map((c) => c.installMethod))],
    [columns],
  );

  const ask = async () => {
    setBusy(true);
    setProblem(null);
    setOverrideColumnId(null);
    try {
      const read = await readInstall(description, arrangements);
      if (read.brief) {
        setBrief(read.brief);
        setAnswer(answerFromBrief(read.brief));
      } else {
        setBrief(null);
        setAnswer(null);
        setProblem(read.refusal ?? 'The install could not be read.');
      }
    } catch (e) {
      setProblem(describeActionFailure(e, 'reading the install'));
    } finally {
      setBusy(false);
    }
  };

  /** Sizes the same facts against a different column, when the pick was wrong. */
  const sizeAgainst = (id: string) => {
    if (!brief) return;
    setOverrideColumnId(id);
    const column = columns.find((c) => c.id === id);
    if (!column) return;
    setAnswer(answerFromBrief(brief, { columns: [column] }));
  };

  const chosen = answer?.result?.chosen;
  const pick = answer?.pick.best;

  return (
    <>
      <Stack.Screen options={{ title: 'Size it from a description' }} />
      <Screen>
        {aiOn === false ? (
          <Banner
            tone="warn"
            title="No key set on this phone"
            body="Reading a description needs the AI key from Settings. The manual calculator does not, and works off the same tables."
          />
        ) : null}

        <Card>
          <Rowed align="flex-start">
            <MaterialCommunityIcons name="message-text-outline" size={24} color={t.color.accent} />
            <View style={{ flex: 1, marginLeft: t.space(3) }}>
              <Txt weight="700">Tell it what you are installing</Txt>
              <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>
                Load, distance, cable, how it runs, anything else that is true. It reads the sentence; the size comes
                from the standard’s tables and the four checks, same as doing it by hand.
              </Txt>
            </View>
          </Rowed>
          <Field
            label="The install"
            value={description}
            onChangeText={setDescription}
            multiline
            placeholder="15 kW three phase pump, 60 m away, TPS in conduit in a wall, four other circuits in the same conduit, 40 degrees in the roof"
          />
          <Button
            title="Work it out"
            onPress={() => { void ask(); }}
            loading={busy}
            disabled={!description.trim() || aiOn === false}
          />
          <Rowed gap={2} wrap style={{ marginTop: t.space(2) }}>
            {[
              '15 kW three phase pump 60 m away, TPS in conduit in a wall',
              'Fire pump submain, 100 A, 45 m, four core XLPE on a tray',
              '32 A single phase oven, 25 m, two core and earth through ceiling insulation',
            ].map((example) => (
              <Chip key={example} label={example.slice(0, 34)} onPress={() => setDescription(example)} />
            ))}
          </Rowed>
        </Card>

        {problem ? <Banner tone="fail" title="Could not read it" body={problem} /> : null}

        {answer ? (
          <>
            <ResultBlock
              label={answer.needs.length ? 'Still needs' : 'Smallest size that passes every check'}
              value={chosen ? `${chosen.row.areaMm2}` : '—'}
              unit={chosen ? 'mm²' : undefined}
              tone={chosen ? 'accent' : 'fail'}
              detail={answerHeadline(answer)}
            />

            {answer.needs.length ? (
              <Card>
                <Label>Answer these and it can be sized</Label>
                {answer.needs.map((n) => (
                  <Txt key={n} size="sm" style={{ marginTop: t.space(1.5), lineHeight: 20 }}>• {n}</Txt>
                ))}
                <Txt size="sm" tone="muted" style={{ marginTop: t.space(2), lineHeight: 19 }}>
                  Add them to the description and work it out again. Nothing here is guessed: a run sized from an
                  assumed length is the one answer worse than no answer.
                </Txt>
              </Card>
            ) : null}

            {chosen ? (
              <Banner
                tone="pass"
                title={`${chosen.row.areaMm2} mm² on a ${chosen.protection.deviceRatingA} A device`}
                body={answerWorking(answer).join('\n')}
              />
            ) : answer.result?.refusal ? (
              <Banner tone="fail" title="Nothing passed" body={answer.result.refusal} />
            ) : null}

            {answer.assumptions.length ? (
              <Card>
                <Label>What it assumed</Label>
                {answer.assumptions.map((a) => (
                  <Txt key={a} size="sm" tone="muted" style={{ marginTop: t.space(1.5), lineHeight: 19 }}>• {a}</Txt>
                ))}
              </Card>
            ) : null}

            {brief ? (
              <Card>
                <Label>What it read, and from which words</Label>
                {brief.quoted.length === 0 ? (
                  <Txt size="sm" tone="muted">It did not say which words it read.</Txt>
                ) : null}
                {brief.quoted.map((q) => (
                  <Rowed key={`${q.field}-${q.phrase}`} align="flex-start" style={{ marginTop: t.space(1.5) }}>
                    <Txt size="xs" tone="faint" style={{ width: 110 }}>{q.field}</Txt>
                    <Txt size="sm" style={{ flex: 1, lineHeight: 19 }}>“{q.phrase}”</Txt>
                  </Rowed>
                ))}
                {brief.missing.length ? (
                  <>
                    <Divider />
                    <Txt size="sm" tone="muted">It could not find: {brief.missing.join(', ')}.</Txt>
                  </>
                ) : null}
                {brief.refused.length ? (
                  <>
                    <Divider />
                    <Txt size="sm" tone="warn" style={{ lineHeight: 19 }}>
                      It also tried to answer — {brief.refused.join(', ')} — which was ignored. The size above is the
                      calculator’s, off the tables.
                    </Txt>
                  </>
                ) : null}
              </Card>
            ) : null}

            {pick ? (
              <>
                <H2>The table it used</H2>
                <Card>
                  <Txt weight="700">{describeColumn(pick.column)}</Txt>
                  <Txt size="sm" tone="muted" style={{ marginTop: t.space(1) }}>
                    {pick.column.source}
                  </Txt>
                  <Txt size="xs" tone="faint" style={{ marginTop: t.space(1) }}>
                    {candidateRowsFor(pick.column).dropNote}
                  </Txt>
                  {pick.because.length ? (
                    <Txt size="xs" tone="accent" style={{ marginTop: t.space(1) }}>
                      Matched on {pick.because.join(', ')}.
                    </Txt>
                  ) : null}
                </Card>

                {answer.pick.runnersUp.length ? (
                  <>
                    <Label>If that is the wrong arrangement</Label>
                    {answer.pick.runnersUp.map((m) => (
                      <Card key={m.column.id} onPress={() => sizeAgainst(m.column.id)}>
                        <Rowed align="flex-start">
                          <View style={{ flex: 1 }}>
                            <Txt size="sm">{describeColumn(m.column)}</Txt>
                            <Txt size="xs" tone="faint">{m.column.ref}</Txt>
                          </View>
                          {overrideColumnId === m.column.id ? <StatusPill label="Using" tone="pass" /> : null}
                        </Rowed>
                      </Card>
                    ))}
                  </>
                ) : null}

                {answer.pick.unmatched.length ? (
                  <Banner
                    tone="warn"
                    title="Something you said did not match a table"
                    body={`${answer.pick.unmatched.join('; ')}. Check the arrangement above is the one you meant.`}
                  />
                ) : null}

                {answer.derating.uncovered.length ? (
                  <Banner
                    tone="warn"
                    title="A condition was not derated"
                    body={`${answer.derating.uncovered.join('; ')}. Open the manual calculator to apply it yourself.`}
                  />
                ) : null}
              </>
            ) : null}

            <Button title="Open it in the full calculator" variant="secondary" onPress={() => router.push('/tools/cable')} />
          </>
        ) : null}

        <Card>
          <Label>Why it works this way</Label>
          <Txt size="sm" tone="muted" style={{ marginTop: t.space(2), lineHeight: 20 }}>
            The model reads your sentence and nothing else. It is told it may never give a size, a breaker rating or a
            capacity, and if it does the answer is thrown away and this screen says so. Everything you see above comes
            from the tables on this phone and the same arithmetic the manual screen runs.
          </Txt>
          <Divider />
          <Txt size="sm" tone="muted" style={{ lineHeight: 20 }}>
            The description leaves the phone. Nothing about the site, the job or the customer goes with it.
          </Txt>
        </Card>
      </Screen>
    </>
  );
}
