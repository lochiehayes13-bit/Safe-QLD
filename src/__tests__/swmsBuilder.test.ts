import { SWMS_TEMPLATES } from '@/seed/swms';
import {
  builderDraft, builderNotReady, builderTitle, initialSelection, matchSummary, matchesFor, worksFromJob,
  type BuilderJob,
} from '@/domain/swmsBuilder';

/**
 * Building today's statement, before any of it reaches a screen.
 *
 * The flow is: pick the job, say what the work is, and the statements it needs
 * come up. What is tested here is everything a person could disagree with —
 * which statements the words produced, what carries off the job, what the
 * record ends up called — because none of it is reachable once it is inside a
 * component.
 */

const JOB: BuilderJob = {
  externalId: '42823',
  siteName: 'Fictional Tower',
  siteId: 's1',
  customerName: 'A Customer',
  title: 'Detection annual',
  descriptionText: 'Replace three heads in the loading dock and core the slab for the new riser',
};

describe('what the box says before anybody types', () => {
  it('carries the office’s own description of the work', () => {
    expect(worksFromJob(JOB)).toContain('core the slab for the new riser');
  });

  it('keeps the job title too, because a title and a description are two halves', () => {
    // "Detection annual" and "core the slab" are both true and they produce
    // different statements.
    expect(worksFromJob(JOB)).toContain('Detection annual');
  });

  it('says the title once where the description already contains it', () => {
    const job = { ...JOB, title: 'Core drilling', descriptionText: 'Core drilling the slab on level 3' };
    expect(worksFromJob(job)).toBe('Core drilling the slab on level 3');
  });

  it('is the title alone when the office wrote no description', () => {
    expect(worksFromJob({ ...JOB, descriptionText: undefined })).toBe('Detection annual');
  });

  it('is empty before a job is picked', () => {
    expect(worksFromJob(null)).toBe('');
  });
});

describe('which statements come up', () => {
  it('reads the job even when the technician typed nothing', () => {
    // The difference between the builder working for the person in a hurry and
    // only for the person being careful.
    const ticked = initialSelection(matchesFor(SWMS_TEMPLATES, { job: JOB, works: '' }));
    expect(ticked).toContain('asbestos-silica');
  });

  it('reads what the technician typed on top of the job', () => {
    const ticked = initialSelection(matchesFor(SWMS_TEMPLATES, {
      job: { ...JOB, descriptionText: undefined, title: 'Service call' },
      works: 'entering the fire water tank',
    }));
    expect(ticked).toContain('confined-space');
  });

  it('uses the register and the routines when the site is known', () => {
    const ticked = initialSelection(matchesFor(SWMS_TEMPLATES, {
      job: { externalId: '1', title: 'Service call' },
      works: '',
      systems: ['hydrant'],
    }));
    expect(ticked).toContain('hydrant-flow');
  });

  it('produces nothing at all with no job and nothing typed', () => {
    expect(matchesFor(SWMS_TEMPLATES, { job: null, works: '' })).toEqual([]);
  });
});

describe('what the screen says above the checkboxes', () => {
  it('asks for the work before anything is typed', () => {
    expect(matchSummary([], '')).toMatch(/Say what the work is/);
  });

  it('says so plainly when nothing in the library matches', () => {
    // "Nothing matched" and "we matched four" are different problems, and the
    // second is not a problem.
    expect(matchSummary([], 'quarterly inspection of the fire doors'))
      .toMatch(/Nothing in the library matches/);
  });

  it('counts what it ticked and what it is offering', () => {
    const works = 'core drilling the slab in a shopping centre';
    const line = matchSummary(matchesFor(SWMS_TEMPLATES, { job: null, works }), works);
    expect(line).toMatch(/ticked for this work/);
    expect(line).toMatch(/Take off anything that does not apply/);
  });

  it('says none is ticked rather than pretending, where nothing was decisive', () => {
    const matches = [{ templateId: 'x', score: 1.2, verdict: 'offer' as const, because: ['panel'] }];
    expect(matchSummary(matches, 'annual service of the panel')).toMatch(/None of them is a clear match/);
  });
});

