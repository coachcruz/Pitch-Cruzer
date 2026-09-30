import { describe, expect, it } from 'vitest';
import { duetNames } from '../src/lib/duet';
import type { SongAnalysis } from '../src/lib/analysis';

const analysis = (duet?: SongAnalysis['duet']): SongAnalysis =>
  ({ duet, lines: [], notes: [], sections: [], duration: 0 } as unknown as SongAnalysis);

describe('duetNames', () => {
  it('defaults to Singer One (you) and Singer Two (partner)', () => {
    expect(duetNames(analysis())).toEqual({ me: 'Singer One', partner: 'Singer Two' });
    expect(duetNames(analysis({ mine: 'low', overrides: {} }))).toEqual({ me: 'Singer One', partner: 'Singer Two' });
  });

  it('uses the saved per-song names', () => {
    const names = duetNames(analysis({ mine: 'high', overrides: {}, names: { me: 'Cruz', partner: 'Riley' } }));
    expect(names).toEqual({ me: 'Cruz', partner: 'Riley' });
  });

  it('blank names fall back to the defaults', () => {
    const names = duetNames(analysis({ mine: 'low', overrides: {}, names: { me: '   ', partner: '' } }));
    expect(names).toEqual({ me: 'Singer One', partner: 'Singer Two' });
  });

  it('trims surrounding whitespace', () => {
    const names = duetNames(analysis({ mine: 'low', overrides: {}, names: { me: '  Cruz ', partner: ' Riley' } }));
    expect(names).toEqual({ me: 'Cruz', partner: 'Riley' });
  });
});
