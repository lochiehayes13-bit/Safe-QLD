import { formatAuDate } from '@/export/sheets';

/**
 * The running list of things a technician needs to get.
 *
 * This is the note that already exists on every dashboard and in every phone's
 * notes app: an extinguisher for a site, a flow meter before the hydrant work
 * in March, two hose reel nozzles because the last two were seized. It is not
 * a purchase request — a purchase request is a document that goes to the
 * office and comes back as an order — and treating the two as the same thing
 * is why the note stays on the dashboard. A purchase request needs a part
 * number, a quantity and a supplier before it is worth raising; the note needs
 * nothing but a few words typed with one hand while the other holds a torch.
 *
 * So a line here is almost entirely optional. `what` is the only thing that
 * has to be filled in, and "flow meter" is a complete line. Everything else —
 * how many, which building, a part number off the catalogue, a note — is
 * offered and never required, because a lookup that comes back with nothing
 * must not be able to stop somebody writing down what they need.
 *
 * Two things this module is careful about, both of them the same worry from
 * different ends:
 *
 *  - **Nothing is thrown away.** Ticking a line marks it got; it does not
 *    delete it. A tick on the wrong row is one tap to undo, and the undo puts
 *    the line back exactly as it was, including the fact that it had already
 *    been ordered. A list somebody is afraid to tick is a list that stops
 *    being ticked.
 *  - **Now and later are different questions.** "What do I need to grab this
 *    morning" and "what has to be on hand before the annuals in March" get
 *    asked at different times by the same person, and mixing them means the
 *    March line is read past every day until March, at which point it is read
 *    past once more. They are two groups, and a line moves between them in one
 *    tap, because the future becomes now on its own.
 *
 * Pure: no expo, no react-native, no database. The screen and the repository
 * are both written against what is decided here.
 */

export type NeedWhen = 'now' | 'future';

/**
 * Where a line has got to.
 *
 * Three states rather than a tick box, because "I have asked for it" and "it
 * is in my hand" are different facts and only the second one means the work
 * can go ahead. A line marked ordered still shows in the list — it is still
 * something the technician has not got.
 */
export type NeedState = 'needed' | 'ordered' | 'got';

export interface NeedLine {
  id: string;
  /** What to get, in the technician's own words. The only required field. */
  what: string;
  /** How many, where a number was given. Absent means "some" and that is fine. */
  quantity?: number;
  /** A catalogue part number, where one was attached. Never required. */
  partNumber?: string;
  /** The site it is for, where it is for one the phone knows. */
  siteId?: string;
  /** The site's name as it was when the line was written, so it reads with no join. */
  siteName?: string;
  note?: string;
  when: NeedWhen;
  state: NeedState;
  /** What was said when it was marked ordered: a PO number, "rang the office". */
  orderNote?: string;
  /** The purchase request it went to the office on, where it went on one. */
  purchaseRequestId?: string;
  createdAt: string;
  updatedAt: string;
  orderedAt?: string;
  gotAt?: string;
}

export const WHEN_LABEL: Record<NeedWhen, string> = {
  now: 'For now',
  future: 'Future works',
};

export const WHEN_BLURB: Record<NeedWhen, string> = {
  now: 'Wanted for the work in front of you.',
  future: 'Wanted before work that has not come around yet.',
};

export const STATE_LABEL: Record<NeedState, string> = {
  needed: 'Needed',
  ordered: 'On order',
  got: 'Got it',
};

// ---------------------------------------------------------------------------
// Reading a typed line
// ---------------------------------------------------------------------------

/**
 * A count written in front of what it counts: "2 x 4.5kg ABE", "3 flow
 * meters", "2x nozzles".
 *
 * The separator is an x or a space, and the space alone is what makes this
 * worth being careful about — "4.5kg ABE" starts with a number too, and it is
 * one item rather than four and a half of them. That case is excluded by
 * requiring a break after the number, which "4.5kg" does not have.
 */
const COUNT_FIRST = /^(\d{1,4}(?:\.\d+)?)\s*(?:[x×*]\s*|\s)(.+)$/i;

/** The same count written after the thing: "flow meter x2". */
const COUNT_LAST = /^(.+?)[\s,]*[x×]\s*(\d{1,4})$/i;

/**
 * A unit written after a space, which makes the number in front of it part of
 * the description rather than a count.
 *
 * "4.5 kg ABE" is one extinguisher, not four and a half of anything. Somebody
 * types it that way often enough that reading it as a quantity would put a
 * wrong number on a line nobody looks at twice.
 */
const UNIT_AFTER = /^(?:kg|kgs|g|l|lt|ltr|litre|litres|mm|cm|m|kpa|psi|v|volt|volts|ah|w|kw|hr|hrs)\b/i;

