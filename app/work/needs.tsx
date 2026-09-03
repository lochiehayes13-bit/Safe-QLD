import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Stack, router, useFocusEffect } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { addNeed, deleteNeed, listNeeds, saveNeed } from '@/db/needsRepo';
import { createPurchaseRequest } from '@/db/opsRepo';
import { queryCatalogue, type CatalogueItem } from '@/db/catalogueRepo';
import { listSiteSummaries } from '@/db/repo';
import { nowIso } from '@/db';
import { loadPrefs } from '@/app-prefs';
import { shareFile, writeCsv } from '@/export/files';
import { notSharedNotice } from '@/export/shareOutcome';
import { formatAuDate } from '@/export/sheets';
import {
  STATE_LABEL, groupNeeds, markOrdered, moveNeed, needHeadline, needSubtitle, needsCsvRows,
  orderableLines, otherWhen, parseNeedLine, tickNeed, withNeedState,
  type NeedLine, type NeedWhen,
} from '@/domain/needsList';
import { useTheme } from '@/theme';
import {
  Banner, Button, Card, Chip, EmptyState, Field, Label, Rowed, Screen, SectionHeader, Segmented,
  StatusPill, Txt,
} from '@/components/ui';
import { Reveal } from '@/components/motion';
import { describeActionFailure, describeLoadFailure } from '@/domain/loadFailure';
import { showAlert } from '@/components/alert';

/**
 * Things I need — the parts list a technician keeps on the run.
 *
 * The note that is currently written on a dash, in a phone's notes app, or on
 * the back of a docket: an extinguisher for a site, a flow meter before the
 * hydrant work in March. It lives here so it survives a reinstall, so it can
 * be ticked with a glove on, and so it can go to the office as a list rather
 * than being read out over the phone.
 *
 * It is next door to Purchase requests and it is not the same thing. A
 * purchase request is a document the office turns into an order and it needs
 * part numbers and quantities; this needs three words. When a line is ready to
 * be ordered it goes across on the existing request path — that button is on
 * this screen — and the line stays here, marked ordered, so the technician can
 * still see what they are waiting on.
 *
 * The typing is the part that had to be got right. "flow meter" is a complete
 * line, because that is what somebody types with one hand free. A count and a
 * building are read out of what was typed where they are there — "2 x 4.5kg
 * ABE for YMCA Bowen Hills" fills in three fields — and the catalogue and the
 * site list are offered as chips underneath. Every one of those is an offer:
 * a lookup that finds nothing, or a database read that fails outright, leaves
 * the line exactly as it was typed and adds it anyway.
 */
