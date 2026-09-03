import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { nowIso } from '@/db';
import { qldIsoDay, qldMoment } from '@/domain/qldTime';
import { Linking, Platform, View } from 'react-native';
import { Stack, router } from 'expo-router';
import * as Location from 'expo-location';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { listJobs, type JobRecord } from '@/db/opsRepo';
import { formatKm, planRoute, type RoutePoint } from '@/domain/routing';
import { useTheme } from '@/theme';
import { showAlert } from '@/components/alert';
import {
  Banner, Button, Card, Chip, EmptyState, H2, Rowed, Screen, Segmented, Txt,
} from '@/components/ui';

/**
 * The day's run, ordered by where the work is.
 *
 * Two things this is honest about on the screen, because getting them wrong
 * would cost a technician real time:
 *
 * The distances are straight-line. Across SEQ that understates badly — two
 * sites a kilometre apart across the river are a fifteen-minute drive. The
 * ordering usually survives, the kilometres do not.
 *
 * Nearest-neighbour is not the shortest possible route. For the handful of
 * stops a day actually holds it is close, and it has the property that matters
 * more: the order is one a technician can look at and see the reasoning behind.
 *
 * Urgent work is never reordered behind routine work to save a few kilometres.
 * A router that suggests driving past a callout gets ignored on the first day
 * and distrusted after that.
 */
type Start = 'here' | 'first';

/**
 * The Queensland clock time of an instant, as HH:MM.
 *
 * Read off qldMoment rather than off the string: the eleventh to sixteenth
 * characters of an ISO instant are its UTC clock, ten hours behind the one
 * the job was booked in.
 */
function qldClock(iso: string): string | undefined {
  return qldMoment(iso)?.match(/ (\d{2}:\d{2}) /)?.[1];
}

