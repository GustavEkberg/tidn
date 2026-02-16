# PRD: tidn — Timeline Media App

**Date:** 2026-02-16

---

## Problem Statement

### What problem are we solving?

There is no simple, private way to build a visual timeline of life events — a child growing up, a long trip, a project unfolding — where multiple people can contribute photos, videos, and comments and see them arranged chronologically. Existing solutions are either social media (public, algorithmic, noisy) or shared albums (no timeline structure, no date-grouped narrative).

Users need a private, collaborative timeline where media uploads are the primary interaction, events are organized by date, and the whole thing scrolls as a visual story.

### Why now?

This is the founding product for tidn. The boilerplate repo is ready with auth, S3, database, and Effect-TS architecture already in place.

### Who is affected?

- **Primary users:** People who want to document something over time — parents tracking a child's milestones, travelers logging a trip, anyone building a personal chronological archive.
- **Secondary users:** Invited collaborators — family members, travel companions, friends — who view or contribute to a shared timeline.

---

## Proposed Solution

### Overview

tidn is a private timeline application where users create named timelines, upload photos/videos/comments as events with dates, and browse them in a scrollable chronological view with thumbnails. Timelines can be shared with other users who get either edit or view-only access. Media is uploaded directly to S3 via signed URLs with drag-and-drop support for bulk uploads. Thumbnails and video frame extraction happen asynchronously after upload. The app is a responsive PWA that works well on mobile.

### User Experience

#### User Flow: Create Timeline

1. User logs in (email OTP, existing auth system)
2. User creates a timeline by providing a name and optional description
3. User lands on the timeline view (empty state with prompt to add first event)

#### User Flow: Add Events (Bulk Upload)

1. User clicks "Add" or drags files onto the timeline view
2. Drop zone accepts multiple photos and videos simultaneously
3. User assigns a date to the batch (defaults to file EXIF date if available, otherwise today)
4. User optionally adds a text comment to accompany the upload
5. Files upload directly to S3 via signed URLs — progress shown per file
6. Thumbnails appear asynchronously as processing completes
7. Events appear in the timeline at the correct chronological position

#### User Flow: Add Comment-Only Event

1. User clicks "Add comment" or similar
2. User writes text and selects a date
3. Comment appears as a standalone event in the timeline

#### User Flow: Browse Timeline

1. User opens a timeline — sees a scrollable chronological view
2. Events are grouped by date — each date group shows its media thumbnails and comments
3. Clicking a photo opens it full-size; clicking a video plays it inline
4. User can scroll through potentially thousands of events (virtualized rendering)

#### User Flow: Edit Event

1. User selects an event
2. User can change date, edit comment text, add/remove media from the event
3. Changes are saved and timeline re-sorts if date changed

#### User Flow: Invite Collaborator

1. Timeline owner opens timeline settings
2. Enters collaborator's email and selects role: **editor** or **viewer**
3. If the email is already a tidn user, they see the timeline immediately
4. If not, they receive an email invitation — on signup the timeline is linked to their account
5. Editors can add/edit/delete events; viewers can only browse

#### User Flow: Mobile (PWA)

1. User visits tidn on mobile browser
2. Can install to home screen (PWA manifest)
3. Full functionality: upload from camera roll, drag-and-drop (or tap-to-select on mobile), browse timeline
4. Responsive layout adapts to phone/tablet screens

### Design Considerations

- **Timeline scroll UX**: The core interaction is vertical scrolling through date-grouped events. This needs to feel smooth with thousands of entries. Exact layout/UX to be designed later — this PRD defines the data model and capabilities, not the visual design.
- **Drag-and-drop**: Must work on desktop. On mobile, a file picker with multi-select is the equivalent.
- **Thumbnail grid**: Within a date group, multiple photos/videos display as a thumbnail grid. Clicking expands.
- **Accessibility**: WCAG AA. Alt text for images (user-provided or filename fallback), keyboard navigation through timeline, video controls accessible.
- **PWA**: Service worker for offline shell, web app manifest for installability. Offline upload queuing is a non-goal for v1.

