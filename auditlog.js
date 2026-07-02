const { EmbedBuilder } = require('discord.js');
const { getKey } = require('./guildconfig');

let _client = null;

function initAuditLog(client) {
  _client = client;
}

// Fire-and-forget log embed to the guild's configured audit channel. No-ops if
// the guild hasn't set one via /setup. Never throws.
function auditLog(guildId, title, description, color = 0x5865f2) {
  if (!_client || !guildId) return;
  const channelId = getKey(guildId, 'auditChannelId');
  if (!channelId) return;
  _client.channels.fetch(channelId)
    .then(ch => ch.send({ embeds: [new EmbedBuilder()
      .setTitle(title)
      .setDescription(description)
      .setColor(color)
      .setTimestamp()
    ]}))
    .catch(e => console.warn('auditLog failed:', e.message));
}

module.exports = { initAuditLog, auditLog };
