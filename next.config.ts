import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactCompiler: true,
  serverExternalPackages: ['ffmpeg-static', 'ffprobe-static', 'sharp']
};

export default nextConfig;
