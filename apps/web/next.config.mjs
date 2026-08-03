/* The whole toolkit is client-side — every page is 'use client', all state lives
   in localStorage, and there are no API routes or server actions. So it exports
   to plain static files and can be hosted straight off GitHub Pages.

   Pages serves a project site under /<repo>/, so the build needs basePath and
   assetPrefix set to that prefix — but only there. The deploy workflow sets
   GITHUB_PAGES=true; `npm run dev` and local builds leave it unset and keep
   serving from the root. */

const repoBase = '/real-estate-investor-toolkit';
const onPages = process.env.GITHUB_PAGES === 'true';

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@reit/core'],
  output: 'export',
  /* emit /rental/index.html rather than /rental.html — unambiguous on any static host */
  trailingSlash: true,
  basePath: onPages ? repoBase : '',
  assetPrefix: onPages ? repoBase : '',
};

export default nextConfig;
