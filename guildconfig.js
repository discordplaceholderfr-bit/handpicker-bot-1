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
//   updatesChannelId    — bot version/feature announcements (see updateannouncer.js)
//   hostRoles           — [roleId, ...] treated as Host (admins always count)
//   medalRole{1,2,3}Id / medalRole{1,2,3}Mvps — MVP medal tiers (role + configurable threshold)
const fs   = require('fs');
const path = require('path');
const { writeJson } = require('./jsonstore');

const DATA_DIR    = process.env.DATA_DIR || path.join(__dirname, 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'guildconfig.json');

// One-time migration: old fixed-threshold medal keys (bronze/airman/purple,
// thresholds hardcoded 1/5/8) → generic slots with a configurable threshold.
const LEGACY_MEDAL_KEYS = [
  ['medalBronzeRoleId', 'medalRole1Id', 'medalRole1Mvps', 1],
  ['medalAirmanRoleId', 'medalRole2Id', 'medalRole2Mvps', 5],
  ['medalPurpleRoleId', 'medalRole3Id', 'medalRole3Mvps', 8],
];

function load() {
  let data;
  try { data = fs.existsSync(CONFIG_FILE) ? JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) : {}; }
  catch { data = {}; }

  let changed = false;
  for (const g of Object.values(data)) {
    for (const [oldKey, newRoleKey, newMvpsKey, defaultMvps] of LEGACY_MEDAL_KEYS) {
      if (g[oldKey] && !g[newRoleKey]) {
        g[newRoleKey] = g[oldKey];
        if (g[newMvpsKey] === undefined) g[newMvpsKey] = defaultMvps;
        changed = true;
      }
      if (oldKey in g) { delete g[oldKey]; changed = true; }
    }
  }
  if (changed) writeJson(CONFIG_FILE, data);
  return data;
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
