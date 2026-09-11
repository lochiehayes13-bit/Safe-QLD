import {
  CAPTURE_QUALITY, LARGE_PHOTO_BYTES, extensionFor, groupForRegister, isEphemeral,
  numberRegister, photoFileName, photoPath, reconcilePhotos, type PhotoRef,
  MAX_DIMENSION, shrinkTarget,
} from '@/domain/photoStore';

/**
 * Where a photograph lives, and whether it is still there.
 *
 * A defect photograph is evidence on a statutory notice. The failure this
 * guards against produces no error at all: the camera hands back a URI in the
 * operating system's cache, the cache is cleared under storage pressure, and
 * the record quietly stops pointing at anything. The report then renders a gap,
 * which reads as "no photograph was taken" — a different and untrue statement.
 */

const photo = (over: Partial<PhotoRef> & Pick<PhotoRef, 'id'>): PhotoRef => ({
  subject: 'defect', subjectId: 'd1', path: `photos/${over.id}.jpg`,
  takenAt: '2026-09-01T02:15:00.000Z', ...over,
});

describe('telling temporary storage from permanent', () => {
  it('treats the picker and camera locations as temporary', () => {
    expect(isEphemeral('file:///var/mobile/Containers/Data/Application/X/tmp/img.jpg')).toBe(true);
    expect(isEphemeral('file:///data/user/0/com.safeqld/cache/ImagePicker/img.jpg')).toBe(true);
    expect(isEphemeral('file:///Library/Caches/photo.heic')).toBe(true);
    expect(isEphemeral('content://media/external/images/1234')).toBe(true);
    expect(isEphemeral('ph://ABC-123')).toBe(true);
  });

  it('recognises the app document directory as permanent', () => {
    expect(isEphemeral('file:///var/mobile/Containers/Data/Application/X/Documents/photos/a.jpg')).toBe(false);
  });

  it('treats anything it does not recognise as temporary', () => {
    // Wrong one way costs a needless copy; wrong the other way loses evidence.
    expect(isEphemeral('')).toBe(true);
    expect(isEphemeral('https://example.com/a.jpg')).toBe(true);
  });
});

describe('naming a kept photograph', () => {
  it('leads with the timestamp so a listing is chronological', () => {
    expect(photoFileName({
      id: 'abc123', subject: 'defect', subjectId: 'd1',
      takenAt: '2026-09-01T02:15:00.000Z', sourceUri: 'file:///tmp/x.jpg',
    })).toBe('20260901-021500-defect-abc123.jpg');
  });

  it('keeps the real extension and normalises jpeg', () => {
    expect(extensionFor('file:///tmp/x.HEIC')).toBe('heic');
    expect(extensionFor('file:///tmp/x.jpeg')).toBe('jpg');
    expect(extensionFor('file:///tmp/x.png?v=2')).toBe('png');
  });

  it('falls back to jpg when the source says nothing', () => {
    // A content:// URI carries no extension at all, which is the common case
    // on Android.
    expect(extensionFor('content://media/external/images/1234')).toBe('jpg');
  });

  it('discards anything in an id that a path would not survive', () => {
    // The original file name is chosen by the OS, collides across captures,
    // and on Android can carry characters a later path join will not survive.
    const name = photoFileName({
      id: '../../etc/passwd', subject: 'asset', subjectId: 'a1', takenAt: '2026-09-01T02:15:00Z',
    });
    expect(name).not.toMatch(/[/.]{2}/);
    expect(name).toMatch(/^20260901-021500-asset-etcpasswd\.jpg$/);
  });

  it('files everything under one directory', () => {
    expect(photoPath('a.jpg')).toBe('photos/a.jpg');
  });
});

describe('reconciling records against the disk', () => {
  const records = [
    photo({ id: 'p1', path: 'photos/p1.jpg' }),
    photo({ id: 'p2', path: 'photos/p2.jpg' }),
    photo({ id: 'p3', path: 'photos/p3.jpg', subject: 'asset' }),
  ];

  it('finds a record whose file has gone', () => {
    const r = reconcilePhotos(records, [
      { path: 'photos/p1.jpg', byteSize: 900_000 },
      { path: 'photos/p3.jpg', byteSize: 800_000 },
    ]);
    expect(r.missing.map((m) => m.id)).toEqual(['p2']);
    expect(r.warnings.join(' ')).toMatch(/1 photograph is recorded but the file is no longer/i);
  });

  it('says the report will state the loss rather than leave a gap', () => {
    // A blank space in a report reads as "no photograph was taken".
    const r = reconcilePhotos(records, []);
    expect(r.warnings.join(' ')).toMatch(/will say so rather than leave a gap/i);
  });

  it('finds files nothing references', () => {
    const r = reconcilePhotos([records[0]!], [
      { path: 'photos/p1.jpg', byteSize: 100 },
      { path: 'photos/orphan.jpg', byteSize: 200 },
    ]);
    expect(r.unreferenced).toEqual(['photos/orphan.jpg']);
    expect(r.warnings.join(' ')).toMatch(/no longer referenced and can be removed/i);
  });

  it('adds up what the photographs are costing in storage', () => {
    const r = reconcilePhotos(records, [
      { path: 'photos/p1.jpg', byteSize: 1_500_000 },
      { path: 'photos/p2.jpg', byteSize: 2_500_000 },
      { path: 'photos/p3.jpg', byteSize: 1_000_000 },
    ]);
    expect(r.totalBytes).toBe(5_000_000);
    expect(r.warnings).toEqual([]);
  });

  it('flags an unusually large photograph', () => {
    const r = reconcilePhotos([records[0]!], [{ path: 'photos/p1.jpg', byteSize: LARGE_PHOTO_BYTES + 1 }]);
    expect(r.warnings.join(' ')).toMatch(/over 6 MB/);
  });

  it('is quiet when everything lines up', () => {
    const r = reconcilePhotos(records, records.map((p) => ({ path: p.path, byteSize: 500_000 })));
    expect(r.missing).toEqual([]);
    expect(r.unreferenced).toEqual([]);
    expect(r.warnings).toEqual([]);
  });
});