export default function RouteScreen() {
  const t = useTheme();
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [start, setStart] = useState<Start>('here');
  const [here, setHere] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationNote, setLocationNote] = useState<string | null>(null);
  const [scope, setScope] = useState<'today' | 'open'>('today');

  const load = useCallback(async () => {
    setJobs(await listJobs({ limit: 500 }));
  }, []);

  useEffect(() => { void load(); }, [load]);

  const findMe = useCallback(async () => {
    setLocating(true);
    setLocationNote(null);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocationNote('Location was declined, so the run is ordered from the first job instead.');
        setStart('first');
        return;
      }
      // Balanced accuracy: this decides an order, not a position on a map, and
      // a high-accuracy fix costs battery and time for precision that changes
      // nothing here.
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setHere({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
    } catch (e) {
      setLocationNote(
        `Could not get a position (${e instanceof Error ? e.message : String(e)}). Ordering from the first job instead.`,
      );
      setStart('first');
    } finally {
      setLocating(false);
    }
  }, []);

  useEffect(() => { if (start === 'here' && !here) void findMe(); }, [start, here, findMe]);

  // The Queensland calendar day. Between midnight and 10am a UTC day is
  // yesterday's, and this company starts at seven.
  const today = qldIsoDay(nowIso()) ?? '';

  const candidates = useMemo(
    () => jobs.filter((j) => {
      if (j.status === 'complete') return false;
      if (scope === 'open') return true;
      return qldIsoDay(j.scheduledFor ?? undefined) === today;
    }),
    [jobs, scope, today],
  );

  const route = useMemo(() => {
    const points: (RoutePoint & { job: JobRecord })[] = candidates.map((j) => ({
      id: j.id,
      label: j.siteName,
      latitude: j.latitude,
      longitude: j.longitude,
      priority: j.priority,
      job: j,
    }));
    return planRoute(points, start === 'here' ? (here ?? undefined) : undefined);
  }, [candidates, start, here]);

  const navigateTo = (job: JobRecord) => {
    const destination =
      job.latitude !== undefined && job.longitude !== undefined
        ? `${job.latitude},${job.longitude}`
        : job.address ?? job.siteName;
    // Hands off to whatever the phone uses for navigation rather than
    // pretending to route: the maps app knows about roads and traffic.
    const url = Platform.select({
      ios: `maps://?daddr=${encodeURIComponent(destination)}`,
      default: `geo:0,0?q=${encodeURIComponent(destination)}`,
    })!;
    void Linking.openURL(url).catch(() => {
      showAlert('No maps app', `Could not open a maps app for ${destination}.`);
    });
  };

  return (
    <>
      <Stack.Screen options={{ title: "Today's run" }} />
      <Screen>
        <Rowed gap={2}>
          <View style={{ flex: 1 }}>
            <Segmented
              value={scope}
              onChange={setScope}
              options={[{ value: 'today', label: 'Today' }, { value: 'open', label: 'All open' }]}
            />
          </View>
        </Rowed>

        <Segmented
          value={start}
          onChange={setStart}
          options={[{ value: 'here', label: 'From here' }, { value: 'first', label: 'From first job' }]}
        />

        {locationNote ? <Banner tone="warn" title="Ordering without a position" body={locationNote} /> : null}

        {start === 'here' && !here && !locationNote ? (
          <Card>
            <Rowed gap={2} align="center">
              <MaterialCommunityIcons name="crosshairs-gps" size={20} color={t.color.textFaint} />
              <Txt size="sm" tone="muted" style={{ flex: 1 }}>
                {locating ? 'Finding where you are…' : 'Waiting on a position.'}
              </Txt>
            </Rowed>
            {!locating ? (
              <Button title="Try again" variant="secondary" compact onPress={findMe} style={{ marginTop: t.space(2) }} />
            ) : null}
          </Card>
        ) : null}

        {route.stops.length ? (
          <Card>
            <Rowed style={{ justifyContent: 'space-between' }}>
              <Txt weight="700">
                {route.stops.length} stop{route.stops.length === 1 ? '' : 's'}
              </Txt>
              <Chip label={`${formatKm(route.totalKm)} straight line`} />
            </Rowed>
            <Txt size="xs" tone="faint" style={{ marginTop: t.space(1.5), lineHeight: 17 }}>
              Straight-line distance, so the real drive is longer — often much longer where the river or a motorway is
              in the way. Nearest-neighbour ordering, which is close to the shortest route for a day's stops but not
              guaranteed to be it. Urgent jobs are placed first regardless of distance.
            </Txt>
          </Card>
        ) : null}

        {!route.stops.length && !route.unplaceable.length ? (
          <EmptyState
            title={scope === 'today' ? 'Nothing scheduled today' : 'Nothing open'}
            body={
              scope === 'today'
                ? 'Switch to all open work to plan a run across everything outstanding.'
                : 'No jobs are outstanding. Pull from Simpro in Settings if you expect some.'
            }
          />
        ) : null}

        {route.stops.map((stop, i) => {
          const job = (stop.point as RoutePoint & { job: JobRecord }).job;
          return (
            <Card key={job.id} onPress={() => router.push({ pathname: '/work/job/[id]', params: { id: job.id } })}>
              <Rowed align="flex-start" gap={2}>
                <View
                  style={{
                    width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center',
                    backgroundColor: job.priority === 'urgent' ? t.color.fail : t.color.surfaceAlt,
                  }}
                >
                  <Txt size="xs" weight="700" tone={job.priority === 'urgent' ? undefined : 'muted'}>{i + 1}</Txt>
                </View>
                <View style={{ flex: 1 }}>
                  <Txt weight="700">{job.siteName}</Txt>
                  <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>{job.title}</Txt>
                  {job.address ? <Txt size="xs" tone="faint">{job.address}</Txt> : null}
                  <Rowed gap={2} wrap style={{ marginTop: t.space(1.5) }}>
                    {job.priority === 'urgent' ? <Chip label="Urgent" tone="fail" /> : null}
                    <Chip label={i === 0 && stop.legKm === 0 ? 'Start' : formatKm(stop.legKm)} />
                    {job.scheduledFor ? <Chip label={qldClock(job.scheduledFor) ?? 'Scheduled'} /> : null}
                  </Rowed>
                </View>
              </Rowed>
              <Button
                title="Navigate"
                variant="secondary"
                compact
                onPress={() => navigateTo(job)}
                style={{ marginTop: t.space(2.5) }}
              />
            </Card>
          );
        })}

        {route.unplaceable.length ? (
          <>
            <H2>Not placed in the run</H2>
            <Banner
              tone="warn"
              title={`${route.unplaceable.length} job${route.unplaceable.length === 1 ? '' : 's'} with no location`}
              body="These have no coordinates, so they cannot be ordered against the rest. They are listed here rather than dropped at the end of the run, where they would look like a decision."
            />
            {route.unplaceable.map((p) => {
              const job = (p as RoutePoint & { job: JobRecord }).job;
              return (
                <Card key={job.id} onPress={() => router.push({ pathname: '/work/job/[id]', params: { id: job.id } })}>
                  <Rowed align="flex-start" gap={2}>
                    <MaterialCommunityIcons name="map-marker-off-outline" size={20} color={t.color.warn} />
                    <View style={{ flex: 1 }}>
                      <Txt weight="700">{job.siteName}</Txt>
                      <Txt size="sm" tone="muted">{job.title}</Txt>
                      {job.address ? <Txt size="xs" tone="faint">{job.address}</Txt> : null}
                    </View>
                  </Rowed>
                  {job.address ? (
                    <Button
                      title="Navigate by address"
                      variant="secondary"
                      compact
                      onPress={() => navigateTo(job)}
                      style={{ marginTop: t.space(2.5) }}
                    />
                  ) : null}
                </Card>
              );
            })}
          </>
        ) : null}
      </Screen>
    </>
  );
}
