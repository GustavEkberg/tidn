type MediaDay = {
  id: string;
  media: ReadonlyArray<{ processingStatus: string }>;
};

type OverviewDay = { id: string; mediaCount: number };

/** Overview days are chronological; loaded details determine which media are viewable. */
export function getAdjacentMediaDay<T extends OverviewDay>(
  overviewDays: ReadonlyArray<T>,
  loadedDays: ReadonlyArray<MediaDay>,
  dayId: string,
  direction: 'prev' | 'next'
): T | null {
  const currentIndex = overviewDays.findIndex(day => day.id === dayId);
  if (currentIndex < 0) return null;
  const loadedById = new Map(loadedDays.map(day => [day.id, day]));
  const step = direction === 'next' ? 1 : -1;
  for (let i = currentIndex + step; i >= 0 && i < overviewDays.length; i += step) {
    const candidate = overviewDays[i];
    const loaded = loadedById.get(candidate.id);
    const hasMedia = loaded
      ? loaded.media.some(media => media.processingStatus === 'completed')
      : candidate.mediaCount > 0;
    if (hasMedia) return candidate;
  }
  return null;
}
