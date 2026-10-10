import { readFileSync } from 'fs';
import { join } from 'path';
import { commissionerCopyDeadline } from '@/domain/occupierForm';
import { codeOf } from './support/sourceCode';

/**
 * What the occupier screens say about the Commissioner's copy, against what
 * they compute.
 *
 * The statement's intro said the copy was due "within ten working days of them
 * signing it", over a deadline counted from the period end under section
 * 55A(3). An occupier who signed late was told they had time they did not.
 */

const read = (f: string) => readFileSync(join(__dirname, '..', '..', f), 'utf8');
const SCREENS = ['app/occupier/index.tsx', 'app/occupier/[id].tsx'];

describe('the deadline rule on the occupier screens', () => {
  it.each(SCREENS)('%s counts from the period end', (f) => {
    expect(codeOf(read(f))).toMatch(/requiredPreparationDate:\s*(rec\?\.|statement\.)periodEnd/);
  });

  it.each(SCREENS)('%s says so: business days after the period end', (f) => {
    expect(read(f).replace(/\s+/g, ' ')).toMatch(/business days after the period end/);
  });

  it.each(SCREENS)('%s never says the clock runs from the signature', (f) => {
    const flat = read(f).replace(/\s+/g, ' ');
    expect(flat).not.toMatch(/of them signing/);
    expect(flat).not.toMatch(/working days/);
  });

  it('and the rule is what the domain computes: signing late does not move the date', () => {
    const onTime = commissionerCopyDeadline({ requiredPreparationDate: '2026-06-30', signedDate: '2026-06-30' });
    const late = commissionerCopyDeadline({ requiredPreparationDate: '2026-06-30', signedDate: '2026-08-01' });
    expect(late.due).toBe(onTime.due);
    expect(late.basis).toBe('statutory');
  });
});

describe('the deadline banner', () => {
  it('prints no source-confidence lines', () => {
    const code = codeOf(read('app/occupier/[id].tsx'));
    expect(code).not.toMatch(/citeSources/);
    expect(code).not.toMatch(/confidence/);
  });
});

describe('the statement list', () => {
  const code = codeOf(read('app/occupier/index.tsx'));

  it('catches a failed read and offers Try again', () => {
    expect(code).toMatch(/describeLoadFailure\(/);
    expect(read('app/occupier/index.tsx')).toMatch(/title="Try again"/);
  });

  it('starts a statement through the site picker', () => {
    expect(code).toMatch(/createOccupierStatement\(/);
    expect(code).toMatch(/<SitePicker/);
  });
});
