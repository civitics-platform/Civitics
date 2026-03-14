import type { Config } from "tailwindcss";

export const baseConfig: Partial<Config> = {
  theme: {
    extend: {
      colors: {
        // Civic palette — neutral, never red vs. blue for political data
        civic: {
          50: "#f0f4ff",
          100: "#e0e9ff",
          200: "#c7d5fe",
          300: "#a5b4fc",
          400: "#818cf8",
          500: "#6366f1",
          600: "#4f46e5",
          700: "#4338ca",
          800: "#3730a3",
          900: "#312e81",
          950: "#1e1b4b",
        },
        // Spending data — green scale
        spending: {
          low: "#d1fae5",
          mid: "#34d399",
          high: "#065f46",
        },
        // Engagement — blue scale
        engagement: {
          low: "#dbeafe",
          mid: "#3b82f6",
          high: "#1e3a8a",
        },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "monospace"],
      },
    },
  },
  plugins: [],
};
