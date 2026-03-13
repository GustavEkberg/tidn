'use client';

import { useCallback, useMemo, useState, useTransition } from 'react';
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
import { createDayAction } from '@/lib/core/day/create-day-action';
import { createDayCommentAction } from '@/lib/core/comment/create-day-comment-action';

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

export function AddDayComment({ timelineId }: Props) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState<Date | undefined>(() => new Date());
  const disabledFutureDays = useMemo(() => ({ after: new Date() }), []);
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
        // Step 1: Create/upsert day
        const dayResult = await createDayAction({
          timelineId,
          date: formatDate(date)
        });

        if (dayResult._tag === 'Error') {
          setFormError(dayResult.message);
          return;
        }

        // Step 2: Add comment to the day
        const commentResult = await createDayCommentAction({
          dayId: dayResult.day.id,
          text: trimmed
        });

        if (commentResult._tag === 'Error') {
          setFormError(commentResult.message);
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
          <Button
            variant="outline"
            size="icon-sm"
            className="sm:w-auto sm:px-3"
            aria-label="Add comment"
          >
            <MessageSquarePlus className="size-4" />
            <span className="hidden sm:inline">Comment</span>
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add comment</DialogTitle>
          <DialogDescription>Add a comment to a day on this timeline.</DialogDescription>
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
              disabledDays={disabledFutureDays}
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
