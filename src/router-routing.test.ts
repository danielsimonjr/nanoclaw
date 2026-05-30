import { describe, it, expect, vi } from 'vitest';

import { findChannel } from './router.js';
import { Channel } from './types.js';

function makeChannel(name: string, opts: { owns?: boolean } = {}): Channel {
  return {
    name,
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    sendMessage: vi.fn(async () => {}),
    isConnected: () => true,
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
