import { describe, expect, it } from 'vitest';
import { getAdjacentMediaDay } from './lightbox-navigation';

const overview = [
  { id: 'older', mediaCount: 2 },
  { id: 'comments-only', mediaCount: 0 },
  { id: 'processing', mediaCount: 1 },
  { id: 'current', mediaCount: 2 },
  { id: 'newer', mediaCount: 3 }
];
const loaded = [
  { id: 'older', media: [{ processingStatus: 'completed' }] },
  { id: 'processing', media: [{ processingStatus: 'processing' }] },
  { id: 'current', media: [{ processingStatus: 'completed' }] }
];

describe('adjacent lightbox days', () => {
  it('follows chronological order in both directions, skipping days without viewable media', () => {
    expect(getAdjacentMediaDay(overview, loaded, 'current', 'prev')?.id).toBe('older');
    expect(getAdjacentMediaDay(overview, loaded, 'older', 'next')?.id).toBe('current');
    expect(getAdjacentMediaDay(overview, loaded, 'current', 'next')?.id).toBe('newer');
  });

  it('uses loaded details when an overview count is stale after deleting media', () => {
    const afterDeletion = [...loaded, { id: 'newer', media: [] }];
    expect(getAdjacentMediaDay(overview, afterDeletion, 'current', 'next')).toBeNull();
  });

  it('includes unloaded days so pagination boundaries do not end navigation', () => {
    expect(getAdjacentMediaDay(overview, [], 'current', 'prev')?.id).toBe('processing');
    expect(getAdjacentMediaDay(overview, [], 'current', 'next')?.id).toBe('newer');
  });

  it('stops at the timeline ends instead of wrapping', () => {
    expect(getAdjacentMediaDay(overview, loaded, 'older', 'prev')).toBeNull();
    expect(getAdjacentMediaDay(overview, loaded, 'newer', 'next')).toBeNull();
    expect(getAdjacentMediaDay(overview, loaded, 'missing', 'next')).toBeNull();
  });
});
