'use client';

import { useEffect, useState } from 'react';

export type LoadedPhoto = { blob: Blob; url: string };

// One request supplies both the displayed image and the native share file.
// Keep only the current image and its neighbors, releasing bytes on close.
function createPhotoCache() {
  const entries = new Map<string, { promise: Promise<LoadedPhoto>; dispose: () => void }>();

  function load(url: string) {
    const existing = entries.get(url);
    if (existing) return existing.promise;
    const controller = new AbortController();
    let objectUrl: string | undefined;
    const promise = fetch(url, { signal: controller.signal, credentials: 'omit' })
      .then(response => {
        if (!response.ok) throw new Error('Could not load image');
        return response.blob();
      })
      .then(blob => {
        if (controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
        objectUrl = URL.createObjectURL(blob);
        return { blob, url: objectUrl };
      })
      .catch(error => {
        if (entries.get(url)?.promise === promise) entries.delete(url);
        throw error;
      });
    entries.set(url, {
      promise,
      dispose: () => {
        controller.abort();
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        objectUrl = undefined;
      }
    });
    return promise;
  }

  function retain(urls: ReadonlySet<string | undefined>) {
    for (const [url, entry] of entries) {
      if (urls.has(url)) continue;
      entry.dispose();
      entries.delete(url);
    }
  }

  return { load, retain, clear: () => retain(new Set()) };
}

function allowsPrefetch() {
  if (!('connection' in navigator)) return true;
  const connection = navigator.connection;
  if (typeof connection !== 'object' || connection === null) return true;
  if ('saveData' in connection && connection.saveData === true) return false;
  return !(
    'effectiveType' in connection &&
    (connection.effectiveType === 'slow-2g' ||
      connection.effectiveType === '2g' ||
      connection.effectiveType === '3g')
  );
}

export function useLightboxPhoto(
  url: string | undefined,
  previousUrl: string | undefined,
  nextUrl: string | undefined,
  preloadNext: boolean,
  retryCount: number
) {
  const [cache] = useState(createPhotoCache);
  const [state, setState] = useState<
    | { sourceUrl: string; attempt: number; status: 'ready'; photo: LoadedPhoto }
    | { sourceUrl: string; attempt: number; status: 'error' }
  >();

  useEffect(() => {
    cache.clear();
  }, [cache, retryCount]);

  useEffect(() => {
    cache.retain(new Set([url, previousUrl, nextUrl]));
  }, [cache, url, previousUrl, nextUrl]);

  useEffect(() => {
    if (!url) return;
    let active = true;
    cache.load(url).then(
      photo => {
        if (active) setState({ sourceUrl: url, attempt: retryCount, status: 'ready', photo });
      },
      () => {
        if (active) setState({ sourceUrl: url, attempt: retryCount, status: 'error' });
      }
    );
    return () => {
      active = false;
    };
  }, [cache, url, retryCount]);

  useEffect(() => {
    if (preloadNext && nextUrl && allowsPrefetch()) {
      void cache.load(nextUrl).catch(() => {
        /* Retry on navigation if prefetch fails. */
      });
    }
  }, [cache, nextUrl, preloadNext]);

  useEffect(() => () => cache.clear(), [cache]);

  return {
    photo:
      state !== undefined &&
      state.sourceUrl === url &&
      state.attempt === retryCount &&
      state.status === 'ready'
        ? state.photo
        : undefined,
    error:
      state !== undefined &&
      state.sourceUrl === url &&
      state.attempt === retryCount &&
      state.status === 'error'
  };
}
