"use client";

import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  onReset?: () => void;
}

export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("LyricSpot UI error:", error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="mx-auto my-16 flex max-w-md flex-col items-center gap-4 px-4 text-center" role="alert">
        <p className="font-display text-2xl font-bold">Something broke on this page</p>
        <p className="text-muted">Your search wasn't lost for good. Start over and try again.</p>
        <button
          type="button"
          className="btn-light h-11 rounded-full px-5 text-sm"
          onClick={() => { this.setState({ error: null }); this.props.onReset?.(); }}
        >
          Start over
        </button>
      </div>
    );
  }
}
