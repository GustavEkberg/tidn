'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

export type MentionSuggestion = {
  id: string;
  name: string;
  subtitle?: string;
};

type Props = {
  value: string;
  onChange: (value: string) => void;
  onMentionsChange: (mentionIds: string[]) => void;
  suggestions: MentionSuggestion[];
  placeholder?: string;
  maxLength?: number;
  rows?: number;
  className?: string;
  disabled?: boolean;
};

export function MentionInput({
  value,
  onChange,
  onMentionsChange,
  suggestions,
  placeholder,
  maxLength,
  rows = 2,
  className,
  disabled
}: Props) {
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const [showSuggestions, setShowSuggestions] = React.useState(false);
  const [suggestionFilter, setSuggestionFilter] = React.useState('');
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const [mentionStartIndex, setMentionStartIndex] = React.useState<number | null>(null);

  // Track mentioned IDs
  const mentionedIdsRef = React.useRef<Set<string>>(new Set());

  const filteredSuggestions = React.useMemo(() => {
    if (!suggestionFilter) return suggestions;
    const lower = suggestionFilter.toLowerCase();
    return suggestions.filter(s => s.name.toLowerCase().includes(lower));
  }, [suggestions, suggestionFilter]);

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    const cursorPos = e.target.selectionStart;

    onChange(newValue);

    // Check if we're typing after @
    const textBeforeCursor = newValue.slice(0, cursorPos);
    const lastAtIndex = textBeforeCursor.lastIndexOf('@');

    if (lastAtIndex !== -1) {
      const textAfterAt = textBeforeCursor.slice(lastAtIndex + 1);
      // Check if there's a space or newline between @ and cursor
      if (!textAfterAt.includes(' ') && !textAfterAt.includes('\n')) {
        setMentionStartIndex(lastAtIndex);
        setSuggestionFilter(textAfterAt);
        setShowSuggestions(true);
        setSelectedIndex(0);
        return;
      }
    }

    setShowSuggestions(false);
    setMentionStartIndex(null);
    setSuggestionFilter('');
  };

  const insertMention = (suggestion: MentionSuggestion) => {
    if (mentionStartIndex === null) return;

    const textarea = textareaRef.current;
    if (!textarea) return;

    const beforeMention = value.slice(0, mentionStartIndex);
    const afterCursor = value.slice(textarea.selectionStart);
    const mentionText = `@${suggestion.name}`;

    const newValue = beforeMention + mentionText + ' ' + afterCursor;
    onChange(newValue);

    // Track this mention
    mentionedIdsRef.current.add(suggestion.id);
    onMentionsChange(Array.from(mentionedIdsRef.current));

    // Reset state
    setShowSuggestions(false);
    setMentionStartIndex(null);
    setSuggestionFilter('');

    // Set cursor position after mention
    setTimeout(() => {
      const newCursorPos = beforeMention.length + mentionText.length + 1;
      textarea.selectionStart = newCursorPos;
      textarea.selectionEnd = newCursorPos;
      textarea.focus();
    }, 0);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!showSuggestions || filteredSuggestions.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(i => (i + 1) % filteredSuggestions.length);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(i => (i - 1 + filteredSuggestions.length) % filteredSuggestions.length);
        break;
      case 'Enter':
      case 'Tab':
        e.preventDefault();
        insertMention(filteredSuggestions[selectedIndex]);
        break;
      case 'Escape':
        e.preventDefault();
        setShowSuggestions(false);
        break;
    }
  };

  // Reset mentions when value is cleared
  React.useEffect(() => {
    if (!value) {
      mentionedIdsRef.current.clear();
      onMentionsChange([]);
    }
  }, [value, onMentionsChange]);

  return (
    <div className="relative">
      <textarea
        ref={textareaRef}
        data-slot="textarea"
        value={value}
        onChange={handleInput}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          // Delay hiding to allow click on suggestion
          setTimeout(() => setShowSuggestions(false), 150);
        }}
        placeholder={placeholder}
        maxLength={maxLength}
        rows={rows}
        disabled={disabled}
        className={cn(
          'border-input dark:bg-input/30 focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 rounded-md border bg-transparent px-2.5 py-2 text-base shadow-xs transition-[color,box-shadow] focus-visible:ring-[3px] aria-invalid:ring-[3px] md:text-sm placeholder:text-muted-foreground flex field-sizing-content min-h-16 w-full outline-none disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
      />

      {showSuggestions && filteredSuggestions.length > 0 && (
        <div className="absolute z-50 mt-1 w-full max-h-48 overflow-y-auto rounded-md border bg-popover shadow-md">
          {filteredSuggestions.map((suggestion, index) => (
            <button
              key={suggestion.id}
              type="button"
              className={cn(
                'w-full px-3 py-2 text-left hover:bg-accent',
                index === selectedIndex && 'bg-accent'
              )}
              onMouseDown={e => {
                e.preventDefault();
                insertMention(suggestion);
              }}
            >
              <div className="text-sm">{suggestion.name}</div>
              {suggestion.subtitle && (
                <div className="text-xs text-muted-foreground">{suggestion.subtitle}</div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
