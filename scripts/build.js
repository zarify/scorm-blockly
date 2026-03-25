import esbuild from 'esbuild';
import { cpSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SRC = resolve(ROOT, 'src');
const DIST = resolve(ROOT, 'dist');

const target = process.argv.find((a) => a.startsWith('--target='))?.split('=')[1] || 'all';

async function buildScorm() {
  const outDir = resolve(DIST, 'scorm-template');
  mkdirSync(outDir, { recursive: true });
  mkdirSync(resolve(outDir, 'config'), { recursive: true });

  // Bundle all SCORM JS (including shared modules and Blockly) into one file
  await esbuild.build({
    entryPoints: [resolve(SRC, 'scorm-template/js/app.js')],
    bundle: true,
    outfile: resolve(outDir, 'js/app.bundle.js'),
    format: 'iife',
    globalName: 'BlocklyScorm',
    minify: true,
    sourcemap: false,
    target: ['es2020'],
    define: {
      'process.env.NODE_ENV': '"production"',
    },
  });

  // Copy static assets
  copyIfExists(resolve(SRC, 'scorm-template/index.html'), resolve(outDir, 'index.html'));
  copyIfExists(resolve(SRC, 'scorm-template/css'), resolve(outDir, 'css'));
  copyIfExists(resolve(SRC, 'scorm-template/imsmanifest.xml'), resolve(outDir, 'imsmanifest.xml'));
  copyIfExists(resolve(SRC, 'scorm-template/config/activity_config.json'), resolve(outDir, 'config/activity_config.json'));

  console.log('✅ SCORM template built → dist/scorm-template/');
}

async function buildBuilder() {
  const outDir = resolve(DIST, 'activity-builder');
  mkdirSync(outDir, { recursive: true });

  // Bundle all builder JS (including shared modules and Blockly)
  await esbuild.build({
    entryPoints: [resolve(SRC, 'activity-builder/js/builder-app.js')],
    bundle: true,
    outfile: resolve(outDir, 'js/builder.bundle.js'),
    format: 'iife',
    globalName: 'ActivityBuilder',
    minify: true,
    sourcemap: false,
    target: ['es2020'],
    define: {
      'process.env.NODE_ENV': '"production"',
    },
  });

  // Copy static assets
  copyIfExists(resolve(SRC, 'activity-builder/index.html'), resolve(outDir, 'index.html'));
  copyIfExists(resolve(SRC, 'activity-builder/css'), resolve(outDir, 'css'));

  console.log('✅ Activity builder built → dist/activity-builder/');
}

function copyIfExists(src, dest) {
  if (existsSync(src)) {
    cpSync(src, dest, { recursive: true });
  }
}

async function main() {
  mkdirSync(DIST, { recursive: true });

  try {
    if (target === 'all' || target === 'scorm') {
      await buildScorm();
    }
    if (target === 'all' || target === 'builder') {
      await buildBuilder();
    }
    console.log('\n🔨 Build complete.');
  } catch (err) {
    console.error('❌ Build failed:', err.message);
    process.exit(1);
  }
}

main();
