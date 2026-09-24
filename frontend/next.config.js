/** @type {import('next').NextConfig} */

// BASE_PATH: "" for local dev / Docker, "/lyricspot" for the GitHub Pages
// build (npm run build:pages). NEXT_OUTPUT=standalone for the Docker image;
// everything else is a static export that needs no server.
const basePath = (process.env.BASE_PATH || "").replace(/\/+$/, "");
const standalone = process.env.NEXT_OUTPUT === "standalone";

const nextConfig = {
  output: standalone ? "standalone" : "export",
  basePath: basePath || undefined,
  assetPrefix: basePath ? basePath + "/" : undefined,
  trailingSlash: true,
  images: { unoptimized: true },
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
};

module.exports = nextConfig;
