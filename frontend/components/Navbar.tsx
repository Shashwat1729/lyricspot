'use client';

import { useEffect, useState } from "react";
import { Github, Music2, Star } from "lucide-react";
import { motion } from "framer-motion";
import { SettingsButton } from "./SettingsModal";

export function Navbar() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <motion.nav
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.5 }}
      className={"w-full px-4 sm:px-6 py-4 sticky top-0 z-50 transition-all duration-300 " +
        (scrolled
          ? "bg-black/80 backdrop-blur-xl border-b border-white/[0.06]"
          : "bg-transparent")}
    >
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-3">
          <motion.div
            whileHover={{ scale: 1.05, rotate: -5 }}
            className="p-2 rounded-lg bg-spotify-green/20 glow-spotify"
          >
            <Music2 className="w-6 h-6 text-spotify-green" />
          </motion.div>
          <span className="text-xl sm:text-2xl font-bold bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
            ContinueMySong
          </span>
        </div>

        <div className="flex items-center gap-4">
          <SettingsButton />
          <a
            href="https://github.com/Shashwat1729/lyricspot"
            target="_blank"
            rel="noreferrer"
            aria-label="GitHub repository"
            className="flex items-center gap-2 text-sm text-gray-400 transition-colors hover:text-white group"
          >
            <Github className="w-4 h-4 transition-transform group-hover:scale-110" />
            <span className="hidden sm:inline">GitHub</span>
          </a>
          <a
            href="https://github.com/Shashwat1729/lyricspot/stargazers"
            target="_blank"
            rel="noreferrer"
            aria-label="Star on GitHub"
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-white/[0.04] border border-white/[0.08] text-gray-400 hover:text-yellow-400 hover:border-yellow-400/30 hover:bg-yellow-400/5 transition-all"
          >
            <Star className="w-3 h-3" />
            <span>Star</span>
          </a>
        </div>
      </div>
    </motion.nav>
  );
}

