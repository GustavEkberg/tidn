import {
  pgTable,
  text,
  timestamp,
  date,
  boolean,
  integer,
  index,
  unique
} from 'drizzle-orm/pg-core';
import { defineRelations } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';

////////////////////////////////////////////////////////////////////////
// AUTH - Better-auth expects singular model names
////////////////////////////////////////////////////////////////////////
export const user = pgTable('user', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),

  // Better Auth
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('emailVerified').notNull().default(false),
  image: text('image'),

  role: text('role', {
    enum: ['USER', 'ADMIN']
  })
    .notNull()
    .default('USER'),

  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date())
});
export type User = typeof user.$inferSelect;
export type InsertUser = typeof user.$inferInsert;

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expiresAt').notNull(),
  token: text('token').notNull().unique(),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  ipAddress: text('ipAddress'),
  userAgent: text('userAgent'),
  userId: text('userId')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' })
});

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('accountId').notNull(),
  providerId: text('providerId').notNull(),
  userId: text('userId')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('accessToken'),
  refreshToken: text('refreshToken'),
  idToken: text('idToken'),
  accessTokenExpiresAt: timestamp('accessTokenExpiresAt'),
  refreshTokenExpiresAt: timestamp('refreshTokenExpiresAt'),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date())
});

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expiresAt').notNull(),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date())
});

////////////////////////////////////////////////////////////////////////
// TIMELINE
////////////////////////////////////////////////////////////////////////
export const timeline = pgTable('timeline', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),

  name: text('name').notNull(),
  description: text('description'),

  ownerId: text('ownerId')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),

  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date())
});
export type Timeline = typeof timeline.$inferSelect;
export type InsertTimeline = typeof timeline.$inferInsert;

////////////////////////////////////////////////////////////////////////
// TIMELINE MEMBER
////////////////////////////////////////////////////////////////////////
export const timelineMember = pgTable(
  'timeline_member',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),

    timelineId: text('timelineId')
      .notNull()
      .references(() => timeline.id, { onDelete: 'cascade' }),

    userId: text('userId').references(() => user.id, { onDelete: 'cascade' }),

    email: text('email').notNull(),

    role: text('role', { enum: ['editor', 'viewer'] }).notNull(),

    invitedAt: timestamp('invitedAt').notNull().defaultNow(),
    joinedAt: timestamp('joinedAt'),

    createdAt: timestamp('createdAt').notNull().defaultNow(),
    updatedAt: timestamp('updatedAt')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date())
  },
  t => [unique('timeline_member_timeline_email').on(t.timelineId, t.email)]
);
export type TimelineMember = typeof timelineMember.$inferSelect;
export type InsertTimelineMember = typeof timelineMember.$inferInsert;

////////////////////////////////////////////////////////////////////////
// EVENT
////////////////////////////////////////////////////////////////////////
export const event = pgTable(
  'event',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),

    timelineId: text('timelineId')
      .notNull()
      .references(() => timeline.id, { onDelete: 'cascade' }),

    date: date('date', { mode: 'string' }).notNull(),

    comment: text('comment'),

    createdById: text('createdById')
      .notNull()
      .references(() => user.id),

    createdAt: timestamp('createdAt').notNull().defaultNow(),
    updatedAt: timestamp('updatedAt')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date())
  },
  t => [index('event_timeline_date_idx').on(t.timelineId, t.date)]
);
export type Event = typeof event.$inferSelect;
export type InsertEvent = typeof event.$inferInsert;

////////////////////////////////////////////////////////////////////////
// MEDIA
////////////////////////////////////////////////////////////////////////
export const media = pgTable('media', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),

  eventId: text('eventId')
    .notNull()
    .references(() => event.id, { onDelete: 'cascade' }),

  type: text('type', { enum: ['photo', 'video'] }).notNull(),

  s3Key: text('s3Key').notNull(),
  thumbnailS3Key: text('thumbnailS3Key'),

  fileName: text('fileName').notNull(),
  mimeType: text('mimeType').notNull(),
  fileSize: integer('fileSize').notNull(),

  width: integer('width'),
  height: integer('height'),
  duration: integer('duration'),

  processingStatus: text('processingStatus', {
    enum: ['pending', 'processing', 'completed', 'failed']
  }).notNull(),

  isPrivate: boolean('isPrivate').notNull().default(false),

  uploadedById: text('uploadedById')
    .notNull()
    .references(() => user.id),

  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date())
});
export type Media = typeof media.$inferSelect;
export type InsertMedia = typeof media.$inferInsert;

////////////////////////////////////////////////////////////////////////
// RELATIONS - Drizzle v1.0 RQB v2 API
////////////////////////////////////////////////////////////////////////
export const relations = defineRelations(
  { user, session, account, verification, timeline, timelineMember, event, media },
  r => ({
    user: {
      ownedTimelines: r.many.timeline({
        from: r.user.id,
        to: r.timeline.ownerId
      }),
      timelineMemberships: r.many.timelineMember({
        from: r.user.id,
        to: r.timelineMember.userId
      }),
      createdEvents: r.many.event({
        from: r.user.id,
        to: r.event.createdById
      }),
      uploadedMedia: r.many.media({
        from: r.user.id,
        to: r.media.uploadedById
      })
    },
    timeline: {
      owner: r.one.user({
        from: r.timeline.ownerId,
        to: r.user.id,
        optional: false
      }),
      members: r.many.timelineMember({
        from: r.timeline.id,
        to: r.timelineMember.timelineId
      }),
      events: r.many.event({
        from: r.timeline.id,
        to: r.event.timelineId
      })
    },
    timelineMember: {
      timeline: r.one.timeline({
        from: r.timelineMember.timelineId,
        to: r.timeline.id,
        optional: false
      }),
      user: r.one.user({
        from: r.timelineMember.userId,
        to: r.user.id,
        optional: true
      })
    },
    event: {
      timeline: r.one.timeline({
        from: r.event.timelineId,
        to: r.timeline.id,
        optional: false
      }),
      createdBy: r.one.user({
        from: r.event.createdById,
        to: r.user.id,
        optional: false
      }),
      media: r.many.media({
        from: r.event.id,
        to: r.media.eventId
      })
    },
    media: {
      event: r.one.event({
        from: r.media.eventId,
        to: r.event.id,
        optional: false
      }),
      uploadedBy: r.one.user({
        from: r.media.uploadedById,
        to: r.user.id,
        optional: false
      })
    }
  })
);
