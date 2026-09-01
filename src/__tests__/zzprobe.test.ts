import { planWork, type PlanRoutine, type PlanSite } from '@/domain/workPlan';

const OCTOBER = { from: '2026-10-01', to: '2026-10-31', label: 'October 2026' };

it('probe', () => {
  const routines: PlanRoutine[] = [
    { siteId: 'ontime', routineId: 'r1', system: 'detection', frequency: 'annual', state: 'upcoming',
      scheduledFor: '2026-10-01', window: { earliest: '2026-10-01', latest: '2026-10-02' } },
    { siteId: 'late', routineId: 'r2', system: 'detection', frequency: 'annual', state: 'overdue',
      scheduledFor: '2026-06-01', window: { earliest: '2026-05-01', latest: '2026-07-31' } },
  ];
  const sites: PlanSite[] = [
    { siteId: 'ontime', siteName: 'ontime', suburb: 'Springwood', postcode: '4127', assetCounts: [{ system: 'detection', count: 50 }] },
    { siteId: 'late', siteName: 'late', suburb: 'Springwood', postcode: '4127', assetCounts: [{ system: 'detection', count: 50 }] },
  ];
  const plan = planWork(routines, sites, { today: '2026-09-15', window: OCTOBER, technicians: 1, hoursPerDay: 7.5 });
  const v = plan.days.flatMap((d) => d.technicians.flatMap((t) => t.visits));
  console.log(v.map((x) => `${x.siteId} ${x.date} urgent=${x.urgent} h=${x.hours.hours}`).join('\n'));
  console.log('unplanned', JSON.stringify(plan.unplanned.map((u) => [u.siteId, u.reason])));
});
