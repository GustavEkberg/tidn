'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Check, ChevronsUpDown, Loader2, LogOut, Plus, Search, Settings } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { LogoutButton } from '@/app/(auth)/logout-button';
import { getTimelinesAction } from '@/lib/core/timeline/get-timelines-action';
import type { TimelineSummary } from '@/lib/core/timeline/get-timelines-action';
import { createTimelineAction } from '@/lib/core/timeline/create-timeline-action';
import { cn } from '@/lib/utils';

// ============================================================
// TYPES
// ============================================================

type ActiveTimeline = {
  id: string;
  name: string;
};

type AppHeaderProps = {
  /** Currently active timeline (when viewing/editing one) */
  activeTimeline?: ActiveTimeline;
  /** Pre-loaded timelines to avoid initial fetch */
  timelines?: Array<TimelineSummary>;
  /** Actions to render on the right side of the header */
  actions?: React.ReactNode;
};

// ============================================================
// ROLE INDICATOR
// ============================================================

const ROLE_COLORS: Record<string, string> = {
  owner: 'bg-foreground',
  editor: 'bg-muted-foreground',
  viewer: 'bg-muted-foreground/50'
};

// ============================================================
// CREATE TIMELINE (inline in switcher footer)
// ============================================================

function CreateTimelineInline({ onCreated }: { onCreated: () => void }) {
  const router = useRouter();
  const [isCreating, setIsCreating] = useState(false);
  const [name, setName] = useState('');
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;

    startTransition(async () => {
      const result = await createTimelineAction({ name: trimmed });
      if (result._tag === 'Error') {
        toast.error(result.message);
        return;
      }
      toast.success('Timeline created');
      setName('');
      setIsCreating(false);
      onCreated();
      router.refresh();
    });
  }

  if (!isCreating) {
    return (
      <div className="border-t border-border p-1">
        <button
          type="button"
          onClick={() => {
            setIsCreating(true);
            requestAnimationFrame(() => inputRef.current?.focus());
          }}
          className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground"
        >
          <Plus className="size-3.5" />
          <span>New timeline</span>
        </button>
      </div>
    );
  }

  return (
    <div className="border-t border-border p-2">
      <form onSubmit={handleSubmit} className="flex items-center gap-1.5">
        <input
          ref={inputRef}
          type="text"
          placeholder="Timeline name..."
          value={name}
          onChange={e => setName(e.target.value)}
          maxLength={100}
          disabled={isPending}
          autoFocus
          className="h-7 flex-1 rounded-sm border border-border bg-transparent px-2 text-sm outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring disabled:opacity-50"
          onKeyDown={e => {
            if (e.key === 'Escape') {
              setIsCreating(false);
              setName('');
            }
          }}
        />
        <Button type="submit" size="icon-xs" disabled={isPending || !name.trim()}>
          {isPending ? <Loader2 className="size-3 animate-spin" /> : <Plus className="size-3" />}
        </Button>
      </form>
    </div>
  );
}

// ============================================================
// TIMELINE SWITCHER
// ============================================================

