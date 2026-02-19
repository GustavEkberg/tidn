'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
import { AppHeader } from '@/components/app-header';
import { createTimelineAction } from '@/lib/core/timeline/create-timeline-action';

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

export function NewTimelinePage() {
  return (
    <>
      <AppHeader timelines={[]} />
      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-24">
        <div className="flex flex-col items-center gap-2 text-center">
          <h2 className="text-lg font-medium">No timelines yet</h2>
          <p className="text-muted-foreground max-w-sm text-sm">
            Create your first timeline to start collecting photos, videos, and moments with others.
          </p>
        </div>
        <CreateTimelineDialog />
      </div>
    </>
  );
}
