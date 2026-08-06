'use client';

import { Button } from '@/components/ui/button';
import { authClient } from '@/lib/services/auth/auth-client';
import type { ComponentProps } from 'react';

type LogoutButtonProps = ComponentProps<typeof Button>;

export const LogoutButton = ({ className, ...props }: LogoutButtonProps) => {
  // const sendTelegram = useSendTelegram()

  const handleLogout = async () => {
    // const { data: session } = await authClient.getSession()
    // const email = session?.user.email ?? 'Unknown'

    authClient.signOut({
      fetchOptions: {
        onSuccess: async () => {
          // sendTelegram(`🚪 User logged out: ${email}`)

          // We cannot use router.push, or the layout will not be updated, since router.push doesn't revalidate layouts while using cache components
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- Full reload clears authenticated layout caches.
          window.location.href = '/';
        }
      }
    });
  };

  return <Button {...props} onClick={handleLogout} className={className} />;
};
