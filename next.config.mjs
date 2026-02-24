/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow fetching from Supabase storage if used for team logos etc.
  images: {
    remotePatterns: [
      { hostname: '*.supabase.co' },
      { hostname: 'media.cricheroes.in' },
    ],
  },
};

export default nextConfig;
