/* The whole toolkit is client-side — every page is 'use client' and there are
   no API routes or server actions; state lives in localStorage and, when signed
   in, syncs to Supabase straight from the browser. So it exports to plain
   static files and can be hosted straight off GitHub Pages.

   It is served from the root of its own domain, tools.michaelhyunn.com (set as
   the repo's GitHub Pages custom domain), so there is no basePath. */

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@reit/core'],
  output: 'export',
  /* emit /rental/index.html rather than /rental.html — unambiguous on any static host */
  trailingSlash: true,
};

export default nextConfig;