---

## End State

When this PRD is complete, the following will be true:

- [ ] Users can create, edit, and delete timelines (name + description)
- [ ] Users can add events to a timeline with a required date, optional comment, and optional media (photos/videos)
- [ ] Users can edit and delete events
- [ ] Users can drag-and-drop or select multiple files for bulk upload
- [ ] Files upload directly to S3 via signed URLs with progress indication
- [ ] Photo thumbnails are generated asynchronously after upload
- [ ] Video thumbnails (frame extraction) are generated asynchronously after upload
- [ ] Timeline view displays events grouped by date in chronological order
- [ ] Timeline view handles thousands of events via virtualized/paginated rendering
- [ ] Photos display as thumbnails; clicking opens full-size
- [ ] Videos display with a thumbnail; clicking plays inline
- [ ] Comment-only events display in the timeline alongside media events
- [ ] Timeline owners can invite collaborators by email with editor or viewer roles
- [ ] Editors can add, edit, and delete events on shared timelines
- [ ] Viewers can only browse shared timelines
- [ ] Pending invitations are fulfilled when the invitee signs up
- [ ] App is a responsive PWA installable on mobile
- [ ] All media is private — accessible only via time-limited signed URLs to authorized users
- [ ] Tests cover core domain logic (timeline CRUD, event CRUD, permissions, invitations)
- [ ] Observability spans on all service methods and actions

---

## Success Metrics

### Quantitative

| Metric                           | Target                            | Measurement Method                |
| -------------------------------- | --------------------------------- | --------------------------------- |
| Upload success rate              | > 99%                             | S3 upload completion tracking     |
| Thumbnail generation time        | < 10s for photos, < 30s for video | Processing duration spans         |
| Timeline load time (1000 events) | < 3s initial, smooth scroll       | Lighthouse + real user monitoring |
| PWA installability               | Passes Lighthouse PWA audit       | Lighthouse CI                     |

### Qualitative

- Uploading multiple files feels effortless (drag-drop, progress, no page reload)
- Browsing a long timeline feels like scrolling through a story, not paginating a table
- Sharing a timeline with family is a one-step invite

---

## Acceptance Criteria

### Feature: Timelines

- [ ] Create timeline with name (required) and description (optional)
- [ ] Edit timeline name and description
- [ ] Delete timeline (cascades to all events and media)
- [ ] User can have multiple timelines
- [ ] Timeline list page shows all timelines user owns or has access to

### Feature: Events

- [ ] Create event with required date, optional comment, optional media attachments
- [ ] Edit event: change date, update comment, add/remove media
- [ ] Delete event (cascades media deletion from S3)
- [ ] Bulk upload: multiple files in one action, all assigned to same date
- [ ] Date defaults to EXIF date (photos) or today if unavailable
- [ ] EXIF data extracted (date, dimensions) then stripped from stored file for privacy (GPS, device info, etc.)
- [ ] Comment-only events (no media) are supported
- [ ] Events are ordered chronologically within the timeline

### Feature: Media

- [ ] Photos: JPEG, PNG, WebP, HEIC accepted
- [ ] Videos: MP4, MOV, WebM accepted
- [ ] Upload via S3 signed URLs (files never transit the server)
- [ ] Upload progress shown per file
- [ ] EXIF metadata extracted (date, dimensions) then stripped from stored photos (privacy: removes GPS, device info)
- [ ] Photo thumbnails generated async (stored in S3 alongside original)
- [ ] Video thumbnails (frame at ~1s) generated async
- [ ] Full-size photo view on click
- [ ] Inline video playback on click
- [ ] Media accessible only via time-limited signed download URLs
- [ ] Max file size: 100MB for video, 20MB for photos

### Feature: Collaboration

