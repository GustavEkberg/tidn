import { Data } from 'effect';

export class NotFoundError extends Data.TaggedError('NotFoundError')<{
  message: string;
  entity: string;
  id: string;
}> {}

export class ValidationError extends Data.TaggedError('ValidationError')<{
  message: string;
  field?: string;
}> {}

export class UnauthenticatedError extends Data.TaggedError('UnauthenticatedError')<{
  message: string;
}> {}

export class UnauthorizedError extends Data.TaggedError('UnauthorizedError')<{
  message: string;
}> {}

// --- Domain-specific errors ---
// Uncomment and customize for your domain. Example for multi-tenant:
//
// export class NoOrganizationError extends Data.TaggedError('NoOrganizationError')<{
//   message: string;
// }> {}
