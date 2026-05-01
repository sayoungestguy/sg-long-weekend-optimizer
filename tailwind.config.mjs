/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}"],
  // These are added at runtime by the hover-island in src/pages/index.astro.
  // JIT can't see them in source, so safelist them explicitly.
  safelist: ["ring-2", "ring-leave"],
  theme: {
    extend: {
      colors: {
        ph: "#dc2626",      // public holiday red
        leave: "#16a34a",   // suggested leave green
        weekend: "#9ca3af", // weekend gray
      },
    },
  },
  plugins: [],
};
