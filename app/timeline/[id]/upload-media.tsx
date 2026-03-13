'use client';

import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertCircle,
  Check,
  CloudUpload,
  ImagePlus,
  Loader2,
  Lock,
  LockOpen,
  Upload,
  X
} from 'lucide-react';
import { Button } from '@/components/ui/button';
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
import { getMediaUploadUrlAction } from '@/lib/core/media/get-media-upload-url-action';
import { confirmMediaUploadAction } from '@/lib/core/media/confirm-media-upload-action';

// ============================================================
// CONSTANTS
// ============================================================

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB

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

// File input accept string
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

type FileUploadStatus = 'queued' | 'uploading' | 'confirming' | 'done' | 'error';

type FileEntry = {
  id: string;
  file: File;
  status: FileUploadStatus;
  progress: number; // 0-100
  error: string | null;
};

export type UploadMediaHandle = {
  openWithFiles: (files: ReadonlyArray<File>) => void;
};

type Props = {
  timelineId: string;
  onSuccess?: () => void;
  ref?: React.Ref<UploadMediaHandle>;
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

function getMaxFileSize(_file: File): number {
  return MAX_FILE_SIZE;
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

function validateFile(file: File): string | null {
  if (!ACCEPTED_MIME_SET.has(file.type)) {
    return `Unsupported file type: ${file.type || 'unknown'}. Accepted: JPEG, PNG, WebP, HEIC, MP4, MOV, WebM`;
  }
  const maxSize = getMaxFileSize(file);
  if (file.size > maxSize) {
    const type = isPhotoType(file.type) ? 'photos' : 'videos';
    return `File too large (${formatBytes(file.size)}). Max for ${type}: ${formatBytes(maxSize)}`;
  }
  return null;
}

/**
 * Upload a single file to S3 via signed URL with progress tracking.
 * Returns a promise that resolves when upload completes.
 */
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
// DROP ZONE COMPONENT
// ============================================================

function DropZone({
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
      // Reset input so same file can be selected again
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
        group relative flex min-h-[120px] cursor-pointer flex-col items-center justify-center gap-3
        rounded-xl border-2 border-dashed p-4 transition-colors sm:min-h-[140px] sm:p-6
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
        className={`flex size-10 items-center justify-center rounded-full transition-colors ${
          isDragOver
            ? 'bg-primary/10 text-primary'
            : 'bg-muted text-muted-foreground group-hover:bg-muted-foreground/10'
        }`}
      >
        {isDragOver ? <CloudUpload className="size-5" /> : <ImagePlus className="size-5" />}
      </div>
      <div className="text-center">
        <p className="text-sm font-medium">
          {isDragOver ? 'Drop files here' : 'Drop photos & videos here'}
        </p>
        <p className="text-muted-foreground mt-1 text-xs">
          or click to browse. JPEG, PNG, WebP, HEIC, MP4, MOV, WebM
        </p>
      </div>
    </div>
  );
}

// ============================================================
// FILE LIST ITEM
// ============================================================

function FileListItem({ entry, onRemove }: { entry: FileEntry; onRemove: (id: string) => void }) {
  const isImage = isPhotoType(entry.file.type);
  const canRemove = entry.status === 'queued' || entry.status === 'error';

  return (
    <div className="flex items-center gap-3 rounded-lg px-2 py-1.5">
      {/* Status indicator */}
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

      {/* File info */}
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
        {/* Progress bar */}
        {(entry.status === 'uploading' || entry.status === 'confirming') && (
          <div className="bg-muted mt-1 h-1 w-full overflow-hidden rounded-full">
            <div
              className="bg-primary h-full rounded-full transition-all duration-300"
              style={{ width: `${entry.progress}%` }}
            />
          </div>
        )}
      </div>

      {/* Remove button */}
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
// UPLOAD DIALOG (main orchestrator)
// ============================================================

export function UploadMedia({ timelineId, onSuccess, ref }: Props) {
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<Array<FileEntry>>([]);
  const [date, setDate] = useState<Date | undefined>(() => new Date());
  const disabledFutureDays = useMemo(() => ({ after: new Date() }), []);
  const [isPrivate, setIsPrivate] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const abortRef = useRef(false);

  // Expose imperative API for page-level drop zone
  useImperativeHandle(
    ref,
    () => ({
      openWithFiles: (droppedFiles: ReadonlyArray<File>) => {
        // Validate and add files, then open dialog
        const entries: Array<FileEntry> = [];
        const rejected: Array<string> = [];

        for (const file of droppedFiles) {
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
          setFiles(entries);
          setOpen(true);
        }
      }
    }),
    []
  );

  const reset = useCallback(() => {
    setFiles([]);
    setDate(new Date());
    setIsPrivate(false);
    setFormError(null);
    setIsSubmitting(false);
    abortRef.current = false;
  }, []);

  const handleAddFiles = useCallback((newFiles: ReadonlyArray<File>) => {
    const entries: Array<FileEntry> = [];
    const rejected: Array<string> = [];

    for (const file of newFiles) {
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
      setFiles(prev => [...prev, ...entries]);
    }
  }, []);

  const handleRemoveFile = useCallback((id: string) => {
    setFiles(prev => prev.filter(f => f.id !== id));
  }, []);

  const updateFileEntry = useCallback(
    (id: string, update: Partial<Pick<FileEntry, 'status' | 'progress' | 'error'>>) => {
      setFiles(prev => prev.map(f => (f.id === id ? { ...f, ...update } : f)));
    },
    []
  );

  /**
   * Process a single file upload: get signed URL → PUT to S3 → confirm
   */
  const uploadSingleFile = useCallback(
    async (dayId: string, entry: FileEntry, privateFlag: boolean): Promise<boolean> => {
      if (abortRef.current) return false;

      updateFileEntry(entry.id, { status: 'uploading', progress: 0 });

      // Step 1: Get signed upload URL
      const urlResult = await getMediaUploadUrlAction({
        dayId,
        fileName: entry.file.name,
        mimeType: entry.file.type,
        fileSize: entry.file.size,
        isPrivate: privateFlag
      });

      if (urlResult._tag === 'Error') {
        updateFileEntry(entry.id, { status: 'error', error: urlResult.message });
        return false;
      }

      if (abortRef.current) return false;

      // Step 2: Upload to S3 with progress
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

      // Step 3: Confirm upload
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

  /**
   * Upload all queued files with concurrency limit.
   */
  const processQueue = useCallback(
    async (dayId: string, entries: ReadonlyArray<FileEntry>, privateFlag: boolean) => {
      let cursor = 0;
      let successCount = 0;
      let failCount = 0;

      const runNext = async (): Promise<void> => {
        while (cursor < entries.length) {
          if (abortRef.current) return;
          const idx = cursor;
          cursor += 1;
          const entry = entries[idx];
          const success = await uploadSingleFile(dayId, entry, privateFlag);
          if (success) {
            successCount += 1;
          } else {
            failCount += 1;
          }
        }
      };

      // Start concurrent workers
      const workers = Array.from({ length: Math.min(MAX_CONCURRENT_UPLOADS, entries.length) }, () =>
        runNext()
      );

      await Promise.all(workers);

      return { successCount, failCount };
    },
    [uploadSingleFile]
  );

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setFormError(null);

      const queuedFiles = files.filter(f => f.status === 'queued' || f.status === 'error');
      if (queuedFiles.length === 0) {
        setFormError('No files to upload');
        return;
      }

      if (!date) {
        setFormError('Please select a date');
        return;
      }

      setIsSubmitting(true);
      abortRef.current = false;

      // Reset errored files back to queued
      setFiles(prev =>
        prev.map(f => (f.status === 'error' ? { ...f, status: 'queued' as const, error: null } : f))
      );

      // Step 1: Create/upsert day
      const dateStr = formatDate(date);
      const dayResult = await createDayAction({
        timelineId,
        date: dateStr
      });

      if (dayResult._tag === 'Error') {
        setFormError(dayResult.message);
        setIsSubmitting(false);
        return;
      }

      // Step 2: Upload all files with concurrency
      const { successCount, failCount } = await processQueue(
        dayResult.day.id,
        queuedFiles,
        isPrivate
      );

      setIsSubmitting(false);

      if (failCount === 0) {
        toast.success(`Uploaded ${successCount} file${successCount !== 1 ? 's' : ''}`);
        setOpen(false);
        reset();
        onSuccess?.();
      } else if (successCount > 0) {
        toast.warning(`${successCount} uploaded, ${failCount} failed`);
        onSuccess?.();
      } else {
        toast.error(`All ${failCount} uploads failed`);
      }
    },
    [files, date, isPrivate, timelineId, processQueue, reset, onSuccess]
  );

  const queuedCount = files.filter(f => f.status === 'queued').length;
  const activeCount = files.filter(
    f => f.status === 'uploading' || f.status === 'confirming'
  ).length;
  const doneCount = files.filter(f => f.status === 'done').length;
  const errorCount = files.filter(f => f.status === 'error').length;
  const totalCount = files.length;

  return (
    <Dialog
      open={open}
      onOpenChange={isOpen => {
        // Don't close while actively uploading
        if (!isOpen && isSubmitting) return;
        setOpen(isOpen);
        if (isOpen) setDate(new Date());
        if (!isOpen) reset();
      }}
    >
      <DialogTrigger
        render={
          <Button size="icon-sm" className="sm:w-auto sm:px-3" aria-label="Upload media">
            <Upload className="size-4" />
            <span className="hidden sm:inline">Upload</span>
          </Button>
        }
      />
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload media</DialogTitle>
          <DialogDescription>Add photos and videos to this timeline.</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/* Drop zone */}
          <DropZone onFiles={handleAddFiles} disabled={isSubmitting} />

          {/* File list */}
          {files.length > 0 && (
            <div className="flex flex-col gap-1">
              <div className="text-muted-foreground mb-1 flex items-center justify-between text-xs">
                <span>
                  {totalCount} file{totalCount !== 1 ? 's' : ''}
                  {doneCount > 0 && ` · ${doneCount} done`}
                  {errorCount > 0 && ` · ${errorCount} failed`}
                </span>
                {isSubmitting && activeCount > 0 && (
                  <span className="text-primary">{activeCount} uploading...</span>
                )}
              </div>
              <div className="max-h-[200px] overflow-y-auto rounded-lg border">
                {files.map(entry => (
                  <FileListItem key={entry.id} entry={entry} onRemove={handleRemoveFile} />
                ))}
              </div>
            </div>
          )}

          {/* Date picker */}
          <Field>
            <FieldLabel>Date</FieldLabel>
            <DatePicker
              value={date}
              onChange={setDate}
              placeholder="Select date"
              disabled={isSubmitting}
              disabledDays={disabledFutureDays}
            />
          </Field>

          {/* Privacy toggle */}
          <button
            type="button"
            onClick={() => setIsPrivate(prev => !prev)}
            disabled={isSubmitting}
            className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
              isPrivate
                ? 'border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-400'
                : 'border-border text-muted-foreground hover:bg-muted/50'
            } ${isSubmitting ? 'pointer-events-none opacity-50' : ''}`}
          >
            {isPrivate ? <Lock className="size-3.5" /> : <LockOpen className="size-3.5" />}
            {isPrivate ? 'Private — hidden from viewers' : 'Public — visible to all members'}
          </button>

          {/* Error display */}
          {formError && <p className="text-sm text-red-500">{formError}</p>}

          {/* Footer */}
          <DialogFooter>
            <DialogCloseButton disabled={isSubmitting}>Cancel</DialogCloseButton>
            <Button type="submit" disabled={isSubmitting || queuedCount + errorCount === 0}>
              {isSubmitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Uploading {doneCount}/{totalCount}...
                </>
              ) : (
                <>
                  <Upload className="size-4" />
                  Upload {queuedCount} file{queuedCount !== 1 ? 's' : ''}
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// FULL-PAGE DROP OVERLAY
// ============================================================

/**
 * A page-level drop zone that shows an overlay when files are dragged
 * over the timeline view. Triggers the upload dialog with dropped files.
 */
export function usePageDropZone(onFiles: (files: ReadonlyArray<File>) => void, enabled: boolean) {
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const counterRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;

    function handleDragEnter(e: DragEvent) {
      e.preventDefault();
      counterRef.current += 1;
      if (counterRef.current === 1) {
        // Check if dragging files (not text etc)
        if (e.dataTransfer?.types.includes('Files')) {
          setIsDraggingOver(true);
        }
      }
    }

    function handleDragOver(e: DragEvent) {
      e.preventDefault();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'copy';
      }
    }

    function handleDragLeave(e: DragEvent) {
      e.preventDefault();
      counterRef.current -= 1;
      if (counterRef.current === 0) {
        setIsDraggingOver(false);
      }
    }

    function handleDrop(e: DragEvent) {
      e.preventDefault();
      counterRef.current = 0;
      setIsDraggingOver(false);
      const files = e.dataTransfer ? Array.from(e.dataTransfer.files) : [];
      if (files.length > 0) {
        onFiles(files);
      }
    }

    document.addEventListener('dragenter', handleDragEnter);
    document.addEventListener('dragover', handleDragOver);
    document.addEventListener('dragleave', handleDragLeave);
    document.addEventListener('drop', handleDrop);

    return () => {
      document.removeEventListener('dragenter', handleDragEnter);
      document.removeEventListener('dragover', handleDragOver);
      document.removeEventListener('dragleave', handleDragLeave);
      document.removeEventListener('drop', handleDrop);
    };
  }, [enabled, onFiles]);

  return isDraggingOver;
}

export function PageDropOverlay({ isDraggingOver }: { isDraggingOver: boolean }) {
  if (!isDraggingOver) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="border-primary/50 bg-background/90 mx-4 flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed px-8 py-8 shadow-lg sm:px-12 sm:py-10">
        <CloudUpload className="text-primary size-8 sm:size-10" />
        <p className="text-base font-medium sm:text-lg">Drop files to upload</p>
        <p className="text-muted-foreground text-sm">Photos and videos</p>
      </div>
    </div>
  );
}
