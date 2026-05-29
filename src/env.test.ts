import { describe, it, expect, beforeEach, vi } from 'vitest';

// Control the contents of the .env file the parser reads.
const state = vi.hoisted(() => ({ content: null as string | null }));

vi.mock('fs', () => ({
  default: {
    readFileSync: vi.fn(() => {
      if (state.content === null) {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      }
      return state.content;
    }),
  },
}));

vi.mock('./logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { readEnvFile } from './env.js';

beforeEach(() => {
  state.content = null;
});

describe('readEnvFile', () => {
  it('returns an empty object when the .env file does not exist', () => {
    expect(readEnvFile(['ANYTHING'])).toEqual({});
  });

  it('parses simple KEY=value pairs and filters to requested keys', () => {
    state.content = 'FOO=bar\nBAZ=qux\nIGNORED=nope';
    expect(readEnvFile(['FOO', 'BAZ'])).toEqual({ FOO: 'bar', BAZ: 'qux' });
  });

  it('ignores comments and blank lines', () => {
    state.content = '# a comment\n\n   \nFOO=bar\n# FOO=should-not-override';
    expect(readEnvFile(['FOO'])).toEqual({ FOO: 'bar' });
  });

  it('strips matching surrounding double and single quotes', () => {
    state.content = 'A="double"\nB=\'single\'\nC="unbalanced';
    expect(readEnvFile(['A', 'B', 'C'])).toEqual({
      A: 'double',
      B: 'single',
      C: '"unbalanced',
    });
  });

  it('ignores lines without an "=" sign', () => {
    state.content = 'NOEQUALS\nFOO=bar';
    expect(readEnvFile(['FOO', 'NOEQUALS'])).toEqual({ FOO: 'bar' });
  });

  it('skips keys with empty values', () => {
    state.content = 'EMPTY=\nFOO=bar';
    expect(readEnvFile(['EMPTY', 'FOO'])).toEqual({ FOO: 'bar' });
  });

  it('handles values that themselves contain "="', () => {
    state.content = 'TOKEN=a=b=c';
    expect(readEnvFile(['TOKEN'])).toEqual({ TOKEN: 'a=b=c' });
  });

  it('trims surrounding whitespace around keys and values', () => {
    state.content = '  FOO = bar  ';
    expect(readEnvFile(['FOO'])).toEqual({ FOO: 'bar' });
  });
});
