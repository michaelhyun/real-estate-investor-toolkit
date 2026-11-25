/* Tailwind v4 runs through its PostCSS plugin. shadcn/ui components are built
   on Tailwind utilities, so it is on; the legacy design system in globals.css
   is plain CSS and sits alongside it. */
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

export default config;