- [ ] Timeline owner can invite users by email
- [ ] Invitation specifies role: editor or viewer
- [ ] Existing users see shared timeline immediately
- [ ] Non-users receive email invitation; timeline linked on signup
- [ ] Editors can create, edit, delete events
- [ ] Viewers can only browse timeline and view media
- [ ] Timeline owner can change collaborator role or remove access
- [ ] Timeline owner cannot be removed

### Feature: Timeline View

- [ ] Chronological scroll — newest or oldest first (user toggle)
- [ ] Events grouped by date
- [ ] Thumbnail grid within date groups
- [ ] Virtualized rendering for performance with thousands of events
- [ ] Responsive layout: desktop, tablet, phone

### Feature: PWA

- [ ] Web app manifest with app name, icons, theme color
- [ ] Service worker for app shell caching
- [ ] Installable on iOS and Android via browser
- [ ] Responsive design passes on 360px-wide screens

---

## Technical Context

### Existing Patterns to Follow

- **Server actions**: `lib/core/[domain]/*-action.ts` — one action per file, `NextEffect.runPromise`, `Effect.matchEffect` error handling, tagged discriminated union responses. See `lib/core/post/create-post-action.ts`.
- **S3 signed URL upload**: `lib/core/file/get-upload-url-action.ts` — generates key as `{folder}/{userId}/{timestamp}-{fileName}`, returns presigned PUT URL. Client uploads directly.
- **Auth session guard**: `lib/services/auth/get-session.ts` — `getSession()` returns `AppSession`, fails with `UnauthenticatedError`.
- **Database schema**: `lib/services/db/schema.ts` — CUID2 IDs, `createdAt`/`updatedAt` timestamps, relations via Drizzle RQB v2.
- **Page pattern**: Suspense + Content component, `force-dynamic` export, nuqs URL state for filters.
- **Effect services**: `Effect.Service` pattern with `static layer` and `static Live`, composed in `lib/layers.ts`.
- **Post-cleanup AppLayer** (after removing Telegram + Activity):
  ```
  AppLayer
  ├── Auth.Live → Email.Live
  ├── Db.Live
  ├── Email.Live
  └── S3.Live
  ```

### Key Files

- `lib/layers.ts` — AppLayer composition (add new services here)
- `lib/services/s3/live-layer.ts` — S3 operations including signed URLs, delete, list
- `lib/services/auth/get-session.ts` — Session retrieval and guards
- `lib/services/db/schema.ts` — Database schema (add new tables here)
- `lib/core/file/get-upload-url-action.ts` — Upload URL generation pattern
- `lib/core/errors/index.ts` — Tagged error types
- `proxy.ts` — Auth middleware (update public routes if needed)
- `specs/SERVER_ACTION_PATTERNS.md` — Action implementation spec
- `specs/DATA_ACCESS_PATTERNS.md` — Read/write pattern decisions
- `specs/PAGE_PATTERNS.md` — Page component structure

### System Dependencies

- **S3**: Media storage (already configured)
- **PostgreSQL/Neon**: Database (already configured)
- **Resend**: Email for invitations (already configured)
- **Thumbnail generation**: Needs a processing solution — options include:
  - **sharp** (npm) for image thumbnail generation (runs in Node.js)
  - **ffmpeg** (via `fluent-ffmpeg` or similar) for video frame extraction
  - These can run as async background jobs triggered after upload confirmation
  - Alternative: AWS Lambda triggered by S3 upload events (more scalable but more infrastructure)

### Data Model Changes

#### New Tables

**`timeline`**
| Column | Type | Notes |
|--------|------|-------|
| id | CUID2 | PK |
| name | text | Required |
| description | text | Optional |
| ownerId | text | FK -> user.id, cascade delete |
| createdAt | timestamp | |
| updatedAt | timestamp | |

**`timeline_member`**
| Column | Type | Notes |
|--------|------|-------|
| id | CUID2 | PK |
| timelineId | text | FK -> timeline.id, cascade delete |
| userId | text | FK -> user.id, nullable (null = pending invite) |
| email | text | Invite email (used to match on signup) |
| role | enum | `'editor' \| 'viewer'` |
| invitedAt | timestamp | |
| joinedAt | timestamp | Null until accepted |
| createdAt | timestamp | |
| updatedAt | timestamp | |

