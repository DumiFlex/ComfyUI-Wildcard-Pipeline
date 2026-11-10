// Tailwind v4 runs as its PostCSS plugin. Its config lives in CSS now
// (`src/manager/styles/tailwind.css`: `@theme` + `@source`), so there is no
// tailwind.config.js. Autoprefixer stays for the canvas extension's own CSS,
// which Tailwind never touches.
export default {
  plugins: {
    "@tailwindcss/postcss": {},
    autoprefixer: {},
  },
};
