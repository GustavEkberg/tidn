'use client';

import { useCallback, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Loader2, MessageSquarePlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Field, FieldLabel } from '@/components/ui/field';
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
import { DatePicker } from '@/components/ui/date-picker';
import { createEventAction } from '@/lib/core/event/create-event-action';

// ============================================================
// HELPERS
// ============================================================

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// ============================================================
// COMPONENT
// ============================================================

type Props = {
  timelineId: string;
};

export function AddCommentEvent({ timelineId }: Props) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState<Date | undefined>(() => new Date());
  const [comment, setComment] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const reset = useCallback(() => {
    setDate(new Date());
    setComment('');
    setFormError(null);
  }, []);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      setFormError(null);

      const trimmed = comment.trim();
      if (!trimmed) {
        setFormError('Comment is required');
        return;
      }

      if (!date) {
        setFormError('Please select a date');
        return;
      }

      startTransition(async () => {
        const result = await createEventAction({
          timelineId,
          date: formatDate(date),
          comment: trimmed
        });

        if (result._tag === 'Error') {
          setFormError(result.message);
          return;
        }

        toast.success('Comment added');
        setOpen(false);
        reset();
      });
    },
    [comment, date, timelineId, reset]
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
          <Button variant="outline" size="sm">
            <MessageSquarePlus data-icon="inline-start" className="size-4" />
            Comment
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add comment</DialogTitle>
          <DialogDescription>Add a text-only event to this timeline.</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/* Date picker */}
          <Field>
            <FieldLabel>Date</FieldLabel>
            <DatePicker
              value={date}
              onChange={setDate}
              placeholder="Select date"
              disabled={isPending}
            />
          </Field>

          {/* Comment */}
          <Field>
            <FieldLabel>Comment</FieldLabel>
            <Textarea
              placeholder="What happened on this day?"
              value={comment}
              onChange={e => setComment(e.target.value)}
              maxLength={2000}
              disabled={isPending}
              rows={3}
            />
          </Field>

          {/* Error display */}
          {formError && <p className="text-sm text-red-500">{formError}</p>}

          {/* Footer */}
          <DialogFooter>
            <DialogCloseButton disabled={isPending}>Cancel</DialogCloseButton>
            <Button type="submit" disabled={isPending || !comment.trim()}>
              {isPending ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Adding...
                </>
              ) : (
                'Add comment'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
