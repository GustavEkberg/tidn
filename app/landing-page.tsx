'use client';

import { motion } from 'motion/react';
import Link from 'next/link';

import { AuthBackground } from '@/components/auth-background';
import { buttonVariants } from '@/components/ui/button';

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0 }
};

export function LandingPage() {
  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden px-6">
      <AuthBackground />
      <motion.div
        className="relative flex max-w-xl flex-col items-center gap-6 text-center"
        initial="hidden"
        animate="visible"
        transition={{ staggerChildren: 0.12 }}
      >
        <motion.h1
          className="text-7xl font-bold tracking-tight sm:text-8xl"
          variants={fadeUp}
          transition={{ duration: 0.5 }}
        >
          tidn
        </motion.h1>
        <motion.p
          className="text-xl text-muted-foreground sm:text-2xl"
          variants={fadeUp}
          transition={{ duration: 0.5 }}
        >
          Your memories. Your photos and videos.
          <br />
          Collected together, organized by time.
          <br />
          Nothing else.
        </motion.p>
        <motion.div variants={fadeUp} transition={{ duration: 0.5 }}>
          <Link href="/login" className={buttonVariants({ size: 'lg' })}>
            Log in
          </Link>
        </motion.div>
      </motion.div>
    </main>
  );
}
