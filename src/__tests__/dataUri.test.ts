import { base64ByteLength, buildDataUri, dataUriByteSize, isDataUri, parseDataUri } from '@/domain/dataUri';

/**
 * The photograph the browser build keeps.
 *
 * This is the whole of how a `data:` URI is read on that build: the size on a
 * queue row, the media type on an upload, and the base64 Simpro receives all
 * come out of the functions below. A wrong answer here is a photograph that
 * uploads as the wrong type, or one reported as a size nobody can reconcile —
 * and the failure would only ever show on an iPhone, which is where nobody is
 * running a debugger.
 */

const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';

describe('isDataUri', () => {
  it('knows one from a path, a blob URL and a file URL', () => {
    expect(isDataUri(JPEG)).toBe(true);
    expect(isDataUri('DATA:image/png;base64,AAAA')).toBe(true);
    expect(isDataUri('photos/2026-defect-a1.jpg')).toBe(false);
    expect(isDataUri('blob:https://app.example.com/9f2c')).toBe(false);
    expect(isDataUri('file:///documents/photos/a.jpg')).toBe(false);
    expect(isDataUri('')).toBe(false);
  });
});

describe('parseDataUri', () => {
  it('splits the media type from the payload', () => {
    expect(parseDataUri(JPEG)).toEqual({ mimeType: 'image/jpeg', base64: '/9j/4AAQSkZJRg==' });
  });

  it('reads the type whatever case it arrived in, and past other parameters', () => {
    expect(parseDataUri('data:IMAGE/PNG;charset=utf-8;base64,AAAA')?.mimeType).toBe('image/png');
  });

  it('refuses everything it cannot read rather than guessing at bytes', () => {
    // Each of these would, if guessed at, put a corrupt or mislabelled file on
    // a customer's job — which is worse than the queue saying it cannot send.
    expect(parseDataUri('photos/a.jpg')).toBeUndefined();
    // Percent-encoded rather than base64: legal, never produced here.
    expect(parseDataUri('data:image/jpeg,%FF%D8%FF')).toBeUndefined();
    // No media type. RFC 2397 says that means text/plain, which a photograph
    // is not, so it is reported rather than assumed to be a JPEG.
    expect(parseDataUri('data:;base64,AAAA')).toBeUndefined();
    expect(parseDataUri('data:base64,AAAA')).toBeUndefined();
    // A header with no comma, and a payload that is empty.
    expect(parseDataUri('data:image/jpeg;base64')).toBeUndefined();
    expect(parseDataUri('data:image/jpeg;base64,')).toBeUndefined();
  });
});

describe('base64ByteLength', () => {
  it('counts the decoded bytes without decoding them', () => {
    // Worked out rather than decoded, because the answer is wanted for a size
    // on a queue row and decoding a megabyte to count it allocates a megabyte
    // for nothing.
    expect(base64ByteLength('')).toBe(0);
    expect(base64ByteLength('QQ==')).toBe(1);
    expect(base64ByteLength('QUI=')).toBe(2);
    expect(base64ByteLength('QUJD')).toBe(3);
    expect(base64ByteLength('QUJDRA==')).toBe(4);
  });

  it('agrees with an actual decode, which is the only check that means anything', () => {
    for (const text of ['a', 'ab', 'abc', 'abcd', 'a longer run of bytes to land on every padding case']) {
      const encoded = Buffer.from(text, 'utf8').toString('base64');
      expect(base64ByteLength(encoded)).toBe(Buffer.byteLength(text, 'utf8'));
    }
  });

  it('ignores the whitespace a wrapped payload carries', () => {
    expect(base64ByteLength('QUJD\nRA==')).toBe(4);
  });
});

describe('dataUriByteSize', () => {
  it('sizes a photograph, and says nothing for what is not one', () => {
    expect(dataUriByteSize(buildDataUri('image/jpeg', Buffer.from('12345').toString('base64')))).toBe(5);
    expect(dataUriByteSize('photos/2026-defect-a1.jpg')).toBeUndefined();
  });
});

describe('buildDataUri', () => {
  it('round-trips through the parser', () => {
    const base64 = Buffer.from('some jpeg bytes').toString('base64');
    expect(parseDataUri(buildDataUri('image/jpeg', base64))).toEqual({ mimeType: 'image/jpeg', base64 });
  });
});
