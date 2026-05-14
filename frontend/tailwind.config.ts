import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Public Trust palette
        forest: "var(--forest)",
        "deep-green": "var(--deep-green)",
        "mid-green": "var(--mid-green)",
        "light-green": "var(--light-green)",
        mint: "var(--mint)",
        "mint-white": "var(--mint-white)",
        "warm-white": "var(--warm-white)",
        "body-text": "var(--body-text)",
        "muted-text": "var(--muted-text)",
        "rule-color": "var(--rule-color)",
        "emrg-red": "var(--emrg-red)",
        "emrg-pale": "var(--emrg-pale)",
        "warn-amber": "var(--warn-amber)",
        "warn-pale": "var(--warn-pale)",
        "safe-green": "var(--safe-green)",
        "safe-pale": "var(--safe-pale)",
        // Field Operations palette
        onyx: "var(--onyx)",
        "onyx-2": "var(--onyx-2)",
        slate: "var(--slate)",
        steel: "var(--steel)",
        "steel-light": "var(--steel-light)",
        "admin-text": "var(--admin-text)",
        "admin-muted": "var(--admin-muted)",
        "admin-rule": "var(--admin-rule)",
        "safety-org": "var(--safety-org)",
        danger: "var(--danger)",
        cleared: "var(--cleared)",
      },
      fontFamily: {
        serif: ["var(--font-serif)", "Georgia", "serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      borderRadius: {
        sharp: "2px",
      },
    },
  },
  plugins: [],
};
export default config;
