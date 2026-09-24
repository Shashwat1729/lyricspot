import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0E0F0C",
        panel: "#141513",
        surface: "#17181A",
        raised: "#1B1C1A",
        well: "#22241F",
        line: "#2C2E30",
        text: "#F2EFE6",
        soft: "#C9C5BB",
        muted: "#A7A39A",
        faint: "#8F8B82",
        dim: "#75726B",
        go: { DEFAULT: "#1ED760", hover: "#3BE276", text: "#5BE88A" },
        amber: { DEFAULT: "#F5B83D" },
        alert: { DEFAULT: "#FF5C5C", text: "#FF8A80" },
      },
      fontFamily: {
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        lyric: ["var(--font-lyric)", "Georgia", "serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      borderRadius: {
        xl2: "18px",
        xl3: "28px",
      },
      keyframes: {
        bar: {
          "0%, 100%": { transform: "scaleY(0.35)" },
          "50%": { transform: "scaleY(1)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-400px 0" },
          "100%": { backgroundPosition: "400px 0" },
        },
        halo: {
          "0%": { transform: "scale(1)", opacity: "0.55" },
          "100%": { transform: "scale(1.6)", opacity: "0" },
        },
      },
      animation: {
        bar: "bar 1s ease-in-out infinite",
        shimmer: "shimmer 1.4s linear infinite",
        halo: "halo 2.4s ease-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