Unique constraint: `(timelineId, email)` — no duplicate invites.

**`event`**
| Column | Type | Notes |
|--------|------|-------|
| id | CUID2 | PK |
| timelineId | text | FK -> timeline.id, cascade delete |
| date | date | Required, used for chronological ordering |
| comment | text | Optional |
| createdById | text | FK -> user.id |
| createdAt | timestamp | |
| updatedAt | timestamp | |

Index on `(timelineId, date)` for efficient chronological queries.

**`media`**
| Column | Type | Notes |
|--------|------|-------|
| id | CUID2 | PK |
| eventId | text | FK -> event.id, cascade delete |
| type | enum | `'photo' \| 'video'` |
| s3Key | text | Original file S3 key |
| thumbnailS3Key | text | Nullable — populated async after processing |
| fileName | text | Original filename |
| mimeType | text | e.g., `image/jpeg`, `video/mp4` |
| fileSize | integer | Bytes |
| width | integer | Nullable — extracted during processing |
| height | integer | Nullable — extracted during processing |
| duration | integer | Nullable — video duration in seconds |
| processingStatus | enum | `'pending' \| 'processing' \| 'completed' \| 'failed'` |
| uploadedById | text | FK -> user.id |
| createdAt | timestamp | |
| updatedAt | timestamp | |

#### Relations

```
user -> ownedTimelines: one-to-many
user -> timelineMemberships: one-to-many
timeline -> owner: many-to-one
timeline -> members: one-to-many
timeline -> events: one-to-many
timelineMember -> timeline: many-to-one
timelineMember -> user: many-to-one (nullable)
event -> timeline: many-to-one
event -> media: one-to-many
event -> createdBy: many-to-one
media -> event: many-to-one
media -> uploadedBy: many-to-one
```

---

## Risks & Mitigations

| Risk                                                    | Likelihood | Impact | Mitigation                                                                                                                                                               |
| ------------------------------------------------------- | ---------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Video processing is slow/fails                          | High       | Med    | Async processing with status tracking; retry failed jobs; show placeholder until ready                                                                                   |
| ffmpeg binary not available in serverless (Vercel)      | High       | High   | Use sharp for images (pure Node.js). For video: either use a Lambda function, an external service, or a lightweight WASM-based solution. Evaluate before implementation. |
| Large timelines (1000s of events) cause slow page loads | Med        | High   | Cursor-based pagination + virtualized rendering (e.g., `@tanstack/react-virtual`). Never load all events at once.                                                        |
| S3 signed URL expiry while browsing                     | Med        | Low    | Generous expiry (1h for downloads); refresh URLs on scroll into viewport                                                                                                 |
| HEIC files not displayable in all browsers              | Med        | Low    | Convert HEIC to JPEG during thumbnail generation; serve converted version for display                                                                                    |
| Concurrent uploads overwhelm client                     | Low        | Med    | Queue uploads client-side; limit concurrent S3 PUTs (e.g., 3-5 at a time)                                                                                                |
| Pending invitations never claimed                       | Low        | Low    | No expiry needed — link on signup. Optional: reminder emails.                                                                                                            |

---

## Alternatives Considered

### Alternative 1: Use a third-party media processing service (Cloudinary, Mux)

- **Pros:** No ffmpeg/sharp dependency; handles all formats; CDN delivery; adaptive video streaming
- **Cons:** Cost per asset; vendor lock-in; data leaves your S3; adds external dependency
- **Decision:** Rejected for v1. Keep processing in-house to control costs and data locality. Reconsider if video processing proves too complex in serverless.

### Alternative 2: Store media metadata in S3 tags instead of database

- **Pros:** Fewer database queries; metadata co-located with files
- **Cons:** S3 tags have strict limits (10 tags, 256 chars each); can't query/filter/sort; no relations
- **Decision:** Rejected. Database is the right place for queryable, relational metadata.

