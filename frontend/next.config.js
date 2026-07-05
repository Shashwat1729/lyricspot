/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  basePath: "/continuemysong-ai",
  assetPrefix: "/continuemysong-ai/",
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
};

module.exports = nextConfig;
