/**
 * The app's end of the conversation with the service worker.
 *
 * Nothing here talks to a browser: the registration script sets a flag, fires
 * an event and leaves a function, and this is the reading of those three. It
 * is worth testing because every one of its answers has to be safe on a page
 * where none of them exist — a browser with no service workers, one that
 * refused the registration, and the Node process this suite runs in.
 */
import {
  APPLY_UPDATE_FUNCTION, UPDATE_READY_EVENT, UPDATE_READY_FLAG,
  applyUpdate, onUpdateReady, updateReady,
} from '@/web/updateSignal';

type Listener = () => void;

/** Enough of a window for these three to be read off, and nothing more. */
function fakeWindow(): Record<string, unknown> & { fire: (name: string) => void; listeners: number } {
  const listeners = new Map<string, Set<Listener>>();
  const w: Record<string, unknown> = {
    addEventListener: (name: string, fn: Listener) => {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(fn);
    },
    removeEventListener: (name: string, fn: Listener) => {
      listeners.get(name)?.delete(fn);
    },
  };
  Object.defineProperty(w, 'fire', {
    value: (name: string) => { for (const fn of listeners.get(name) ?? []) fn(); },
  });
  Object.defineProperty(w, 'listeners', {
    get: () => [...listeners.values()].reduce((n, set) => n + set.size, 0),
  });
  return w as Record<string, unknown> & { fire: (name: string) => void; listeners: number };
}

const globals = globalThis as { window?: unknown };

afterEach(() => {
  delete globals.window;
});

describe('with no window at all', () => {
  it('says no update is ready rather than throwing', () => {
    expect(updateReady()).toBe(false);
  });

  it('subscribes to nothing and hands back an unsubscribe that is safe to call', () => {
    const stop = onUpdateReady(() => { throw new Error('must not fire'); });
    expect(() => stop()).not.toThrow();
  });

  it('reports that it could not apply, rather than pretending it did', () => {
    expect(applyUpdate()).toBe(false);
  });
});

describe('in a browser where the registration script never ran', () => {
  it('has nothing waiting and nothing to call', () => {
    globals.window = fakeWindow();
    expect(updateReady()).toBe(false);
    expect(applyUpdate()).toBe(false);
  });
});

describe('in a browser where a newer build is waiting', () => {
  it('reads the flag the script set', () => {
    const w = fakeWindow();
    w[UPDATE_READY_FLAG] = true;
    globals.window = w;
    expect(updateReady()).toBe(true);
  });

  it('tells a listener that mounted after the news, without waiting for another event', () => {
    const w = fakeWindow();
    w[UPDATE_READY_FLAG] = true;
    globals.window = w;

    let told = 0;
    onUpdateReady(() => { told += 1; });
    expect(told).toBe(1);
  });

  it('tells a listener that was already there when the event fires', () => {
    const w = fakeWindow();
    globals.window = w;

    let told = 0;
    onUpdateReady(() => { told += 1; });
    expect(told).toBe(0);

    w.fire(UPDATE_READY_EVENT);
    expect(told).toBe(1);
  });

  it('stops telling it once it unsubscribes, and leaves no listener behind', () => {
    const w = fakeWindow();
    globals.window = w;

    let told = 0;
    const stop = onUpdateReady(() => { told += 1; });
    expect(w.listeners).toBe(1);

    stop();
    expect(w.listeners).toBe(0);
    w.fire(UPDATE_READY_EVENT);
    expect(told).toBe(0);
  });

  it('calls the script’s own function to take it, and says it did', () => {
    const w = fakeWindow();
    let applied = 0;
    w[APPLY_UPDATE_FUNCTION] = () => { applied += 1; };
    globals.window = w;

    expect(applyUpdate()).toBe(true);
    expect(applied).toBe(1);
  });

  it('refuses a name on the window that is not a function', () => {
    const w = fakeWindow();
    // Anything could be sitting on a global name. Calling it would throw
    // inside a button press, which is the one place this must not do that.
    w[APPLY_UPDATE_FUNCTION] = 'not a function';
    globals.window = w;

    expect(applyUpdate()).toBe(false);
  });
});
