import React, { useMemo, useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { Stack, router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  BFSR_2008, BFSR_CITATION, BFSR_DEFINITIONS, BFSR_REPEALED, BFSR_VERIFICATION,
  CRITICAL_DEFECT_EXAMPLES, CRITICAL_DEFECT_TEST,
  type BfsrDuty, type BfsrSection,
} from '@/domain/standardsExtra';
import { normalise } from '@/domain/tradeVocabulary';
import { useTheme } from '@/theme';
import {
  Banner, Button, Card, Chip, Divider, Field, H2, Rowed, Screen, Txt,
} from '@/components/ui';

/**
 * The Building Fire Safety Regulation, indexed by who has to do what.
 *
 * This is the law the rest of the app exists to serve, and it was sitting in
 * the codebase with no way to open it. Every clock the app counts — the
 * twenty-four hours to a written notice, the month to rectify, the ten business
 * days to the commissioner — comes from a section in here, and a technician
 * being argued with on site has no way to point at the section without it.
 *
 * Indexed by duty rather than by number on purpose. "What do I have to do" is
 * the question; "what does section 55A say" is a question somebody only asks
 * once they already know the answer. The same section can bind more than one
 * person, so the filter widens rather than partitions.
 *
 * Unlike an Australian Standard this is Crown material published free, so where
 * the exact words decide something — the two-limb critical defect test, the
 * regulation's own worked examples — they are reproduced rather than
 * paraphrased. Everything that is our summary rather than the regulation's
 * words says so, and each section carries how far it has been verified: word
 * for word against the current consolidation, or read from the 2012 reprint and
 * not re-checked. Those are not the same claim and the screen does not present
 * them as one.
 */

const DUTY_LABEL: Record<BfsrDuty, string> = {
  occupier: 'Occupier',
  owner: 'Owner',
  maintainer: 'Maintainer',
  'any-person': 'Any person',
};

const DUTIES: BfsrDuty[] = ['occupier', 'owner', 'maintainer', 'any-person'];

export default function BfsrScreen() {
  const t = useTheme();
  const [duty, setDuty] = useState<BfsrDuty | null>(null);
  const [query, setQuery] = useState('');

  const matches = useMemo(() => {
    const q = normalise(query.trim());
    return BFSR_2008.filter((s) => {
      if (duty && !s.duty.includes(duty)) return false;
      if (!q) return true;
      const hay = normalise([
        s.section, s.heading, s.requires, s.text ?? '', s.part,
        ...(s.elements ?? []).map((e) => `${e.para} ${e.requires}`),
      ].join(' '));
      return hay.includes(q);
    });
  }, [duty, query]);

  const byPart = useMemo(() => {
    const map = new Map<string, BfsrSection[]>();
    for (const s of matches) {
      const list = map.get(s.part);
      if (list) list.push(s);
      else map.set(s.part, [s]);
    }
    return [...map.entries()];
  }, [matches]);

  const definitions = useMemo(() => {
    const q = normalise(query.trim());
    if (!q) return [];
    return BFSR_DEFINITIONS.filter((d) =>
      normalise(`${d.term} ${d.meaning} ${d.note ?? ''}`).includes(q));
  }, [query]);

  return (
    <Screen>
      <Stack.Screen options={{ title: 'The regulation' }} />

      <View>
        <H2>{BFSR_CITATION.title}</H2>
        <Txt size="sm" tone="muted">
          {BFSR_CITATION.instrument} · made under the {BFSR_CITATION.madeUnder}
        </Txt>
      </View>

      <Banner
        tone="info"
        title="Reproduced, not summarised, where the words decide something"
        body={BFSR_CITATION.reproductionNote}
      />

      <Field
        label="Search"
        value={query}
        onChangeText={setQuery}
        placeholder="critical defect, occupier statement, 24 hours"
        autoCapitalize="none"
      />

      <Rowed gap={2} wrap>
        <Chip label="Everything" selected={duty === null} onPress={() => setDuty(null)} />
        {DUTIES.map((d) => (
          <Chip
            key={d}
            label={DUTY_LABEL[d]}
            selected={duty === d}
            tone={duty === d ? 'accent' : 'default'}
            onPress={() => setDuty(duty === d ? null : d)}
          />
        ))}
      </Rowed>

      <Txt size="sm" tone="muted">
        {matches.length} of {BFSR_2008.length} sections
        {duty ? ` binding the ${DUTY_LABEL[duty].toLowerCase()}` : ''}
      </Txt>

      <CriticalDefectCard />

      {definitions.length ? (
        <>
          <H2>Definitions</H2>
          {definitions.map((d) => (
            <Card key={d.term}>
              <Rowed>
                <Txt weight="700" style={{ flex: 1 }}>{d.term}</Txt>
                <Chip label={d.source} />
              </Rowed>
              <Txt size="sm" style={{ lineHeight: 20 }}>{d.meaning}</Txt>
              {d.note ? (
                <Txt size="sm" tone="warn" style={{ lineHeight: 19 }}>{d.note}</Txt>
              ) : null}
            </Card>
          ))}
        </>
      ) : null}

      {byPart.map(([part, sections]) => (
        <View key={part} style={{ gap: t.space(2.5) }}>
          <H2>{part}</H2>
          {sections.map((s) => <SectionCard key={s.section} section={s} />)}
        </View>
      ))}

      {!matches.length ? (
        <Card>
          <Txt tone="muted">
            Nothing in the indexed sections matches that. This is not the whole regulation — the fee
            parts and most transitional provisions are left out because nothing in this app touches
            them. Part 5, which carries the maintenance obligations, is complete.
          </Txt>
        </Card>
      ) : null}

      <Divider />
      <RepealedCard />

      <Card>
        <Txt size="sm" tone="muted" style={{ lineHeight: 20 }}>
          The current consolidation is on the Queensland legislation register, free. What is here is
          an index to it, not a substitute for it.
        </Txt>
        <Button
          title="Open the regulation"
          variant="secondary"
          icon={<MaterialCommunityIcons name="open-in-new" size={16} color={t.color.text} />}
          onPress={() => void Linking.openURL(BFSR_CITATION.officialUrl)}
        />
      </Card>
      <View style={{ height: t.space(4) }} />
    </Screen>
  );
}

/**
 * One section.
 *
 * The exact words come first where they exist, because a technician being
 * argued with needs the regulation's sentence rather than ours. Our summary is
 * labelled as ours underneath it.
 */
function SectionCard({ section }: { section: BfsrSection }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const verification = BFSR_VERIFICATION[section.verified];

  return (
    <Card onPress={() => setOpen(!open)}>
      <Rowed align="flex-start">
        <View style={{ width: 46 }}>
          <Txt weight="700" mono>s {section.section}</Txt>
        </View>
        <View style={{ flex: 1 }}>
          <Txt weight="600">{section.heading}</Txt>
          <Txt size="sm" tone="muted" style={{ lineHeight: 19, marginTop: 2 }}>
            {section.requires}
          </Txt>
        </View>
        <MaterialCommunityIcons
          name={open ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={t.color.textFaint}
        />
      </Rowed>

      <Rowed gap={1.5} wrap>
        {section.duty.map((d) => <Chip key={d} label={DUTY_LABEL[d]} />)}
        {section.maxPenaltyUnits ? (
          <Chip label={`Max ${section.maxPenaltyUnits} penalty units`} tone="warn" />
        ) : null}
      </Rowed>

      {open ? (
        <View style={{ gap: t.space(2), marginTop: t.space(1) }}>
          {section.text ? (
            <View
              style={{
                backgroundColor: t.color.surfaceAlt,
                borderRadius: t.radius.md,
                borderLeftWidth: 3,
                borderLeftColor: t.color.borderStrong,
                padding: t.space(3),
              }}
            >
              <Txt size="sm" style={{ lineHeight: 21 }}>{section.text}</Txt>
              <Txt size="xs" tone="faint" style={{ marginTop: t.space(1.5) }}>
                The regulation&rsquo;s own words.
              </Txt>
            </View>
          ) : null}

          {section.elements?.length ? (
            <View style={{ gap: t.space(1.5) }}>
              {section.elements.map((e) => (
                <Rowed key={e.para} gap={2} align="flex-start">
                  <Txt size="sm" mono tone="muted" style={{ width: 62 }}>{e.para}</Txt>
                  <Txt size="sm" style={{ flex: 1, lineHeight: 19 }}>{e.requires}</Txt>
                </Rowed>
              ))}
            </View>
          ) : null}

          <Txt size="xs" tone={verification.confidence === 'high' ? 'muted' : 'warn'} style={{ lineHeight: 16 }}>
            {verification.source}, as at {verification.asAt}.
          </Txt>

          {section.appFeature ? (
            <Pressable onPress={() => router.push(`/${section.appFeature}` as never)}>
              <Rowed gap={2}>
                <MaterialCommunityIcons name="arrow-right-circle-outline" size={15} color={t.color.accentText} />
                <Txt size="sm" tone="accent">Open what this app does about it</Txt>
              </Rowed>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

/**
 * The two-limb test, reproduced.
 *
 * Given its own card because it is the call a technician makes under time
 * pressure and gets wrong, and because it is not the AS 1851 critical defect
 * test. The negative example is the useful one: one dead extinguisher out of
 * several is expressly not a critical defect.
 */
function CriticalDefectCard() {
  const t = useTheme();
  return (
    <Card>
      <Rowed>
        <MaterialCommunityIcons name="alert-octagon-outline" size={20} color={t.color.fail} />
        <Txt weight="700" style={{ flex: 1 }}>
          Critical defect — section {CRITICAL_DEFECT_TEST.section}
        </Txt>
      </Rowed>
      <Txt size="sm" style={{ lineHeight: 20 }}>a. {CRITICAL_DEFECT_TEST.limbA}</Txt>
      <Txt size="sm" style={{ lineHeight: 20 }}>b. {CRITICAL_DEFECT_TEST.limbB}</Txt>
      <Banner
        tone="warn"
        title={CRITICAL_DEFECT_TEST.bothRequired ? 'Both limbs, not either' : 'Either limb'}
        body={CRITICAL_DEFECT_TEST.note}
      />
      <Divider />
      <Txt size="sm" weight="600">The regulation&rsquo;s own examples</Txt>
      {CRITICAL_DEFECT_EXAMPLES.areCritical.map((e) => (
        <Rowed key={e} gap={2} align="flex-start">
          <MaterialCommunityIcons name="check-circle-outline" size={15} color={t.color.fail} />
          <Txt size="sm" style={{ flex: 1, lineHeight: 19 }}>{e}</Txt>
        </Rowed>
      ))}
      {CRITICAL_DEFECT_EXAMPLES.areNotCritical.map((e) => (
        <Rowed key={e} gap={2} align="flex-start">
          <MaterialCommunityIcons name="close-circle-outline" size={15} color={t.color.pass} />
          <Txt size="sm" style={{ flex: 1, lineHeight: 19 }}>{e}</Txt>
        </Rowed>
      ))}
      <Txt size="xs" tone="faint" style={{ lineHeight: 16 }}>
        The second one is the call that gets made wrong under time pressure: one dead extinguisher
        out of several in a part of a building is expressly not a critical defect.
      </Txt>
    </Card>
  );
}

/**
 * Sections that no longer exist.
 *
 * Worth showing rather than omitting. A repealed section number turns up in old
 * reports and old advice, and "not found" reads as a gap in this index rather
 * than as the answer.
 */
function RepealedCard() {
  const entries = Object.entries(BFSR_REPEALED);
  if (!entries.length) return null;
  return (
    <Card>
      <Txt weight="600" size="sm">Repealed sections</Txt>
      <Txt size="xs" tone="muted" style={{ lineHeight: 17 }}>
        These turn up in old reports and old advice. Listed so a search for one gives the answer
        rather than nothing.
      </Txt>
      {entries.map(([section, note]) => (
        <Rowed key={section} gap={2} align="flex-start">
          <Txt size="sm" mono tone="muted" style={{ width: 46 }}>s {section}</Txt>
          <Txt size="sm" style={{ flex: 1, lineHeight: 19 }}>{note}</Txt>
        </Rowed>
      ))}
    </Card>
  );
}
