'use client';

import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';

type SaveState =
  | { status: 'closed' }
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; file: File; error?: string }
  | { status: 'sharing'; file: File };

type Props = {
  mediaId: string;
  timelineId: string;
  fileName: string;
  mimeType: string;
  type: 'photo' | 'video';
  onOpenChange: (open: boolean) => void;
};

export function SaveMedia({ mediaId, timelineId, fileName, mimeType, type, onOpenChange }: Props) {
  const [state, setState] = useState<SaveState>({ status: 'closed' });
  const controller = useRef<AbortController | null>(null);
  const href = `/api/media/download?${new URLSearchParams({ mediaId, timelineId })}`;
  const label = type === 'photo' ? 'Save image' : 'Save video';
  // HEIC uploads are converted to JPEG while retaining their original display name.
  const saveFileName =
    mimeType === 'image/jpeg' ? fileName.replace(/\.(heic|heif)$/i, '.jpg') : fileName;

  useEffect(() => () => controller.current?.abort(), []);

  function close() {
    controller.current?.abort();
    setState({ status: 'closed' });
    onOpenChange(false);
  }

  async function prepare() {
    const request = new AbortController();
    controller.current?.abort();
    controller.current = request;
    setState({ status: 'loading' });
    onOpenChange(true);
    try {
      const response = await fetch(`${href}&mode=share`, {
        signal: request.signal,
        cache: 'no-store'
      });
      if (!response.ok) throw new Error('Could not authorize save');
      const result: unknown = await response.json();
      if (
        typeof result !== 'object' ||
        result === null ||
        !('url' in result) ||
        typeof result.url !== 'string'
      )
        throw new Error('Missing media URL');
      // Fetch directly from S3; media bytes never pass through the app server.
      const media = await fetch(result.url, { signal: request.signal, credentials: 'omit' });
      if (!media.ok) throw new Error('Could not load media');
      const blob = await media.blob();
      const file = new File([blob], saveFileName, { type: mimeType });
      if (!navigator.canShare({ files: [file] })) throw new Error('Cannot save this media');
      if (!request.signal.aborted) setState({ status: 'ready', file });
    } catch {
      if (!request.signal.aborted) setState({ status: 'error' });
    }
  }

  function handleDownload(event: MouseEvent<HTMLAnchorElement>) {
    event.stopPropagation();
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    // Keep ordinary downloads on browsers without native file sharing.
    if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return;
    if (!navigator.canShare({ files: [new File([''], saveFileName, { type: mimeType })] })) return;
    event.preventDefault();
    void prepare();
  }

  async function save() {
    if (state.status !== 'ready') return;
    const file = state.file;
    setState({ status: 'sharing', file });
    try {
      // A fresh tap is required: awaiting the download first can lose iOS user activation.
      await navigator.share({ files: [file] });
      close();
    } catch (error) {
      setState({
        status: 'ready',
        file,
        ...((error instanceof DOMException || error instanceof Error) && error.name === 'AbortError'
          ? {}
          : { error: 'Could not open the save options. Please try again.' })
      });
    }
  }

  return (
    <>
      <a
        href={href}
        onClick={handleDownload}
        className="flex size-11 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm transition-colors hover:bg-black/70 sm:size-10"
        aria-label={`Download ${fileName}`}
        download
      >
        <Download className="size-5" />
      </a>
      <Dialog
        open={state.status !== 'closed'}
        onOpenChange={open => {
          if (!open && state.status !== 'sharing') close();
        }}
      >
        <DialogContent className="max-w-sm" onClick={event => event.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>{label}</DialogTitle>
            <DialogDescription>
              {type === 'photo'
                ? 'Choose Save Image in the share sheet to add it to Photos.'
                : 'Choose Save Video in the share sheet to add it to Photos.'}
            </DialogDescription>
          </DialogHeader>
          {state.status === 'loading' && (
            <p role="status">Preparing {type === 'photo' ? 'image' : 'video'}...</p>
          )}
          {state.status === 'error' && (
            <p role="alert">Could not prepare media. Check your connection and try again.</p>
          )}
          {state.status === 'ready' && state.error && <p role="alert">{state.error}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={close} disabled={state.status === 'sharing'}>
              Cancel
            </Button>
            {state.status === 'error' ? (
              <Button onClick={prepare}>Try again</Button>
            ) : (
              <Button onClick={save} disabled={state.status !== 'ready'}>
                {state.status === 'loading' || state.status === 'sharing' ? (
                  <Loader2 className="animate-spin" data-icon="inline-start" aria-hidden="true" />
                ) : null}
                {label}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
