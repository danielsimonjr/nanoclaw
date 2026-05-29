import { describe, it, expect, vi } from 'vitest';

import { routeOutbound, findChannel } from './router.js';
import { Channel } from './types.js';

function makeChannel(
  name: string,
  opts: { owns?: boolean; connected?: boolean } = {},
): Channel & { sendMessage: ReturnType<typeof vi.fn> } {
  return {
    name,
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    sendMessage: vi.fn(async () => {}),
    isConnected: () => opts.connected ?? true,
    ownsJid: () => opts.owns ?? false,
  };
}

describe('findChannel', () => {
  it('returns the first channel that owns the jid', () => {
    const a = makeChannel('a', { owns: false });
    const b = makeChannel('b', { owns: true });
    expect(findChannel([a, b], 'x@g.us')).toBe(b);
  });

  it('returns undefined when no channel owns the jid', () => {
    expect(
      findChannel([makeChannel('a', { owns: false })], 'x@g.us'),
    ).toBeUndefined();
  });
});

describe('routeOutbound', () => {
  it('sends through a connected channel that owns the jid', async () => {
    const ch = makeChannel('a', { owns: true, connected: true });
    await routeOutbound([ch], 'x@g.us', 'hello');
    expect(ch.sendMessage).toHaveBeenCalledWith('x@g.us', 'hello');
  });

  it('skips a channel that owns the jid but is disconnected', () => {
    const disconnected = makeChannel('a', { owns: true, connected: false });
    expect(() => routeOutbound([disconnected], 'x@g.us', 'hi')).toThrow(
      /No channel for JID/,
    );
    expect(disconnected.sendMessage).not.toHaveBeenCalled();
  });

  it('throws when no channel owns the jid', () => {
    const ch = makeChannel('a', { owns: false, connected: true });
    expect(() => routeOutbound([ch], 'x@g.us', 'hi')).toThrow(
      /No channel for JID: x@g.us/,
    );
  });
});
