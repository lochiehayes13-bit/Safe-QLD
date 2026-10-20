/**
 * Correcting what kind of meter something is.
 *
 * Part C's three boxes — Orifice, Mechanical, Electro magnetic — are a claim
 * about how the instrument measures, and the chips under each meter promise
 * that "a different answer replaces this one rather than sitting beside it".
 * That was true of the remembered answer and false of the document: the form
 * only ever had kinds added to it. Tap Mechanical, see it is wrong, tap
 * Electro magnetic, and the printed Part C showed both boxes ticked against
 * one meter on a page the licensee signs.
 *
 * The rule is in the domain rather than the component because what it must
 * *not* take off matters as much as what it takes off, and that is an argument
 * worth having somewhere it can be read.
 */
import { flowKindsAfterAnswer, unTickedAnsweredKinds, type FlowDeviceKind, type TestDevice } from '@/domain/form72';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('a corrected answer', () => {
  it('replaces the old tick, which is what the screen says it does', () => {
    expect(flowKindsAfterAnswer({
      ticked: ['mechanical'], was: 'mechanical', now: 'electromagnetic', others: [],
    })).toEqual(['electromagnetic']);
  });

  it('adds the new tick on a meter nobody had answered', () => {
    expect(flowKindsAfterAnswer({ ticked: [], now: 'mechanical', others: [] }))
      .toEqual(['mechanical']);
  });

  it('changes nothing when the same answer is tapped again', () => {
    expect(flowKindsAfterAnswer({
      ticked: ['mechanical'], was: 'mechanical', now: 'mechanical', others: [],
    })).toEqual(['mechanical']);
  });

  it('keeps the old tick where another meter on the form is answered that way', () => {
    // Two mechanical meters and one of them is corrected: the box still
    // belongs to the other one.
    expect(flowKindsAfterAnswer({
      ticked: ['mechanical'], was: 'mechanical', now: 'electromagnetic', others: ['mechanical'],
    }).sort()).toEqual(['electromagnetic', 'mechanical']);
  });

  it('keeps a tick nobody’s meter accounts for, rather than erasing an answer', () => {
    /*
     * A tick the technician put on by hand for a device that is not in Part
     * C's four columns — the department's own note says to put extra devices
     * in the Notes section. From here that is indistinguishable from a stale
     * carry-forward, so both are kept: a tick that stays is a box somebody can
     * untick, and a tick that vanishes is an answer nobody can get back.
     */
    expect(flowKindsAfterAnswer({
      ticked: ['orifice', 'mechanical'], was: 'mechanical', now: 'electromagnetic', others: [],
    }).sort()).toEqual(['electromagnetic', 'orifice']);
  });

  it('never leaves one meter claiming two kinds', () => {
    // The fault, stated as the property. Walk a meter through all three.
    let ticked: FlowDeviceKind[] = [];
    let was: FlowDeviceKind | undefined;
    for (const now of ['orifice', 'mechanical', 'electromagnetic'] as FlowDeviceKind[]) {
      ticked = flowKindsAfterAnswer({ ticked, was, now, others: [] });
      was = now;
    }
    expect(ticked).toEqual(['electromagnetic']);
  });
});

describe('the carry-forward from what was answered before', () => {
  const meter = (serialNumber: string): TestDevice => ({
    slot: 'Device/gauge 1', serialNumber, kind: 'flow-meter',
  });

  it('offers the remembered kind for a meter on the form', () => {
    expect(unTickedAnsweredKinds(
      [meter('SQF-001')], [], new Map([['SQF-001', 'mechanical' as FlowDeviceKind]]),
    )).toEqual(['mechanical']);
  });

  it('offers nothing already ticked', () => {
    expect(unTickedAnsweredKinds(
      [meter('SQF-001')], ['mechanical'], new Map([['SQF-001', 'mechanical' as FlowDeviceKind]]),
    )).toEqual([]);
  });

  it('is only consulted on a form with nothing ticked, so an untick sticks', () => {
    /*
     * The screen's half of this. The carry-forward ran on every open, so a
     * technician who unticked a carried kind — the meter was swapped, or the
     * remembered answer is wrong — found it ticked again next time, with
     * nothing on screen saying why. A tick nobody tapped on the department's
     * own form is the fault taken out of Part A's two questions.
     */
    const screen = readFileSync(join(__dirname, '..', '..', 'app', 'form72', '[id].tsx'), 'utf8');
    expect(screen).toContain("const untouched = f.status !== 'issued' && f.flowDeviceKinds.length === 0;");
    expect(screen).toContain('const add = untouched ? unTickedAnsweredKinds(');
  });
});
