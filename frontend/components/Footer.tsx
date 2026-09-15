'use client';

import { motion } from "framer-motion";
import { Music2, Github, Heart } from "lucide-react";

export function Footer() {
  return (
    <motion.footer
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.8 }}
      className="w-full px-4 py-8 mt-auto"
    >
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-sm">
        <p className="flex items-center gap-2 text-gray-500">
          <Music2 className="w-4 h-4 text-gray-600" />
          <span>&copy; {new Date().getFullYear()} ContinueMySong</span>
        </p>
        <div className="flex items-center gap-4">
          <a
            href="https://github.com/Shashwat1729/lyricspot"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 text-gray-500 hover:text-white transition-colors"
          >
            <Github className="w-3.5 h-3.5" />
            <span>Source</span>
          </a>
        </div>
      </div>
    </motion.footer>
  );
}

