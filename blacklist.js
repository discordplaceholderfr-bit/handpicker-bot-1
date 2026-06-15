const fs   = require('fs');
const path = require('path');

const DATA_DIR       = process.env.DATA_DIR || path.join(__dirname, 'data');
const BLACKLIST_FILE = path.join(DATA_DIR, 'blacklist.json');

function loadBlacklist() {
  try { return fs.existsSync(BLACKLIST_FILE) ? JSON.parse(fs.readFileSync(BLACKLIST_FILE, 'utf8')) : {}; }
  catch { return {}; }
}
function saveBlacklist(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(BLACKLIST_FILE, JSON.stringify(data, null, 2));
}

// Single shared in-memory copy (Node caches this module, so handpicker.js and
// pollwatcher.js read/write the exact same object).
let blacklist = loadBlacklist();

// Returns the active blacklist entry for a user, or null. Auto-clears expired entries.
function getBlacklist(guildId, userId) {
  const bl = blacklist[guildId]?.[userId];
  if (!bl) return null;
  if (bl.expiresAt && Date.now() > bl.expiresAt) {
    delete blacklist[guildId][userId];
    saveBlacklist(blacklist);
    return null;
  }
  return bl;
}

function isBlacklisted(guildId, userId) {
  return getBlacklist(guildId, userId) !== null;
}

function addBlacklist(guildId, userId, entry) {
  if (!blacklist[guildId]) blacklist[guildId] = {};
  blacklist[guildId][userId] = entry;
  saveBlacklist(blacklist);
}

function removeBlacklist(guildId, userId) {
  if (!blacklist[guildId]?.[userId]) return false;
  delete blacklist[guildId][userId];
  saveBlacklist(blacklist);
  return true;
}

module.exports = { getBlacklist, isBlacklisted, addBlacklist, removeBlacklist };
