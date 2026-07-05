'use client';

import { motion } from 'framer-motion';
import { Mic, Search, Play } from 'lucide-react';

const featurePills = ['Speech Recognition', 'Song Identification', 'Spotify Integration'];

interface HeroSectionProps {
  minimal?: boolean;
}

function FloatingParticles() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {[...Array(6)].map((_, i) => (
        <div
          key={i}
          className="particle"
          style={{
            left: `${15 + i * 14}%`,
            animationDelay: `${i * 1.2}s`,
            animationDuration: `${8 + i * 1.5}s`,
          }}
        />
      ))}
    </div>
  );
}

export function HeroSection({ minimal = false }: HeroSectionProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.2 }}
      className="relative px-4 text-center"
    >
      {!minimal && <FloatingParticles />}

      {/* Ambient glow */}
      <div className="pointer-events-none absolute -top-20 left-1/2 -translate-x-1/2 h-40 w-[500px] bg-[radial-gradient(ellipse,_rgba(29,185,84,0.08)_0%,_transparent_70%)] blur-2xl" />
      <div className="pointer-events-none absolute -top-32 left-1/3 -translate-x-1/2 h-60 w-[300px] bg-[radial-gradient(ellipse,_rgba(29,185,84,0.04)_0%,_transparent_70%)] blur-3xl hidden sm:block" />

      {minimal ? (
        <motion.h1
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="relative text-2xl font-bold tracking-tight text-white"
        >
          Continue My Song
        </motion.h1>
      ) : (
        <>
          <motion.h1
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="relative text-4xl font-bold tracking-tight leading-tight sm:text-5xl md:text-6xl"
          >
            <span className="text-white">
              Sing a lyric.
            </span>
            <br />
            <span className="bg-gradient-to-r from-green-400 via-emerald-400 to-green-500 bg-clip-text text-transparent">
              We'll find the song.
            </span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="mx-auto mt-5 max-w-xl text-base leading-7 text-gray-400 sm:text-lg"
          >
            Sing or hum any part of a song. We'll identify it and continue
            playing from exactly where you left off on Spotify.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="mt-6 flex flex-wrap justify-center gap-2 text-xs text-gray-500"
          >
            {featurePills.map((feature, i) => (
              <motion.div
                key={feature}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.3, delay: 0.4 + i * 0.1 }}
                className="flex items-center gap-1.5 rounded-full border border-white/[0.06] bg-white/[0.02] px-3 py-1.5 hover:border-green-500/20 hover:bg-green-500/[0.03] transition-colors"
              >
                <span className="h-1 w-1 rounded-full bg-green-500" />
                <span>{feature}</span>
              </motion.div>
            ))}
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.5 }}
            className="mt-8 flex items-center justify-center gap-4 text-xs text-gray-500"
          >
            {[
              { icon: Mic, label: 'Sing', delay: 0 },
              { icon: Search, label: 'Identify', delay: 0.15 },
              { icon: Play, label: 'Play', delay: 0.3 },
            ].map((step, i) => (
              <motion.div
                key={step.label}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.6 + step.delay }}
                className="flex items-center gap-2"
              >
                <span className="flex items-center justify-center w-7 h-7 rounded-full bg-green-500/10">
                  <step.icon className="w-3.5 h-3.5 text-green-400" />
                </span>
                <span>{step.label}</span>
                {i < 2 && (
                  <span className="text-gray-700 mx-1 hidden sm:inline">→</span>
                )}
              </motion.div>
            ))}
          </motion.div>
        </>
      )}
    </motion.div>
  );
}
