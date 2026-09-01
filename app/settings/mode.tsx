import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Stack, router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  DESTINATIONS, MODE_BLURB, MODE_LABEL, TAB_LABEL,
  hiddenFrom, keptForTechnician, navFor, reach, readMode, searchDestinations, summarise,
  validateManifest,
  type AppMode, type Destination, type TabKey,
} from '@/domain/appMode';
import { DEFAULT_PREFS, loadPrefs, savePrefs, type Prefs } from '@/app-prefs';
import { useTheme } from '@/theme';
import {
  Banner, Card, Chip, Field, H2, Rowed, Screen, Segmented, StatTile, Txt,
} from '@/components/ui';

/**
 * Choosing between the technician's app and the office's.
 *
 * The setting itself is one line. The rest of this screen is the part that
 * makes the setting safe to use: it shows exactly what each mode holds back,
 * why, and how to get at it anyway. A mode that quietly removes things is
 * indistinguishable from a broken build to the person standing in a plant
 * room, and the support call that follows costs more than the taps it saved.
 *
 * The search box is the point rather than a nicety. It searches every screen
 * in the app whatever the mode is set to, so nothing here is ever a lock — a
 * technician who needs the quote screen once a year can still find it, and
 * sees for themselves that it was moved rather than taken away.
 */

export default function ModeScreen() {
  const t = useTheme();
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<TabKey | null>(null);

  useEffect(() => {
    void loadPrefs().then((p) => { setPrefs(p); setLoaded(true); });
  }, []);

  const read = useMemo(() => readMode(prefs.appMode), [prefs.appMode]);
  const mode = read.mode;

  const choose = useCallback((next: AppMode) => {
    setPrefs((prev) => {
      const updated = { ...prev, appMode: next };
      void savePrefs(updated);
      return updated;
    });
  }, []);

  const stats = summarise(mode);
  const held = hiddenFrom('technician');
  const kept = keptForTechnician();
  const problems = validateManifest();
  const hits = searchDestinations(query, mode);

  return (
    <>
      <Stack.Screen options={{ title: 'Technician or office' }} />
      <Screen>
        <Segmented
          value={mode}
          onChange={choose}
          options={[
            { value: 'technician' as AppMode, label: MODE_LABEL.technician },
            { value: 'office' as AppMode, label: MODE_LABEL.office },
          ]}
        />

        {read.assumed ? <Banner tone="warn" title="Mode not recognised" body={read.assumed} /> : null}

        <Card>
          <Txt size="sm" tone="muted" style={{ lineHeight: 20 }}>{MODE_BLURB[mode]}</Txt>
          <View style={{ height: t.space(3) }} />
          <Rowed gap={2}>
            <StatTile label="In the menus" value={stats.listed} />
            <StatTile label="From a record" value={stats.contextual} />
            <StatTile label="Held back" value={stats.hidden} tone={stats.hidden ? 'warn' : 'muted'} />
          </Rowed>
          <Txt size="xs" tone="faint" style={{ marginTop: t.space(2.5), lineHeight: 17 }}>
            {stats.total} screens in all. Nothing is ever removed by this setting — everything held
            back is still found by the search below, and every screen in the app is reachable in at
            least one mode without it.
          </Txt>
        </Card>

        <H2>Find any screen</H2>
        <Field
          label="Search every mode, not just this one"
          value={query}
          onChangeText={setQuery}
          placeholder="work planner"
          autoCapitalize="none"
        />
        {query.trim().length >= 2 && !hits.length ? (
          <Banner
            tone="warn"
            title="Nothing by that name"
            body={
              'This searches the names of the screens themselves, not the work inside them. For a '
              + 'clause, a defect code or a part number, use the question bar on Today.'
            }
          />
        ) : null}
        {hits.map((hit) => (
          <SearchResult key={hit.destination.route} destination={hit.destination} hidden={hit.hidden} mode={mode} />
        ))}

        <H2>What Technician holds back</H2>
        <Card>
          <Txt size="xs" tone="faint" style={{ lineHeight: 17 }}>
            {held.length} of {DESTINATIONS.length} screens. Each one is office work a technician
            cannot act on from site — and each one says how to get to it anyway.
          </Txt>
        </Card>
        {held.map((note) => (
          <Card key={note.destination.route}>
            <Rowed gap={2} align="center">
              <Txt weight="700" size="sm" style={{ flex: 1 }}>{note.destination.label}</Txt>
              <Chip label="Office" tone="accent" />
            </Rowed>
            <Txt size="sm" tone="muted" style={{ marginTop: t.space(1), lineHeight: 19 }}>
              {note.destination.blurb}
            </Txt>
            <Txt size="sm" style={{ marginTop: t.space(2), lineHeight: 19 }}>{note.because}</Txt>
            <Rowed gap={2} align="flex-start" style={{ marginTop: t.space(2) }}>
              <MaterialCommunityIcons name="arrow-u-left-top" size={15} color={t.color.textFaint} style={{ marginTop: 2 }} />
              <Txt size="xs" tone="faint" style={{ flex: 1, lineHeight: 17 }}>
                {note.stillReachedBy.sentence}
              </Txt>
            </Rowed>
          </Card>
        ))}

        {kept.length ? (
          <>
            <H2>Kept on purpose</H2>
            <Card>
              <Txt size="xs" tone="faint" style={{ lineHeight: 17 }}>
                These read as office work and stay in the technician's app anyway. The reason is
                written down so the argument does not have to be had again.
              </Txt>
            </Card>
            {kept.map((d) => (
              <Card key={d.route}>
                <Txt weight="700" size="sm">{d.label}</Txt>
                <Txt size="sm" tone="muted" style={{ marginTop: t.space(1), lineHeight: 19 }}>
                  {d.keptBecause}
                </Txt>
              </Card>
            ))}
          </>
        ) : null}

        <H2>What {MODE_LABEL[mode]} shows</H2>
        {navFor(mode).map((group) => {
          const count = group.sections.reduce((n, s) => n + s.destinations.length, 0);
          const expanded = open === group.tab;
          return (
            <Card key={group.tab} onPress={() => setOpen(expanded ? null : group.tab)}>
              <Rowed gap={2} align="center">
                <View style={{ flex: 1 }}>
                  <Txt weight="700">{TAB_LABEL[group.tab]}</Txt>
                  <Txt size="xs" tone="faint" style={{ lineHeight: 16 }}>{group.blurb}</Txt>
                </View>
                <Chip label={`${count}`} tone="muted" />
                <MaterialCommunityIcons
                  name={expanded ? 'chevron-up' : 'chevron-down'}
                  size={20}
                  color={t.color.textFaint}
                />
              </Rowed>
              {expanded ? (
                <View style={{ marginTop: t.space(2) }}>
                  {group.sections.map((section) => (
                    <View key={section.title} style={{ marginTop: t.space(2) }}>
                      <Txt size="xs" tone="muted" weight="700" style={{ textTransform: 'uppercase', letterSpacing: 0.8 }}>
                        {section.title}
                      </Txt>
                      {section.destinations.map((d) => <NavRow key={d.route} destination={d} />)}
                    </View>
                  ))}
                </View>
              ) : null}
            </Card>
          );
        })}

        {problems.length ? (
          <Banner
            tone="fail"
            title="The screen list has gone wrong"
            body={
              `${problems.join(' ')} Until this is fixed the menus may be missing something. `
              + 'Every screen is still reachable by name from the search above.'
            }
          />
        ) : null}

        <Txt size="xs" tone="faint" style={{ lineHeight: 17 }}>
          The list above is checked against the app's own screens by the test suite, in both
          directions: a menu row with no screen behind it fails, and so does a screen no menu
          points at. That is what stops this setting from quietly losing something.
        </Txt>
      </Screen>
    </>
  );
}

