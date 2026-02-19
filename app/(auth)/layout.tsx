import type { Metadata } from 'next';
import { AuthBackground } from '@/components/auth-background';

export const metadata: Metadata = {
  title: 'tidn',
  description: 'tidn'
};

export default async function Layout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="relative min-h-dvh flex items-center justify-center overflow-hidden">
      <AuthBackground />
      <div className="relative z-10 flex flex-col justify-center items-center gap-8 w-full mx-8 md:max-w-lg md:mx-auto">
        <h1 className="text-7xl font-bold tracking-tight sm:text-8xl">tidn</h1>
        {children}
      </div>
    </div>
  );
}
