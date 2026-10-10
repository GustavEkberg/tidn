import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LightboxSlide } from './lightbox-slide';

const media = {
  type: 'photo',
  fileName: 'photo.jpg',
  width: 1200,
  height: 800
} satisfies Parameters<typeof LightboxSlide>[0]['media'];

describe('lightbox image loading', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it('shows the thumbnail while waiting for a full-size URL', () => {
    act(() =>
      root.render(<LightboxSlide media={media} url={undefined} thumbnailUrl="/thumb.jpg" />)
    );
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/thumb.jpg');
    expect(container.querySelector('[role="status"]')).not.toBeNull();
    expect(container.querySelector('[role="status"]')?.textContent).toBe('');
    expect(container.querySelector('[role="status"]')?.getAttribute('aria-label')).toBe(
      'Loading full image'
    );
  });

  it('keeps a preview until the original loads, then reports it ready', () => {
    const onReady = vi.fn();
    act(() =>
      root.render(
        <LightboxSlide
          media={media}
          url="/original.jpg"
          thumbnailUrl="/thumb.jpg"
          onReady={onReady}
        />
      )
    );
    const original = container.querySelector('img[src="/original.jpg"]');
    expect(container.querySelector('img[src="/thumb.jpg"]')).not.toBeNull();
    expect(container.querySelector('[role="status"]')).not.toBeNull();
    expect(onReady).not.toHaveBeenCalled();
    act(() => original?.dispatchEvent(new Event('load')));
    expect(onReady).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it('preserves the preview and offers retry when the original fails', () => {
    const onRetry = vi.fn();
    act(() =>
      root.render(
        <LightboxSlide
          media={media}
          url="/original.jpg"
          thumbnailUrl="/thumb.jpg"
          onRetry={onRetry}
        />
      )
    );
    act(() =>
      container.querySelector('img[src="/original.jpg"]')?.dispatchEvent(new Event('error'))
    );
    expect(container.querySelector('img[src="/thumb.jpg"]')).not.toBeNull();
    expect(container.textContent).toContain('Could not load');
    act(() => container.querySelector('button')?.click());
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('offers retry when obtaining the signed URL fails', () => {
    const onRetry = vi.fn();
    act(() =>
      root.render(
        <LightboxSlide
          media={media}
          url={undefined}
          thumbnailUrl="/thumb.jpg"
          urlError
          onRetry={onRetry}
        />
      )
    );
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/thumb.jpg');
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.querySelector('[role="status"]')).toBeNull();
    act(() => container.querySelector('button')?.click());
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('marks a video ready after metadata without waiting for playback', () => {
    const onReady = vi.fn();
    act(() =>
      root.render(
        <LightboxSlide
          media={{ ...media, type: 'video' }}
          url="/video.mp4"
          thumbnailUrl="/thumb.jpg"
          onReady={onReady}
        />
      )
    );
    const video = container.querySelector('video');
    expect(video?.getAttribute('preload')).toBe('metadata');
    act(() => video?.dispatchEvent(new Event('loadedmetadata')));
    expect(onReady).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="status"]')).toBeNull();
  });
});
