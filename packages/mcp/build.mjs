/* Bundles the server, the calculation engine and the MCP SDK into one file
   that runs with plain `node`, then copies it into the web app's public
   folder so the site can serve it as a download. */
import { build } from 'esbuild';
import { mkdirSync, copyFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, 'dist/investor-toolkit-mcp.mjs');
await build({
  entryPoints: [resolve(here, 'src/server.ts')],
  bundle: true, platform: 'node', format: 'esm', target: 'node18',
  outfile: out, legalComments: 'none',
  banner: { js: "#!/usr/bin/env node\nimport { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});
const pub = resolve(here, '../../apps/web/public/mcp');
mkdirSync(pub, { recursive: true });
copyFileSync(out, resolve(pub, 'investor-toolkit-mcp.mjs'));
console.log('built', out);
