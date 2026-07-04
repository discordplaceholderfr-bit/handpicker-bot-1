// Announces changelog.js entries to each guild's configured Updates Channel,
// one Discord message per entry.
//
// Tracked via an integer `lastAnnouncedId` in data/botstate.json (not the
// package.json version) — this way every entry ships exactly once, in order,
// even if several are added across a few quick deploys before anyone checks,
// and there's no risk of an update silently going unposted because someone
// forgot to bump the version to match.
const path = require('node:path');
const { EmbedBuilder } = require('discord.js');
const CHANGELOG = require('./changelog');
const { getConfig } = require('./guildconfig');
const { readJson, writeJson } = require('./jsonstore');

const DATA_DIR   = process.env.DATA_DIR || path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'botstate.json');

// Old state (before id-based tracking) only ever recorded
// `lastAnnouncedVersion`. Migrate it to `lastAnnouncedId` by matching that
// version to a changelog entry, so anything shipped after it still announces
// — but nothing before it retroactively spams history. If the stored version
// doesn't match any entry (or there's no prior state at all — a fresh
// install), fall back to the latest known id so nothing backfires.
function resolveLastAnnouncedId(state, latestId) {
  if (typeof state.lastAnnouncedId === 'number') return state.lastAnnouncedId;
  if (state.lastAnnouncedVersion) {
    const match = CHANGELOG.find(e => e.version === state.lastAnnouncedVersion);
    if (match) return match.id;
  }
  return latestId;
}

function entryEmbed(entry) {
  const titleSuffix = entry.version ? ` — v${entry.version}` : ` — Update #${entry.id}`;
  return new EmbedBuilder()
    .setTitle(`🔔 Bot Updated${titleSuffix}`)
    .setDescription(`**${entry.title}**`)
    .addFields({ name: 'What\'s new', value: entry.notes.map(n => `• ${n}`).join('\n') })
    .setColor(0x57f287)
    .setTimestamp();
}

async function announceUpdates(client) {
  const state    = readJson(STATE_FILE, {});
  const latestId = CHANGELOG.length ? CHANGELOG[CHANGELOG.length - 1].id : 0;
  const isFirstRun = Object.keys(state).length === 0;

  const lastAnnouncedId = resolveLastAnnouncedId(state, latestId);
  const newEntries = isFirstRun ? [] : CHANGELOG.filter(e => e.id > lastAnnouncedId);

  writeJson(STATE_FILE, { lastAnnouncedId: latestId });

  if (!newEntries.length) return;

  for (const entry of newEntries) {
    const embed = entryEmbed(entry);
    for (const guild of client.guilds.cache.values()) {
      const channelId = getConfig(guild.id).updatesChannelId;
      if (!channelId) continue;
      try {
        const channel = await client.channels.fetch(channelId);
        await channel.send({ embeds: [embed] });
      } catch (err) {
        console.warn(`updateannouncer: failed to post update #${entry.id} in guild ${guild.id}:`, err.message);
      }
    }
  }
}

module.exports = { announceUpdates };
