'use client';

import { useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Mic, Square, AlertCircle, RefreshCw, X } from "lucide-react";
import { AnimatedWaveform } from "./AnimatedWaveform";
import { uploadAudio, ApiResponse } from "@/lib/api";

type RecorderState = "idle" | "recording" | "uploading" | "processing" | "error";

interface MicRecorderProps {
  onResult: (data: ApiResponse) => void;
  onLoadingChange?: (loading: boolean, status?: "uploading" | "processing") => void;
}

const MAX_DURATION = 30;
const MIN_DURATION = 3;

export function MicRecorder({ onResult, onLoadingChange }: MicRecorderProps) {
  const [state, setState] = useState<RecorderState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [recordingTime, setRecordingTime] = useState(0);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [isSupported, setIsSupported] = useState(true);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const cancelledRef = useRef(false);
  const onResultRef = useRef(onResult);
  const onLoadingChangeRef = useRef(onLoadingChange);
  const recordingTimeRef = useRef(0);

  useEffect(() => { onResultRef.current = onResult; }, [onResult]);
  useEffect(() => { onLoadingChangeRef.current = onLoadingChange; }, [onLoadingChange]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setIsSupported(!!(navigator.mediaDevices?.getUserMedia));
    }
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    };
  }, []);

  const formatTime = (seconds: number): string => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m + ":" + s.toString().padStart(2, "0");
  };

  const stopTracks = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const handleUpload = useCallback(async (blob: Blob) => {
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      setState("uploading");
      onLoadingChangeRef.current?.(true, "uploading");
      await new Promise(r => setTimeout(r, 400));

      if (abortController.signal.aborted) return;
      setState("processing");
      onLoadingChangeRef.current?.(true, "processing");

      const result = await uploadAudio(blob, abortController.signal);
      if (abortController.signal.aborted) return;

      if (result.success) {
        onResultRef.current(result);
        setState("idle");
      } else {
        throw new Error(result.error || "Failed to process audio");
      }
    } catch (err) {
      if (abortController.signal.aborted) return;
      const message = err instanceof Error ? err.message : "Failed to process audio.";
      if (message.includes("timeout") || message.includes("ECONNABORTED")) {
        setError("Request timed out. The server may be loading the AI model for the first time.");
      } else if (message.includes("Network Error") || message.includes("ERR_NETWORK")) {
        setError("Cannot reach the server. Please ensure the backend is running on port 8000.");
      } else {
        setError(message);
      }
      setState("error");
    } finally {
      abortControllerRef.current = null;
      onLoadingChangeRef.current?.(false);
    }
  }, []);

  const startRecording = useCallback(async () => {
    try {
      setError(null);
      setPermissionDenied(false);

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 44100 },
      });
      streamRef.current = stream;

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "audio/mp4";

      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      mediaRecorder.onstop = () => {
        if (cancelledRef.current) {
          cancelledRef.current = false;
          return;
        }
        const blob = new Blob(chunksRef.current, { type: mimeType });
        handleUpload(blob);
      };

      mediaRecorder.start(100);
      setState("recording");
      setRecordingTime(0);
      recordingTimeRef.current = 0;

      timerRef.current = setInterval(() => {
        setRecordingTime((prev) => {
          const next = prev + 1;
          recordingTimeRef.current = next;
          if (next >= MAX_DURATION) {
            mediaRecorderRef.current?.stop();
            stopTracks();
            stopTimer();
            return MAX_DURATION;
          }
          return next;
        });
      }, 1000);
    } catch (err) {
      if (err instanceof DOMException) {
        if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
          setPermissionDenied(true);
          setError("Microphone access denied. Please allow microphone access and try again.");
        } else if (err.name === "NotFoundError") {
          setError("No microphone found. Please connect a microphone.");
        } else {
          setError("Could not access microphone. Please check your device settings.");
        }
      } else {
        setError("An unexpected error occurred.");
      }
      setState("error");
    }
  }, [handleUpload, stopTracks, stopTimer]);

  const stopRecording = useCallback(() => {
    stopTimer();
    if (recordingTimeRef.current < MIN_DURATION) {
      setError("Please record at least 3 seconds of singing.");
      cancelledRef.current = true;
      stopTracks();
      mediaRecorderRef.current?.stop();
      setState("idle");
      return;
    }
    mediaRecorderRef.current?.stop();
    stopTracks();
  }, [stopTimer, stopTracks]);

  const handleCancel = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    onLoadingChangeRef.current?.(false);
    setState("idle");
    setRecordingTime(0);
  }, []);

  const handleRetry = useCallback(() => {
    setError(null);
    setPermissionDenied(false);
    setState("idle");
    setRecordingTime(0);
  }, []);

  if (!isSupported) {
    return (
      <div className="text-center p-8 glass rounded-2xl">
        <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
        <h3 className="text-xl font-semibold text-white mb-2">Browser Not Supported</h3>
        <p className="text-gray-400">
          Your browser does not support audio recording. Please use Chrome, Firefox, or Safari.
        </p>
      </div>
    );
  }

  return (
    <>
      {(state === "uploading" || state === "processing") && (
        <motion.button
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          onClick={handleCancel}
          className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-5 py-2.5 rounded-full bg-red-500/20 border border-red-500/50 text-red-400 hover:bg-red-500/30 transition-colors backdrop-blur-sm"
        >
          <X className="w-4 h-4" />
          Cancel
        </motion.button>
      )}

      <AnimatePresence mode="wait">
        {state === "idle" && (
          <motion.div
            key="idle"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.3 }}
            className="flex flex-col items-center"
          >
            <div className="relative">
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="absolute w-28 h-28 sm:w-32 sm:h-32 rounded-full border border-green-500/20 ambient-ring" />
                <div className="absolute w-36 h-36 sm:w-40 sm:h-40 rounded-full border border-green-500/10 ambient-ring-delayed" />
                <div className="absolute w-44 h-44 sm:w-48 sm:h-48 rounded-full border border-green-500/5 ambient-ring-delayed-2" />
              </div>

              <motion.button
                onClick={startRecording}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.97 }}
                className="relative w-28 h-28 sm:w-32 sm:h-32 rounded-full bg-transparent border-2 border-green-500 hover:bg-green-500/10 flex items-center justify-center shadow-[0_0_30px_rgba(29,185,84,0.2)] transition-all hover:shadow-[0_0_40px_rgba(29,185,84,0.3)]"
                aria-label="Start recording"
              >
                <Mic className="w-10 h-10 sm:w-12 sm:h-12 text-green-500" />
              </motion.button>
            </div>

            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2 }}
              className="mt-6 text-gray-400 text-center"
            >
              Tap to start singing
            </motion.p>
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4 }}
              className="mt-1 text-xs text-gray-600"
            >
              Max 30 seconds, minimum 3 seconds
            </motion.p>
          </motion.div>
        )}

        {state === "recording" && (
          <motion.div
            key="recording"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.3 }}
            className="flex flex-col items-center w-full"
          >
            <div className="glass rounded-2xl p-8 w-full max-w-md">
              <div className="text-center mb-6">
                <motion.div
                  animate={{ scale: [1, 1.1, 1] }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                  className="w-4 h-4 rounded-full bg-red-500 mx-auto mb-4"
                />
                <p className="text-2xl font-mono text-white">{formatTime(recordingTime)}</p>
                <p className="text-sm text-gray-400 mt-1">Recording...</p>
                <div className="mt-3 progress-timeline">
                  <div
                    className="progress-timeline-bar"
                    style={{ width: (recordingTime / MAX_DURATION) * 100 + "%" }}
                  />
                </div>
              </div>

              <AnimatedWaveform isActive={true} />

              <motion.button
                onClick={stopRecording}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="w-full mt-6 py-4 rounded-xl bg-red-500 hover:bg-red-600 text-white font-semibold flex items-center justify-center gap-2 transition-all"
              >
                <Square className="w-5 h-5" />
                <span>Stop Recording</span>
              </motion.button>
            </div>
          </motion.div>
        )}

        {state === "error" && (
          <motion.div
            key="error"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.3 }}
            className="flex flex-col items-center w-full max-w-md"
          >
            <div className="glass rounded-2xl p-8 w-full text-center">
              <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center mx-auto mb-4">
                <AlertCircle className="w-8 h-8 text-red-400" />
              </div>

              <h3 className="text-xl font-semibold text-white mb-2">
                {permissionDenied ? "Microphone Access Required" : "Something went wrong"}
              </h3>

              <p className="text-gray-400 mb-6">{error}</p>

              {permissionDenied && (
                <div className="text-sm text-gray-500 mb-6 p-4 glass rounded-lg">
                  <p className="mb-2">To enable microphone access:</p>
                  <ol className="text-left list-decimal list-inside space-y-1">
                    <li>Click the lock/info icon in your browser&apos;s address bar</li>
                    <li>Find "Microphone" in the permissions</li>
                    <li>Change it to "Allow"</li>
                    <li>Refresh the page</li>
                  </ol>
                </div>
              )}

              <motion.button
                onClick={handleRetry}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="px-8 py-4 rounded-xl bg-spotify-green hover:bg-spotify-green-light text-black font-semibold flex items-center justify-center gap-2 mx-auto transition-all"
              >
                <RefreshCw className="w-5 h-5" />
                <span>Try Again</span>
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
