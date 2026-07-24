/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  distDir: process.env.NEXT_DIST_DIR_OVERRIDE || ".next",
};

module.exports = nextConfig;
