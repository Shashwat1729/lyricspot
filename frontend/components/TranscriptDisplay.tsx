'use client';

import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

interface TranscriptDisplayProps {
  text: string;
  animate?: boolean;
}

export function TranscriptDisplay({ text, animate = true }: TranscriptDisplayProps) {
  const [displayedText, setDisplayedText] = useState('');
  const [isComplete, setIsComplete] = useState(false);

  useEffect(() => {
    if (!animate) {
      setDisplayedText(text);
      setIsComplete(true);
      return;
    }

    setDisplayedText('');
    setIsComplete(false);
    
    let currentIndex = 0;
    const interval = setInterval(() => {
      if (currentIndex < text.length) {
        setDisplayedText(text.slice(0, currentIndex + 1));
        currentIndex++;
      } else {
        setIsComplete(true);
        clearInterval(interval);
      }
    }, 30);

    return () => clearInterval(interval);
  }, [text, animate]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="p-4 rounded-lg glass"
    >
      <p className="text-sm text-gray-400 mb-2">You sang:</p>
      <p className="text-lg text-white font-medium">
        &ldquo;{displayedText}&rdquo;
        {!isComplete && (
          <span className="inline-block w-0.5 h-5 bg-spotify-green ml-1 animate-pulse" />
        )}
      </p>
    </motion.div>
  );
}
