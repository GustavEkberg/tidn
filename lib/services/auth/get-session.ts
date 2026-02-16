import { Effect } from 'effect';
import { cookies } from 'next/headers';
import { Auth } from './live-layer';
import { UnauthenticatedError, UnauthorizedError } from '@/lib/core/errors';

export type AppUser = {
  id: string;
  email: string;
  name: string;
  role: 'USER' | 'ADMIN';
  // Extend with domain-specific fields as needed, e.g.:
  // organizationId: Option.Option<string>;
};

export type AppSession = {
  user: AppUser;
};

// Basic session guard - requires authentication
export const getSession = () =>
  Effect.gen(function* () {
    yield* Effect.promise(() => cookies()); // Mark as dynamic

    const authService = yield* Auth;
    const session = yield* authService.getSessionFromCookies();

    if (!session) {
      return yield* Effect.fail(new UnauthenticatedError({ message: 'Not authenticated' }));
    }

    // Better-auth returns user with our additional fields
    // Extract with type-safe property access
    const { id, email, name } = session.user;
    const role = session.user.role === 'ADMIN' ? 'ADMIN' : 'USER';

    return {
      user: {
        id,
        email,
        name,
        role
        // Add domain-specific fields here, e.g.:
        // organizationId: Option.fromNullable(
        //   'organizationId' in session.user ? session.user.organizationId : null
        // )
      }
    } satisfies AppSession;
  }).pipe(Effect.withSpan('Auth.session.get'));

// Admin guard - requires ADMIN role
export const getAdminSession = () =>
  Effect.gen(function* () {
    const session = yield* getSession();

    if (session.user.role !== 'ADMIN') {
      return yield* Effect.fail(new UnauthorizedError({ message: 'Not authorized' }));
    }

    return session;
  }).pipe(Effect.withSpan('Auth.session.getAdmin'));

// --- Domain-specific session guards ---
// Uncomment and customize for your domain. Example for multi-tenant:
//
// import { NoOrganizationError } from '@/lib/core/errors';
//
// export type AppSessionWithOrganization = {
//   user: Omit<AppUser, 'organizationId'> & { organizationId: string };
//   organizationId: string;
// };
//
// export const getSessionWithOrganization = () =>
//   Effect.gen(function* () {
//     const session = yield* getSession();
//     const organizationId = Option.getOrNull(session.user.organizationId);
//
//     if (!organizationId) {
//       return yield* Effect.fail(
//         new NoOrganizationError({ message: 'User has no organization' })
//       );
//     }
//
//     return {
//       user: { ...session.user, organizationId },
//       organizationId
//     } satisfies AppSessionWithOrganization;
//   }).pipe(Effect.withSpan('Auth.session.getWithOrganization'));
