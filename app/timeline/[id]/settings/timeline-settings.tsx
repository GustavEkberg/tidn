'use client';

import { useCallback, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowLeft, Loader2, Mail, Trash2, UserMinus, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Field, FieldLabel } from '@/components/ui/field';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogCloseButton
} from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { updateTimelineAction } from '@/lib/core/timeline/update-timeline-action';
import { inviteMemberAction } from '@/lib/core/timeline/invite-member-action';
import { updateMemberRoleAction } from '@/lib/core/timeline/update-member-role-action';
import { removeMemberAction } from '@/lib/core/timeline/remove-member-action';
import { deleteTimelineAction } from '@/lib/core/timeline/delete-timeline-action';

// ============================================================
// TYPES (local, matching serialized shapes from server)
// ============================================================

type TimelineRole = 'owner' | 'editor' | 'viewer';
type MemberRole = 'editor' | 'viewer';

type TimelineData = {
  id: string;
  name: string;
  description: string | null;
};

type MemberData = {
  id: string;
  email: string;
  role: string;
  userId: string | null;
  userName: string | null;
  invitedAt: string;
  joinedAt: string | null;
};

// Module-level constants for member roles
const MEMBER_ROLE_VALUES = ['editor', 'viewer'] as const;
const MEMBER_ROLES: ReadonlySet<string> = new Set(MEMBER_ROLE_VALUES);

function isMemberRole(value: string): value is MemberRole {
  return MEMBER_ROLES.has(value);
}

const ROLE_OPTIONS: ReadonlyArray<{ value: MemberRole; label: string }> = [
  { value: 'viewer', label: 'Viewer' },
  { value: 'editor', label: 'Editor' }
];

type Props = {
  timeline: TimelineData;
  members: Array<MemberData>;
  isOwner: boolean;
  role: TimelineRole;
};

// ============================================================
// ROLE BADGE
// ============================================================

const ROLE_BADGE_VARIANT: Record<string, 'default' | 'secondary' | 'outline'> = {
  owner: 'default',
  editor: 'secondary',
  viewer: 'outline'
};

function RoleBadge({ role }: { role: string }) {
  return <Badge variant={ROLE_BADGE_VARIANT[role] ?? 'outline'}>{role}</Badge>;
}

// ============================================================
// TIMELINE INFO SECTION (owner: editable, non-owner: read-only)
// ============================================================