describe('the record the builder creates', () => {
  const draft = () => builderDraft({
    job: JOB,
    works: worksFromJob(JOB),
    templateIds: ['asbestos-silica', 'live-testing'],
    templates: SWMS_TEMPLATES,
    date: '2026-09-16',
    technicianName: 'Alex Technician',
    technicianLicence: 'FPAS 12345',
  });

  it('writes the description of the works into notes, which nothing had ever written to', () => {
    expect(draft().notes).toContain('core the slab for the new riser');
  });

  it('takes the site off the job rather than asking for it again', () => {
    // A statement with no site on it cannot be signed, and the job always knows.
    expect(draft().siteName).toBe('Fictional Tower');
    expect(draft().siteId).toBe('s1');
  });

  it('links the Simpro job, so the signed PDF has somewhere to go', () => {
    expect(draft().jobExternalId).toBe('42823');
    expect(draft().jobTitle).toBe('Detection annual');
  });

  it('puts the person building it on the crew', () => {
    expect(draft().workers).toEqual([{ name: 'Alex Technician', licence: 'FPAS 12345' }]);
  });

  it('starts with an empty crew rather than a blank name', () => {
    const d = builderDraft({
      job: JOB, works: '', templateIds: ['live-testing'], templates: SWMS_TEMPLATES,
      date: '2026-09-16', technicianName: '   ',
    });
    expect(d.workers).toEqual([]);
  });

  it('keeps only the statements that exist', () => {
    const d = builderDraft({
      job: JOB, works: '', templateIds: ['live-testing', 'not-a-statement'],
      templates: SWMS_TEMPLATES, date: '2026-09-16',
    });
    expect(d.templateIds).toEqual(['live-testing']);
  });
});

describe('what the statement is called six weeks later', () => {
  it('leads with the job number, which is what somebody searching has in their hand', () => {
    const title = builderTitle(JOB, SWMS_TEMPLATES.filter((t) => t.id === 'live-testing'));
    expect(title).toMatch(/^Job 42823 — /);
  });

  it('still names the work with no job number', () => {
    const title = builderTitle(null, SWMS_TEMPLATES.filter((t) => t.id === 'live-testing'));
    expect(title).not.toContain('Job');
    expect(title.length).toBeGreaterThan(0);
  });
});

describe('what stops it being started', () => {
  it('wants a job or a site', () => {
    /*
     * It wanted a job, full stop, and this module had no site surface at all —
     * no picker, no site lister. So a crew at a site the office had not raised
     * a job for could not have a safe work method statement, which is the one
     * document that should never wait on the office's paperwork. Plenty of
     * this work happens before anything is booked.
     */
    expect(builderNotReady({ job: null, templateIds: ['live-testing'] }))
      .toMatch(/Pick the job this is for, or the site/);
  });

  it('is satisfied by a site with no job', () => {
    expect(builderNotReady({ job: null, siteId: 's1', templateIds: ['live-testing'] })).toBeNull();
  });

  it('wants at least one statement', () => {
    expect(builderNotReady({ job: JOB, templateIds: [] })).toMatch(/at least one statement/);
  });

  it('asks for nothing else, because the record itself asks for the rest', () => {
    expect(builderNotReady({ job: JOB, templateIds: ['live-testing'] })).toBeNull();
  });

  it('still wants a statement, whichever of the two it was given', () => {
    expect(builderNotReady({ job: null, siteId: 's1', templateIds: [] }))
      .toMatch(/at least one statement/);
  });
});

describe('a statement for a site with no job', () => {
  it('puts the site on the record', () => {
    // A statement with no site on it cannot be signed. The site is simply no
    // longer reachable only through a job.
    const draft = builderDraft({
      job: null,
      siteId: 's1',
      siteName: 'Kingaroy Fire Station',
      works: 'Core drilling the slab',
      templateIds: ['live-testing'],
      templates: SWMS_TEMPLATES,
      date: '2026-10-02',
    });
    expect(draft.siteId).toBe('s1');
    expect(draft.siteName).toBe('Kingaroy Fire Station');
    expect(draft.jobExternalId).toBeUndefined();
  });

  it('prefers the job’s site where there is a job, so nothing changes for one', () => {
    const draft = builderDraft({
      job: JOB,
      siteId: 'other',
      siteName: 'Somewhere else',
      works: '',
      templateIds: ['live-testing'],
      templates: SWMS_TEMPLATES,
      date: '2026-10-02',
    });
    expect(draft.siteId).toBe(JOB.siteId);
    expect(draft.siteName).toBe(JOB.siteName);
  });

  it('falls back to the picked site where the job names none', () => {
    const draft = builderDraft({
      job: { ...JOB, siteId: undefined, siteName: '' },
      siteId: 's1',
      siteName: 'Kingaroy Fire Station',
      works: '',
      templateIds: ['live-testing'],
      templates: SWMS_TEMPLATES,
      date: '2026-10-02',
    });
    expect(draft.siteId).toBe('s1');
    expect(draft.siteName).toBe('Kingaroy Fire Station');
  });
});