/** "… for <somewhere>", which is usually a building. Greedy, so the last one wins. */
const FOR_WHERE = /^(.*\S)\s+for\s+(\S.*)$/i;

export interface ParsedNeed {
  /** What to get, with a leading count and a trailing "for …" taken off. */
  what: string;
  /** The count, where one was written. */
  quantity?: number;
  /**
   * Whatever followed "for". It may be a site, and it may be "the roof" — this
   * module does not know the site list, so it hands the words over and the
   * caller decides whether they name a building.
   */
  siteHint?: string;
  /**
   * `what` with the "for …" left on it.
   *
   * The caller uses this when the hint turns out not to be a site: dropping
   * "for the pump room" off a line because no building is called that would
   * quietly lose the only thing that said where the part goes.
   */
  whatWithWhere: string;
}

/**
 * Reads a typed line for the pieces that are worth pulling out.
 *
 * It never fails and it never refuses. A line it cannot make anything of comes
 * back whole as `what`, which is exactly right: the technician wrote what they
 * meant, and this is a convenience for the two or three shapes people actually
 * type, not a grammar they have to learn.
 */
export function parseNeedLine(text: string): ParsedNeed {
  const tidy = text.trim().replace(/\s+/g, ' ');
  if (!tidy) return { what: '', whatWithWhere: '' };

  let rest = tidy;
  let quantity: number | undefined;

  const first = COUNT_FIRST.exec(rest);
  if (first && !UNIT_AFTER.test(first[2]!)) {
    quantity = Number(first[1]);
    rest = first[2]!.trim();
  } else {
    const last = COUNT_LAST.exec(rest);
    if (last) {
      quantity = Number(last[2]);
      rest = last[1]!.trim();
    }
  }
  // A count of nothing is not a count. Guards against "0 x", and against a
  // number so long it arrived as something other than a number.
  if (quantity !== undefined && (!Number.isFinite(quantity) || quantity <= 0)) quantity = undefined;

  const where = FOR_WHERE.exec(rest);
  return {
    what: where ? where[1]!.trim() : rest,
    whatWithWhere: rest,
    quantity,
    siteHint: where ? where[2]!.trim() : undefined,
  };
}

// ---------------------------------------------------------------------------
// Order on the page
// ---------------------------------------------------------------------------

/**
 * What a line sorts by.
 *
 * The part number where there is one, so the same catalogue item asked for at
 * four sites reads as four lines together rather than scattered down the page
 * — which is the difference between one trip to the supplier and four. Where
 * there is no part number the words are the key, folded so that "Flow Meter"
 * and "flow meter" are the same thing, which they are.
 */
export function needSortKey(line: NeedLine): string {
  return (line.partNumber?.trim() || line.what).trim().toLowerCase();
}

/** The list in reading order: same thing together, then by site, then oldest first. */
export function sortNeeds(lines: readonly NeedLine[]): NeedLine[] {
  return [...lines].sort((a, b) =>
    needSortKey(a).localeCompare(needSortKey(b))
    || (a.siteName ?? '').localeCompare(b.siteName ?? '')
    || a.createdAt.localeCompare(b.createdAt)
    || a.id.localeCompare(b.id));
}

export interface NeedGroup {
  when: NeedWhen;
  title: string;
  blurb: string;
  /** Still to get: needed and on order, in reading order. */
  open: NeedLine[];
  /** Got, kept underneath rather than deleted, newest first. */
  got: NeedLine[];
}

/**
 * The list as the screen shows it: now first, then the future works, with what
 * has been got moved underneath each.
 *
 * Both groups are always returned, empty or not. A screen that only draws the
 * groups it has rows for cannot offer anywhere to put a future line, and the
 * empty half is where somebody learns the list has two halves at all.
 */
export function groupNeeds(lines: readonly NeedLine[]): NeedGroup[] {
  const sorted = sortNeeds(lines);
  return (['now', 'future'] as NeedWhen[]).map((when) => {
    const mine = sorted.filter((l) => l.when === when);
    return {
      when,
      title: WHEN_LABEL[when],
      blurb: WHEN_BLURB[when],
      open: mine.filter((l) => l.state !== 'got'),
      // Newest first: the thing picked up this morning is the one somebody is
      // looking for when they check whether they already got it.
      got: mine.filter((l) => l.state === 'got')
        .sort((a, b) => (b.gotAt ?? b.updatedAt).localeCompare(a.gotAt ?? a.updatedAt)),
    };
  });
}

/** How many are still to get, which is the only number worth a badge. */
export function openNeedCount(lines: readonly NeedLine[]): number {
  return lines.filter((l) => l.state !== 'got').length;
}

// ---------------------------------------------------------------------------
// Moving a line along
// ---------------------------------------------------------------------------