describe('the photographic register', () => {
  // The issued effectiveness report says photographs are grouped by subject.

  const photos = [
    photo({ id: 'a', subjectId: 'd2', takenAt: '2026-09-01T03:00:00Z' }),
    photo({ id: 'b', subjectId: 'd1', takenAt: '2026-09-01T02:00:00Z' }),
    photo({ id: 'c', subjectId: 'd1', takenAt: '2026-09-01T01:00:00Z' }),
    photo({ id: 'd', subject: 'asset', subjectId: 'a9', takenAt: '2026-09-01T04:00:00Z' }),
  ];
  const label = (subject: string, id: string) => `${subject} ${id}`;

  it('groups by subject and keeps the walking order within each', () => {
    const groups = groupForRegister(photos, label);
    expect(groups.map((g) => g.subjectId)).toEqual(['d2', 'd1', 'a9']);
    // Within a subject, the order the technician took them.
    expect(groups[1]!.photos.map((p) => p.id)).toEqual(['c', 'b']);
  });

  it('keeps subjects of different kinds apart even if ids collide', () => {
    const groups = groupForRegister(
      [photo({ id: '1', subject: 'defect', subjectId: 'x' }), photo({ id: '2', subject: 'asset', subjectId: 'x' })],
      label,
    );
    expect(groups).toHaveLength(2);
  });

  it('numbers them the way the register cites them', () => {
    const numbered = numberRegister(groupForRegister(photos, label));
    expect(numbered.map((n) => n.ref)).toEqual(['Photo 1', 'Photo 2', 'Photo 3', 'Photo 4']);
    // The numbering follows the grouping, so a citation in the text resolves.
    expect(numbered[1]!.photo.id).toBe('c');
  });

  it('handles having no photographs at all', () => {
    expect(groupForRegister([], label)).toEqual([]);
    expect(numberRegister([])).toEqual([]);
  });
});

describe('capture settings', () => {
  it('trades quality down but not out', () => {
    // The point of the photograph is that somebody can see the fault in it. A
    // defect notice with an unreadable photograph attached is not evidence.
    expect(CAPTURE_QUALITY).toBeGreaterThanOrEqual(0.5);
    expect(CAPTURE_QUALITY).toBeLessThan(1);
  });
});


describe('sizing a photograph down before it is kept', () => {
  /*
   * MAX_DIMENSION sat in the module unused. The comment beside it describes
   * the trade — a full-resolution photograph is about four megabytes and a job
   * with twenty of them fills eighty — and only half of it was made: quality
   * came down and the pixels did not. A picker's quality setting is JPEG
   * compression, not size.
   *
   * That matters on a handset already carrying 12,553 assets and 897 sites
   * offline, and again in a report that has to be shared over a site's signal.
   */
  it('caps the long edge of a photograph taken upright', () => {
    expect(shrinkTarget(3000, 4000)).toEqual({ width: 1536, height: 2048 });
  });

  it('caps the long edge of the same photograph taken sideways', () => {
    // A phone held the other way is not a different case.
    expect(shrinkTarget(4000, 3000)).toEqual({ width: 2048, height: 1536 });
  });

  it('keeps the shape, because a defect photograph is evidence', () => {
    const out = shrinkTarget(4000, 3000)!;
    expect(out.width / out.height).toBeCloseTo(4000 / 3000, 3);
  });

  it('leaves a photograph already inside the cap alone', () => {
    /*
     * Not merely an optimisation. Every re-encode of a JPEG loses a little,
     * and a photograph of a hairline crack does not have much to spare.
     */
    expect(shrinkTarget(1600, 1200)).toBeUndefined();
    expect(shrinkTarget(MAX_DIMENSION, MAX_DIMENSION)).toBeUndefined();
  });

  it('resizes the one pixel past the cap', () => {
    expect(shrinkTarget(MAX_DIMENSION + 1, 100)).toBeDefined();
  });

  it('never rounds a narrow photograph away to nothing', () => {
    // A very long, very thin image scaled by the long edge can round its short
    // edge to zero, and a zero-height resize is an error rather than a photo.
    const out = shrinkTarget(20_000, 3)!;
    expect(out.width).toBe(MAX_DIMENSION);
    expect(out.height).toBeGreaterThanOrEqual(1);
  });

  it('says nothing for a size it was not given', () => {
    // An asset with no dimensions is kept as it is rather than resized to a
    // guess.
    expect(shrinkTarget(0, 0)).toBeUndefined();
    expect(shrinkTarget(Number.NaN, 100)).toBeUndefined();
    expect(shrinkTarget(-4000, 3000)).toBeUndefined();
  });
});
