import esbuild from 'esbuild';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SRC = resolve(ROOT, 'src');

async function dev() {
  // Serve the activity builder with live reload
  const ctx = await esbuild.context({
    entryPoints: [resolve(SRC, 'activity-builder/js/builder-app.js')],
    bundle: true,
    outfile: resolve(ROOT, 'dist/activity-builder/js/builder.bundle.js'),
    format: 'iife',
    globalName: 'ActivityBuilder',
    sourcemap: true,
    target: ['es2020'],
  });

  await ctx.watch();

  const { host, port } = await ctx.serve({
    servedir: resolve(ROOT, 'dist/activity-builder'),
    port: 3000,
  });

  console.log(`🚀 Dev server running at http://${host}:${port}`);
  console.log('   Watching for changes...');
}

dev().catch((err) => {
  console.error('Dev server failed:', err);
  process.exit(1);
});
