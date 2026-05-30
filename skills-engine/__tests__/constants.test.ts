import { describe, it, expect } from 'vitest';
import {
  NANOCLAW_DIR,
  BASE_DIR,
  BACKUP_DIR,
  LOCK_FILE,
  CUSTOM_DIR,
  RESOLUTIONS_DIR,
} from '../constants.js';

describe('constants', () => {
  it('path constants use forward slashes and .nanoclaw prefix', () => {
    const pathConstants = [
      BASE_DIR,
      BACKUP_DIR,
      LOCK_FILE,
      CUSTOM_DIR,
      RESOLUTIONS_DIR,
    ];
    for (const p of pathConstants) {
      expect(p).not.toContain('\\');
      expect(p).toMatch(/^\.nanoclaw\//);
    }
  });

  it('NANOCLAW_DIR is .nanoclaw', () => {
    expect(NANOCLAW_DIR).toBe('.nanoclaw');
  });
});