### Alternative 3: One event = one file (no grouping)

- **Pros:** Simpler data model; no event/media split
- **Cons:** Can't attach multiple photos to a single moment; can't have comment-only entries; bulk upload loses grouping context
- **Decision:** Rejected. The event/media split is essential for the "date group with multiple items" requirement.

---

## Non-Goals (v1)

Explicitly out of scope:

- **Photo editing/cropping** — upload as-is; editing is a separate feature
- **Public/embeddable timelines** — all timelines are private to authenticated members
- **Offline upload queuing** — PWA provides app shell caching, but uploads require connectivity
- **Search within timeline** — browsing by scroll and date grouping is sufficient for v1
- **Timeline templates** — no pre-built structures for "baby's first year" etc.
- **Export/download timeline** — no bulk export to ZIP or PDF
- **Push notifications** — no alerts when collaborators add events
- **Activity feed** — no "Alice added 3 photos" log
- **Video transcoding/adaptive streaming** — serve original video; optimize later if needed
- **AI features** — no auto-tagging, face recognition, or caption generation

---

## Interface Specifications

### Server Actions

```
createTimelineAction({ name: string, description?: string })
  -> { _tag: 'Success', timeline } | { _tag: 'Error', message }

updateTimelineAction({ timelineId: string, name?: string, description?: string })
  -> { _tag: 'Success', timeline } | { _tag: 'Error', message }

deleteTimelineAction({ timelineId: string })
  -> { _tag: 'Success' } | { _tag: 'Error', message }

inviteMemberAction({ timelineId: string, email: string, role: 'editor' | 'viewer' })
  -> { _tag: 'Success', member } | { _tag: 'Error', message }

updateMemberRoleAction({ memberId: string, role: 'editor' | 'viewer' })
  -> { _tag: 'Success' } | { _tag: 'Error', message }

removeMemberAction({ memberId: string })
  -> { _tag: 'Success' } | { _tag: 'Error', message }

createEventAction({ timelineId: string, date: string, comment?: string })
  -> { _tag: 'Success', event } | { _tag: 'Error', message }

updateEventAction({ eventId: string, date?: string, comment?: string })
  -> { _tag: 'Success', event } | { _tag: 'Error', message }

deleteEventAction({ eventId: string })
  -> { _tag: 'Success' } | { _tag: 'Error', message }

getMediaUploadUrlAction({ eventId: string, fileName: string, mimeType: string, fileSize: number })
  -> { _tag: 'Success', uploadUrl: string, mediaId: string } | { _tag: 'Error', message }

confirmMediaUploadAction({ mediaId: string })
  -> { _tag: 'Success' } | { _tag: 'Error', message }
  // Triggers async thumbnail generation

deleteMediaAction({ mediaId: string })
  -> { _tag: 'Success' } | { _tag: 'Error', message }
```

### Pages

```
/                        -> Timeline list (or redirect to sole timeline)
/timeline/[id]           -> Timeline view (chronological scroll)
/timeline/[id]/settings  -> Timeline settings (name, description, members)
/login                   -> Auth (existing)
```

### Thumbnail Processing (Background)

```
On confirmMediaUploadAction:
  1. Set media.processingStatus = 'processing'
  2. For photos:
     a. Extract EXIF data (date, width, height, orientation)
     b. Strip all EXIF metadata from original (remove GPS, device info, etc.)
     c. Re-upload stripped original to S3 (overwrite)
     d. Generate thumbnail via sharp, upload to S3 as {key}-thumb.{ext}
  3. For videos: extract frame via ffmpeg, upload to S3 as {key}-thumb.jpg
  4. Update media record: thumbnailS3Key, width, height, duration, processingStatus = 'completed'
  5. On failure: processingStatus = 'failed' (can be retried)
```

---

## Boilerplate Setup

This project starts from the tidn boilerplate repo. Before implementing any features, the following setup must be completed.

### Modules to Keep

