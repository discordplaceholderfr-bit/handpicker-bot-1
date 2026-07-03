// Announces new bot versions to each guild's configured Updates Channel.
//
// On every boot, compares the current package.json version against the last
// version already announced (persisted in data/botstate.json). If it's newer
// and changelog.js has a matching entry, posts it to every guild that has set
// a 🔔 Updates Channel via /setup, then records the version so it's never
// announced twice.
const path = require('node:path');
const { EmbedBuilder } = require('discord.js');
const { version: CURRENT_VERSION } = require('./package.json');
const CHANGELOG = require('./changelog');
const { getConfig } = require('./guildconfig');
const { readJson, writeJson } = require('./jsonstore');

const DATA_DIR   = process.env.DATA_DIR || path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'botstate.json');

async function announceUpdates(client) {
  const state = readJson(STATE_FILE, {});
  if (state.lastAnnouncedVersion === CURRENT_VERSION) return;

  const entry = CHANGELOG.find(e => e.version === CURRENT_VERSION);
  if (entry) {
    const embed = new EmbedBuilder()
      .setTitle(`🔔 Bot Updated — v${entry.version}`)
      .setDescription(`**${entry.title}**`)
      .addFields({ name: 'What\'s new', value: entry.notes.map(n => `• ${n}`).join('\n') })
      .setColor(0x57f287)
      .setTimestamp();

    for (const guild of client.guilds.cache.values()) {
      const channelId = getConfig(guild.id).updatesChannelId;
      if (!channelId) continue;
      try {
        const channel = await client.channels.fetch(channelId);
        await channel.send({ embeds: [embed] });
      } catch (err) {
        console.warn(`updateannouncer: failed to post in guild ${guild.id}:`, err.message);
      }
    }
  }

  writeJson(STATE_FILE, { lastAnnouncedVersion: CURRENT_VERSION });
}

module.exports = { announceUpdates };
