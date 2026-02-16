# PRD: Home Improvement Project Tracker

**Date:** 2026-01-31
**Updated:** Technical Context, Data Model, Server Actions aligned with repo specs

---

## Problem Statement

### What problem are we solving?

Tracking home improvement projects across spreadsheets is fragmented and error-prone. Key pain points:

1. **Status tracking is difficult** - Spreadsheets don't surface current project state at a glance
2. **Cost tracking is scattered** - Estimated vs actual spend per item is tedious to maintain
3. **Contacts get lost** - Contractor info (plumber, electrician, etc.) isn't linked to relevant projects
4. **Coordination is hard** - Partners can't easily see what's happening or what's been done
5. **Documents disappear** - Receipts, warranties, permits, contracts are stored inconsistently

### Why now?

Active home improvement projects need a centralized system. The longer this is deferred, the more historical data is lost and the harder coordination becomes.

### Who is affected?

- **Primary users:** Homeowners/renters managing renovation and maintenance projects
- **Secondary users:** Partners/family members invited to collaborate on a shared property

---

## Proposed Solution

### Overview

Byggabo is a home improvement project tracker centered around properties (houses/apartments). Users create a property, invite collaborators, and track projects with estimated/actual costs, timelines, document uploads, contractor contacts, and activity logs.

### User Experience

#### User Flow: Onboarding

1. User signs up via email OTP
2. User redirected to `/onboarding` (no properties yet)
3. User creates first property (name, address, currency, optional photo)
4. Slug auto-generated from name, stored in localStorage
5. User redirected to `/` dashboard showing empty project list

#### User Flow: Create Project

1. User clicks "New Project" on property dashboard
2. User enters: name, description, estimated cost, estimated time
3. Project appears in list with "Idea" status

#### User Flow: Track Project Progress

1. User opens project detail view
2. User adds cost items (e.g., "Kitchen tiles", estimated: 5000kr)
3. User updates item with actual cost when purchased (actual: 4800kr)
4. User changes project status (idea -> planning -> in-progress -> done)
5. Dashboard shows aggregated estimated vs actual spend

#### User Flow: Add Log Entry

1. User opens project
2. User adds log entry with plain text note + date
3. Entry shows who created it and when
4. Log displays as timeline on project page

#### User Flow: Upload Document

1. User clicks "Upload" on project
2. User selects file (receipt, warranty, contract, photo, permit)
3. File uploads to S3, appears in project document list
4. User can view/download document later

#### User Flow: Manage Contacts

1. User adds contact (company, name, phone, email, notes)
2. User links contact to one or more projects
3. When viewing project, linked contacts are visible

#### User Flow: Manage Quotes

1. User receives quote from contractor (PDF, email, etc.)
2. User creates quote on project: description, value, expiry date
3. User uploads quote file (PDF/image)
4. User can add comments to quote (negotiation notes, clarifications)
5. When quote accepted and paid, user links quote to invoice
6. Project shows quotes with status (pending, accepted, expired, rejected)

#### User Flow: Invite Collaborator

1. Property owner opens settings dropdown → Settings page
2. In "Members" section, owner enters partner's email
3. Partner receives invite email with link
4. Partner signs up/logs in, invite auto-accepted
5. Property added to partner's account, slug stored in their localStorage
6. Partner sees property dashboard

#### User Flow: Switch Property

1. User opens settings dropdown (top-right)
2. User sees current property name with dropdown
3. User selects different property or "Add property"
4. If switching: localStorage updated, page reloads with new property context
5. If adding: redirect to `/onboarding` flow (reused for additional properties)

### Design Considerations

