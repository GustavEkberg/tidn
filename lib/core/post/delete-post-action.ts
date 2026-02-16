'use server';

import { Effect, Match } from 'effect';
import { revalidatePath } from 'next/cache';
import { AppLayer } from '@/lib/layers';
import { NextEffect } from '@/lib/next-effect';
import { getSession } from '@/lib/services/auth/get-session';
import { Db } from '@/lib/services/db/live-layer';
import { NotFoundError, UnauthorizedError } from '@/lib/core/errors';
import * as schema from '@/lib/services/db/schema';
import { eq } from 'drizzle-orm';

export const deletePostAction = async (postId: schema.Post['id']) => {
  return await NextEffect.runPromise(
    Effect.gen(function* () {
      const session = yield* getSession();
      const db = yield* Db;

      yield* Effect.annotateCurrentSpan({
        'user.id': session.user.id,
        'user.email': session.user.email
      });

      // Verify post exists and belongs to user
      const [existing] = yield* db
        .select()
        .from(schema.post)
        .where(eq(schema.post.id, postId))
        .limit(1);

      if (!existing) {
        return yield* new NotFoundError({
          message: 'Post not found',
          entity: 'post',
          id: postId
        });
      }

      if (existing.userId !== session.user.id) {
        return yield* new UnauthorizedError({
          message: 'You can only delete your own posts'
        });
      }

      yield* db.delete(schema.post).where(eq(schema.post.id, postId));
    }).pipe(
      Effect.withSpan('action.post.delete', {
        attributes: {
          'post.id': postId,
          operation: 'post.delete'
        }
      }),
      Effect.provide(AppLayer),
      Effect.scoped,
      Effect.matchEffect({
        onFailure: error =>
          Match.value(error._tag).pipe(
            Match.when('UnauthenticatedError', () => NextEffect.redirect('/login')),
            Match.when('UnauthorizedError', () =>
              Effect.succeed({
                _tag: 'Error' as const,
                message: error.message
              })
            ),
            Match.when('NotFoundError', () =>
              Effect.succeed({
                _tag: 'Error' as const,
                message: error.message
              })
            ),
            Match.orElse(() =>
              Effect.succeed({
                _tag: 'Error' as const,
                message: 'Something went wrong'
              })
            )
          ),
        onSuccess: () => Effect.sync(() => revalidatePath('/'))
      })
    )
  );
};
