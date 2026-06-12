const { EmbedBuilder } = require('discord.js');

// Channel where admin/host actions are logged (in category 1508275084026974293)
const AUDIT_LOG_CHANNEL_ID = '1508275128025223238';

let _client = null;

function initAuditLog(client) {
  _client = client;
}

// Fire-and-forget log embed. Never throws.
function auditLog(title, description, color = 0x5865f2) {
  if (!_client) return;
  _client.channels.fetch(AUDIT_LOG_CHANNEL_ID)
    .then(ch => ch.send({ embeds: [new EmbedBuilder()
      .setTitle(title)
      .setDescription(description)
      .setColor(color)
      .setTimestamp()
    ]}))
    .catch(e => console.warn('auditLog failed:', e.message));
}

module.exports = { initAuditLog, auditLog };
