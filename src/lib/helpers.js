const fs = require('fs');
const path = require('path');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readUserList(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith('#'));
}

function normalizeUsername(input) {
  const value = String(input || '').trim();
  if (!value) return '';
  if (value.startsWith('http://') || value.startsWith('https://')) {
    const match = value.match(/tiktok\.com\/@([^/?]+)/i);
    return match ? match[1] : '';
  }
  return value.replace(/^@/, '').replace(/\/+$/, '');
}

function parseCountText(text) {
  if (!text) return 0;
  const normalized = String(text).replace(/,/g, '').trim();
  const match = normalized.match(/([\d.]+)\s*([KkMmBb])?/);
  if (!match) return 0;
  let value = parseFloat(match[1]);
  const unit = (match[2] || '').toUpperCase();
  if (unit === 'K') value *= 1000;
  if (unit === 'M') value *= 1000000;
  if (unit === 'B') value *= 1000000000;
  return Math.round(value);
}

function extractTimestampFromVideoId(videoId) {
  try {
    const id = BigInt(String(videoId));
    const timestamp = Number(id >> 32n);
    if (timestamp > 1546300800 && timestamp < 1893456000) return timestamp;
  } catch (error) {
    return 0;
  }
  return 0;
}

function formatNumber(value) {
  const num = Number(value) || 0;
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return String(num);
}

function formatDate(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

function resolveProjectPath(...segments) {
  return path.join(__dirname, '..', '..', ...segments);
}

module.exports = {
  sleep,
  ensureDir,
  readUserList,
  normalizeUsername,
  parseCountText,
  extractTimestampFromVideoId,
  formatNumber,
  formatDate,
  resolveProjectPath,
};
