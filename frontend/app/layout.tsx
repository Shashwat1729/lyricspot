import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "ContinueMySong - Sing a lyric, find your song instantly",
  description:
    "Sing or type any lyric to identify the song instantly and continue listening on Spotify. AI-powered music recognition with local processing.",
  keywords: [
    "music",
    "Spotify",
    "song identification",
    "lyrics",
    "singing",
    "music recognition",
    "AI",
    "Whisper",
  ],
  authors: [{ name: "Shashwat Bajpai", url: "https://github.com/Shashwat1729" }],
  creator: "Shashwat Bajpai",
  icons: {
    icon: "/favicon.svg",
  },
  manifest: "/manifest.json",
  openGraph: {
    title: "ContinueMySong - Find Any Song by Singing",
    description: "Sing a lyric and find the song instantly. Powered by local AI.",
    type: "website",
    locale: "en_US",
    siteName: "ContinueMySong",
  },
  twitter: {
    card: "summary_large_image",
    title: "ContinueMySong",
    description: "Sing a lyric and find the song instantly.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export const viewport: Viewport = {
  themeColor: "#1DB954",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className={inter.className + " bg-dark-900 text-white antialiased"}>
        {children}
      </body>
    </html>
  );
}
