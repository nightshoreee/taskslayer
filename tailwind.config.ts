import type { Config } from "tailwindcss";

// Design tokens for TaskSlayer: near-black arena base, warm off-white text,
// two deliberate reds (crimson = primary/damage, ruby = deep shadow/borders),
// muted gold for victory/XP/leader state, and a separate, sparingly-used
// danger red reserved for bombs and critical alerts only.
const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./data/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: "#0D0B10",
          soft: "#141116",
        },
        surface: {
          DEFAULT: "#17141B",
          raised: "#1E1A22",
          border: "#2A2530",
        },
        parchment: {
          DEFAULT: "#EDE7E0",
          dim: "#A9A2AC",
          faint: "#716C79",
        },
        crimson: {
          DEFAULT: "#C13A4A",
          bright: "#DD5266",
          dim: "#8C2A36",
        },
        ruby: {
          DEFAULT: "#7A1F30",
          dark: "#4E1420",
        },
        gold: {
          DEFAULT: "#C99A4B",
          bright: "#E6BE73",
          dim: "#8C6E39",
        },
        danger: {
          DEFAULT: "#E13A3A",
        },
      },
      fontFamily: {
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        body: ["var(--font-body)", "system-ui", "sans-serif"],
        stat: ["var(--font-display)", "ui-monospace", "monospace"],
      },
      boxShadow: {
        arena: "0 0 0 1px rgba(201,154,75,0.12), 0 30px 80px -20px rgba(0,0,0,0.7)",
        card: "0 1px 0 rgba(255,255,255,0.03), 0 1px 2px rgba(0,0,0,0.4)",
      },
      keyframes: {
        "shake-sm": {
          "0%, 100%": { transform: "translateX(0)" },
          "20%": { transform: "translateX(-4px)" },
          "40%": { transform: "translateX(3px)" },
          "60%": { transform: "translateX(-2px)" },
          "80%": { transform: "translateX(2px)" },
        },
        "float-up": {
          "0%": { transform: "translateY(0)", opacity: "1" },
          "100%": { transform: "translateY(-40px)", opacity: "0" },
        },
        "pulse-glow": {
          "0%, 100%": { opacity: "0.55" },
          "50%": { opacity: "1" },
        },
        // Uses the individual `scale` property (not `transform`) so it composes
        // with the dialog's -translate-x/y-1/2 centering instead of replacing it.
        "dialog-in": {
          "0%": { opacity: "0", scale: "0.96" },
          "100%": { opacity: "1", scale: "1" },
        },
        "overlay-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
      },
      animation: {
        "shake-sm": "shake-sm 0.4s ease-in-out",
        "float-up": "float-up 1.1s ease-out forwards",
        "pulse-glow": "pulse-glow 2.4s ease-in-out infinite",
        "dialog-in": "dialog-in 0.18s ease-out",
        "overlay-in": "overlay-in 0.18s ease-out",
      },
    },
  },
  plugins: [],
};

export default config;
