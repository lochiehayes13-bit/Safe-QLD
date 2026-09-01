import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { Stack, router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { nowIso } from '@/db';
import { listDefects, listSites } from '@/db/repo';
import { listRoutineRuns } from '@/db/routineRunRepo';
import { queryAssets } from '@/db/assetRepo';
import { listOccupierStatements } from '@/db/occupierRepo';
import {
  STANDING_LABEL, STATUTORY_LABEL, buildPortfolio, foldRuns, percentOf, scoreAddsUp,
  type ConcentrationRow, type Portfolio, type SiteRisk, type StatutoryItem,
} from '@/domain/portfolio';
import { assetTypeById } from '@/seed/assetTypes';
import { formatAuDate } from '@/export/sheets';
import { useTheme } from '@/theme';
import {
  Banner, Button, Card, Chip, Divider, EmptyState, H2, Label, ResultBlock, Rowed, Screen, Segmented,
  StatTile, Txt,
} from '@/components/ui';

/**
 * How the whole book is going.
 *
 * The app could answer everything about one site and nothing about 897 of them,
 * and "how are we going" is the question that decides where somebody goes
 * tomorrow. This is that screen, and it is built so it cannot flatter itself:
 *
 *  - The coverage figure is printed before any health figure, because a
 *    dashboard that reads green while knowing about forty sites is worse than
 *    no dashboard.
 *  - Sites nobody has ever serviced get their own tile and their own list. They
 *    are not overdue, and the screen says why in the words the module gives it
 *    rather than in a caption somebody has to remember to update.
 *  - Every score can be opened up. The breakdown is the score — a technician
 *    reads the reasons, not the number.
 *  - Statutory exposure has its own block above the ranking, because a 24-hour
 *    notice is not a performance metric.
 */

/**
 * How much this screen will read.
 *
 * The book is 12,553 assets and a few years of routine runs. These are set well
 * above that so a normal load is complete, and the screen says so out loud when
 * a query comes back at its limit rather than quietly describing part of the
 * book as though it were all of it.
 */
const RUN_LIMIT = 40_000;
const ASSET_LIMIT = 30_000;

interface Loaded {
  portfolio: Portfolio;
  /** Runs that could not be folded into a history, with the reason. */
  rejectedRuns: number;
  truncated: string[];
}

export default function PortfolioScreen() {
  const t = useTheme();
  const [data, setData] = useState<Loaded | undefined>();
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'risk' | 'concentration' | 'unjudged'>('risk');
  const [openSite, setOpenSite] = useState<string | undefined>();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [sites, runs, defects, assets, statements] = await Promise.all([
        listSites(),
        listRoutineRuns(undefined, RUN_LIMIT),
        listDefects(),
        queryAssets({ limit: ASSET_LIMIT }),
        listOccupierStatements(),
      ]);

      // Only a signed statement is a statement. A draft sitting in the app is
      // not one the occupier has made, and counting it would restart the year.
      const lastStatement = new Map<string, string>();
      for (const s of statements) {
        if (!s.signedAt) continue;
        const prev = lastStatement.get(s.siteId);
        if (!prev || s.signedAt > prev) lastStatement.set(s.siteId, s.signedAt);
      }

      const folded = foldRuns(runs.map((r) => ({
        siteId: r.siteId,
        routineId: r.routineId,
        frequency: r.frequency,
        system: r.system,
        completedAt: r.completedAt,
      })));

      const portfolio = buildPortfolio({
        today: nowIso(),
        sites: sites.map((s) => ({
          siteId: s.id,
          siteName: s.name,
          clientName: s.clientName,
          suburb: s.suburb,
          postcode: s.postcode,
          lastStatementAt: lastStatement.get(s.id),
        })),
        histories: folded.histories,
        assets: assets.map((a) => ({
          siteId: a.siteId,
          assetTypeId: a.assetTypeId,
          system: assetTypeById(a.assetTypeId)?.system,
        })),
        defects: defects.map((d) => {
          /**
           * The defect table stores the two Queensland limbs as nullable
           * columns and the repository reads a null back as false. That makes a
           * limb nobody answered indistinguishable from a limb answered no, so
           * a defect flagged critical whose limbs both read false is passed on
           * as unanswered rather than as not-critical. Either it was mis-flagged
           * or the limbs were never worked through, and in both cases the
           * statutory position is unestablished — which is what the portfolio
           * then reports.
           *
           * "Flagged critical" has to include the AS 1851 classification as
           * well as the severity. They are different tests and the app records
           * them separately, but both are a person calling this defect
           * critical, and only checking one of them let an AS 1851 critical
           * defect with nothing answered arrive as two false limbs and be
           * scored as an ordinary three-point defect.
           */
          const flaggedCritical = d.severity === 'critical' || d.as1851Class === 'critical';
          const answered = d.qldLimbInoperable === true || d.qldLimbAdverseImpact === true;
          const unestablished = flaggedCritical && !answered;
          return {
            defectId: d.id,
            siteId: d.siteId,
            status: d.status,
            severity: d.severity,
            raisedAt: d.raisedAt,
            description: d.description,
            location: d.location,
            as1851Class: d.as1851Class,
            qldLimbInoperable: unestablished ? undefined : d.qldLimbInoperable,
            qldLimbAdverseImpact: unestablished ? undefined : d.qldLimbAdverseImpact,
            noticeIssuedAt: d.noticeIssuedAt,
            verbalNotifiedAt: d.verbalNotifiedAt,
            rectificationDueAt: d.rectificationDueAt,
            rectifiedAt: d.rectifiedAt,
          };
        }),
      });

      const truncated: string[] = [];
      if (runs.length >= RUN_LIMIT) {
        truncated.push(`Service history was read to its limit of ${RUN_LIMIT.toLocaleString('en-AU')} runs, so some `
          + 'sites may be anchored to a later service than their first. Treat the schedule figures as incomplete.');
      }
      if (assets.length >= ASSET_LIMIT) {
        truncated.push(`The asset register was read to its limit of ${ASSET_LIMIT.toLocaleString('en-AU')} assets, `
          + 'so the coverage figure understates what is known.');
      }

      setData({ portfolio, rejectedRuns: folded.rejected.length, truncated });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const book = data?.portfolio;

  const currentPercent = useMemo(
    () => percentOf(book?.health.currentFractionOfJudged),
    [book],
  );

  if (loading && !book) {
    return (
      <>
        <Stack.Screen options={{ title: 'Portfolio' }} />
        <Screen>
          <Txt tone="muted">Reading the book…</Txt>
        </Screen>
      </>
    );
  }

  if (!book) {
    return (
      <>
        <Stack.Screen options={{ title: 'Portfolio' }} />
        <Screen>
          <EmptyState
            title="Nothing loaded"
            body="The portfolio could not be built from what is in the app."
            action={<Button title="Try again" onPress={() => void load()} />}
          />
        </Screen>
      </>
    );
  }

  const s = book.statutory;
  const health = book.health;

  return (
    <>
      <Stack.Screen options={{ title: 'Portfolio' }} />
      <Screen>
        {book.refusals.map((r, i) => (
          <Banner key={`refusal-${i}`} tone="fail" title="Nothing was judged" body={r} />
        ))}

        {/* Coverage before anything else, deliberately. */}
        <ResultBlock
          label="What this screen can judge"
          value={book.coverage.percent === undefined ? '—' : String(book.coverage.percent)}
          unit={book.coverage.percent === undefined ? undefined : '% of the book'}
          tone={book.coverage.enoughToJudge ? 'pass' : 'warn'}
          detail={book.coverage.headline}
        />
        {book.coverage.caveats.map((c, i) => (
          <Banner key={`caveat-${i}`} tone="warn" title="Read the denominator" body={c} />
        ))}
        {data?.truncated.map((c, i) => (
          <Banner key={`truncated-${i}`} tone="warn" title="Partly read" body={c} />
        ))}
        {data?.rejectedRuns ? (
          <Banner
            tone="warn"
            title={`${data.rejectedRuns} service record${data.rejectedRuns === 1 ? '' : 's'} could not be read`}
            body="Their frequency or their date is not something this app can interpret, so they were left out rather than guessed at. Those sites may look emptier than they are."
          />
        ) : null}

        <H2>Servicing</H2>
        <Rowed gap={2}>
          <StatTile label="Overdue" value={health.overdue} tone={health.overdue ? 'fail' : 'default'} />
          <StatTile label="Due now" value={health.due} tone={health.due ? 'warn' : 'default'} />
          <StatTile label="Current" value={health.current} tone={health.current ? 'pass' : 'default'} />
        </Rowed>
        <Rowed gap={2}>
          <StatTile label="Never serviced" value={health.neverServiced} />
          <StatTile label="No schedule" value={health.unschedulable} />
          <StatTile label="Sites" value={health.sites} />
        </Rowed>
        <Card>
          <Label>Where the percentage comes from</Label>
          <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>
            {currentPercent === undefined
              ? health.denominator
              : `${currentPercent}% of judged sites are current. ${health.denominator}`}
          </Txt>
        </Card>

        <H2>Statutory exposure</H2>
        <Banner tone="info" title="Counted here and nowhere else" body={s.note} />
        <Rowed gap={2}>
          <StatTile
            label="Critical open"
            value={s.criticalDefectsOutstanding}
            tone={s.criticalDefectsOutstanding ? 'fail' : 'default'}
          />
          <StatTile label="Notice overdue" value={s.noticeOverdue} tone={s.noticeOverdue ? 'fail' : 'default'} />
          <StatTile label="Notice running" value={s.noticeClockRunning} tone={s.noticeClockRunning ? 'warn' : 'default'} />
        </Rowed>
        <Rowed gap={2}>
          <StatTile
            label="Past rectify date"
            value={s.pastRectificationDate}
            tone={s.pastRectificationDate ? 'fail' : 'default'}
          />
          <StatTile
            label="Statements due"
            value={s.statementsOverdue + s.statementsDueSoon}
            tone={s.statementsOverdue ? 'fail' : 'default'}
          />
          <StatTile label="Limbs unanswered" value={s.classificationUnanswered} />
        </Rowed>
        {s.rectificationDateUnknown ? (
          <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>
            The month allowed for the repair cannot be counted on {s.rectificationDateUnknown} critical defect
            {s.rectificationDateUnknown === 1 ? '' : 's'}, because the date it would run from is not one this app
            can read. Not counted as breached, and not counted as in hand.
          </Txt>
        ) : null}
        {s.noticeDateUnknown ? (
          <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>
            The 24 hours cannot be counted on {s.noticeDateUnknown} critical defect
            {s.noticeDateUnknown === 1 ? '' : 's'} either — the raised date is unreadable, so there is no moment
            for it to run from. A breach is not asserted against a date nobody can read.
          </Txt>
        ) : null}
        {s.statementDateUnknown ? (
          <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>
            {s.statementDateUnknown} site{s.statementDateUnknown === 1 ? ' holds' : 's hold'} no statement date at
            all, so when their occupier statement falls due is unknown — not overdue, and not in hand.
          </Txt>
        ) : null}
        {s.items.length ? (
          <Card>
            {s.items.slice(0, 8).map((item, i) => (
              <View key={`${item.kind}-${item.siteId}-${item.defectId ?? i}`}>
                {i ? <Divider /> : null}
                <StatutoryRow item={item} />
              </View>
            ))}
            {s.items.length > 8 ? (
              <Txt size="sm" tone="muted" style={{ marginTop: t.space(2) }}>
                and {s.items.length - 8} more.
              </Txt>
            ) : null}
          </Card>
        ) : (
          <Txt size="sm" tone="muted">No statutory clock is running on anything this app holds.</Txt>
        )}

        <H2>Where the exposure sits</H2>
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'risk', label: `Ranked (${book.rankedTotal})` },
            { value: 'concentration', label: 'Concentration' },
            { value: 'unjudged', label: `Not judged (${book.unjudged.length})` },
          ]}
        />

        {tab === 'risk' ? (
          book.ranked.length ? (
            <>
              <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>
                Ranked by exposure, not by how many things are outstanding. Tap a site to see every point in its
                score — the breakdown is the score.
              </Txt>
              {book.ranked.map((risk, i) => (
                <RiskCard
                  key={risk.siteId}
                  rank={i + 1}
                  risk={risk}
                  open={openSite === risk.siteId}
                  onToggle={() => setOpenSite(openSite === risk.siteId ? undefined : risk.siteId)}
                />
              ))}
              {book.rankedTotal > book.ranked.length ? (
                <Txt size="sm" tone="muted">
                  {book.rankedTotal - book.ranked.length} further sites scored above zero and are in the counts above.
                </Txt>
              ) : null}
            </>
          ) : (
            <EmptyState
              title="Nothing scored"
              body="No site in the book carries an overdue routine, an open defect or a statutory clock that this app can see. Check the coverage figure at the top before reading that as good news."
            />
          )
        ) : null}

        {tab === 'concentration' ? (
          <>
            <ConcentrationBlock
              title="Clients"
              rows={book.concentration.byClient}
              missing={book.concentration.sitesWithNoClient}
              missingLabel="site(s) have no client recorded and are in no row below"
            />
            <ConcentrationBlock
              title="Suburbs"
              rows={book.concentration.bySuburb}
              missing={book.concentration.sitesWithNoSuburb}
              missingLabel="site(s) have no suburb recorded and are in no row below"
            />
            <ConcentrationBlock
              title="Systems"
              rows={book.concentration.bySystem}
              missing={book.concentration.overdueWithNoSystem}
              missingLabel="overdue routine(s) could not be tied to a system"
            />
            {book.concentration.caveats.map((c, i) => (
              <Txt key={`conc-${i}`} size="sm" tone="muted" style={{ lineHeight: 19 }}>{c}</Txt>
            ))}
          </>
        ) : null}

        {tab === 'unjudged' ? (
          book.unjudged.length ? (
            <>
              <Banner
                tone="info"
                title={`${book.unjudged.length} site${book.unjudged.length === 1 ? '' : 's'} this app cannot place`}
                body="Not overdue and not current. Every figure above excludes them, which is the only honest way to count a site nobody has told the app about."
              />
              {book.unjudged.map((u) => (
                <Card
                  key={u.siteId}
                  onPress={() => router.push({ pathname: '/site/[id]', params: { id: u.siteId } })}
                >
                  <Rowed align="flex-start" gap={2}>
                    <View style={{ flex: 1, gap: 3 }}>
                      <Txt weight="700">{u.siteName}</Txt>
                      <Txt size="sm" tone="muted">
                        {[u.clientName, u.suburb].filter(Boolean).join(' · ') || 'No client or suburb recorded'}
                      </Txt>
                      <Rowed gap={2} wrap>
                        <Chip label={u.reason === 'never-serviced' ? 'Never serviced' : 'No schedule'} tone="warn" />
                        {u.criticalDefectsOutstanding ? (
                          <Chip label={`${u.criticalDefectsOutstanding} critical open`} tone="fail" />
                        ) : null}
                        {u.defectsOutstanding ? <Chip label={`${u.defectsOutstanding} defects open`} /> : null}
                      </Rowed>
                      <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>{u.detail}</Txt>
                    </View>
                    <MaterialCommunityIcons name="chevron-right" size={20} color={t.color.textFaint} />
                  </Rowed>
                </Card>
              ))}
            </>
          ) : (
            <EmptyState
              title="Every site can be judged"
              body="Every site in the book carries a service history with a schedule behind it."
            />
          )
        ) : null}

        <Rowed gap={2}>
          <Button
            title={loading ? 'Reading…' : 'Read the book again'}
            variant="secondary"
            onPress={() => void load()}
            loading={loading}
            style={{ flex: 1 }}
          />
        </Rowed>
        <Txt size="xs" tone="faint">
          {book.today
            ? `Read at ${formatAuDate(book.today)}. `
            : 'Nothing was read, because the date to read it against could not be established. '}
          This screen reads the whole book, so it does not refresh itself every time you open it — nothing here
          is live.
        </Txt>

        <H2>Notes and sources</H2>
        {book.notes.map((n, i) => (
          <Txt key={`note-${i}`} size="sm" tone="muted" style={{ lineHeight: 19 }}>{n}</Txt>
        ))}
        <Card>
          {book.sources.map((src, i) => (
            <View key={src.id}>
              {i ? <Divider /> : null}
              <Txt size="sm" weight="700">{src.ref}</Txt>
              <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>{src.what}.</Txt>
              <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>{src.basis}</Txt>
              <Rowed gap={2} wrap style={{ marginTop: 4 }}>
                <Chip
                  label={`${src.confidence} confidence`}
                  tone={src.confidence === 'high' ? 'pass' : src.confidence === 'low' ? 'warn' : 'default'}
                />
                {src.url ? <Txt size="xs" tone="faint" numberOfLines={1}>{src.url}</Txt> : null}
              </Rowed>
            </View>
          ))}
        </Card>
      </Screen>
    </>
  );
}

