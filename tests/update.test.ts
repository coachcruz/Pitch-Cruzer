import { describe, expect, it } from 'vitest';
import { versionOf } from '../src/lib/update';

describe('app version (lib/update)', () => {
  it('is the built main script, which changes with every published version', () => {
    expect(versionOf('<script type="module" crossorigin src="./assets/index-C1X5VK9E.js"></script>')).toBe('assets/index-C1X5VK9E.js');
    expect(versionOf('<script type="module" src="./assets/index-zdPDxGZg.js">')).not.toBe(versionOf('<script src="./assets/index-C1X5VK9E.js">'));
  });

  it('is unknown on a page that isn’t the built app (the dev server, an error page)', () => {
    expect(versionOf('<script type="module" src="./src/main.ts"></script>')).toBeNull();
    expect(versionOf('Service unavailable')).toBeNull();
  });
});