// ---------------------------------------------------------------------------

function NavRow({ destination }: { destination: Destination }) {
  const t = useTheme();
  return (
    <Pressable onPress={() => router.push(destination.route as never)}>
      <Rowed gap={2} align="flex-start" style={{ paddingVertical: t.space(2) }}>
        <View style={{ flex: 1 }}>
          <Txt size="sm" weight="600">{destination.label}</Txt>
          <Txt size="xs" tone="faint" style={{ lineHeight: 16 }}>{destination.blurb}</Txt>
        </View>
        <MaterialCommunityIcons name="chevron-right" size={18} color={t.color.textFaint} />
      </Rowed>
    </Pressable>
  );
}

/**
 * A search result, which is also the proof that nothing was taken away.
 *
 * A screen that needs a record cannot be opened from here — there is no site
 * to open it against — so instead of a button that goes nowhere it says which
 * screen it lives on. Half a route is not a result.
 */
function SearchResult({
  destination, hidden, mode,
}: {
  destination: Destination;
  hidden: boolean;
  mode: AppMode;
}) {
  const t = useTheme();
  const path = reach(destination.route, mode);
  const openable = !destination.needsContext;
  return (
    <Card onPress={openable ? () => router.push(destination.route as never) : undefined}>
      <Rowed gap={2} align="center">
        <Txt weight="700" size="sm" style={{ flex: 1 }}>{destination.label}</Txt>
        {hidden ? <Chip label={`${MODE_LABEL.office} only`} tone="warn" /> : null}
        <Chip label={TAB_LABEL[destination.tab]} tone="muted" />
      </Rowed>
      <Txt size="sm" tone="muted" style={{ marginTop: t.space(1), lineHeight: 19 }}>
        {destination.blurb}
      </Txt>
      {path ? (
        <Txt size="xs" tone={hidden ? 'warn' : 'faint'} style={{ marginTop: t.space(1.5), lineHeight: 17 }}>
          {path.sentence}
        </Txt>
      ) : null}
    </Card>
  );
}
