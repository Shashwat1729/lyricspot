import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, DM_Sans, Instrument_Serif, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const display = Bricolage_Grotesque({ subsets: ["latin"], weight: ["500", "700"], variable: "--font-display", display: "swap" });
const sans = DM_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-sans", display: "swap" });
const lyric = Instrument_Serif({ subsets: ["latin"], weight: "400", style: ["normal", "italic"], variable: "--font-lyric", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: "500", variable: "--font-mono", display: "swap" });

// Next applies basePath to page links but not to metadata icon/manifest
// URLs, so prefix them explicitly (empty locally, "/lyricspot" on Pages).
const base = process.env.NEXT_PUBLIC_BASE_PATH || "";

export const metadata: Metadata = {
  title: "LyricSpot — sing a line, find the song",
  description:
    "Sing or type the one lyric stuck in your head. LyricSpot finds the song and drops you at the exact second that line plays.",
  keywords: ["lyrics", "song finder", "identify song by lyrics", "sing to search", "Spotify", "music"],
  authors: [{ name: "Shashwat Bajpai", url: "https://github.com/Shashwat1729" }],
  icons: { icon: base + "/favicon.svg" },
  manifest: base + "/manifest.json",
  openGraph: {
    title: "LyricSpot",
    description: "Sing a line, find the song, keep listening from that exact second.",
    type: "website",
    siteName: "LyricSpot",
  },
  twitter: { card: "summary", title: "LyricSpot", description: "Sing a line, find the song." },
};

export const viewport: Viewport = {
  themeColor: "#0E0F0C",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={[display.variable, sans.variable, lyric.variable, mono.variable].join(" ")}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
