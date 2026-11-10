import { pickedFileBytes } from '@/services/pickedFileBytes.web';

/**
 * Opening a picked file in the browser build.
 *
 * The phone half reads the picker's `file://` copy with expo-file-system,
 * which throws on the web. These hold the browser half to reading what the
 * picker actually gives it there.
 */

const csv = 'Loop,Address,Text\n1,1,Fictional Tower L1 lobby\n';

describe('pickedFileBytes in a browser', () => {
  afterEach(() => jest.restoreAllMocks());

  it('reads the File the picker hands back', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    const picked = {
      uri: 'blob:https://example.test/1234',
      name: 'devices.csv',
      file: new Blob([csv], { type: 'text/csv' }),
    };
    const bytes = await pickedFileBytes(picked);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(Buffer.from(bytes).toString('utf8')).toBe(csv);
    // The File is already in memory; nothing is fetched.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('keeps binary content intact', async () => {
    const raw = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff, 0x10]);
    const bytes = await pickedFileBytes({ uri: 'blob:x', name: 'site.zip', file: new Blob([raw]) });
    expect([...bytes]).toEqual([...raw]);
  });

  it('fetches the uri when the picker gave no File', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(csv));
    const bytes = await pickedFileBytes({ uri: 'data:text/csv,abc', name: 'devices.csv' });
    expect(fetchSpy).toHaveBeenCalledWith('data:text/csv,abc');
    expect(Buffer.from(bytes).toString('utf8')).toBe(csv);
  });

  it('says which file would not read, rather than handing back an error page', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('gone', { status: 404 }));
    await expect(pickedFileBytes({ uri: 'blob:gone', name: 'site.sqld' })).rejects.toThrow('site.sqld');
  });
});
