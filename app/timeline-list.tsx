'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Field, FieldLabel, FieldError } from '@/components/ui/field';
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
import { createTimelineAction } from '@/lib/core/timeline/create-timeline-action';

type TimelineRole = 'owner' | 'editor' | 'viewer';

type Timeline = {
  id: string;
  name: string;
  description: string | null;
  ownerId: string;
  createdAt: Date;
  updatedAt: Date;
  role: TimelineRole;
};

type Props = {
  timelines: Timeline[];
};

const ROLE_LABELS: Record<TimelineRole, string> = {
  owner: 'Owner',
  editor: 'Editor',
  viewer: 'Viewer'
};

const ROLE_VARIANTS: Record<TimelineRole, 'default' | 'secondary' | 'outline'> = {
  owner: 'default',
  editor: 'secondary',
  viewer: 'outline'
};

function formatRelativeDate(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
  return `${Math.floor(diffDays / 365)}y ago`;
}

function CreateTimelineDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function reset() {
    setName('');
    setDescription('');
    setError(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      const result = await createTimelineAction({
        name: name.trim(),
        description: description.trim() || undefined
      });

      if (result._tag === 'Error') {
        setError(result.message);
        return;
      }

      toast.success('Timeline created');
      setOpen(false);
      reset();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={isOpen => {
        setOpen(isOpen);
        if (!isOpen) reset();
      }}
    >
      <DialogTrigger
        render={
          <Button>
            <Plus data-icon="inline-start" />
            New timeline
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create timeline</DialogTitle>
          <DialogDescription>
            A timeline is a shared space for photos, videos, and moments.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor="timeline-name">Name</FieldLabel>
            <Input
              id="timeline-name"
              placeholder="Family vacation 2026"
              value={name}
              onChange={e => setName(e.target.value)}
              maxLength={100}
              required
              autoFocus
              disabled={isPending}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="timeline-description">
              Description
              <span className="text-muted-foreground font-normal">(optional)</span>
            </FieldLabel>
            <Textarea
              id="timeline-description"
              placeholder="What is this timeline about?"
              value={description}
              onChange={e => setDescription(e.target.value)}
              maxLength={500}
              disabled={isPending}
            />
          </Field>
          {error && <FieldError>{error}</FieldError>}
          <DialogFooter>
            <DialogCloseButton disabled={isPending}>Cancel</DialogCloseButton>
            <Button type="submit" disabled={isPending || !name.trim()}>
              {isPending ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-6 py-24">
      <div className="flex flex-col items-center gap-2 text-center">
        <h2 className="text-lg font-medium">No timelines yet</h2>
        <p className="text-muted-foreground max-w-sm text-sm">
          Create your first timeline to start collecting photos, videos, and moments with others.
        </p>
      </div>
      <CreateTimelineDialog />
    </div>
  );
}

function TimelineCard({ timeline }: { timeline: Timeline }) {
  return (
    <Link
      href={`/timeline/${timeline.id}`}
      className="ring-foreground/10 hover:ring-foreground/20 bg-card flex flex-col gap-3 rounded-xl p-5 ring-1 transition-all hover:shadow-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-base font-medium leading-snug">{timeline.name}</h3>
        <Badge variant={ROLE_VARIANTS[timeline.role]}>{ROLE_LABELS[timeline.role]}</Badge>
      </div>
      {timeline.description && (
        <p className="text-muted-foreground line-clamp-2 text-sm">{timeline.description}</p>
      )}
      <p className="text-muted-foreground text-xs">
        Updated {formatRelativeDate(timeline.updatedAt)}
      </p>
    </Link>
  );
}

function getLastTimelineId(): string | null {
  try {
    return localStorage.getItem('tidn:last-timeline');
  } catch {
    return null;
  }
}

export function TimelineList({ timelines }: Props) {
  const router = useRouter();

  // Compute redirect target once via lazy initializer (no refs, no effects).
  const [redirectTarget] = useState(() => {
    const lastId = getLastTimelineId();
    if (lastId && timelines.some(t => t.id === lastId)) return lastId;
    return null;
  });

  if (redirectTarget) {
    router.replace(`/timeline/${redirectTarget}`);
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <p className="text-muted-foreground text-sm">Loading...</p>
      </div>
    );
  }

  if (timelines.length === 0) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
        <EmptyState />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Timelines</h1>
        <CreateTimelineDialog />
      </div>
      <div className="grid gap-3">
        {timelines.map(timeline => (
          <TimelineCard key={timeline.id} timeline={timeline} />
        ))}
      </div>
    </div>
  );
}
