#!/usr/bin/env node

/**
 * Mise à jour de l'annonce du site Desha-Moulin
 *
 * Usage :
 *   node annonce.js "Texte de la nouvelle annonce"
 *   node annonce.js --off         → masque la bannière
 *   node annonce.js --on          → réaffiche la dernière annonce
 *   node annonce.js --status      → affiche l'annonce actuelle
 */

const fs   = require('fs');
const path = require('path');

const HTML_FILE = path.join(__dirname, 'desha-moulin.html');
const MARKER_OPEN  = '<!-- ANNONCE_START -->';
const MARKER_CLOSE = '<!-- ANNONCE_END -->';

// ── helpers ──────────────────────────────────────────────────────────────────

function readFile() {
  if (!fs.existsSync(HTML_FILE)) {
    console.error(`❌  Fichier introuvable : ${HTML_FILE}`);
    process.exit(1);
  }
  return fs.readFileSync(HTML_FILE, 'utf8');
}

function writeFile(content) {
  fs.writeFileSync(HTML_FILE, content, 'utf8');
}

function getBlock(html) {
  const start = html.indexOf(MARKER_OPEN);
  const end   = html.indexOf(MARKER_CLOSE);
  if (start === -1 || end === -1) {
    console.error('❌  Marqueurs introuvables dans le HTML.');
    console.error('    Assure-toi que le fichier contient <!-- ANNONCE_START --> et <!-- ANNONCE_END -->');
    process.exit(1);
  }
  return { start, end: end + MARKER_CLOSE.length };
}

function buildBlock(texte, visible) {
  const display = visible ? '' : ' style="display:none"';
  return `${MARKER_OPEN}
<div class="annonce"${display}>
  ✦ &nbsp; ${texte} &nbsp; ✦
</div>
${MARKER_CLOSE}`;
}

function currentAnnonce(html) {
  const { start, end } = getBlock(html);
  const block = html.slice(start, end);
  const match = block.match(/<div class="annonce"[^>]*>\s*✦ &nbsp; (.+?) &nbsp; ✦\s*<\/div>/s);
  return match ? match[1].trim() : null;
}

function isVisible(html) {
  const { start, end } = getBlock(html);
  const block = html.slice(start, end);
  return !block.includes('display:none');
}

// ── commandes ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.length === 0) {
  console.log(`
Usage :
  node annonce.js "Nouveau texte d'annonce"
  node annonce.js --off       → masque la bannière
  node annonce.js --on        → réaffiche la bannière
  node annonce.js --status    → affiche l'annonce actuelle
  `);
  process.exit(0);
}

const html = readFile();
const { start, end } = getBlock(html);

// --status
if (args[0] === '--status') {
  const texte = currentAnnonce(html);
  const visible = isVisible(html);
  console.log(`\n📋  Annonce actuelle :`);
  console.log(`    "${texte}"`);
  console.log(`    Visible : ${visible ? '✅  oui' : '❌  non (masquée)'}\n`);
  process.exit(0);
}

// --off
if (args[0] === '--off') {
  const texte = currentAnnonce(html);
  const newBlock = buildBlock(texte, false);
  const newHtml = html.slice(0, start) + newBlock + html.slice(end);
  writeFile(newHtml);
  console.log(`✅  Bannière masquée.`);
  process.exit(0);
}

// --on
if (args[0] === '--on') {
  const texte = currentAnnonce(html);
  const newBlock = buildBlock(texte, true);
  const newHtml = html.slice(0, start) + newBlock + html.slice(end);
  writeFile(newHtml);
  console.log(`✅  Bannière réaffichée : "${texte}"`);
  process.exit(0);
}

// nouveau texte
const texte = args.join(' ');
const newBlock = buildBlock(texte, true);
const newHtml = html.slice(0, start) + newBlock + html.slice(end);
writeFile(newHtml);
console.log(`✅  Annonce mise à jour : "${texte}"`);
