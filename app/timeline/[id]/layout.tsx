'use client';

import { use } from 'react';
import { AppHeader } from '@/components/app-header';

type Props = {
  params: Promise<{ id: string }>;
  children: React.ReactNode;
};

export default function TimelineLayout({ params, children }: Props) {
  const { id } = use(params);

  return (
    <div className="flex h-dvh flex-col">
      <AppHeader activeTimeline={{ id, name: '' }} />
      {children}
    </div>
  );
}
