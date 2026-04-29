// Path is relative to the directory PostCSS runs from. Vite always
// invokes PostCSS with `cwd` = repo root (where `vite.config.mts`
// lives), so this string resolves against the root regardless of
// where this config file itself lives.
export default {
  plugins: {
    tailwindcss: { config: "config/tailwind.config.js" },
    autoprefixer: {},
  },
};
