// Tailwind v4 is processed by the @tailwindcss/vite plugin (see vite.config.ts),
// NOT through PostCSS. Only autoprefixer remains here for vendor prefixing of
// the hand-authored CSS (index.css and the feature-level stylesheets).
export default {
  plugins: {
    autoprefixer: {},
  },
}