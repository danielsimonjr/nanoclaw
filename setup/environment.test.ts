import { describe, it, expect } from 'vitest';

/**
 * Tests for the environment check step's credential detection regex.
 * (Platform detection is covered in platform.test.ts; the registered-groups
 * count uses the shared db layer covered in db-accessors.test.ts.)
 */

describe('credentials detection', () => {
  it('detects ANTHROPIC_API_KEY in env content', () => {
    const content =
      'SOME_KEY=value\nANTHROPIC_API_KEY=sk-ant-test123\nOTHER=foo';
    const hasCredentials =
      /^(CLAUDE_CODE_OAUTH_TOKEN|ANTHROPIC_API_KEY)=/m.test(content);
    expect(hasCredentials).toBe(true);
  });

  it('detects CLAUDE_CODE_OAUTH_TOKEN in env content', () => {
    const content = 'CLAUDE_CODE_OAUTH_TOKEN=token123';
    const hasCredentials =
      /^(CLAUDE_CODE_OAUTH_TOKEN|ANTHROPIC_API_KEY)=/m.test(content);
    expect(hasCredentials).toBe(true);
  });

  it('returns false when no credentials', () => {
    const content = 'ASSISTANT_NAME="Andy"\nOTHER=foo';
    const hasCredentials =
      /^(CLAUDE_CODE_OAUTH_TOKEN|ANTHROPIC_API_KEY)=/m.test(content);
    expect(hasCredentials).toBe(false);
  });
});
