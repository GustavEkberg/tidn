'use client';

import { useCallback, useImperativeHandle, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import {
  AlertCircle,
  Check,
  CloudUpload,
  ImageIcon,
  ImagePlus,
  Loader2,
  Lock,
  LockOpen,
  Trash2,
  X
} from 'lucide-react';
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
  DialogCloseButton
} from '@/components/ui/dialog';
import { DatePicker } from '@/components/ui/date-picker';
import { updateEventAction } from '@/lib/core/event/update-event-action';
import { deleteMediaAction } from '@/lib/core/media/delete-media-action';
import { toggleMediaPrivacyAction } from '@/lib/core/media/toggle-media-privacy-action';
import { getMediaUploadUrlAction } from '@/lib/core/media/get-media-upload-url-action';
import { confirmMediaUploadAction } from '@/lib/core/media/confirm-media-upload-action';

// ============================================================
// CONSTANTS
// ============================================================

const PHOTO_MAX_SIZE = 20 * 1024 * 1024; // 20 MB
const VIDEO_MAX_SIZE = 100 * 1024 * 1024; // 100 MB

const ACCEPTED_PHOTO_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif'
] as const;

const ACCEPTED_VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'] as const;

const ACCEPTED_PHOTO_SET: ReadonlySet<string> = new Set(ACCEPTED_PHOTO_TYPES);
const ACCEPTED_MIME_SET: ReadonlySet<string> = new Set([
  ...ACCEPTED_PHOTO_TYPES,
  ...ACCEPTED_VIDEO_TYPES
]);

const ACCEPT_STRING = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'video/mp4',
  'video/quicktime',
  'video/webm',
  '.heic',
  '.heif',
  '.mov'
].join(',');

const MAX_CONCURRENT_UPLOADS = 4;

// ============================================================
// TYPES
// ============================================================

type MediaItem = {
  id: string;
  type: 'photo' | 'video';
  s3Key: string;
  thumbnailS3Key: string | null;
  fileName: string;
  mimeType: string;
  fileSize: number;
  width: number | null;
  height: number | null;
  duration: number | null;
  processingStatus: 'pending' | 'processing' | 'completed' | 'failed';
  isPrivate: boolean;
  createdAt: string;
};

type EventData = {
  id: string;
  date: string;
  comment: string | null;
  media: ReadonlyArray<MediaItem>;
};

type FileUploadStatus = 'queued' | 'uploading' | 'confirming' | 'done' | 'error';

type FileEntry = {
  id: string;
  file: File;
  status: FileUploadStatus;
  progress: number;
  error: string | null;
};

export type EditEventHandle = {
  open: (event: EventData, thumbnailUrls: Record<string, string>) => void;
};

type Props = {
  ref?: React.Ref<EditEventHandle>;
};

// ============================================================
// HELPERS
// ============================================================

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function isPhotoType(mime: string): boolean {
  return ACCEPTED_PHOTO_SET.has(mime);
}

