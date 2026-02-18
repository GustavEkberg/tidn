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
// DAY — one per (timeline, date). Replaces the old "event" table.
////////////////////////////////////////////////////////////////////////
export const day = pgTable(
  'day',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),

    timelineId: text('timelineId')
      .notNull()
      .references(() => timeline.id, { onDelete: 'cascade' }),

    date: date('date', { mode: 'string' }).notNull(),

    title: text('title'),

    createdById: text('createdById')
      .notNull()
      .references(() => user.id),

    createdAt: timestamp('createdAt').notNull().defaultNow(),
    updatedAt: timestamp('updatedAt')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date())
  },
  t => [
    unique('day_timeline_date').on(t.timelineId, t.date),
    index('day_timeline_date_idx').on(t.timelineId, t.date)
  ]
);
export type Day = typeof day.$inferSelect;
export type InsertDay = typeof day.$inferInsert;

////////////////////////////////////////////////////////////////////////
// DAY COMMENT
////////////////////////////////////////////////////////////////////////
export const dayComment = pgTable(
  'day_comment',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),

    dayId: text('dayId')
      .notNull()
      .references(() => day.id, { onDelete: 'cascade' }),

    text: text('text').notNull(),

    authorId: text('authorId')
      .notNull()
      .references(() => user.id),

    createdAt: timestamp('createdAt').notNull().defaultNow(),
    updatedAt: timestamp('updatedAt')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date())
  },
  t => [index('day_comment_day_idx').on(t.dayId)]
);
export type DayComment = typeof dayComment.$inferSelect;
export type InsertDayComment = typeof dayComment.$inferInsert;

////////////////////////////////////////////////////////////////////////
// MEDIA
////////////////////////////////////////////////////////////////////////
export const media = pgTable('media', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),

  dayId: text('dayId')
    .notNull()
    .references(() => day.id, { onDelete: 'cascade' }),

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
// MEDIA COMMENT
////////////////////////////////////////////////////////////////////////
export const mediaComment = pgTable(
  'media_comment',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),

    mediaId: text('mediaId')
      .notNull()
      .references(() => media.id, { onDelete: 'cascade' }),

    text: text('text').notNull(),

    authorId: text('authorId')
      .notNull()
      .references(() => user.id),

    createdAt: timestamp('createdAt').notNull().defaultNow(),
    updatedAt: timestamp('updatedAt')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date())
  },
  t => [index('media_comment_media_idx').on(t.mediaId)]
);
export type MediaComment = typeof mediaComment.$inferSelect;
export type InsertMediaComment = typeof mediaComment.$inferInsert;

////////////////////////////////////////////////////////////////////////
// RELATIONS - Drizzle v1.0 RQB v2 API
////////////////////////////////////////////////////////////////////////
export const relations = defineRelations(
  {
    user,
    session,
    account,
    verification,
    timeline,
    timelineMember,
    day,
    dayComment,
    media,
    mediaComment
  },
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
      createdDays: r.many.day({
        from: r.user.id,
        to: r.day.createdById
      }),
      uploadedMedia: r.many.media({
        from: r.user.id,
        to: r.media.uploadedById
      }),
      dayComments: r.many.dayComment({
        from: r.user.id,
        to: r.dayComment.authorId
      }),
      mediaComments: r.many.mediaComment({
        from: r.user.id,
        to: r.mediaComment.authorId
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
      days: r.many.day({
        from: r.timeline.id,
        to: r.day.timelineId
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
    day: {
      timeline: r.one.timeline({
        from: r.day.timelineId,
        to: r.timeline.id,
        optional: false
      }),
      createdBy: r.one.user({
        from: r.day.createdById,
        to: r.user.id,
        optional: false
      }),
      media: r.many.media({
        from: r.day.id,
        to: r.media.dayId
      }),
      comments: r.many.dayComment({
        from: r.day.id,
        to: r.dayComment.dayId
      })
    },
    dayComment: {
      day: r.one.day({
        from: r.dayComment.dayId,
        to: r.day.id,
        optional: false
      }),
      author: r.one.user({
        from: r.dayComment.authorId,
        to: r.user.id,
        optional: false
      })
    },
    media: {
      day: r.one.day({
        from: r.media.dayId,
        to: r.day.id,
        optional: false
      }),
      uploadedBy: r.one.user({
        from: r.media.uploadedById,
        to: r.user.id,
        optional: false
      }),
      comments: r.many.mediaComment({
        from: r.media.id,
        to: r.mediaComment.mediaId
      })
    },
    mediaComment: {
      media: r.one.media({
        from: r.mediaComment.mediaId,
        to: r.media.id,
        optional: false
      }),
      author: r.one.user({
        from: r.mediaComment.authorId,
        to: r.user.id,
        optional: false
      })
    }
  })
);
