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
          border: "var(--wp-border)",
          text: "var(--wp-text)",
          accent: "var(--wp-accent)",
          violet: "var(--wp-violet)",
          teal: "var(--wp-teal)",
        },
      },
    },
  },
  plugins: [],
};
