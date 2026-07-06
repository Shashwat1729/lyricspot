/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  basePath: "/lyricspot",
  assetPrefix: "/lyricspot/",
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
};

module.exports = nextConfig;

