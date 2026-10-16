import { act } from 'react';
import { setImmediate, setTimeout as delay } from 'node:timers/promises';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TimelineView } from './timeline-view';
import { getDaysAction } from '@/lib/core/day/get-days-action';
import { createMediaCommentAction } from '@/lib/core/comment/create-media-comment-action';
import { editMediaCommentAction } from '@/lib/core/comment/edit-media-comment-action';

vi.mock('nuqs', () => ({ useQueryState: () => ['newest'] }));
vi.mock('@/lib/last-timeline-cookie', () => ({ setLastTimeline: vi.fn() }));
vi.mock('@/lib/core/day/get-days-action', () => ({ getDaysAction: vi.fn() }));
vi.mock('@/lib/core/day/delete-day-action', () => ({ deleteDayAction: vi.fn() }));
vi.mock('@/lib/core/media/delete-media-action', () => ({ deleteMediaAction: vi.fn() }));
vi.mock('@/lib/core/media/toggle-media-privacy-action', () => ({
  toggleMediaPrivacyAction: vi.fn()
}));
vi.mock('@/lib/core/media/poll-media-status-action', () => ({ pollMediaStatusAction: vi.fn() }));
vi.mock('@/lib/core/media/get-media-urls-action', () => ({
  getMediaUrlsAction: vi.fn(async (_timelineId: string, keys: ReadonlyArray<string>) => ({
    _tag: 'Success',
    urls: Object.fromEntries(keys.map(key => [key, `/media/${key}`]))
  }))
}));
vi.mock('@/lib/core/comment/create-media-comment-action', () => ({
  createMediaCommentAction: vi.fn()
}));
vi.mock('@/lib/core/comment/delete-media-comment-action', () => ({
  deleteMediaCommentAction: vi.fn()
}));
vi.mock('@/lib/core/comment/edit-media-comment-action', () => ({
  editMediaCommentAction: vi.fn()
}));
vi.mock('./upload-media', () => ({
  UploadMedia: () => null,
  PageDropOverlay: () => null,
  usePageDropZone: () => false
}));
vi.mock('./edit-day', () => ({ EditDay: () => null }));
vi.mock('@/components/timeline-ribbon', () => ({ TimelineRibbon: () => null }));
vi.mock('@/components/timeline-overview', () => ({
  TimelineOverview: ({ activeDayId }: { activeDayId: string }) => (
    <div data-active-day={activeDayId} />
  )
}));

type Day = Parameters<typeof TimelineView>[0]['initialDays'][number];
type Media = Day['media'][number];

function photo(id: string): Media {
  return {
    id,
    type: 'photo',
    s3Key: id,
    thumbnailS3Key: `${id}-thumb`,
    fileName: `${id}.jpg`,
    mimeType: 'image/jpeg',
    fileSize: 100,
    width: 400,
    height: 300,
    duration: null,
    processingStatus: 'completed',
    isPrivate: false,
    createdAt: '2026-10-01T12:00:00Z'
  };
}

function day(id: string, date: string, media: ReadonlyArray<Media>): Day {
  return {
    id,
    date,
    media,
    title: null,
    createdAt: `${date}T12:00:00Z`,
    updatedAt: `${date}T12:00:00Z`,
    comments: [],
    mediaComments: []
  };
}

const older = day('older', '2026-10-01', [photo('a1'), photo('a2')]);
const empty = day('empty', '2026-10-02', []);
const newer = day('newer', '2026-10-03', [photo('b1'), photo('b2')]);

