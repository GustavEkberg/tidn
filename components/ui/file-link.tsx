'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

type Props = {
  /** Action that resolves a signed URL for the file */
  getUrl: (
    fileUrl: string
  ) => Promise<{ _tag: 'Success'; signedUrl: string } | { _tag: 'Error'; message: string }>;
  fileUrl: string;
  children: React.ReactNode;
  className?: string;
};

/**
 * A link component that fetches a signed URL before opening the file.
 * Use this for any S3 files that require authentication.
 *
 * Decoupled from specific server actions — pass your own `getUrl` function.
 *
 * @example
 * ```tsx
 * <FileLink fileUrl={receipt.fileUrl} getUrl={getDownloadUrlAction}>
 *   View Receipt
 * </FileLink>
 * ```
 */
export function FileLink({ getUrl, fileUrl, children, className }: Props) {
  const [loading, setLoading] = useState(false);

  const handleClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    setLoading(true);

    const result = await getUrl(fileUrl);

    if (result._tag === 'Error') {
      toast.error(result.message);
      setLoading(false);
      return;
    }

    window.open(result.signedUrl, '_blank');
    setLoading(false);
  };

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className={cn('text-primary hover:underline cursor-pointer disabled:opacity-50', className)}
    >
      {loading ? 'Loading...' : children}
    </button>
  );
}
