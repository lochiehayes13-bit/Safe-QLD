import { canonical, hasMarker, markerFor, queueKey, withMarker } from '@/domain/queueKey';

/**
 * Naming a queued send by what it is.
 *
 * The property that matters is that the same work has the same key on every
 * phone and after every reinstall, whatever order the fields happened to be
 * written in — and that different work never shares one.
 */
describe('the content key', () => {
  it('does not depend on field order or on undefined fields', () => {
    const a = queueKey('job-note', { jobId: '1', subject: 'S', note: 'N' });
    const b = queueKey('job-note', { note: 'N', subject: 'S', jobId: '1', extra: undefined });
    expect(a).toBe(b);
  });

  it('changes when the content or the kind changes', () => {
    const a = queueKey('job-note', { jobId: '1', note: 'N' });
    expect(queueKey('job-note', { jobId: '1', note: 'n' })).not.toBe(a);
    expect(queueKey('purchase-order', { jobId: '1', note: 'N' })).not.toBe(a);
  });

  it('is sixteen hex characters', () => {
    expect(queueKey('x', {})).toMatch(/^[0-9a-f]{16}$/);
  });

  it('canonicalises nested objects and arrays', () => {
    expect(canonical({ b: [{ z: 1, a: 2 }], a: null })).toBe('{"a":null,"b":[{"a":2,"z":1}]}');
  });
});

describe('the marker in the posted text', () => {
  const key = queueKey('job-note', { jobId: '1' });

  it('is appended once, on its own line, and found again', () => {
    const once = withMarker('Replaced 3 detectors', key);
    expect(once.endsWith(`\n${markerFor(key)}`)).toBe(true);
    expect(withMarker(once, key)).toBe(once);
    expect(hasMarker(once, key)).toBe(true);
    expect(hasMarker('Replaced 3 detectors', key)).toBe(false);
  });

  it('stands alone when there was no text', () => {
    expect(withMarker(undefined, key)).toBe(markerFor(key));
  });
});
