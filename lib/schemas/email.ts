import { Schema } from 'effect';

export const EmailSchema = Schema.compose(Schema.Trim, Schema.NonEmptyString).pipe(
  Schema.pattern(/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/),
  Schema.annotations({
    title: 'Email',
    description: 'A valid email address'
  }),
  Schema.brand('Email')
);

export type Email = Schema.Schema.Type<typeof EmailSchema>;

// Validation helper
export const parseEmail = Schema.decodeUnknown(EmailSchema);
