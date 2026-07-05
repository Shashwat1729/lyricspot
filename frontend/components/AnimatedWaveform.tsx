'use client';

import { motion } from 'framer-motion';

interface AnimatedWaveformProps {
  isActive: boolean;
}

export function AnimatedWaveform({ isActive }: AnimatedWaveformProps) {
  const bars = [0, 1, 2, 3, 4, 5, 6];
  
  return (
    <div className="flex items-center justify-center gap-1 h-16">
      {bars.map((index) => (
        <motion.div
          key={index}
          className="w-2 bg-spotify-green rounded-full"
          initial={{ height: 8 }}
          animate={
            isActive
              ? {
                  height: [8, 32, 16, 48, 24, 40, 8],
                  transition: {
                    duration: 1.2,
                    repeat: Infinity,
                    delay: index * 0.1,
                    ease: 'easeInOut',
                  },
                }
              : { height: 8 }
          }
          style={{
            boxShadow: isActive
              ? '0 0 10px rgba(29, 185, 84, 0.5)'
              : 'none',
          }}
        />
      ))}
    </div>
  );
}