function TimelineSwitcher({
  activeTimeline,
  initialTimelines
}: {
  activeTimeline?: ActiveTimeline;
  initialTimelines?: Array<TimelineSummary>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [timelines, setTimelines] = useState<Array<TimelineSummary>>(initialTimelines ?? []);
  const [loaded, setLoaded] = useState(initialTimelines != null);
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  // Fetch timelines eagerly on mount (to resolve active name) and when popover opens
  const fetchTimelines = useCallback(() => {
    if (isPending) return;
    startTransition(async () => {
      const result = await getTimelinesAction();
      if (result._tag === 'Success') {
        setTimelines(result.timelines);
        setLoaded(true);
      }
    });
  }, [isPending]);

  // Eager fetch on mount if not pre-loaded
  useEffect(() => {
    if (!loaded) {
      fetchTimelines();
    }
  }, [loaded, fetchTimelines]);

  useEffect(() => {
    if (open) {
      // Focus search input when opened
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      setQuery('');
    }
  }, [open]);

  // Refetch when popover reopens to catch newly created timelines
  useEffect(() => {
    if (open && loaded) {
      startTransition(async () => {
        const result = await getTimelinesAction();
        if (result._tag === 'Success') {
          setTimelines(result.timelines);
        }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const filtered = useMemo(() => {
    if (!query.trim()) return timelines;
    const q = query.toLowerCase();
    return timelines.filter(t => t.name.toLowerCase().includes(q));
  }, [timelines, query]);

  const handleSelect = (timeline: TimelineSummary) => {
    setOpen(false);
    if (timeline.id !== activeTimeline?.id) {
      router.push(`/timeline/${timeline.id}`);
    }
  };

  // Resolve name: prefer prop, fall back to fetched timelines list
  const resolvedName =
    activeTimeline?.name || timelines.find(t => t.id === activeTimeline?.id)?.name;
  const label = resolvedName || (activeTimeline ? '...' : 'Timelines');

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            className={cn(
              'flex h-8 max-w-48 items-center gap-1.5 rounded-md px-2 text-sm font-medium',
              'transition-colors hover:bg-muted',
              'outline-none focus-visible:ring-2 focus-visible:ring-ring'
            )}
          />
        }
      >
        <span className="truncate">{label}</span>
        <ChevronsUpDown className="size-3 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-64 p-0">
        {/* Search */}
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Search className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search timelines..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="h-6 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>

        {/* Timeline list */}
        <div className="max-h-64 overflow-y-auto p-1">
          {!loaded && isPending ? (
            <div className="px-3 py-4 text-center text-xs text-muted-foreground">Loading...</div>
          ) : filtered.length === 0 ? (
            <div className="px-3 py-4 text-center text-xs text-muted-foreground">
              {query ? 'No timelines found' : 'No timelines yet'}
            </div>
          ) : (
            filtered.map(t => {
              const isActive = t.id === activeTimeline?.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => handleSelect(t)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm',
                    'outline-none transition-colors',
                    isActive ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-muted'
                  )}
                >
                  <span
                    className={cn('size-1.5 shrink-0 rounded-full', ROLE_COLORS[t.role] ?? '')}
                    title={t.role}
                  />
                  <span className="flex-1 truncate text-left">{t.name}</span>
                  {isActive && <Check className="size-3.5 shrink-0 text-muted-foreground" />}
                </button>
              );
            })
          )}
        </div>

        {/* Footer: create new timeline */}
        <CreateTimelineInline onCreated={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}

// ============================================================
// BREADCRUMB SEPARATOR
// ============================================================

function SlashSeparator() {
  return (
    <span className="text-border select-none text-lg font-light" aria-hidden>
      /
    </span>
  );
}

// ============================================================
// APP HEADER
// ============================================================

export function AppHeader({ activeTimeline, timelines, actions }: AppHeaderProps) {
  const pathname = usePathname();
  const isSettings = pathname.endsWith('/settings');

  return (
    <header className="shrink-0 border-b border-border/50 bg-background/80 backdrop-blur-sm safe-pt">
      <div className="flex h-12 items-center justify-between gap-3 px-4 sm:px-6">
        {/* Left: Logo + breadcrumb + timeline switcher */}
        <div className="flex min-w-0 items-center gap-2">
          <Link
            href="/"
            className="shrink-0 text-base font-bold tracking-tight transition-colors hover:text-muted-foreground"
          >
            tidn
          </Link>

          <SlashSeparator />

          <TimelineSwitcher activeTimeline={activeTimeline} initialTimelines={timelines} />

          {isSettings && activeTimeline && (
            <>
              <SlashSeparator />
              <span className="text-sm text-muted-foreground">Settings</span>
            </>
          )}
        </div>

        {/* Right: Actions + nav links */}
        <div className="flex shrink-0 items-center gap-1">
          {actions}

          {activeTimeline && (
            <Link href={`/timeline/${activeTimeline.id}/settings`}>
              <Button variant="ghost" size="icon-sm" aria-label="Timeline settings">
                <Settings className="size-4" />
              </Button>
            </Link>
          )}

          <Separator orientation="vertical" className="mx-1 h-5" />

          <LogoutButton variant="ghost" size="icon-sm" aria-label="Sign out">
            <LogOut className="size-4" />
          </LogoutButton>
        </div>
      </div>
    </header>
  );
}
