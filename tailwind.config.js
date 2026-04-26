/** @type {import('tailwindcss').Config} */
export default {
  // Scope content scanning to the SPA only — extension code never sees Tailwind.
  content: ["./src/manager/**/*.{vue,ts}", "./src/manager.html"],
  theme: {
    extend: {
      colors: {
        wp: {
          bg: "var(--wp-bg)",
          bg2: "var(--wp-bg2)",
          bg3: "var(--wp-bg3)",
          bg4: "var(--wp-bg4)",
          border: "var(--wp-border)",
          border2: "var(--wp-border2)",
          text: "var(--wp-text)",
          text2: "var(--wp-text2)",
          text3: "var(--wp-text3)",
          text4: "var(--wp-text4)",
          accent: "var(--wp-accent)",
          accent2: "var(--wp-accent2)",
          violet: "var(--wp-violet)",
          teal: "var(--wp-teal)",
          green: "var(--wp-green)",
          amber: "var(--wp-amber)",
          red: "var(--wp-red)",
          rose: "var(--wp-rose)",
        },
      },
      fontFamily: {
        sans: "var(--wp-font-sans)",
        mono: "var(--wp-font-mono)",
      },
    },
  },
  plugins: [],
};
