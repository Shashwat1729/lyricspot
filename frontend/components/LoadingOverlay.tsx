'use client';

import { motion } from "framer-motion";
import {
  Search,
  Music2,
  FileText,
  Target,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import type { ProgressEvent } from "@/lib/api";

interface LoadingOverlayProps {
  isVisible: boolean;
  progress?: ProgressEvent | null;
  status?: "uploading" | "processing";
}

const stages = [
  { id: "searching", label: "Searching", icon: Search },
  { id: "found", label: "Candidates found", icon: Music2 },
  { id: "lyrics", label: "Analyzing", icon: FileText },
  { id: "candidate_ready", label: "Results arriving", icon: Target },
  { id: "complete", label: "Done", icon: CheckCircle2 },
];

function getStageIndex(stage?: string): number {
  if (!stage) return -1;
  return stages.findIndex((s) => s.id === stage);
}

function SkeletonCard() {
  return (
    <div className="glass-card rounded-xl p-5">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-xl shimmer" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-2/3 shimmer rounded" />
          <div className="h-3 w-1/3 shimmer rounded" />
        </div>
        <div className="w-12 h-12 rounded-full shimmer" />
      </div>
    </div>
  );
}

export function LoadingOverlay({
  isVisible,
  progress,
  status = "processing",
}: LoadingOverlayProps) {
  const currentStageIndex = getStageIndex(progress?.stage);

  if (!isVisible) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="w-full max-w-md mx-auto"
      role="status"
      aria-live="polite"
      aria-label="Processing your request"
    >
      <div className="glass-premium rounded-xl p-5 mb-4">
        <div className="flex items-center gap-3 mb-4">
          <motion.div
            animate={
              progress?.stage === "complete"
                ? { scale: [1, 1.2, 1] }
                : { rotate: 360 }
            }
            transition={
              progress?.stage === "complete"
                ? { duration: 0.3 }
                : { repeat: Infinity, duration: 1.5, ease: "linear" }
            }
            className="w-8 h-8 rounded-full border border-green-500/30 flex items-center justify-center"
          >
            {progress?.stage === "complete" ? (
              <CheckCircle2 className="w-4 h-4 text-green-400" />
            ) : (
              <Loader2 className="w-4 h-4 text-green-400" />
            )}
          </motion.div>
          <p className="text-white text-sm font-medium">
            {progress?.message ||
              (status === "uploading" ? "Uploading audio..." : "Identifying song...")}
          </p>
        </div>

        {progress && (
          <div className="space-y-1.5">
            {stages.map((stage, index) => {
              const Icon = stage.icon;
              const isComplete = index < currentStageIndex;
              const isActive = index === currentStageIndex;

              return (
                <motion.div
                  key={stage.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.05 }}
                  className={`flex items-center gap-2.5 py-1.5 px-2.5 rounded-lg text-xs transition-all ${
                    isActive
                      ? "bg-green-500/[0.06] text-white"
                      : isComplete
                      ? "text-gray-400"
                      : "text-gray-700"
                  }`}
                >
                  <div
                    className={`w-5 h-5 rounded-full flex items-center justify-center ${
                      isComplete
                        ? "bg-green-500/15"
                        : isActive
                        ? "bg-green-500/20"
                        : ""
                    }`}
                  >
                    {isComplete ? (
                      <CheckCircle2 className="w-3 h-3 text-green-400" />
                    ) : (
                      <Icon
                        className={`w-3 h-3 ${
                          isActive ? "text-green-400" : "text-gray-700"
                        }`}
                      />
                    )}
                  </div>
                  <span>
                    {stage.label}
                    {stage.id === "found" && progress?.candidates_count
                      ? " (" + progress.candidates_count + ")"
                      : ""}
                    {stage.id === "candidate_ready" && progress?.completed
                      ? " (" + progress.completed + "/" + progress.total + ")"
                      : ""}
                  </span>
                  {isActive && (
                    <span className="ml-auto w-1 h-1 rounded-full bg-green-400 animate-pulse" />
                  )}
                </motion.div>
              );
            })}
          </div>
        )}

        {progress?.candidates && progress.candidates.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            className="mt-3 pt-3 border-t border-white/[0.04]"
          >
            <p className="text-[10px] uppercase tracking-widest text-gray-600 mb-2">
              Candidates
            </p>
            <div className="space-y-1">
              {progress.candidates.map((c, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-700 w-3">{i + 1}.</span>
                  <span className="text-xs text-gray-400 truncate">{c.song}</span>
                  {c.artist && (
                    <span className="text-[10px] text-gray-600 truncate">- {c.artist}</span>
                  )}
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {progress?.stage === "candidate_ready" && progress?.result && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-2 py-1.5 px-2.5 rounded-lg bg-green-500/[0.05] border border-green-500/10"
          >
            <p className="text-xs text-green-400 font-medium truncate">
              {"\u2713 " + progress.result.song + " \u2014 " + progress.result.confidence + "%"}
            </p>
          </motion.div>
        )}
      </div>

      <div className="space-y-3 opacity-40 pointer-events-none">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    </motion.div>
  );
}