| Module            | Keep | Notes                                                              |
| ----------------- | ---- | ------------------------------------------------------------------ |
| **Auth**          | Yes  | Email OTP login, session management                                |
| **Database**      | Yes  | Drizzle ORM + PostgreSQL/Neon                                      |
| **Email**         | Yes  | Invitation emails + auth OTP                                       |
| **S3**            | Yes  | Media storage, signed URLs                                         |
| **Telegram**      | No   | Remove entirely                                                    |
| **Activity**      | No   | Remove entirely (depends on Telegram)                              |
| **UI Components** | Yes  | shadcn/ui + Base UI primitives                                     |
| **Example Code**  | No   | Always removed (`lib/core/post/`, example API routes, post schema) |

### Setup Tasks (Before Feature Work)

- [ ] Delete `lib/services/telegram/` directory
- [ ] Delete `lib/services/activity/` directory
- [ ] Delete `lib/core/post/` directory (example CRUD scaffolding)
- [ ] Delete `app/api/example/` directory
- [ ] Remove `post` table and its relations from `lib/services/db/schema.ts`
- [ ] Remove `Telegram.Live` and `Activity.Live` from `lib/layers.ts` AppLayer
- [ ] Remove Telegram/Activity-related env vars from `.env.example`
- [ ] Update `package.json` name to `tidn`
- [ ] Rewrite `AGENTS.md` to reflect tidn as the actual project (remove boilerplate sections, update OVERVIEW, STRUCTURE, CODE MAP, WHERE TO LOOK, service dependency hierarchy)
- [ ] Rewrite `README.md` with tidn project description, stack (Auth, DB, Email, S3, UI), setup instructions, env vars
- [ ] Prune specs: remove any Telegram/Activity references from specs; keep all other specs as architectural guidance
- [ ] Update `proxy.ts` public routes if needed (currently `/`, `/login`)

### What Stays (Core Architecture)

These are not optional and must not be removed:

- Effect-TS service architecture + patterns
- Next.js App Router structure
- `lib/next-effect/` (Effect/Next.js adapter)
- `lib/core/errors/` (tagged error pattern)
- `lib/core/file/` (S3 upload/download actions — extend for media)
- Tailwind CSS 4 + styling setup
- ESLint rules (Effect-TS rules, no-any, no-as)
- Specs directory (`specs/`) — prune for removed modules only
- nuqs URL state management

---

## Documentation Requirements

- [ ] Rewrite AGENTS.md to reflect tidn as the actual project (see Boilerplate Setup section)
- [ ] Rewrite README.md with tidn project description, setup, and env vars
- [ ] Update package.json name to `tidn`

---

## Open Questions

| Question                                                                                                      | Status |
| ------------------------------------------------------------------------------------------------------------- | ------ |
| Video processing runtime: Lambda vs in-process vs external service? Vercel serverless has 10s/50MB limits.    | Open   |
| Should EXIF date extraction happen client-side (faster, no server processing) or server-side (more reliable)? | Open   |
| Max video duration limit? Unlimited could mean multi-GB files.                                                | Open   |
| Should deleting a timeline require confirmation + typing the name (destructive action)?                       | Open   |
| Timeline sort order preference — newest-first or oldest-first as default?                                     | Open   |

---

## Appendix

### Glossary

- **Timeline**: A named chronological collection of events, owned by one user, optionally shared with others.
- **Event**: A single entry in a timeline, tied to a specific date. Contains optional text comment and optional media attachments.
- **Media**: A photo or video file attached to an event, stored in S3.
- **Member**: A user with access to a timeline they don't own, with either editor or viewer permissions.
- **Thumbnail**: A smaller version of a photo, or an extracted frame from a video, generated asynchronously after upload.

### References

- `specs/DATA_ACCESS_PATTERNS.md` — Upload/download patterns
- `specs/SERVER_ACTION_PATTERNS.md` — Action structure
- `specs/PAGE_PATTERNS.md` — Page component patterns
- `components/ui/AGENTS.md` — Available UI components