function StatutoryRow({ item }: { item: StatutoryItem }) {
  const t = useTheme();
  const late = item.daysRemaining !== undefined && item.daysRemaining < 0;
  return (
    <View style={{ paddingVertical: t.space(1.5), gap: 3 }}>
      <Rowed gap={2} wrap>
        <Chip label={STATUTORY_LABEL[item.kind]} tone={late ? 'fail' : 'warn'} />
        {item.dueAt ? (
          <Txt size="sm" tone={late ? 'fail' : 'muted'}>
            {late ? 'Was due ' : 'Due '}{formatAuDate(item.dueAt)}
            {item.daysRemaining !== undefined
              ? ` — ${Math.abs(item.daysRemaining)} day${Math.abs(item.daysRemaining) === 1 ? '' : 's'} ${late ? 'ago' : 'left'}`
              : ''}
          </Txt>
        ) : null}
      </Rowed>
      <Txt weight="600">{item.siteName}</Txt>
      <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>{item.detail}</Txt>
      <Txt size="xs" tone="faint">{item.legalRef}</Txt>
    </View>
  );
}

const BAND_TONE = {
  severe: 'fail',
  high: 'fail',
  moderate: 'warn',
  low: 'muted',
  none: 'muted',
} as const;

function RiskCard({
  rank, risk, open, onToggle,
}: {
  rank: number;
  risk: SiteRisk;
  open: boolean;
  onToggle: () => void;
}) {
  const t = useTheme();
  const tone = BAND_TONE[risk.band];
  /**
   * The one thing this card promises is that the total is the lines under it.
   *
   * scoreAddsUp is the module's own check on that, and it is asked here rather
   * than assumed: if a contribution ever stops being counted into the total,
   * this card withholds the number instead of printing one it cannot justify.
   * The reasons are still shown — they are what a technician acts on.
   */
  const justified = scoreAddsUp(risk);

  return (
    <Card onPress={onToggle}>
      <Rowed align="flex-start" gap={3}>
        <View style={{ flex: 1, gap: 3 }}>
          <Txt weight="700">{rank}. {risk.siteName}</Txt>
          <Txt size="sm" tone="muted">
            {[risk.clientName, risk.suburb].filter(Boolean).join(' · ') || 'No client or suburb recorded'}
          </Txt>
          <Rowed gap={2} wrap style={{ marginTop: 2 }}>
            <Chip label={STANDING_LABEL[risk.standing]} tone={risk.standing === 'overdue' ? 'fail' : 'default'} />
            {risk.overdueRoutines ? <Chip label={`${risk.overdueRoutines} overdue`} tone="fail" /> : null}
            {risk.dueRoutines ? <Chip label={`${risk.dueRoutines} due`} tone="warn" /> : null}
            {risk.criticalDefectsOutstanding ? (
              <Chip label={`${risk.criticalDefectsOutstanding} critical`} tone="fail" />
            ) : null}
            {risk.statutoryExposure ? <Chip label="Statutory clock" tone="fail" /> : null}
          </Rowed>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Txt size="xl" weight="700" tone={justified ? tone : 'fail'}>{justified ? risk.score : '—'}</Txt>
          <Txt size="xs" tone="faint">{open ? 'hide' : 'why'}</Txt>
        </View>
      </Rowed>

      {open ? (
        <View style={{ marginTop: t.space(3), gap: t.space(2) }}>
          <Divider />
          {justified ? null : (
            <Banner
              tone="fail"
              title="This score is not shown"
              body="The lines below do not add up to the total the ranking used, so the number is not one this screen can stand behind and it is withheld. The reasons are still listed. Report this — the ranking is built so that this cannot happen."
            />
          )}
          <Label>Every point in this score</Label>
          {risk.contributions.map((c, i) => (
            <View key={`${c.factor}-${i}`} style={{ gap: 2 }}>
              <Rowed gap={2} align="flex-start">
                <Txt weight="700" tone={tone} style={{ minWidth: 34 }}>+{c.points}</Txt>
                <Txt weight="600" style={{ flex: 1 }}>{c.label}</Txt>
              </Rowed>
              <Txt size="sm" tone="muted" style={{ lineHeight: 19, marginLeft: 34 }}>{c.detail}</Txt>
            </View>
          ))}
          {justified ? (
            <Rowed gap={2}>
              <Txt weight="700" style={{ minWidth: 34 }}>={risk.score}</Txt>
              <Txt size="sm" tone="muted" style={{ flex: 1 }}>
                The total is the sum of the lines above and nothing else.
              </Txt>
            </Rowed>
          ) : null}

          {risk.unknowns.length ? (
            <>
              <Divider />
              <Label>What could not be weighed</Label>
              {risk.unknowns.map((u, i) => (
                <Txt key={`${u.code}-${i}`} size="sm" tone="muted" style={{ lineHeight: 19 }}>{u.detail}</Txt>
              ))}
            </>
          ) : null}

          <Divider />
          <Txt size="xs" tone="faint" style={{ lineHeight: 17 }}>
            Weights are Safe QLD&apos;s own judgement about relative exposure, not a requirement of any standard.
            The intervals and tolerance windows behind the overdue lines are the app&apos;s AS 1851 scheduling rules.
          </Txt>
          <Chip label="Open site" tone="accent" onPress={() => router.push({ pathname: '/site/[id]', params: { id: risk.siteId } })} />
        </View>
      ) : null}
    </Card>
  );
}

