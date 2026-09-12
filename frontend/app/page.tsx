'use client';

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Navbar } from '@/components/Navbar';
import { HeroSection } from '@/components/HeroSection';
import { MicRecorder } from '@/components/MicRecorder';
import TextInput from '@/components/TextInput';
import ResultCard from '@/components/ResultCard';
import { Footer } from '@/components/Footer';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { LoadingOverlay } from '@/components/LoadingOverlay';
import { Mic, Keyboard } from 'lucide-react';

export default function Home() {
  const [result, setResult] = useState<any>(null);
  const [showResult, setShowResult] = useState(false);
  const [mode, setMode] = useState('mic');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<any>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (showResult && resultsRef.current) {
      setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    }
  }, [showResult]);

  const handleResult = (data: any) => {
    setResult(data);
    setShowResult(true);
    setLoading(false);
    setProgress(null);
  };

  const handleReset = () => {
    setResult(null);
    setShowResult(false);
  };

  const handleLoadingChange = (isLoading: boolean, progressEvent?: any) => {
    setLoading(isLoading);
    if (progressEvent && typeof progressEvent === 'object') setProgress(progressEvent);
    else setProgress(null);
  };

  return (
    <main className="min-h-screen flex flex-col">
      <Navbar />
      <ErrorBoundary>
        <div className={'flex-1 flex flex-col items-center px-4 ' + (showResult ? 'pt-6 sm:pt-8' : 'pt-[12vh] sm:pt-[15vh] py-8 sm:py-12')}>
          <AnimatePresence mode="wait">
            <motion.div
              key={loading || showResult ? 'minimal' : 'full'}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
            >
              <HeroSection minimal={loading || showResult} />
            </motion.div>
          </AnimatePresence>

          <div className="w-full max-w-2xl mx-auto mt-8 sm:mt-12">
            {!showResult ? (
              <>
                <div className="flex justify-center mb-8">
                  <div className="relative inline-flex items-center rounded-full bg-[#111] border border-white/[0.06] p-1">
                    <button onClick={() => setMode('mic')}
                      className={'relative z-10 flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium transition-colors ' + (mode === 'mic' ? 'text-green-400' : 'text-gray-400 hover:text-white')}>
                      {mode === 'mic' && (
                        <motion.span layoutId="mode-indicator" className="absolute inset-0 -z-10 rounded-full border border-green-500/30 bg-green-500/20" transition={{ type: 'tween', duration: 0.2 }} />
                      )}
                      <Mic className="h-4 w-4" /><span>Voice</span>
                    </button>
                    <button onClick={() => setMode('text')}
                      className={'relative z-10 flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium transition-colors ' + (mode === 'text' ? 'text-green-400' : 'text-gray-400 hover:text-white')}>
                      {mode === 'text' && (
                        <motion.span layoutId="mode-indicator" className="absolute inset-0 -z-10 rounded-full border border-green-500/30 bg-green-500/20" transition={{ type: 'tween', duration: 0.2 }} />
                      )}
                      <Keyboard className="h-4 w-4" /><span>Lyrics</span>
                    </button>
                  </div>
                </div>

                {loading && (
                  <div className="mb-8">
                    <LoadingOverlay isVisible={loading} progress={progress} />
                  </div>
                )}

                {!loading && (
                  <AnimatePresence mode="wait">
                    {mode === 'mic' ? (
                      <motion.div key="mic-mode" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
                        <MicRecorder onResult={handleResult} onLoadingChange={handleLoadingChange} />
                      </motion.div>
                    ) : (
                      <motion.div key="text-mode" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
                        <TextInput onResult={handleResult} onLoadingChange={handleLoadingChange} />
                      </motion.div>
                    )}
                  </AnimatePresence>
                )}
              </>
            ) : (
              <div ref={resultsRef}>
                {result && result.results && (
                  <ResultCard results={result.results} transcript={result.transcript} onTryAgain={handleReset} confidenceLabel={result.confidence_label} />
                )}
              </div>
            )}
          </div>
        </div>
      </ErrorBoundary>
      <Footer />
    </main>
  );
}