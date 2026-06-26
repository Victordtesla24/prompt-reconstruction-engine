'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const REPORTS = path.join(ROOT, 'reports');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(relPath, data) {
  const full = path.isAbsolute(relPath) ? relPath : path.join(REPORTS, relPath);
  ensureDir(path.dirname(full));
  fs.writeFileSync(full, JSON.stringify(data, null, 2) + '\n');
  return full;
}

function readJson(relPath) {
  const full = path.isAbsolute(relPath) ? relPath : path.join(REPORTS, relPath);
  return JSON.parse(fs.readFileSync(full, 'utf8'));
}

function writeText(relPath, text) {
  const full = path.isAbsolute(relPath) ? relPath : path.join(REPORTS, relPath);
  ensureDir(path.dirname(full));
  fs.writeFileSync(full, text);
  return full;
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

module.exports = { ROOT, REPORTS, ensureDir, writeJson, readJson, writeText, timestamp };
