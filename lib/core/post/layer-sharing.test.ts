import { layer, expect } from '@effect/vitest';
import { Effect, Layer, Context } from 'effect';
import { UnauthenticatedError, NotFoundError } from '@/lib/core/errors';

/**
 * Demonstrates layer() for sharing mock services across tests
 *
 * layer() creates a describe block where all tests share the same Layer.
 * Use this to:
 * - Share mock services across multiple tests
 * - Avoid duplicating Layer setup
 * - Test different scenarios with same dependencies
 *
 * For property testing, see test-5 (it.prop).
 * For error testing patterns, see test-6 (Effect.either, Effect.exit).
 *
 * NOTE: This example uses mock services for unit testing. For integration tests
 * against a real database, see the testcontainers section in specs/EFFECT_TESTING.md.
 * Database integration tests require additional setup with @testcontainers/postgresql.
 */

type Post = {
  id: string;
  title: string;
  content: string | null;
  userId: string;
};

// Mock Auth service - returns test session/user
class Auth extends Context.Tag('@app/Auth')<
  Auth,
  {
    readonly getSession: () => Effect.Effect<
      { user: { id: string; email: string; name: string } },
      UnauthenticatedError
    >;
  }
>() {}

// Mock Db service - simplified post operations
class PostRepository extends Context.Tag('@app/PostRepository')<
  PostRepository,
  {
    readonly create: (input: {
      title: string;
      content: string | null;
      userId: string;
    }) => Effect.Effect<Post>;
    readonly findAll: () => Effect.Effect<Post[]>;
    readonly delete: (id: string) => Effect.Effect<void, NotFoundError>;
  }
>() {}

// Factory for creating test Auth implementations
const createMockAuth = (options?: { authenticated: boolean }) => {
  const authenticated = options?.authenticated ?? true;

  return Layer.succeed(Auth, {
    getSession: () =>
      authenticated
        ? Effect.succeed({
            user: {
              id: 'test-user-id',
              email: 'test@example.com',
              name: 'Test User'
            }
          })
        : Effect.fail(new UnauthenticatedError({ message: 'Not authenticated' }))
  });
};

// Factory for creating test PostRepository with call tracking
const createMockPostRepository = () => {
  // In-memory post storage
  const posts = new Map<string, Post>();

  // Track calls for assertions
  const calls: Array<{ method: string; args: unknown[] }> = [];

  const trackCall = (method: string, args: unknown[]) => {
    calls.push({ method, args });
  };

  return {
    layer: Layer.succeed(PostRepository, {
      create: input =>
        Effect.sync(() => {
          trackCall('create', [input]);
          const post: Post = {
            id: `post-${posts.size + 1}`,
            ...input
          };
          posts.set(post.id, post);
          return post;
        }),
      findAll: () =>
        Effect.sync(() => {
          trackCall('findAll', []);
          return Array.from(posts.values());
        }),
      delete: id =>
        Effect.gen(function* () {
          trackCall('delete', [id]);
          if (!posts.has(id)) {
            return yield* Effect.fail(
              new NotFoundError({ message: 'Post not found', entity: 'post', id })
            );
          }
          posts.delete(id);
        })
    }),
    calls,
    posts
  };
};

// Shared test layer: authenticated user + in-memory post repository
const { layer: mockPostRepoLayer, calls: repoCalls } = createMockPostRepository();
const TestLayer = Layer.mergeAll(createMockAuth(), mockPostRepoLayer);

layer(TestLayer)('Post operations with shared mocks', it => {
  /**
   * All tests in this block share the same Auth + PostRepository layer
   *
   * This demonstrates:
   * - Sharing mock services across multiple tests
   * - State persistence between tests (posts created in test 1 visible in test 2)
   * - Call tracking for assertions
   */

  it.effect('creates post with authenticated user', () =>
    Effect.gen(function* () {
      const auth = yield* Auth;
      const repo = yield* PostRepository;

      // Get session
      const session = yield* auth.getSession();
      expect(session.user.id).toBe('test-user-id');

      // Create post
      const post = yield* repo.create({
        title: 'Test Post',
        content: 'Test content',
        userId: session.user.id
      });

      expect(post.title).toBe('Test Post');
      expect(post.userId).toBe('test-user-id');
      expect(repoCalls.some(c => c.method === 'create')).toBe(true);
    })
  );

  it.effect('lists posts from repository', () =>
    Effect.gen(function* () {
      const repo = yield* PostRepository;

      // Query posts
      const posts = yield* repo.findAll();

      // Should include post created in previous test (shared layer)
      expect(posts.length).toBeGreaterThan(0);
      expect(posts[0].title).toBe('Test Post');
      expect(repoCalls.some(c => c.method === 'findAll')).toBe(true);
    })
  );

  /**
   * Nested it.layer() adds additional dependencies
   *
   * The nested layer merges with the parent TestLayer, overriding Auth.
   * Use for tests that need extra services or different configurations.
   */
  it.layer(createMockAuth({ authenticated: false }))('with unauthenticated user', it => {
    it.effect('fails to get session', () =>
      Effect.gen(function* () {
        const auth = yield* Auth;

        // Should fail with UnauthenticatedError
        const result = yield* auth.getSession().pipe(Effect.either);

        expect(result._tag).toBe('Left');
        if (result._tag === 'Left') {
          expect(result.left._tag).toBe('UnauthenticatedError');
        }
      })
    );

    it.effect('repository still accessible with nested layer', () =>
      Effect.gen(function* () {
        const repo = yield* PostRepository;

        // PostRepository from parent layer still works
        const posts = yield* repo.findAll();
        expect(posts.length).toBeGreaterThan(0);
      })
    );
  });
});

/**
 * Example: separate layer for deletion tests
 *
 * Demonstrates creating a fresh layer for different test scenarios.
 * Each layer() call gets its own isolated state.
 */
const { layer: deleteRepoLayer, posts: deletePosts } = createMockPostRepository();
const DeleteTestLayer = Layer.mergeAll(createMockAuth(), deleteRepoLayer);

layer(DeleteTestLayer)('Post deletion with fresh layer', it => {
  it.effect('deletes post successfully', () =>
    Effect.gen(function* () {
      const repo = yield* PostRepository;

      // Create a post
      const created = yield* repo.create({
        title: 'To Delete',
        content: null,
        userId: 'test-user-id'
      });

      expect(deletePosts.has(created.id)).toBe(true);

      // Delete it
      yield* repo.delete(created.id);

      // Verify deletion
      expect(deletePosts.has(created.id)).toBe(false);
    })
  );

  it.effect('fails when deleting non-existent post', () =>
    Effect.gen(function* () {
      const repo = yield* PostRepository;

      // Try to delete non-existent post
      const result = yield* repo.delete('invalid-id').pipe(Effect.either);

      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left._tag).toBe('NotFoundError');
      }
    })
  );
});
