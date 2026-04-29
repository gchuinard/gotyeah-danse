#!/usr/bin/env node
'use strict';
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const INPUT_DIR = path.join(__dirname, 'images');
const OUTPUT_DIR = path.join(__dirname, 'images', 'optimized');

const AVIF_QUALITY = 60;
const WEBP_QUALITY = 82;
const JPEG_QUALITY = 82;

// fallback: 'jpg' for photos, 'png' for images with alpha (logo)
const IMAGE_CONFIGS = [
  { input: 'Cours_nb.png',                             widths: [878, 1316, 1600], fallback: 'jpg' },
  { input: 'Cours_ModernJazz.png',                     widths: [282, 564],        fallback: 'jpg' },
  { input: 'Cours-Initiation.png',                     widths: [282, 564],        fallback: 'jpg' },
  { input: '2488558346897120552-1024x765.jpg',          widths: [282, 564],        fallback: 'jpg' },
  { input: 'Cours-DanseClassique_371_287-300x231.png', widths: [282, 564],        fallback: 'jpg' },
  { input: 'Logo Desha Moulin_803px.png',              widths: [250, 500],        fallback: 'png' },
  { input: 'rentree-819x1024.jpg',                     widths: [711, 1422],       fallback: 'jpg' },
  { input: 'IMG_98021.jpg',                            widths: [1280, 1920],      fallback: 'jpg' },
];

function baseName(filename) {
  return path.basename(filename, path.extname(filename)).replace(/\s+/g, '-');
}

function outPath(input, w, ext) {
  return path.join(OUTPUT_DIR, `${baseName(input)}-${w}w.${ext}`);
}

function kb(bytes) { return `${Math.round(bytes / 1024)}KB`; }

async function writeVariant(src, dst, w, fmt) {
  const srcStat = fs.statSync(src);
  if (fs.existsSync(dst) && fs.statSync(dst).mtimeMs > srcStat.mtimeMs) {
    process.stdout.write(`  ⏭  ${path.basename(dst)} (up to date)\n`);
    return;
  }

  const pipe = sharp(src).resize(w, null, { withoutEnlargement: true });
  let out;
  if (fmt === 'avif')      out = pipe.avif({ quality: AVIF_QUALITY });
  else if (fmt === 'webp') out = pipe.webp({ quality: WEBP_QUALITY });
  else if (fmt === 'jpg')  out = pipe.jpeg({ quality: JPEG_QUALITY, progressive: true });
  else                     out = pipe.png({ compressionLevel: 9, palette: false });

  await out.toFile(dst);

  const outSize = fs.statSync(dst).size;
  const pct = Math.round((1 - outSize / srcStat.size) * 100);
  const sign = pct >= 0 ? `-${pct}%` : `+${Math.abs(pct)}%`;
  process.stdout.write(`  ✅ ${path.basename(dst)}  ${kb(srcStat.size)} → ${kb(outSize)}  (${sign})\n`);
}

async function processConfig(cfg) {
  const src = path.join(INPUT_DIR, cfg.input);
  if (!fs.existsSync(src)) {
    console.warn(`⚠️  ${cfg.input} not found, skipping`);
    return;
  }

  const meta = await sharp(src).metadata();
  // Deduplicate effective widths (capped at source width)
  const seen = new Set();
  const effectiveWidths = [];
  for (const w of cfg.widths) {
    const ew = Math.min(w, meta.width);
    if (!seen.has(ew)) { seen.add(ew); effectiveWidths.push(ew); }
  }

  console.log(`\n📸 ${cfg.input}  (${meta.width}×${meta.height}) → widths: ${effectiveWidths.join(', ')}`);

  for (const ew of effectiveWidths) {
    for (const fmt of ['avif', 'webp', cfg.fallback]) {
      await writeVariant(src, outPath(cfg.input, ew, fmt), ew, fmt);
    }
  }
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  console.log(`Output → ${OUTPUT_DIR}\n`);
  for (const cfg of IMAGE_CONFIGS) {
    await processConfig(cfg);
  }

  // Summary
  const files = fs.readdirSync(OUTPUT_DIR);
  const totalBytes = files.reduce((acc, f) => acc + fs.statSync(path.join(OUTPUT_DIR, f)).size, 0);
  console.log(`\n✨ Terminé ! ${files.length} fichiers générés — total : ${kb(totalBytes)}`);
}

main().catch(err => { console.error(err); process.exit(1); });