Visual style inspired by [kostnad.app](https://kostnad.app/):

**Layout & Structure:**

- Clean, minimal interface with generous whitespace
- Sticky header with logo left, nav/actions right
- Content max-width ~1152px (`max-w-6xl`), centered
- Cards with subtle borders, rounded corners (`rounded-xl`), light shadows

**Typography:**

- Inter font family (already in project)
- Bold headings with tight tracking (`font-bold tracking-tight`)
- Muted secondary text (`text-muted-foreground`)
- Size hierarchy: headings 2xl-5xl, body base-lg

**Colors:**

- Light/dark mode support via CSS variables
- Background with slight transparency and backdrop blur on header
- Accent colors for status: green (done/income), red (overdue/expenses), neutral for in-progress
- Subtle borders (`border-border`)

**Components:**

- Cards: `rounded-xl border bg-card p-4 shadow-sm`
- Buttons: Small, rounded, subtle hover states
- Charts/data viz: Simple, clean with muted grid lines (future enhancement)

**Interactions:**

- Smooth transitions (`transition-all`)
- Hover states on interactive elements
- Focus rings for accessibility (`focus-visible:ring-[3px]`)

**Mobile:**

- Responsive grid (`grid gap-6 lg:grid-cols-2`)
- Hamburger menu on mobile (`sm:hidden`)
- Adjusted padding/sizing for smaller screens

---

## End State

When this PRD is complete, the following will be true:

- [ ] Users can create and manage properties (houses/apartments) with auto-generated slugs
- [ ] Property selection persisted in localStorage, synced to cookie for SSR
- [ ] Property switcher hidden in settings dropdown (not prominent in UI)
- [ ] Clean URLs without property ID (`/`, `/projects/[id]`, `/contacts`, `/settings`)
- [ ] Users can invite others to their property (shared access, equal permissions)
- [ ] Users can create projects with name, description, status, estimated cost/time
- [ ] Projects have line items with estimated and actual costs
- [ ] Users can upload documents (receipts, warranties, photos, permits, contracts) to projects
- [ ] Users can add plain-text log entries to projects with timestamps
- [ ] Users can manage contacts and link them to projects
- [ ] Dashboard shows aggregated cost tracking (estimated vs actual)
- [ ] All data is scoped per-property; users only see properties they own or are invited to
- [ ] Tests cover core functionality
- [ ] Observability spans track key operations

---

## Success Metrics

### Quantitative

| Metric                    | Current | Target                | Measurement Method |
| ------------------------- | ------- | --------------------- | ------------------ |
| Projects created per user | 0       | 3+ within first month | DB query           |
| Documents uploaded        | 0       | 5+ per project        | DB query           |
| Partner invites sent      | 0       | 1+ per property       | DB query           |

### Qualitative

- Users can answer "how much have we spent?" instantly
- Users never lose a receipt or warranty
- Partners stay coordinated without verbal sync

---

## Acceptance Criteria

### Property Management

- [ ] User can create a property with name, currency, optional address/photo
- [ ] Slug auto-generated from name (URL-safe, unique per user)
- [ ] User can edit property details including slug (in settings)
- [ ] User can delete a property (cascades to all projects, docs, contacts)
- [ ] Property photo uploads to S3
- [ ] Active property slug stored in localStorage + synced to cookie
- [ ] Property switcher in settings dropdown lists all user's properties
- [ ] "Add property" option in switcher redirects to `/onboarding`

### Property Invitations

- [ ] Owner can invite user by email
- [ ] Invited user sees property after accepting (signing up/logging in)
- [ ] Invited users have full read/write access (no permission tiers)
- [ ] Owner can remove invited users
- [ ] Invited user can leave a property

### Projects

- [ ] User can create project with: name, description, status, estimated cost, estimated time
- [ ] User can edit project details
- [ ] User can delete project (cascades to items, logs, docs, contact links)
- [ ] Status options: Idea, Planning, In Progress, Done, On Hold
- [ ] Project list shows: name, status, estimated/actual cost summary

### Cost Tracking

Project costs are aggregated from two sources:

1. **Cost Items** - Simple line items (materials, misc purchases)
2. **Quotes/Invoices** - Contractor work with formal quotes and invoices

**Estimated cost** = sum of cost item estimates + sum of accepted quote values
**Actual cost** = sum of cost item actuals + sum of paid invoice amounts

### Cost Items

- [ ] User can add items to project: name, estimated cost
- [ ] User can update item with actual cost (when purchased/completed)
- [ ] User can delete items

### Log Entries

- [ ] User can add log entry with plain text content
- [ ] Log entry records: created by (user), created at (timestamp)
- [ ] Logs display in reverse chronological order
- [ ] User can edit their own log entries
- [ ] User can delete their own log entries

### Documents

- [ ] User can upload documents to a project
- [ ] Supported types: images, PDFs, common document formats
- [ ] Documents stored in S3 with signed URLs
- [ ] User can view document list with names and upload dates
- [ ] User can download documents
- [ ] User can delete documents

### Contacts

- [ ] User can create contact: company name, person name, phone, email, notes
- [ ] Contacts are scoped to property (not project)
- [ ] User can link contact to multiple projects
- [ ] Project detail shows linked contacts
- [ ] User can edit/delete contacts
- [ ] Deleting contact removes links but not projects

### Quotes

Quotes represent formal estimates from contractors. **Accepted quotes contribute to project estimated cost.**

- [ ] User can create quote on project: description, value, expiry date
- [ ] User can optionally link quote to a contact (who provided it)
- [ ] User can upload files to quote (PDF, images)
- [ ] User can add comments to quote (negotiation notes, Q&A)
- [ ] Quote status: pending, accepted, rejected, expired
- [ ] User can change quote status
- [ ] **Accepted quotes add their value to project estimated cost**
- [ ] Expired quotes auto-marked (or visual indicator) based on expiresAt
- [ ] User can edit/delete quotes
- [ ] User can delete quote files and comments
- [ ] Project detail shows quotes list with status, value, expiry

### Invoices

Invoices represent actual payments. **Paid invoices contribute to project actual cost.**

- [ ] User can create invoice on project: description, amount
- [ ] User can optionally link invoice to a quote (shows quote → invoice flow)
- [ ] User can optionally link invoice to a contact
- [ ] User can upload invoice files (PDF, images)
- [ ] User can mark invoice as paid (sets paidAt timestamp)
- [ ] **Paid invoices add their amount to project actual cost**
- [ ] User can edit/delete invoices
- [ ] Project detail shows invoices with paid/unpaid status
- [ ] Dashboard shows total paid vs unpaid across project

### Dashboard

- [ ] Property dashboard at `/` shows: project count, total estimated cost, total actual cost
- [ ] Estimated cost = cost item estimates + accepted quote values
- [ ] Actual cost = cost item actuals + paid invoice amounts
- [ ] Project list sortable/filterable by status
- [ ] Quick view of recent activity across projects
- [ ] Redirects to `/onboarding` if user has no properties
- [ ] Redirects to `/onboarding` if stored slug doesn't match any user property

### Settings Page

- [ ] Single `/settings` page with sections: Account, Property, Members
- [ ] Account section: email display, logout
- [ ] Property section: edit name, slug, address, photo, currency, delete property
- [ ] Members section: list members, invite by email, remove members
- [ ] Property switcher dropdown in header settings menu

---

## Technical Context

### Existing Patterns

- **Server actions:** `lib/core/post/delete-post-action.ts` - One action per file, named `{verb}-{entity}-action.ts`
- **S3 uploads:** `lib/core/file/get-upload-url-action.ts` - Signed URL pattern (client uploads directly to S3)
- **Session guards:** `lib/services/auth/get-session.ts` - Auth check in actions/pages
- **Error types:** `lib/core/errors/index.ts` - `Data.TaggedError` pattern (not Schema.TaggedError)
- **Domain queries:** `lib/core/[domain]/queries.ts` - Read-only queries (not actions)
- **Page pattern:** `Suspense + Content` with `export const dynamic = 'force-dynamic'`
- **URL state:** nuqs with `search-params.ts` per route (import parsers from `nuqs/server`)

### Key Files

- `lib/services/db/schema.ts` - Add new entities and `defineRelations()` here
- `lib/layers.ts` - AppLayer composition (merges all service layers)
- `lib/core/errors/index.ts` - Shared domain errors (`NotFoundError`, `ValidationError`, etc.)
- `app/(dashboard)/` - Add project/contact/settings pages here
- `app/(onboarding)/` - New route group for `/onboarding` page
- `specs/SERVER_ACTION_PATTERNS.md` - Complete action template with validation
- `specs/PAGE_PATTERNS.md` - Suspense + Content pattern for dynamic pages
- `specs/DRIZZLE_PATTERNS.md` - Database query patterns with Effect

### Property Selection Pattern

**Storage:**

- `localStorage.getItem('activePropertySlug')` - Client-side source of truth
- `document.cookie` includes `activePropertySlug` - Synced for SSR access

**Sync Flow:**

1. Client component on mount reads localStorage, sets cookie if mismatched
2. Server reads cookie via `cookies()` from `next/headers`
3. Server validates slug belongs to user, returns property or redirects to `/onboarding`

**Helper Functions:**

```
lib/core/property/
- get-active-property.ts      # Server: read cookie, validate, return property
- use-active-property.ts      # Client hook: localStorage + cookie sync
- set-active-property.ts      # Client: update localStorage + cookie
```

**Slug Generation:**

- Auto-generate from name: `slugify(name)` → lowercase, replace spaces with `-`, remove special chars
- Ensure unique per user: append `-2`, `-3` etc. if collision
- User can customize in settings (validated for uniqueness)

### System Dependencies

- PostgreSQL (Neon) - existing
- S3 - existing, for document uploads
- better-auth with OTP - existing, for user auth
- Resend - existing, for invite emails

### Data Model Changes

New entities required. Uses Drizzle v1.0 patterns with `pgTable`, `defineRelations`, and `$defaultFn(() => createId())` for CUID2 IDs.

**Tables:**

```typescript
// lib/services/db/schema.ts

export const property = pgTable('property', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  name: text('name').notNull(),
  slug: text('slug').notNull(), // unique per user, URL-safe, auto-generated
  address: text('address'),
  imageUrl: text('imageUrl'),
  currency: text('currency').notNull().default('SEK'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date())
});

export const propertyMember = pgTable(
  'property_member',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    propertyId: text('propertyId')
      .notNull()
      .references(() => property.id, { onDelete: 'cascade' }),
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['owner', 'member'] }).notNull(),
    createdAt: timestamp('createdAt').notNull().defaultNow()
  },
  t => [unique('property_member_unique').on(t.propertyId, t.userId)]
);

export const propertyInvite = pgTable('property_invite', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  propertyId: text('propertyId')
    .notNull()
    .references(() => property.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  invitedBy: text('invitedBy')
    .notNull()
    .references(() => user.id),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  expiresAt: timestamp('expiresAt').notNull()
});

export const project = pgTable(
  'project',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    propertyId: text('propertyId')
      .notNull()
      .references(() => property.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    status: text('status', { enum: ['idea', 'planning', 'in_progress', 'done', 'on_hold'] })
      .notNull()
      .default('idea'),
    estimatedCost: decimal('estimatedCost', { precision: 12, scale: 2 }),
    estimatedTime: text('estimatedTime'), // free-form like "2 weeks"
    createdAt: timestamp('createdAt').notNull().defaultNow(),
    updatedAt: timestamp('updatedAt')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date())
  },
  t => [index('project_property_idx').on(t.propertyId)]
);

export const costItem = pgTable('cost_item', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  projectId: text('projectId')
    .notNull()
    .references(() => project.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  estimatedCost: decimal('estimatedCost', { precision: 12, scale: 2 }),
  actualCost: decimal('actualCost', { precision: 12, scale: 2 }),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date())
});

export const logEntry = pgTable('log_entry', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  projectId: text('projectId')
    .notNull()
    .references(() => project.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  createdBy: text('createdBy')
    .notNull()
    .references(() => user.id),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date())
});

export const document = pgTable('document', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  projectId: text('projectId')
    .notNull()
    .references(() => project.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  url: text('url').notNull(),
  key: text('key').notNull(),
  mimeType: text('mimeType').notNull(),
  size: integer('size').notNull(),
  uploadedBy: text('uploadedBy')
    .notNull()
    .references(() => user.id),
  createdAt: timestamp('createdAt').notNull().defaultNow()
});

export const contact = pgTable('contact', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  propertyId: text('propertyId')
    .notNull()
    .references(() => property.id, { onDelete: 'cascade' }),
  companyName: text('companyName'),
  personName: text('personName'),
  phone: text('phone'),
  email: text('email'),
  notes: text('notes'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date())
});

export const projectContact = pgTable(
  'project_contact',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    projectId: text('projectId')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    contactId: text('contactId')
      .notNull()
      .references(() => contact.id, { onDelete: 'cascade' }),
    createdAt: timestamp('createdAt').notNull().defaultNow()
  },
  t => [unique('project_contact_unique').on(t.projectId, t.contactId)]
);

export const quote = pgTable('quote', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  projectId: text('projectId')
    .notNull()
    .references(() => project.id, { onDelete: 'cascade' }),
  contactId: text('contactId').references(() => contact.id),
  description: text('description').notNull(),
  value: decimal('value', { precision: 12, scale: 2 }).notNull(),
  expiresAt: timestamp('expiresAt'),
  status: text('status', { enum: ['pending', 'accepted', 'rejected', 'expired'] })
    .notNull()
    .default('pending'),
  createdBy: text('createdBy')
    .notNull()
    .references(() => user.id),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date())
});

export const quoteFile = pgTable('quote_file', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  quoteId: text('quoteId')
    .notNull()
    .references(() => quote.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  url: text('url').notNull(),
  key: text('key').notNull(),
  mimeType: text('mimeType').notNull(),
  size: integer('size').notNull(),
  uploadedBy: text('uploadedBy')
    .notNull()
    .references(() => user.id),
  createdAt: timestamp('createdAt').notNull().defaultNow()
});

export const quoteComment = pgTable('quote_comment', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  quoteId: text('quoteId')
    .notNull()
    .references(() => quote.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  createdBy: text('createdBy')
    .notNull()
    .references(() => user.id),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date())
});

export const invoice = pgTable('invoice', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  projectId: text('projectId')
    .notNull()
    .references(() => project.id, { onDelete: 'cascade' }),
  quoteId: text('quoteId').references(() => quote.id),
  contactId: text('contactId').references(() => contact.id),
  description: text('description').notNull(),
  amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
  paidAt: timestamp('paidAt'),
  createdBy: text('createdBy')
    .notNull()
    .references(() => user.id),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date())
});

export const invoiceFile = pgTable('invoice_file', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  invoiceId: text('invoiceId')
    .notNull()
    .references(() => invoice.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  url: text('url').notNull(),
  key: text('key').notNull(),
  mimeType: text('mimeType').notNull(),
  size: integer('size').notNull(),
  uploadedBy: text('uploadedBy')
    .notNull()
    .references(() => user.id),
  createdAt: timestamp('createdAt').notNull().defaultNow()
});

// Type exports
export type Property = typeof property.$inferSelect;
export type InsertProperty = typeof property.$inferInsert;
export type Project = typeof project.$inferSelect;
export type InsertProject = typeof project.$inferInsert;
// ... etc for all tables
```

**Relations (Drizzle v1.0 RQB v2 API):**

```typescript
export const relations = defineRelations(
  {
    user,
    property,
    propertyMember,
    propertyInvite,
    project,
    costItem,
    logEntry,
    document,
    contact,
    projectContact,
    quote,
    quoteFile,
    quoteComment,
    invoice,
    invoiceFile
  },
  r => ({
    property: {
      members: r.many.propertyMember({ from: r.property.id, to: r.propertyMember.propertyId }),
      invites: r.many.propertyInvite({ from: r.property.id, to: r.propertyInvite.propertyId }),
      projects: r.many.project({ from: r.property.id, to: r.project.propertyId }),
      contacts: r.many.contact({ from: r.property.id, to: r.contact.propertyId })
    },
    propertyMember: {
      property: r.one.property({
        from: r.propertyMember.propertyId,
        to: r.property.id,
        optional: false
      }),
      user: r.one.user({ from: r.propertyMember.userId, to: r.user.id, optional: false })
    },
    project: {
      property: r.one.property({ from: r.project.propertyId, to: r.property.id, optional: false }),
      costItems: r.many.costItem({ from: r.project.id, to: r.costItem.projectId }),
      logEntries: r.many.logEntry({ from: r.project.id, to: r.logEntry.projectId }),
      documents: r.many.document({ from: r.project.id, to: r.document.projectId }),
      projectContacts: r.many.projectContact({
        from: r.project.id,
        to: r.projectContact.projectId
      }),
      quotes: r.many.quote({ from: r.project.id, to: r.quote.projectId }),
      invoices: r.many.invoice({ from: r.project.id, to: r.invoice.projectId })
    },
    quote: {
      project: r.one.project({ from: r.quote.projectId, to: r.project.id, optional: false }),
      contact: r.one.contact({ from: r.quote.contactId, to: r.contact.id, optional: true }),
      createdByUser: r.one.user({ from: r.quote.createdBy, to: r.user.id, optional: false }),
      files: r.many.quoteFile({ from: r.quote.id, to: r.quoteFile.quoteId }),
      comments: r.many.quoteComment({ from: r.quote.id, to: r.quoteComment.quoteId }),
      invoices: r.many.invoice({ from: r.quote.id, to: r.invoice.quoteId })
    },
    invoice: {
      project: r.one.project({ from: r.invoice.projectId, to: r.project.id, optional: false }),
      quote: r.one.quote({ from: r.invoice.quoteId, to: r.quote.id, optional: true }),
      contact: r.one.contact({ from: r.invoice.contactId, to: r.contact.id, optional: true }),
      createdByUser: r.one.user({ from: r.invoice.createdBy, to: r.user.id, optional: false }),
      files: r.many.invoiceFile({ from: r.invoice.id, to: r.invoiceFile.invoiceId })
    },
    contact: {
      property: r.one.property({ from: r.contact.propertyId, to: r.property.id, optional: false }),
      projectContacts: r.many.projectContact({ from: r.contact.id, to: r.projectContact.contactId })
    }
  })
);
```

**Notes:**

- `decimal` columns return `string` at runtime - parse to number when needed
- Use `{ onDelete: 'cascade' }` for proper cascade behavior
- Unique constraints defined in third argument of `pgTable`
- Relations use `optional: false` for required FKs, `optional: true` for nullable FKs

---

## Risks & Mitigations

| Risk                                         | Likelihood | Impact | Mitigation                                                       |
| -------------------------------------------- | ---------- | ------ | ---------------------------------------------------------------- |
| Data isolation bugs (user sees other's data) | Med        | High   | All queries filter by property membership; add integration tests |
| S3 upload failures                           | Low        | Med    | Existing pattern is proven; add retry logic in UI                |
| Invite email delivery issues                 | Low        | Med    | Resend is reliable; show pending invites in UI for re-send       |

---

## Alternatives Considered

### Alternative 1: Project-level permissions (viewer/editor roles)

- **Description:** Different permission levels for invited users
- **Pros:** More control over who can edit
- **Cons:** Adds complexity; not needed for partner/family use case
- **Decision:** Rejected. All members have equal access. Can add later if needed.

### Alternative 2: Global contact list (not per-property)

- **Description:** Contacts shared across all user's properties
- **Pros:** Reuse contacts across properties
- **Cons:** Complicates data isolation; contacts may not apply across properties
- **Decision:** Rejected. Contacts scoped to property. Can add "copy contact" later.

### Alternative 3: Nested projects (sub-tasks)

- **Description:** Projects can contain sub-projects
- **Pros:** Better organization for large renovations
- **Cons:** Adds significant complexity
- **Decision:** Deferred to v2. Flat projects with cost items provides enough structure.

---

## Non-Goals (v1)

Explicitly out of scope:

- **Property-centric navigation** - No `/properties/[id]` URLs; property selection via localStorage + settings dropdown
- **Timeline/Gantt view** - List view is sufficient for v1
- **Budget categories** - Just total estimated/actual per project
- **Notifications** - No push/email notifications for activity
- **Mobile app** - Web-responsive only
- **Offline support** - Requires internet connection
- **Project templates** - Create from scratch each time
- **Multi-currency per property** - One currency per property is sufficient
- **Document OCR/parsing** - Just file storage, no data extraction
- **Contractor ratings/reviews** - Just contact info

---

## Interface Specifications

### Pages

| Route                   | Description                                                       |
| ----------------------- | ----------------------------------------------------------------- |
| `/`                     | Landing page (logged out) or dashboard (logged in, has property)  |
| `/onboarding`           | First-time property creation for new users                        |
| `/projects/new`         | Create new project                                                |
| `/projects/[projectId]` | Project detail with items, logs, docs, contacts, quotes, invoices |
| `/contacts`             | Property contacts list                                            |
| `/contacts/new`         | Create new contact                                                |
| `/settings`             | All settings: account, property details, members/invites, switch  |

**Property Selection:**

- Active property stored in `localStorage` as `activePropertySlug`
- Cookie synced for SSR access (`activePropertySlug` cookie)
- Property switcher hidden in settings dropdown (top-right header)
- Switcher includes "Add property" option
- `/onboarding` shown when user has no properties

### Server Actions & Queries (by domain)

**Pattern:** Actions mutate data (`*-action.ts`), queries read data (`queries.ts`). One action per file.

```
lib/core/property/
├── queries.ts                      # get-property, get-properties-for-user
├── create-property-action.ts
├── update-property-action.ts
├── delete-property-action.ts
└── generate-slug.ts                # pure function, not action

lib/core/property-member/
├── queries.ts                      # get-members, check-membership
├── invite-member-action.ts
├── remove-member-action.ts
├── leave-property-action.ts
└── accept-invite-action.ts         # also triggers client redirect to set localStorage

lib/core/project/
├── queries.ts                      # get-project, get-projects, get-project-summary
├── create-project-action.ts
├── update-project-action.ts
├── delete-project-action.ts
└── update-project-status-action.ts

lib/core/cost-item/
├── queries.ts                      # get-cost-items
├── create-cost-item-action.ts
├── update-cost-item-action.ts
└── delete-cost-item-action.ts

lib/core/log-entry/
├── queries.ts                      # get-log-entries
├── create-log-entry-action.ts
├── update-log-entry-action.ts
└── delete-log-entry-action.ts

lib/core/document/
├── queries.ts                      # get-documents
├── get-upload-url-action.ts        # returns signed URL for S3 upload
├── save-document-action.ts         # saves document reference after S3 upload
└── delete-document-action.ts

lib/core/contact/
├── queries.ts                      # get-contacts, get-contact
├── create-contact-action.ts
├── update-contact-action.ts
├── delete-contact-action.ts
├── link-contact-to-project-action.ts
└── unlink-contact-from-project-action.ts

lib/core/quote/
├── queries.ts                      # get-quotes, get-quote-with-details
├── create-quote-action.ts
├── update-quote-action.ts
├── delete-quote-action.ts
├── update-quote-status-action.ts
├── create-quote-comment-action.ts  # renamed from add-* to create-*
├── delete-quote-comment-action.ts
├── get-quote-upload-url-action.ts  # returns signed URL for quote file
├── save-quote-file-action.ts       # saves file reference after S3 upload
└── delete-quote-file-action.ts

lib/core/invoice/
├── queries.ts                      # get-invoices, get-invoice-with-details
├── create-invoice-action.ts
├── update-invoice-action.ts
├── delete-invoice-action.ts
├── mark-invoice-paid-action.ts
├── get-invoice-upload-url-action.ts # returns signed URL for invoice file
├── save-invoice-file-action.ts      # saves file reference after S3 upload
└── delete-invoice-file-action.ts

lib/core/errors/
└── index.ts                        # shared domain errors (NotFoundError, ValidationError, etc.)
```

**Query pattern example:**

```typescript
// lib/core/project/queries.ts
import { Effect } from 'effect';
import { Db } from '@/lib/services/db/live-layer';
import * as schema from '@/lib/services/db/schema';
import { eq, desc } from 'drizzle-orm';

export const getProjects = (propertyId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    return yield* db
      .select()
      .from(schema.project)
      .where(eq(schema.project.propertyId, propertyId))
      .orderBy(desc(schema.project.createdAt));
  }).pipe(Effect.withSpan('Project.getAll'));
```

**Action pattern:** See `specs/SERVER_ACTION_PATTERNS.md` for complete template with validation, auth, error handling.

---

## Documentation Requirements

- [ ] User-facing: None required for v1 (self-explanatory UI)
- [ ] API: Server actions are internal, no external API docs needed
- [ ] Internal: AGENTS.md update with new domain structure

---

## Open Questions

| Question                                               | Owner   | Due Date              | Status                      |
| ------------------------------------------------------ | ------- | --------------------- | --------------------------- |
| Currency handling - store as integer cents or decimal? | Dev     | Before implementation | Resolved: decimal           |
| Rich text editor choice (Tiptap, Slate, other)?        | Dev     | Before log entry impl | Resolved: plain text for v1 |
| Invite expiration period (24h, 7d, never)?             | Product | Before invite impl    | Resolved: 24h               |

---

## Appendix

### Glossary

- **Property:** A house, apartment, or other dwelling being tracked
- **Project:** A discrete home improvement task (e.g., "Kitchen Renovation", "Fix Leaky Faucet")
- **Cost Item:** A line item within a project with estimated and actual cost
- **Log Entry:** A timestamped note recording what happened on a project
- **Contact:** A contractor, service provider, or other person related to property work

### References

- Existing patterns: `lib/core/post/` (server actions), `lib/core/file/` (S3 uploads)
- Auth: `lib/services/auth/` (better-auth with OTP)
- Specs: `specs/DATA_ACCESS_PATTERNS.md`, `specs/PAGE_PATTERNS.md`
