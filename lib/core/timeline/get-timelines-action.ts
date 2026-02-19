'use server';

import { Effect, Match } from 'effect';
import { NextEffect } from '@/lib/next-effect';
import { AppLayer } from '@/lib/layers';
import { getTimelines } from '@/lib/core/timeline/get-timelines';

export type TimelineSummary = {
  id: string;
  name: string;
  role: 'owner' | 'editor' | 'viewer';
};

export const getTimelinesAction = async (): Promise<
  { _tag: 'Success'; timelines: Array<TimelineSummary> } | { _tag: 'Error'; message: string }
> => {
  return await NextEffect.runPromise(
    Effect.gen(function* () {
      const timelines = yield* getTimelines();
      return timelines.map(t => ({ id: t.id, name: t.name, role: t.role }));
    }).pipe(
      Effect.withSpan('action.timeline.getTimelines'),
      Effect.provide(AppLayer),
      Effect.scoped,
      Effect.matchEffect({
        onFailure: error =>
          Match.value(error._tag).pipe(
            Match.when('UnauthenticatedError', () =>
              Effect.succeed({ _tag: 'Error' as const, message: 'Not authenticated' })
            ),
            Match.orElse(() =>
              Effect.succeed({ _tag: 'Error' as const, message: 'Failed to load timelines' })
            )
          ),
        onSuccess: timelines => Effect.succeed({ _tag: 'Success' as const, timelines })
      })
    )
  );
};