function TimelineInfoSection({ timeline, isOwner }: { timeline: TimelineData; isOwner: boolean }) {
  const [name, setName] = useState(timeline.name);
  const [description, setDescription] = useState(timeline.description ?? '');
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const hasChanges = name !== timeline.name || description !== (timeline.description ?? '');

  const handleSave = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      setFormError(null);

      const trimmedName = name.trim();
      if (!trimmedName) {
        setFormError('Name is required');
        return;
      }

      startTransition(async () => {
        const result = await updateTimelineAction({
          id: timeline.id,
          name: trimmedName,
          description: description.trim() || null
        });

        if (result._tag === 'Error') {
          setFormError(result.message);
          return;
        }

        toast.success('Timeline updated');
      });
    },
    [name, description, timeline.id]
  );

  if (!isOwner) {
    return (
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Timeline details</h2>
        <div className="space-y-2">
          <div>
            <p className="text-muted-foreground text-sm">Name</p>
            <p className="text-sm font-medium">{timeline.name}</p>
          </div>
          {timeline.description && (
            <div>
              <p className="text-muted-foreground text-sm">Description</p>
              <p className="text-sm">{timeline.description}</p>
            </div>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">Timeline details</h2>
      <form onSubmit={handleSave} className="space-y-4">
        <Field>
          <FieldLabel>Name</FieldLabel>
          <Input
            value={name}
            onChange={e => setName(e.target.value)}
            maxLength={100}
            disabled={isPending}
            placeholder="Timeline name"
          />
        </Field>

        <Field>
          <FieldLabel>Description</FieldLabel>
          <Textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            maxLength={500}
            disabled={isPending}
            placeholder="Optional description"
            rows={3}
          />
        </Field>

        {formError && <p className="text-sm text-red-500">{formError}</p>}

        <Button type="submit" disabled={isPending || !hasChanges || !name.trim()}>
          {isPending ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Saving...
            </>
          ) : (
            'Save changes'
          )}
        </Button>
      </form>
    </section>
  );
}

// ============================================================
// INVITE MEMBER DIALOG (owner only)
// ============================================================

function InviteMemberDialog({ timelineId }: { timelineId: string }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<MemberRole>('viewer');
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const reset = useCallback(() => {
    setEmail('');
    setRole('viewer');
    setFormError(null);
  }, []);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      setFormError(null);

      const trimmedEmail = email.trim().toLowerCase();
      if (!trimmedEmail) {
        setFormError('Email is required');
        return;
      }

      startTransition(async () => {
        const result = await inviteMemberAction({
          timelineId,
          email: trimmedEmail,
          role
        });

        if (result._tag === 'Error') {
          setFormError(result.message);
          return;
        }

        toast.success(`Invited ${trimmedEmail} as ${role}`);
        setOpen(false);
        reset();
      });
    },
    [email, role, timelineId, reset]
  );

  return (
    <Dialog
      open={open}
      onOpenChange={isOpen => {
        if (!isOpen && isPending) return;
        setOpen(isOpen);
        if (!isOpen) reset();
      }}
    >
      <DialogTrigger
        render={
          <Button size="sm">
            <UserPlus data-icon="inline-start" className="size-4" />
            Invite
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite member</DialogTitle>
          <DialogDescription>Invite someone to collaborate on this timeline.</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Field>
            <FieldLabel>Email</FieldLabel>
            <Input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="name@example.com"
              disabled={isPending}
              maxLength={320}
            />
          </Field>

          <Field>
            <FieldLabel>Role</FieldLabel>
            <Select
              value={role}
              onValueChange={val => {
                if (val !== null && isMemberRole(val)) {
                  setRole(val);
                }
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLE_OPTIONS.map(opt => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {formError && <p className="text-sm text-red-500">{formError}</p>}

          <DialogFooter>
            <DialogCloseButton disabled={isPending}>Cancel</DialogCloseButton>
            <Button type="submit" disabled={isPending || !email.trim()}>
              {isPending ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Inviting...
                </>
              ) : (
                'Send invite'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// MEMBER ROW
// ============================================================

function MemberRow({ member, isOwner }: { member: MemberData; isOwner: boolean }) {
  const [currentRole, setCurrentRole] = useState(member.role);
  const [isUpdating, startUpdateTransition] = useTransition();

  const isPending = !member.joinedAt;
  const displayName = member.userName ?? member.email;

  const handleRoleChange = useCallback(
    (newRole: string | null) => {
      if (newRole === null || !isMemberRole(newRole) || newRole === currentRole) return;

      startUpdateTransition(async () => {
        const result = await updateMemberRoleAction({
          memberId: member.id,
          role: newRole
        });

        if (result._tag === 'Error') {
          toast.error(result.message);
          return;
        }

        setCurrentRole(newRole);
        toast.success(`Updated ${member.email} to ${newRole}`);
      });
    },
    [member.id, member.email, currentRole]
  );

  const handleRemove = useCallback(async () => {
    const result = await removeMemberAction({ memberId: member.id });

    if (result._tag === 'Error') {
      toast.error(result.message);
      return;
    }

    toast.success(`Removed ${member.email}`);
  }, [member.id, member.email]);

  return (
    <div className="flex items-center gap-3 py-3">
      {/* Avatar / Icon */}
      <div className="bg-muted flex size-9 shrink-0 items-center justify-center rounded-full">
        {isPending ? (
          <Mail className="text-muted-foreground size-4" />
        ) : (
          <span className="text-sm font-medium">{displayName.charAt(0).toUpperCase()}</span>
        )}
      </div>

      {/* Info + role controls — stacks on narrow screens */}
      <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium">{displayName}</p>
            {isPending && (
              <Badge variant="outline" className="text-muted-foreground shrink-0 text-[10px]">
                pending
              </Badge>
            )}
          </div>
          {member.userName && (
            <p className="text-muted-foreground truncate text-xs">{member.email}</p>
          )}
        </div>

        {/* Role control */}
        {isOwner ? (
          <div className="flex shrink-0 items-center gap-2">
            <Select value={currentRole} onValueChange={handleRoleChange} disabled={isUpdating}>
              <SelectTrigger size="sm" className="w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="editor">Editor</SelectItem>
                <SelectItem value="viewer">Viewer</SelectItem>
              </SelectContent>
            </Select>

            <ConfirmDialog
              title="Remove member"
              description={`Remove ${member.email} from this timeline? They will lose access immediately.`}
              actionLabel="Remove"
              onConfirm={handleRemove}
              trigger={
                <button
                  type="button"
                  className="text-muted-foreground hover:text-destructive rounded-md p-1.5 transition-colors"
                >
                  <UserMinus className="size-4" />
                </button>
              }
            />
          </div>
        ) : (
          <RoleBadge role={currentRole} />
        )}
      </div>
    </div>
  );
}

// ============================================================
// MEMBERS SECTION
// ============================================================

function MembersSection({
  members,
  timelineId,
  isOwner
}: {
  members: Array<MemberData>;
  timelineId: string;
  isOwner: boolean;
}) {
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Members</h2>
        {isOwner && <InviteMemberDialog timelineId={timelineId} />}
      </div>

      {members.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No members yet.{isOwner ? ' Invite someone to collaborate.' : ''}
        </p>
      ) : (
        <div className="divide-border divide-y">
          {members.map(member => (
            <MemberRow key={member.id} member={member} isOwner={isOwner} />
          ))}
        </div>
      )}
    </section>
  );
}

// ============================================================
// DANGER ZONE (owner only)
// ============================================================

function DangerZone({ timelineId, timelineName }: { timelineId: string; timelineName: string }) {
  const router = useRouter();

  const handleDelete = useCallback(async () => {
    const result = await deleteTimelineAction({ id: timelineId });

    if (result._tag === 'Error') {
      toast.error(result.message);
      return;
    }

    // Clear last-timeline if it was this one
    try {
      if (localStorage.getItem('tidn:last-timeline') === timelineId) {
        localStorage.removeItem('tidn:last-timeline');
      }
    } catch {
      // ignore
    }

    toast.success('Timeline deleted');
    router.push('/');
  }, [timelineId, router]);

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold text-destructive">Danger zone</h2>
      <div className="border-destructive/30 rounded-lg border p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div className="space-y-1">
            <p className="text-sm font-medium">Delete timeline</p>
            <p className="text-muted-foreground text-xs">
              Permanently delete &ldquo;{timelineName}&rdquo; and all its events, media, and member
              access. This cannot be undone.
            </p>
          </div>
          <ConfirmDialog
            title="Delete timeline"
            description={`Permanently delete "${timelineName}" and all its events, media, and member access? This cannot be undone.`}
            actionLabel="Delete"
            onConfirm={handleDelete}
            trigger={
              <Button variant="destructive" size="sm" className="w-full sm:w-auto">
                <Trash2 data-icon="inline-start" className="size-4" />
                Delete
              </Button>
            }
          />
        </div>
      </div>
    </section>
  );
}

// ============================================================
// MAIN COMPONENT
// ============================================================

export function TimelineSettings({ timeline, members, isOwner, role }: Props) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      {/* Header */}
      <div className="mb-8 flex items-center gap-3">
        <Link
          href={`/timeline/${timeline.id}`}
          className="text-muted-foreground hover:text-foreground -ml-1 rounded-md p-1 transition-colors"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold">Settings</h1>
          <RoleBadge role={role} />
        </div>
      </div>

      {/* Sections */}
      <div className="space-y-8">
        <TimelineInfoSection timeline={timeline} isOwner={isOwner} />

        <Separator />

        <MembersSection members={members} timelineId={timeline.id} isOwner={isOwner} />

        {isOwner && (
          <>
            <Separator />
            <DangerZone timelineId={timeline.id} timelineName={timeline.name} />
          </>
        )}
      </div>
    </div>
  );
}