function getMaxFileSize(file: File): number {
  return isPhotoType(file.type) ? PHOTO_MAX_SIZE : VIDEO_MAX_SIZE;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${Math.round(bytes / (1024 * 1024))}MB`;
}

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseDateString(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function validateFile(file: File): string | null {
  if (!ACCEPTED_MIME_SET.has(file.type)) {
    return `Unsupported file type: ${file.type || 'unknown'}`;
  }
  const maxSize = getMaxFileSize(file);
  if (file.size > maxSize) {
    const type = isPhotoType(file.type) ? 'photos' : 'videos';
    return `File too large (${formatBytes(file.size)}). Max for ${type}: ${formatBytes(maxSize)}`;
  }
  return null;
}

function uploadToS3(url: string, file: File, onProgress: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener('progress', e => {
      if (e.lengthComputable) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`Upload failed with status ${xhr.status}`));
      }
    });

    xhr.addEventListener('error', () => reject(new Error('Upload network error')));
    xhr.addEventListener('abort', () => reject(new Error('Upload aborted')));

    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.send(file);
  });
}

// ============================================================
// EXISTING MEDIA THUMBNAIL
// ============================================================

function ExistingMediaItem({
  media,
  thumbnailUrl,
  onRemove,
  onTogglePrivacy,
  isRemoving
}: {
  media: MediaItem;
  thumbnailUrl: string | undefined;
  onRemove: () => void;
  onTogglePrivacy: () => void;
  isRemoving: boolean;
}) {
  const showThumbnail = media.processingStatus === 'completed' && thumbnailUrl;

  return (
    <div className="group relative aspect-square overflow-hidden rounded-lg">
      {showThumbnail ? (
        /* eslint-disable-next-line @next/next/no-img-element -- Dynamic signed URLs can't use next/image */
        <img src={thumbnailUrl} alt={media.fileName} className="size-full object-cover" />
      ) : (
        <div className="bg-muted flex size-full items-center justify-center">
          {media.processingStatus === 'pending' || media.processingStatus === 'processing' ? (
            <Loader2 className="text-muted-foreground size-5 animate-spin" />
          ) : (
            <ImageIcon className="text-muted-foreground size-5" />
          )}
        </div>
      )}
      {/* Privacy badge (always visible when private) */}
      {media.isPrivate && (
        <div className="absolute top-1 left-1 z-10 flex size-5 items-center justify-center rounded-full bg-black/60">
          <Lock className="size-3 text-white" />
        </div>
      )}
      {/* Hover overlay with controls */}
      <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/0 opacity-0 transition-all group-hover:bg-black/50 group-hover:opacity-100 focus-within:bg-black/50 focus-within:opacity-100">
        <button
          type="button"
          onClick={onTogglePrivacy}
          disabled={isRemoving}
          className="flex size-8 items-center justify-center rounded-full bg-white/20 text-white backdrop-blur-sm transition-colors hover:bg-white/40 outline-none focus-visible:ring-2 focus-visible:ring-white"
          aria-label={
            media.isPrivate ? `Make ${media.fileName} public` : `Make ${media.fileName} private`
          }
        >
          {media.isPrivate ? <LockOpen className="size-4" /> : <Lock className="size-4" />}
        </button>
        <button
          type="button"
          onClick={onRemove}
          disabled={isRemoving}
          className="flex size-8 items-center justify-center rounded-full bg-white/20 text-white backdrop-blur-sm transition-colors hover:bg-red-500/80 outline-none focus-visible:ring-2 focus-visible:ring-white"
          aria-label={`Remove ${media.fileName}`}
        >
          {isRemoving ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
        </button>
      </div>
    </div>
  );
}

// ============================================================
// NEW FILE LIST ITEM
// ============================================================

function NewFileItem({ entry, onRemove }: { entry: FileEntry; onRemove: (id: string) => void }) {
  const isImage = isPhotoType(entry.file.type);
  const canRemove = entry.status === 'queued' || entry.status === 'error';

  return (
    <div className="flex items-center gap-3 rounded-lg px-2 py-1.5">
      <div className="flex size-5 shrink-0 items-center justify-center">
        {entry.status === 'queued' && (
          <div className="bg-muted-foreground/30 size-2 rounded-full" />
        )}
        {(entry.status === 'uploading' || entry.status === 'confirming') && (
          <Loader2 className="text-primary size-4 animate-spin" />
        )}
        {entry.status === 'done' && <Check className="text-emerald-500 size-4" />}
        {entry.status === 'error' && <AlertCircle className="size-4 text-red-500" />}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm">{entry.file.name}</span>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-xs">
            {formatBytes(entry.file.size)} · {isImage ? 'Photo' : 'Video'}
          </span>
          {entry.status === 'error' && entry.error && (
            <span className="truncate text-xs text-red-500">{entry.error}</span>
          )}
        </div>
        {(entry.status === 'uploading' || entry.status === 'confirming') && (
          <div className="bg-muted mt-1 h-1 w-full overflow-hidden rounded-full">
            <div
              className="bg-primary h-full rounded-full transition-all duration-300"
              style={{ width: `${entry.progress}%` }}
            />
          </div>
        )}
      </div>
      {canRemove && (
        <button
          type="button"
          onClick={() => onRemove(entry.id)}
          className="text-muted-foreground hover:text-foreground shrink-0 rounded-md p-1 transition-colors"
          aria-label={`Remove ${entry.file.name}`}
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

// ============================================================
// DROP ZONE (inline, smaller variant)
// ============================================================

function AddMediaDropZone({
  onFiles,
  disabled
}: {
  onFiles: (files: ReadonlyArray<File>) => void;
  disabled: boolean;
}) {
  const [isDragOver, setIsDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);

  const handleDragEnter = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (disabled) return;
      dragCounterRef.current += 1;
      if (dragCounterRef.current === 1) {
        setIsDragOver(true);
      }
    },
    [disabled]
  );

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current === 0) {
      setIsDragOver(false);
    }
  }, []);

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!disabled) {
        e.dataTransfer.dropEffect = 'copy';
      }
    },
    [disabled]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
      dragCounterRef.current = 0;
      if (disabled) return;
      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) {
        onFiles(files);
      }
    },
    [disabled, onFiles]
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files ? Array.from(e.target.files) : [];
      if (files.length > 0) {
        onFiles(files);
      }
      e.target.value = '';
    },
    [onFiles]
  );

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className={`
        group relative flex min-h-[80px] cursor-pointer flex-col items-center justify-center gap-2
        rounded-lg border-2 border-dashed p-4 transition-colors
        ${
          isDragOver
            ? 'border-primary bg-primary/5'
            : 'border-muted-foreground/25 hover:border-muted-foreground/40 hover:bg-muted/50'
        }
        ${disabled ? 'pointer-events-none opacity-50' : ''}
      `}
      onClick={() => inputRef.current?.click()}
      role="button"
      tabIndex={0}
      aria-label="Drop files here or click to browse"
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT_STRING}
        onChange={handleInputChange}
        className="hidden"
        disabled={disabled}
        aria-hidden="true"
      />
      <div
        className={`flex size-8 items-center justify-center rounded-full transition-colors ${
          isDragOver
            ? 'bg-primary/10 text-primary'
            : 'bg-muted text-muted-foreground group-hover:bg-muted-foreground/10'
        }`}
      >
        {isDragOver ? <CloudUpload className="size-4" /> : <ImagePlus className="size-4" />}
      </div>
      <p className="text-muted-foreground text-xs">
        {isDragOver ? 'Drop files' : 'Add more files'}
      </p>
    </div>
  );
}

// ============================================================
// MAIN COMPONENT
// ============================================================

export function EditEvent({ ref }: Props) {
  const [open, setOpen] = useState(false);
  const [eventData, setEventData] = useState<EventData | null>(null);
  const [date, setDate] = useState<Date | undefined>();
  const [comment, setComment] = useState('');
  const [existingMedia, setExistingMedia] = useState<Array<MediaItem>>([]);
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({});
  const [removingMediaIds, setRemovingMediaIds] = useState<Set<string>>(new Set());
  const [newFiles, setNewFiles] = useState<Array<FileEntry>>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const abortRef = useRef(false);

  useImperativeHandle(
    ref,
    () => ({
      open: (event: EventData, thumbnailUrls: Record<string, string>) => {
        setEventData(event);
        setDate(parseDateString(event.date));
        setComment(event.comment ?? '');
        setExistingMedia([...event.media]);
        setMediaUrls(thumbnailUrls);
        setRemovingMediaIds(new Set());
        setNewFiles([]);
        setFormError(null);
        setIsSubmitting(false);
        abortRef.current = false;
        setOpen(true);
      }
    }),
    []
  );

  const reset = useCallback(() => {
    setEventData(null);
    setDate(undefined);
    setComment('');
    setExistingMedia([]);
    setMediaUrls({});
    setRemovingMediaIds(new Set());
    setNewFiles([]);
    setFormError(null);
    setIsSubmitting(false);
    abortRef.current = false;
  }, []);

  // --------------------------------------------------------
  // Media removal
  // --------------------------------------------------------

  const handleRemoveExistingMedia = useCallback(
    (mediaId: string) => {
      if (removingMediaIds.has(mediaId)) return;

      startTransition(async () => {
        setRemovingMediaIds(prev => new Set([...prev, mediaId]));

        const result = await deleteMediaAction({ mediaId });

        if (result._tag === 'Error') {
          toast.error(result.message);
          setRemovingMediaIds(prev => {
            const next = new Set(prev);
            next.delete(mediaId);
            return next;
          });
          return;
        }

        setExistingMedia(prev => prev.filter(m => m.id !== mediaId));
        setRemovingMediaIds(prev => {
          const next = new Set(prev);
          next.delete(mediaId);
          return next;
        });
        toast.success('Media removed');
      });
    },
    [removingMediaIds]
  );

  // --------------------------------------------------------
  // Media privacy toggle
  // --------------------------------------------------------

  const handleTogglePrivacy = useCallback(
    (mediaId: string) => {
      const media = existingMedia.find(m => m.id === mediaId);
      if (!media) return;

      const newPrivacy = !media.isPrivate;

      // Optimistic update
      setExistingMedia(prev =>
        prev.map(m => (m.id === mediaId ? { ...m, isPrivate: newPrivacy } : m))
      );

      toast.success(newPrivacy ? 'Media set to private' : 'Media set to public');

      toggleMediaPrivacyAction({ mediaId, isPrivate: newPrivacy }).then(result => {
        if (result._tag === 'Error') {
          toast.error(result.message);
          // Revert
          setExistingMedia(prev =>
            prev.map(m => (m.id === mediaId ? { ...m, isPrivate: !newPrivacy } : m))
          );
        }
      });
    },
    [existingMedia]
  );

  // --------------------------------------------------------
  // New file management
  // --------------------------------------------------------

  const handleAddFiles = useCallback((files: ReadonlyArray<File>) => {
    const entries: Array<FileEntry> = [];
    const rejected: Array<string> = [];

    for (const file of files) {
      const error = validateFile(file);
      if (error) {
        rejected.push(`${file.name}: ${error}`);
      } else {
        entries.push({
          id: generateId(),
          file,
          status: 'queued',
          progress: 0,
          error: null
        });
      }
    }

    if (rejected.length > 0) {
      toast.error(`${rejected.length} file(s) rejected`, {
        description: rejected.slice(0, 3).join('\n')
      });
    }

    if (entries.length > 0) {
      setNewFiles(prev => [...prev, ...entries]);
    }
  }, []);

  const handleRemoveNewFile = useCallback((id: string) => {
    setNewFiles(prev => prev.filter(f => f.id !== id));
  }, []);

  const updateFileEntry = useCallback(
    (id: string, update: Partial<Pick<FileEntry, 'status' | 'progress' | 'error'>>) => {
      setNewFiles(prev => prev.map(f => (f.id === id ? { ...f, ...update } : f)));
    },
    []
  );

  // --------------------------------------------------------
  // Upload single file to existing event
  // --------------------------------------------------------

  const uploadSingleFile = useCallback(
    async (eventId: string, entry: FileEntry): Promise<boolean> => {
      if (abortRef.current) return false;

      updateFileEntry(entry.id, { status: 'uploading', progress: 0 });

      const urlResult = await getMediaUploadUrlAction({
        eventId,
        fileName: entry.file.name,
        mimeType: entry.file.type,
        fileSize: entry.file.size
      });

      if (urlResult._tag === 'Error') {
        updateFileEntry(entry.id, { status: 'error', error: urlResult.message });
        return false;
      }

      if (abortRef.current) return false;

      try {
        await uploadToS3(urlResult.uploadUrl, entry.file, pct => {
          updateFileEntry(entry.id, { progress: pct });
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Upload failed';
        updateFileEntry(entry.id, { status: 'error', error: message });
        return false;
      }

      if (abortRef.current) return false;

      updateFileEntry(entry.id, { status: 'confirming', progress: 100 });
      const confirmResult = await confirmMediaUploadAction({
        mediaId: urlResult.mediaId
      });

      if (confirmResult._tag === 'Error') {
        updateFileEntry(entry.id, { status: 'error', error: confirmResult.message });
        return false;
      }

      updateFileEntry(entry.id, { status: 'done', progress: 100 });
      return true;
    },
    [updateFileEntry]
  );

  const processQueue = useCallback(
    async (eventId: string, entries: ReadonlyArray<FileEntry>) => {
      let cursor = 0;
      let successCount = 0;
      let failCount = 0;

      const runNext = async (): Promise<void> => {
        while (cursor < entries.length) {
          if (abortRef.current) return;
          const idx = cursor;
          cursor += 1;
          const entry = entries[idx];
          const success = await uploadSingleFile(eventId, entry);
          if (success) {
            successCount += 1;
          } else {
            failCount += 1;
          }
        }
      };

      const workers = Array.from({ length: Math.min(MAX_CONCURRENT_UPLOADS, entries.length) }, () =>
        runNext()
      );

      await Promise.all(workers);
      return { successCount, failCount };
    },
    [uploadSingleFile]
  );

  // --------------------------------------------------------
  // Submit: update event metadata + upload new files
  // --------------------------------------------------------

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!eventData) return;
      setFormError(null);

      if (!date) {
        setFormError('Please select a date');
        return;
      }

      setIsSubmitting(true);
      abortRef.current = false;

      // Build update payload — only send changed fields
      const dateStr = formatDate(date);
      const trimmedComment = comment.trim() || null;

      const hasDateChanged = dateStr !== eventData.date;
      const hasCommentChanged = trimmedComment !== eventData.comment;
      const queuedFiles = newFiles.filter(f => f.status === 'queued' || f.status === 'error');

      // Update event metadata if anything changed
      if (hasDateChanged || hasCommentChanged) {
        const updateInput: {
          id: string;
          date?: string;
          comment?: string | null;
        } = { id: eventData.id };

        if (hasDateChanged) updateInput.date = dateStr;
        if (hasCommentChanged) updateInput.comment = trimmedComment;

        const result = await updateEventAction(updateInput);

        if (result._tag === 'Error') {
          setFormError(result.message);
          setIsSubmitting(false);
          return;
        }
      }

      // Upload new files if any
      if (queuedFiles.length > 0) {
        // Reset errored files back to queued
        setNewFiles(prev =>
          prev.map(f =>
            f.status === 'error' ? { ...f, status: 'queued' as const, error: null } : f
          )
        );

        const { successCount, failCount } = await processQueue(eventData.id, queuedFiles);

        setIsSubmitting(false);

        if (failCount === 0) {
          if (successCount > 0) {
            toast.success(`Uploaded ${successCount} file${successCount !== 1 ? 's' : ''}`);
          }
          if (hasDateChanged || hasCommentChanged) {
            toast.success('Event updated');
          } else if (successCount === 0) {
            // Nothing actually changed but no errors
            toast.success('Event updated');
          }
          setOpen(false);
          reset();
        } else if (successCount > 0) {
          toast.warning(`${successCount} uploaded, ${failCount} failed`);
        } else {
          toast.error(`All ${failCount} uploads failed`);
        }
      } else {
        setIsSubmitting(false);
        toast.success('Event updated');
        setOpen(false);
        reset();
      }
    },
    [eventData, date, comment, newFiles, processQueue, reset]
  );

  const queuedCount = newFiles.filter(f => f.status === 'queued').length;
  const errorCount = newFiles.filter(f => f.status === 'error').length;
  const activeCount = newFiles.filter(
    f => f.status === 'uploading' || f.status === 'confirming'
  ).length;
  const doneCount = newFiles.filter(f => f.status === 'done').length;
  const isBusy = isSubmitting || isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={isOpen => {
        if (!isOpen && isBusy) return;
        setOpen(isOpen);
        if (!isOpen) reset();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit event</DialogTitle>
          <DialogDescription>Change date, comment, or manage media.</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/* Date picker */}
          <Field>
            <FieldLabel>Date</FieldLabel>
            <DatePicker
              value={date}
              onChange={setDate}
              placeholder="Select date"
              disabled={isBusy}
            />
          </Field>

          {/* Comment */}
          <Field>
            <FieldLabel>
              Comment
              <span className="text-muted-foreground font-normal"> (optional)</span>
            </FieldLabel>
            <Textarea
              placeholder="What happened on this day?"
              value={comment}
              onChange={e => setComment(e.target.value)}
              maxLength={2000}
              disabled={isBusy}
              rows={3}
            />
          </Field>

          {/* Existing media grid */}
          {existingMedia.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">
                Media
                <span className="text-muted-foreground font-normal"> ({existingMedia.length})</span>
              </span>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {existingMedia.map(media => (
                  <ExistingMediaItem
                    key={media.id}
                    media={media}
                    thumbnailUrl={
                      media.thumbnailS3Key ? mediaUrls[media.thumbnailS3Key] : undefined
                    }
                    onRemove={() => handleRemoveExistingMedia(media.id)}
                    onTogglePrivacy={() => handleTogglePrivacy(media.id)}
                    isRemoving={removingMediaIds.has(media.id)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Add more media */}
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Add media</span>
            <AddMediaDropZone onFiles={handleAddFiles} disabled={isBusy} />
          </div>

          {/* New files list */}
          {newFiles.length > 0 && (
            <div className="flex flex-col gap-1">
              <div className="text-muted-foreground mb-1 flex items-center justify-between text-xs">
                <span>
                  {newFiles.length} new file{newFiles.length !== 1 ? 's' : ''}
                  {doneCount > 0 && ` · ${doneCount} done`}
                  {errorCount > 0 && ` · ${errorCount} failed`}
                </span>
                {isSubmitting && activeCount > 0 && (
                  <span className="text-primary">{activeCount} uploading...</span>
                )}
              </div>
              <div className="max-h-[150px] overflow-y-auto rounded-lg border">
                {newFiles.map(entry => (
                  <NewFileItem key={entry.id} entry={entry} onRemove={handleRemoveNewFile} />
                ))}
              </div>
            </div>
          )}

          {/* Error display */}
          {formError && <p className="text-sm text-red-500">{formError}</p>}

          {/* Footer */}
          <DialogFooter>
            <DialogCloseButton disabled={isBusy}>Cancel</DialogCloseButton>
            <Button type="submit" disabled={isBusy}>
              {isSubmitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {activeCount > 0
                    ? `Uploading ${doneCount}/${queuedCount + doneCount + errorCount}...`
                    : 'Saving...'}
                </>
              ) : (
                <>Save changes</>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
