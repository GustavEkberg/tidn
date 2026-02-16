'use client';

import { useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from '@/components/ui/alert-dialog';

type ConfirmDialogProps = {
  /** Dialog title */
  title: string;
  /** Dialog description */
  description: string;
  /** Label for the confirm button (default: "Confirm") */
  actionLabel?: string;
  /** Label shown while action is executing (default: actionLabel + "...") */
  pendingLabel?: string;
  /** Button variant for the action (default: "destructive") */
  variant?: 'default' | 'destructive';
  /** Size passed to AlertDialogContent */
  size?: 'default' | 'sm';
  /** Async action to run on confirm. Dialog closes on success. */
  onConfirm: () => Promise<void> | void;
  /**
   * Trigger element rendered via AlertDialogTrigger's `render` prop.
   * When provided, the dialog is trigger-based.
   * When omitted, control via open/onOpenChange.
   */
  trigger?: React.ReactElement;
  /** Content rendered inside the trigger element */
  children?: React.ReactNode;
  /** Controlled open state (use without trigger) */
  open?: boolean;
  /** Controlled open change handler (use without trigger) */
  onOpenChange?: (open: boolean) => void;
};

export function ConfirmDialog({
  title,
  description,
  actionLabel = 'Confirm',
  pendingLabel,
  variant = 'destructive',
  size,
  onConfirm,
  trigger,
  children,
  open,
  onOpenChange
}: ConfirmDialogProps) {
  const [pending, setPending] = useState(false);

  const handleAction = async () => {
    setPending(true);
    try {
      await onConfirm();
    } finally {
      setPending(false);
    }
  };

  const resolvedPendingLabel = pendingLabel ?? `${actionLabel}...`;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      {trigger !== undefined && (
        <AlertDialogTrigger render={trigger}>{children}</AlertDialogTrigger>
      )}
      <AlertDialogContent size={size}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction variant={variant} onClick={handleAction} disabled={pending}>
            {pending ? resolvedPendingLabel : actionLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
