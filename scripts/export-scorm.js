import { readFileSync, createWriteStream, existsSync, readdirSync, statSync } from 'fs';
import { resolve, dirname, relative } from 'path';
import { fileURLToPath } from 'url';
import JSZip from 'jszip';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DIST_SCORM = resolve(ROOT, 'dist/scorm-template');
const OUTPUT = resolve(ROOT, 'dist');

async function exportScorm() {
  if (!existsSync(DIST_SCORM)) {
    console.error('❌ dist/scorm-template/ not found. Run `npm run build` first.');
    process.exit(1);
  }

  const zip = new JSZip();

  // Recursively add all files from the SCORM template dist
  addDirectoryToZip(zip, DIST_SCORM, '');

  // Read the activity title for the filename
  let filename = 'blockly-scorm-activity.zip';
  const configPath = resolve(DIST_SCORM, 'config/activity_config.json');
  if (existsSync(configPath)) {
    try {
      const config = JSON.parse(readFileSync(configPath, 'utf-8'));
      if (config.metadata?.activity_id) {
        filename = `${config.metadata.activity_id}.zip`;
      }
    } catch {
      // Use default filename
    }
  }

  const outputPath = resolve(OUTPUT, filename);
  const content = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  });

  const { writeFileSync } = await import('fs');
  writeFileSync(outputPath, content);
  console.log(`✅ SCORM package exported → dist/${filename}`);
}

function addDirectoryToZip(zip, dirPath, zipPath) {
  const entries = readdirSync(dirPath);
  for (const entry of entries) {
    const fullPath = resolve(dirPath, entry);
    const entryZipPath = zipPath ? `${zipPath}/${entry}` : entry;
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      addDirectoryToZip(zip, fullPath, entryZipPath);
    } else {
      zip.file(entryZipPath, readFileSync(fullPath));
    }
  }
}

exportScorm();