describe('timeline lightbox day navigation', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      }
    );
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  async function render(loaded: ReadonlyArray<Day>, overview = [older, empty, newer]) {
    const urls = Object.fromEntries(
      loaded.flatMap(d => d.media.map(m => [`${m.id}-thumb`, `/thumb/${m.id}`]))
    );
    await act(async () =>
      root.render(
        <TimelineView
          timeline={{ id: 'timeline', name: 'Test', description: null }}
          role="viewer"
          userId="user"
          userName="User"
          initialDays={loaded}
          initialCursor={null}
          initialThumbnailUrls={urls}
          initialOverviewDays={overview.map(d => ({
            id: d.id,
            date: d.date,
            title: d.title,
            mediaCount: d.media.length
          }))}
        />
      )
    );
    const scrollContainer = container.querySelector('.snap-x');
    if (!scrollContainer) throw new Error('Missing timeline scroll container');
    Object.defineProperty(scrollContainer, 'scrollTo', { value: vi.fn(), configurable: true });
  }

  async function click(label: string) {
    const button = container.querySelector(`button[aria-label="${label}"]`);
    if (!(button instanceof HTMLButtonElement)) throw new Error(`Missing button: ${label}`);
    await act(async () => button.click());
  }

  function currentImage() {
    return container.querySelector('[role="dialog"]')?.getAttribute('aria-label');
  }

  async function key(key: string) {
    await act(async () =>
      window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
    );
  }

  function commentInput() {
    const input = container.querySelector('textarea[placeholder="Add a comment..."]');
    if (!(input instanceof HTMLTextAreaElement)) throw new Error('Missing comment input');
    return input;
  }

  function type(input: HTMLTextAreaElement, text: string) {
    input.scrollIntoView = vi.fn();
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    if (!setter) throw new Error('Missing textarea value setter');
    act(() => {
      setter.call(input, text);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  const savedComment = {
    id: 'comment-1',
    mediaId: 'b1',
    authorId: 'user',
    text: 'A memory',
    createdAt: new Date('2026-10-03T12:00:00Z'),
    updatedAt: new Date('2026-10-03T12:00:00Z')
  };

  it('lets a viewer comment after navigating to another day', async () => {
    vi.mocked(createMediaCommentAction).mockResolvedValue({
      _tag: 'Success',
      comment: savedComment
    });
    await render([older, newer]);
    await click('View photo: a2.jpg');
    await click('Next day');
    await click('Show comments');
    type(commentInput(), 'A memory');
    await click('Send comment');
    expect(createMediaCommentAction).toHaveBeenCalledWith({ mediaId: 'b1', text: 'A memory' });
    expect(
      Array.from(container.querySelectorAll('[role="dialog"] p')).some(
        p => p.textContent === 'A memory'
      )
    ).toBe(true);
    expect(commentInput().value).toBe('');
    expect(commentInput().disabled).toBe(false);
  });

  it('preserves the draft and allows retrying after a rejected comment request', async () => {
    vi.mocked(createMediaCommentAction)
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({ _tag: 'Success', comment: savedComment });
    await render([newer]);
    await click('View photo: b1.jpg');
    await click('Show comments');
    type(commentInput(), 'A memory');
    await click('Send comment');
    // Let a rejected async event handler settle, including the unhandled-rejection turn.
    await act(async () => {
      await setImmediate();
    });
    expect(commentInput().disabled).toBe(false);
    expect(commentInput().value).toBe('A memory');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Could not send comment'
    );
    await click('Send comment');
    expect(createMediaCommentAction).toHaveBeenCalledTimes(2);
    expect(commentInput().value).toBe('');
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('keeps a rejected edit editable instead of leaving Save disabled', async () => {
    vi.mocked(editMediaCommentAction).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const withComment = {
      ...newer,
      mediaComments: [
        {
          ...savedComment,
          authorName: 'User',
          createdAt: savedComment.createdAt.toISOString(),
          updatedAt: savedComment.updatedAt.toISOString()
        }
      ]
    };
    await render([withComment]);
    await click('View photo: b1.jpg');
    await click('Show comments');
    await click('Edit comment');
    const input = container.querySelector('textarea[rows="2"]');
    if (!(input instanceof HTMLTextAreaElement)) throw new Error('Missing edit input');
    type(input, 'An updated memory');
    await click('Save edit');
    await act(async () => {
      await setImmediate();
    });
    expect(input.disabled).toBe(false);
    expect(input.value).toBe('An updated memory');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Could not save comment'
    );
  });

  it('keeps comment controls reachable after posting, tapping the photo, and navigating', async () => {
    vi.mocked(createMediaCommentAction).mockResolvedValue({
      _tag: 'Success',
      comment: savedComment
    });
    await render([newer]);
    await click('View photo: b1.jpg');
    await click('Show comments');
    type(commentInput(), 'A memory');
    await click('Send comment');
    const area = container.querySelector('[data-lightbox-current]')?.parentElement?.parentElement;
    if (!area) throw new Error('Missing gesture area');
    Object.defineProperties(area, {
      setPointerCapture: { value: vi.fn() },
      hasPointerCapture: { value: () => false },
      releasePointerCapture: { value: vi.fn() }
    });
    for (const eventType of ['pointerdown', 'pointerup']) {
      const event = new MouseEvent(eventType, {
        bubbles: true,
        clientX: 200,
        clientY: 200,
        button: 0
      });
      Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: 'touch' } });
      await act(async () => area.dispatchEvent(event));
    }
    // Wait for the single-tap delay, then the controls' exit animation.
    await act(async () => {
      await delay(350);
    });
    await act(async () => {
      await delay(250);
    });
    await click('Hide comments');
    await key('ArrowRight');
    expect(currentImage()).toBe('Media viewer: b2.jpg');
    await click('Show comments');
    expect(commentInput().disabled).toBe(false);
    expect(container.querySelector('button[aria-label="Close"]')).not.toBeNull();
  });

  it('crosses to the first image of the next day and back to the previous day’s last image', async () => {
    await render([older, empty, newer]);
    await click('View photo: a2.jpg');
    await click('Next day');
    expect(currentImage()).toBe('Media viewer: b1.jpg');
    expect(container.querySelector('[data-active-day]')?.getAttribute('data-active-day')).toBe(
      'newer'
    );
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Oct 3, 2026');
    expect(container.querySelector('[role="status"]')?.getAttribute('style')).toContain(
      'opacity: 1'
    );
    expect(container.querySelector('time')?.dateTime).toBe(newer.date);

    await key('ArrowLeft');
    expect(currentImage()).toBe('Media viewer: a2.jpg');
    expect(container.querySelector('[data-active-day]')?.getAttribute('data-active-day')).toBe(
      'older'
    );
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Oct 1, 2026');
    expect(container.querySelector('[role="status"]')?.getAttribute('style')).toContain(
      'opacity: 1'
    );
    await key('ArrowLeft');
    expect(currentImage()).toBe('Media viewer: a1.jpg');
    expect(container.querySelector('button[aria-label="Previous day"]')).toBeNull();
  });

  it('uses the same day-boundary navigation for touch swipes', async () => {
    await render([older, newer]);
    await click('View photo: a2.jpg');
    const area = container.querySelector('[data-lightbox-current]')?.parentElement?.parentElement;
    if (!area) throw new Error('Missing gesture area');
    Object.defineProperties(area, {
      setPointerCapture: { value: vi.fn() },
      hasPointerCapture: { value: () => false },
      releasePointerCapture: { value: vi.fn() }
    });
    vi.spyOn(area, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 400, 400));
    for (const [type, x] of [
      ['pointerdown', 300],
      ['pointermove', 100],
      ['pointerup', 100]
    ] satisfies Array<[string, number]>) {
      const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: 200, button: 0 });
      Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: 'touch' } });
      await act(async () => area.dispatchEvent(event));
    }
    expect(currentImage()).toBe('Media viewer: b1.jpg');
  });

  it('loads a neighboring day outside the detail window and retains per-day counters', async () => {
    vi.mocked(getDaysAction).mockResolvedValue({
      _tag: 'Success',
      days: [newer, empty, older],
      nextCursor: null
    });
    await render([older]);
    await click('View photo: a2.jpg');
    await key('ArrowRight');
    expect(getDaysAction).toHaveBeenCalledWith({
      timelineId: 'timeline',
      startAt: { id: newer.id, date: newer.date },
      order: 'newest',
      limit: 20
    });
    expect(currentImage()).toBe('Media viewer: b1.jpg');
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain('1 / 2');
    await key('ArrowRight');
    expect(currentImage()).toBe('Media viewer: b2.jpg');
    expect(container.querySelector('button[aria-label="Next day"]')).toBeNull();
  });

  it('does not reopen the viewer when an in-flight day load completes after closing', async () => {
    let finish: ((result: Awaited<ReturnType<typeof getDaysAction>>) => void) | undefined;
    vi.mocked(getDaysAction).mockImplementation(
      () =>
        new Promise(resolve => {
          finish = resolve;
        })
    );
    await render([older]);
    await click('View photo: a2.jpg');
    await key('ArrowRight');
    await click('Close');
    await act(async () => finish?.({ _tag: 'Success', days: [newer, older], nextCursor: null }));
    expect(currentImage()).not.toBe('Media viewer: b1.jpg');
  });

  it('loads the previous day and starts at its last completed image', async () => {
    const processingPhoto = { ...photo('waiting'), processingStatus: 'processing' } satisfies Media;
    const previous = { ...older, media: [...older.media, processingPhoto] };
    vi.mocked(getDaysAction).mockResolvedValue({
      _tag: 'Success',
      days: [previous],
      nextCursor: null
    });
    await render([newer]);
    await click('View photo: b1.jpg');
    await key('ArrowLeft');
    expect(currentImage()).toBe('Media viewer: a2.jpg');
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain('2 / 2');
  });

  it('skips an unloaded day once its details show no completed media', async () => {
    const pending = day('pending', '2026-10-02', [
      { ...photo('waiting'), processingStatus: 'processing' }
    ]);
    vi.mocked(getDaysAction)
      .mockResolvedValueOnce({ _tag: 'Success', days: [pending, older], nextCursor: null })
      .mockResolvedValueOnce({ _tag: 'Success', days: [newer, pending, older], nextCursor: null });
    await render([older], [older, pending, newer]);
    await click('View photo: a2.jpg');
    await key('ArrowRight');
    expect(currentImage()).toBe('Media viewer: b1.jpg');
    expect(getDaysAction).toHaveBeenCalledTimes(2);
  });

  it('keeps the current image available when loading another day fails', async () => {
    vi.mocked(getDaysAction).mockResolvedValue({ _tag: 'Error', message: 'Failed to load days' });
    await render([older]);
    await click('View photo: a2.jpg');
    await key('ArrowRight');
    expect(currentImage()).toBe('Media viewer: a2.jpg');
    expect(container.querySelector('button[aria-label="Next day"]')).not.toBeNull();
    expect(container.querySelector('time')).toBeNull();
  });
});