function ConcentrationBlock({
  title, rows, missing, missingLabel,
}: {
  title: string;
  rows: ConcentrationRow[];
  missing: number;
  missingLabel: string;
}) {
  const t = useTheme();
  const top = rows.filter((r) => r.overdueRoutines > 0 || r.criticalDefectsOutstanding > 0).slice(0, 8);

  return (
    <View style={{ gap: t.space(2) }}>
      <Label>{title}</Label>
      {top.length ? (
        <Card>
          {top.map((row, i) => (
            <View key={row.key}>
              {i ? <Divider /> : null}
              <Rowed align="flex-start" gap={2} style={{ paddingVertical: t.space(1) }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt weight="600">{row.label}</Txt>
                  <Txt size="sm" tone="muted">
                    {row.sites} site{row.sites === 1 ? '' : 's'}
                    {row.unjudgedSites ? ` · ${row.unjudgedSites} not judged` : ''}
                    {row.postcodes ? ` · postcodes ${row.postcodes.join(', ')}` : ''}
                  </Txt>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Txt weight="700" tone={row.overdueRoutines ? 'fail' : 'default'}>{row.overdueRoutines}</Txt>
                  <Txt size="xs" tone="faint">
                    {row.shareOfOverdue !== undefined ? `${Math.round(row.shareOfOverdue * 100)}% of overdue` : 'overdue'}
                  </Txt>
                </View>
              </Rowed>
            </View>
          ))}
        </Card>
      ) : (
        <Txt size="sm" tone="muted">Nothing overdue is concentrated here.</Txt>
      )}
      {missing ? (
        <Txt size="sm" tone="muted" style={{ lineHeight: 19 }}>
          {missing} {missingLabel}. The table therefore does not add up to the book, which is better than a large
          bucket called &quot;Unknown&quot; sitting at the top of it.
        </Txt>
      ) : null}
    </View>
  );
}