export default function NeedsScreen() {
  const t = useTheme();
  const [lines, setLines] = useState<NeedLine[]>([]);

  // "Nothing on the list" is a statement a technician drives to the supplier
  // on. A read that failed has to say so rather than showing an empty list.
  const [failed, setFailed] = useState<string | null>(null);

  const [text, setText] = useState('');
  const [when, setWhen] = useState<NeedWhen>('now');
  const [note, setNote] = useState('');
  const [detail, setDetail] = useState(false);
  const [siteText, setSiteText] = useState('');
  const [siteId, setSiteId] = useState<string>();
  const [siteName, setSiteName] = useState<string>();
  const [partNumber, setPartNumber] = useState<string>();
  const [parts, setParts] = useState<CatalogueItem[]>([]);
  const [sites, setSites] = useState<{ id: string; name: string; suburb?: string }[]>([]);
  const [sending, setSending] = useState(false);
  const [ordering, setOrdering] = useState(false);

  const load = useCallback(async () => {
    setFailed(null);
    try {
      // Everything, including what has been got: nothing is deleted on a tick,
      // and "did I already pick that up" is a question this list answers.
      setLines(await listNeeds({ includeGot: true }));
    } catch (e) {
      setLines([]);
      setFailed(describeLoadFailure(e, 'the things you need on this device'));
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const parsed = useMemo(() => parseNeedLine(text), [text]);

  /**
   * Part numbers for what is being typed.
   *
   * Behind a short pause, because this runs on every keystroke and the
   * catalogue is four thousand rows. A failure is swallowed on purpose: the
   * suggestion is a convenience, and a technician typing "flow meter" must not
   * be shown an error about a lookup they did not ask for.
   */
  useEffect(() => {
    const term = parsed.what.trim();
    let live = true;
    const timer = setTimeout(() => {
      void (async () => {
        if (term.length < 3) {
          if (live) setParts([]);
          return;
        }
        try {
          const found = await queryCatalogue({ search: term, limit: 4 });
          if (live) setParts(found);
        } catch {
          if (live) setParts([]);
        }
      })();
    }, 250);
    return () => { live = false; clearTimeout(timer); };
  }, [parsed.what]);

  /** Sites for whatever followed "for", or for what was typed in the site box. */
  useEffect(() => {
    const term = (siteText.trim() || parsed.siteHint || '').trim();
    let live = true;
    const timer = setTimeout(() => {
      void (async () => {
        if (siteName || term.length < 3) {
          if (live) setSites([]);
          return;
        }
        try {
          const page = await listSiteSummaries({ query: term, limit: 4 });
          if (live) setSites(page.rows.map((s) => ({ id: s.id, name: s.name, suburb: s.suburb })));
        } catch {
          if (live) setSites([]);
        }
      })();
    }, 250);
    return () => { live = false; clearTimeout(timer); };
  }, [siteText, parsed.siteHint, siteName]);

  /**
   * The box after a line has been written.
   *
   * `when` is deliberately left where it was. Somebody listing what they need
   * before the March annuals is writing four of them, not one, and resetting
   * the toggle to "for now" between each would file three of the four in the
   * wrong half — the control is on screen and shows which half is chosen.
   */
  const clearAdd = () => {
    setText('');
    setNote('');
    setSiteText('');
    setSiteId(undefined);
    setSiteName(undefined);
    setPartNumber(undefined);
    setParts([]);
    setSites([]);
    setDetail(false);
  };

  /**
   * Writes the line.
   *
   * The wording kept depends on whether a building was actually attached: with
   * a site on the line, "for YMCA Bowen Hills" is already said and comes off
   * the words; without one it stays on, because dropping "for the pump room"
   * from a line nobody matched to a site would throw away the only thing that
   * said where the part goes.
   */
  const add = async () => {
    const what = (siteName ? parsed.what : parsed.whatWithWhere).trim();
    if (!what) return;
    try {
      await addNeed({
        what,
        quantity: parsed.quantity,
        partNumber,
        siteId,
        siteName,
        note: note.trim() || undefined,
        when,
      });
      clearAdd();
      void load();
    } catch (e) {
      showAlert('Could not add it', describeActionFailure(e, 'add this to your list'));
    }
  };

  /** Every change to a line is the same two steps: work it out, write it back. */
  const write = async (next: NeedLine, what: string) => {
    try {
      await saveNeed(next);
      void load();
    } catch (e) {
      showAlert('Could not save that', describeActionFailure(e, what));
    }
  };

  const remove = (line: NeedLine) => {
    showAlert(
      'Take this off the list?',
      `"${needHeadline(line)}" is removed for good. Ticking it off instead keeps it, in case you `
      + 'need to know later that you got it.',
      [
        { text: 'Keep it', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                await deleteNeed(line.id);
                void load();
              } catch (e) {
                showAlert('Could not remove it', describeActionFailure(e, 'remove this line'));
              }
            })();
          },
        },
      ],
    );
  };

  /**
   * The list as a spreadsheet, for the office.
   *
   * Same call on both builds: a phone opens the share sheet, a browser hands
   * the file to its downloads. `shareFile` returning false is the case where
   * the device has neither, and it gets said out loud rather than looking like
   * a button that did nothing.
   */
  const sendList = async () => {
    if (!lines.length) return;
    setSending(true);
    try {
      const file = writeCsv(`Things I need ${formatAuDate(nowIso())}`, needsCsvRows(lines));
      const shared = await shareFile(file, 'Things I need');
      if (!shared) {
        const notice = notSharedNotice(file.name, 'list');
        showAlert(notice.title, notice.body);
      }
    } catch (e) {
      showAlert('Could not send the list', describeActionFailure(e, 'produce this list'));
    } finally {
      setSending(false);
    }
  };

  const nowNeeded = lines.filter((l) => l.when === 'now' && l.state === 'needed');

  /**
   * Sends what is wanted now to the office, on the existing purchase path.
   *
   * The "for now" lines only. Future works are on the list precisely because
   * nobody wants them ordered yet, and a line that has to be ordered early is
   * one tap from being moved across.
   *
   * The lines are marked ordered only once the request exists, and each one
   * keeps a note saying which request took it — a line marked ordered with no
   * request behind it is a part nobody is actually getting.
   */
  const raiseRequest = async () => {
    if (!nowNeeded.length) return;
    setOrdering(true);
    try {
      const prefs = await loadPrefs();
      const request = await createPurchaseRequest({
        requestedBy: prefs.technicianName,
        lines: orderableLines(nowNeeded),
        notes: 'Raised from a technician\'s "things I need" list.',
      });
      const at = nowIso();
      for (const line of nowNeeded) {
        await saveNeed(markOrdered(line, at, `On the request raised ${formatAuDate(at)}`, request.id));
      }
      void load();
      showAlert(
        'On a purchase request',
        `${nowNeeded.length} line${nowNeeded.length === 1 ? '' : 's'} went onto a draft request. It `
        + 'goes to the office from Purchase requests, and the lines stay on your list, marked on order.',
      );
      router.push('/work/purchases');
    } catch (e) {
      showAlert('Could not raise the request', describeActionFailure(e, 'raise a purchase request'));
    } finally {
      setOrdering(false);
    }
  };

  const groups = groupNeeds(lines);

  const renderLine = (line: NeedLine) => {
    const got = line.state === 'got';
    const subtitle = needSubtitle(line);
    return (
      <Card key={line.id} style={{ opacity: got ? 0.65 : 1 }}>
        <Rowed gap={2} align="flex-start">
          <Pressable
            onPress={() => void write(tickNeed(line, nowIso()), 'tick this line off')}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: got }}
            accessibilityLabel={got ? `Got ${line.what}. Put it back on the list` : `Tick off ${line.what}`}
            hitSlop={6}
            // 44 square, because this is the one control on the screen that
            // gets pressed with a glove on while holding something else.
            style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}
          >
            <MaterialCommunityIcons
              name={got ? 'checkbox-marked' : 'checkbox-blank-outline'}
              size={28}
              color={got ? t.color.pass : t.color.textMuted}
            />
          </Pressable>
          <View style={{ flex: 1, gap: 4, paddingTop: t.space(1.5) }}>
            <Txt weight="700" style={got ? { textDecorationLine: 'line-through' } : undefined}>
              {needHeadline(line)}
            </Txt>
            {subtitle ? <Txt size="sm" tone="muted">{subtitle}</Txt> : null}
            {line.orderNote ? <Txt size="xs" tone="faint">{line.orderNote}</Txt> : null}
          </View>
          <StatusPill
            label={STATE_LABEL[line.state]}
            tone={got ? 'pass' : line.state === 'ordered' ? 'info' : 'warn'}
          />
        </Rowed>
        <Rowed gap={2} wrap style={{ marginTop: t.space(2) }}>
          {!got && line.state === 'needed' ? (
            <Button
              title="Mark ordered"
              variant="secondary"
              compact
              onPress={() => void write(markOrdered(line, nowIso()), 'mark this ordered')}
            />
          ) : null}
          {!got && line.state === 'ordered' ? (
            <Button
              title="Not ordered yet"
              variant="ghost"
              compact
              onPress={() => void write(withNeedState(line, 'needed', nowIso()), 'put this back to needed')}
            />
          ) : null}
          <Button
            title={line.when === 'now' ? 'Leave for future works' : 'Need it now'}
            variant="ghost"
            compact
            onPress={() => void write(moveNeed(line, otherWhen(line.when), nowIso()), 'move this line')}
          />
          <Button title="Remove" variant="ghost" compact onPress={() => remove(line)} />
        </Rowed>
      </Card>
    );
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Things I need' }} />
      <Screen>
        {failed ? <Banner tone="fail" title="This list could not be read" body={failed} /> : null}

        <Card variant="raised">
          <Field
            label="What do you need?"
            value={text}
            onChangeText={setText}
            placeholder="Flow meter"
            hint="A count and a site are read out of what you type: 2 x 4.5kg ABE for YMCA Bowen Hills."
          />

          {parsed.quantity !== undefined ? (
            <Txt size="xs" tone="faint" style={{ marginTop: t.space(1.5) }}>
              Reading that as {parsed.quantity} × {parsed.what}
            </Txt>
          ) : null}

          {parts.length ? (
            <View style={{ marginTop: t.space(2.5), gap: t.space(1.5) }}>
              <Label>{partNumber ? 'Part attached' : 'Attach a part number'}</Label>
              <Rowed gap={2} wrap>
                {parts.map((p) => (
                  <Chip
                    key={p.id}
                    label={`${p.partNumber} · ${p.brand}`}
                    selected={partNumber === p.partNumber}
                    onPress={() => setPartNumber(partNumber === p.partNumber ? undefined : p.partNumber)}
                  />
                ))}
              </Rowed>
            </View>
          ) : null}

          {siteName ? (
            <View style={{ marginTop: t.space(2.5), gap: t.space(1.5) }}>
              <Label>For</Label>
              <Rowed gap={2} wrap>
                <Chip
                  label={`${siteName}  ✕`}
                  selected
                  onPress={() => { setSiteId(undefined); setSiteName(undefined); }}
                />
              </Rowed>
            </View>
          ) : sites.length ? (
            <View style={{ marginTop: t.space(2.5), gap: t.space(1.5) }}>
              <Label>Which site?</Label>
              <Rowed gap={2} wrap>
                {sites.map((s) => (
                  <Chip
                    key={s.id}
                    label={s.suburb ? `${s.name} · ${s.suburb}` : s.name}
                    onPress={() => { setSiteId(s.id); setSiteName(s.name); setSites([]); }}
                  />
                ))}
              </Rowed>
            </View>
          ) : null}

          <View style={{ height: t.space(3) }} />
          <Segmented
            options={[{ value: 'now', label: 'For now' }, { value: 'future', label: 'Future works' }]}
            value={when}
            onChange={setWhen}
          />

          {detail ? (
            <View style={{ marginTop: t.space(3), gap: t.space(3) }}>
              <Field
                label="Site"
                value={siteText}
                onChangeText={setSiteText}
                placeholder="Start typing a building"
                hint="Optional. A site the phone has never heard of is fine — type it in the line itself."
              />
              <Field label="Note" value={note} onChangeText={setNote} placeholder="Anything the office would ask" />
            </View>
          ) : null}

          <Rowed gap={2} style={{ marginTop: t.space(3) }}>
            <Button
              title={detail ? 'Less' : 'Site or note'}
              variant="ghost"
              compact
              style={{ flex: 1 }}
              onPress={() => setDetail(!detail)}
            />
            <Button
              title="Add to the list"
              style={{ flex: 2 }}
              disabled={!(siteName ? parsed.what : parsed.whatWithWhere).trim()}
              onPress={() => void add()}
            />
          </Rowed>
        </Card>

        <Rowed gap={2} wrap>
          <Button
            title="Send this list"
            variant="secondary"
            compact
            loading={sending}
            disabled={!lines.length}
            onPress={() => void sendList()}
            icon={<MaterialCommunityIcons name="share-variant-outline" size={16} color={t.color.text} />}
          />
          <Button
            title={nowNeeded.length ? `Order ${nowNeeded.length} with the office` : 'Order with the office'}
            variant="secondary"
            compact
            loading={ordering}
            disabled={!nowNeeded.length}
            onPress={() => void raiseRequest()}
            icon={<MaterialCommunityIcons name="cart-outline" size={16} color={t.color.text} />}
          />
          <Button
            title="Purchase requests"
            variant="ghost"
            compact
            onPress={() => router.push('/work/purchases')}
          />
        </Rowed>

        {!lines.length && !failed ? (
          <EmptyState
            icon="format-list-checks"
            title="Nothing on the list"
            body="Write down what you need as you notice it — an extinguisher for a site, a flow meter for next month. Tick it off when you have it."
          />
        ) : null}

        {lines.length ? groups.map((group) => (
          <View key={group.when} style={{ gap: t.space(2.5) }}>
            <SectionHeader title={group.open.length ? `${group.title} · ${group.open.length}` : group.title} />
            <Txt size="sm" tone="muted">{group.blurb}</Txt>
            {group.open.map((line, i) => (
              <Reveal key={line.id} index={i}>{renderLine(line)}</Reveal>
            ))}
            {!group.open.length ? (
              <Txt size="sm" tone="faint">Nothing wanted here.</Txt>
            ) : null}
            {group.got.length ? (
              <>
                <Label>Got ({group.got.length})</Label>
                {group.got.map(renderLine)}
              </>
            ) : null}
          </View>
        )) : null}
      </Screen>
    </>
  );
}
