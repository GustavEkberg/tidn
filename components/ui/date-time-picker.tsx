'use client';

import * as React from 'react';
import { format } from 'date-fns';
import { CalendarIcon } from 'lucide-react';
import type { Locale } from 'react-day-picker';

import { cn } from '@/lib/utils';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';

type DateTimePickerProps = {
  value: Date | undefined;
  onChange: (date: Date | undefined) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  /** date-fns locale for formatting. Uses browser default if omitted. */
  locale?: Locale;
};

export function DateTimePicker({
  value,
  onChange,
  placeholder = 'Pick date & time',
  className,
  disabled,
  locale
}: DateTimePickerProps) {
  const [open, setOpen] = React.useState(false);

  const handleDateSelect = (date: Date | undefined) => {
    if (!date) {
      onChange(undefined);
      return;
    }
    // Preserve time from current value, or use current time
    const hours = value?.getHours() ?? new Date().getHours();
    const minutes = value?.getMinutes() ?? new Date().getMinutes();
    date.setHours(hours, minutes);
    onChange(date);
  };

  const handleTimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const [hours, minutes] = e.target.value.split(':').map(Number);
    if (isNaN(hours) || isNaN(minutes)) return;

    const newDate = value ? new Date(value) : new Date();
    newDate.setHours(hours, minutes);
    onChange(newDate);
  };

  const timeValue = value
    ? `${value.getHours().toString().padStart(2, '0')}:${value.getMinutes().toString().padStart(2, '0')}`
    : '';

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled}
        className={cn(
          'border-input data-[placeholder]:text-muted-foreground dark:bg-input/30 dark:hover:bg-input/50 focus-visible:border-ring focus-visible:ring-ring/50 flex h-9 w-full items-center justify-between gap-2 rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
      >
        {value ? (
          format(value, 'PPP HH:mm', locale ? { locale } : undefined)
        ) : (
          <span className="text-muted-foreground">{placeholder}</span>
        )}
        <CalendarIcon className="size-4 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={value}
          onSelect={handleDateSelect}
          locale={locale}
          initialFocus
        />
        <div className="border-t p-3">
          <Input type="time" value={timeValue} onChange={handleTimeChange} className="w-full" />
        </div>
      </PopoverContent>
    </Popover>
  );
}
