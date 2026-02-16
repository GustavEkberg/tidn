'use server';

import { Effect, Match } from 'effect';
import { revalidatePath } from 'next/cache';
import { AppLayer } from '@/lib/layers';
import { NextEffect } from '@/lib/next-effect';
import { getSession } from '@/lib/services/auth/get-session';
import { Db } from '@/lib/services/db/live-layer';
import * as schema from '@/lib/services/db/schema';

type CreatePostInput = {
  title: string;
  content?: string;
};

export const createPostAction = async (input: CreatePostInput) => {
  return await NextEffect.runPromise(
    Effect.gen(function* () {
      const session = yield* getSession();
      const db = yield* Db;

      yield* Effect.annotateCurrentSpan({
        'user.id': session.user.id,
        'user.email': session.user.email
      });

      const [post] = yield* db
        .insert(schema.post)
        .values({
          title: input.title,
          content: input.content,
          userId: session.user.id
        })
        .returning();

      return post;
    }).pipe(
      Effect.withSpan('action.post.create', {
        attributes: {
          'post.title': input.title,
          operation: 'post.create'
        }
      }),
      Effect.provide(AppLayer),
      Effect.scoped,
      Effect.matchEffect({
        onFailure: error =>
          Match.value(error._tag).pipe(
            Match.when('UnauthenticatedError', () => NextEffect.redirect('/login')),
            Match.orElse(() =>
              Effect.succeed({
                _tag: 'Error' as const,
                message: `Failed to create post: ${error.message}`
              })
            )
          ),
        onSuccess: post =>
          Effect.sync(() => {
            revalidatePath('/');
            return { _tag: 'Success' as const, post };
          })
      })
    )
  );
};
