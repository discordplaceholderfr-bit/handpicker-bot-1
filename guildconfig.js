// Per-guild configuration store.
//
// Everything that used to be a hardcoded channel/role ID now lives here, keyed
// by guild, so the bot works in any server once an admin runs /setup. Backed by
// the same atomic JSON writer as the rest of the bot.
//
// Keys currently used:
//   logChannelId       — list expiry / auto-reset / reopen announcements
//   auditChannelId      — moderation/admin action log
//   rankingsChannelId   — pinned auto-updating leaderboard
//   hostRoles           — [roleId, ...] treated as Host (admins always count)
//   medalBronzeRoleId / medalAirmanRoleId / medalPurpleRoleId — MVP medal tiers
const fs   = require('fs');
const path = require('path');
const { writeJson } = require('./jsonstore');

const DATA_DIR    = process.env.DATA_DIR || path.join(__dirname, 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'guildconfig.json');

function load() {
  try { return fs.existsSync(CONFIG_FILE) ? JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) : {}; }
  catch { return {}; }
}

// Single shared in-memory copy (Node caches this module, so every importer reads
// and writes the same object).
let cfg = load();

function getConfig(guildId) {
  return cfg[guildId] || {};
}

function getKey(guildId, key) {
  return cfg[guildId]?.[key];
}

// Set (or, with null/undefined/empty-array, clear) a key for a guild.
function setKey(guildId, key, value) {
  if (!cfg[guildId]) cfg[guildId] = {};
  const empty = value === undefined || value === null || (Array.isArray(value) && value.length === 0);
  if (empty) delete cfg[guildId][key];
  else       cfg[guildId][key] = value;
  writeJson(CONFIG_FILE, cfg);
}

module.exports = { getConfig, getKey, setKey };