/**
 * A line in a new state, with the stamps that go with it.
 *
 * `orderedAt` survives a line going back to needed being *untrue*, and
 * `orderNote` and `purchaseRequestId` survive it entirely: a request really
 * was raised with the office, and forgetting that because somebody corrected
 * a tick would throw away the only record on the phone that it happened.
 */
export function withNeedState(line: NeedLine, state: NeedState, at: string): NeedLine {
  if (state === 'got') return { ...line, state, gotAt: at, updatedAt: at };
  if (state === 'ordered') {
    return { ...line, state, orderedAt: line.orderedAt ?? at, gotAt: undefined, updatedAt: at };
  }
  return { ...line, state, orderedAt: undefined, gotAt: undefined, updatedAt: at };
}

/**
 * One tap on the tick box.
 *
 * Ticking marks it got. Un-ticking puts it back where it was — on order if it
 * had been ordered, needed if it had not — rather than dropping it to the
 * bottom state and losing the fact that the office is already working on it.
 */
export function tickNeed(line: NeedLine, at: string): NeedLine {
  if (line.state !== 'got') return withNeedState(line, 'got', at);
  return line.orderedAt
    ? { ...line, state: 'ordered', gotAt: undefined, updatedAt: at }
    : withNeedState(line, 'needed', at);
}

/** Marks a line ordered, with whatever the technician wants to remember about it. */
export function markOrdered(line: NeedLine, at: string, note?: string, purchaseRequestId?: string): NeedLine {
  const ordered = withNeedState(line, 'ordered', at);
  return {
    ...ordered,
    orderNote: note?.trim() ? note.trim() : ordered.orderNote,
    purchaseRequestId: purchaseRequestId ?? ordered.purchaseRequestId,
  };
}

/** Moves a line between "for now" and "future works". */
export function moveNeed(line: NeedLine, when: NeedWhen, at: string): NeedLine {
  return line.when === when ? line : { ...line, when, updatedAt: at };
}

/** The other half of wherever a line is now, for a one-tap move. */
export function otherWhen(when: NeedWhen): NeedWhen {
  return when === 'now' ? 'future' : 'now';
}

// ---------------------------------------------------------------------------
// Saying it out loud
// ---------------------------------------------------------------------------

/** The line as one string: "2 × 4.5kg ABE". */
export function needHeadline(line: NeedLine): string {
  const count = line.quantity !== undefined ? `${line.quantity} × ` : '';
  return `${count}${line.what}`.trim();
}

/** The second line under it: where it is for, and the part number if there is one. */
export function needSubtitle(line: NeedLine): string {
  return [line.partNumber?.trim(), line.siteName?.trim(), line.note?.trim()]
    .filter((s): s is string => Boolean(s))
    .join(' · ');
}

export interface OrderableLine {
  /**
   * Empty where nobody has chosen a part yet, which is common and is not a
   * problem to hide: the office orders against the description, and a blank
   * part number on the request says plainly that the choice is still open.
   */
  partNumber: string;
  description: string;
  quantity: number;
}

/**
 * The lines to put on a purchase request.
 *
 * Only what is still needed: something already on order would be ordered
 * twice, and something already in the van does not need ordering at all. The
 * quantity defaults to one, because a request with no quantity is a request
 * somebody in the office has to ring back about.
 */
export function orderableLines(lines: readonly NeedLine[]): OrderableLine[] {
  return sortNeeds(lines.filter((l) => l.state === 'needed')).map((l) => ({
    partNumber: l.partNumber?.trim() ?? '',
    description: [l.what.trim(), l.siteName ? `(for ${l.siteName})` : '']
      .filter(Boolean).join(' '),
    quantity: l.quantity && l.quantity > 0 ? l.quantity : 1,
  }));
}

/**
 * The list as a spreadsheet the office can work from.
 *
 * Everything, including what has already been got: a list that silently left
 * out the ticked rows would look, to whoever opens it, like a list of what was
 * never dealt with. The when and the state columns say which is which.
 */
export function needsCsvRows(lines: readonly NeedLine[]): (string | number | null | undefined)[][] {
  const rows: (string | number | null | undefined)[][] = [[
    'When', 'What', 'Quantity', 'Part number', 'Site', 'State', 'Note', 'Added', 'Ordered', 'Got',
  ]];
  for (const group of groupNeeds(lines)) {
    for (const line of [...group.open, ...group.got]) {
      rows.push([
        group.title,
        line.what,
        line.quantity ?? '',
        line.partNumber ?? '',
        line.siteName ?? '',
        STATE_LABEL[line.state],
        [line.note, line.orderNote].filter(Boolean).join(' · '),
        formatAuDate(line.createdAt),
        formatAuDate(line.orderedAt),
        formatAuDate(line.gotAt),
      ]);
    }
  }
  return rows;
}
