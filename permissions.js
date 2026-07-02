const { getKey } = require('./guildconfig');

// ─── Permission check helpers ─────────────────────────────────────────────────
function isAdmin(member) {
  return !!member && member.permissions.has('Administrator');
}

// Host = Discord Administrator, OR a member holding one of the roles configured
// as Host for this guild via /setup. Admins always pass so a freshly-added
// server is usable before any Host roles are set.
function isHost(member) {
  if (!member) return false;
  if (isAdmin(member)) return true;
  const hostRoles = getKey(member.guild.id, 'hostRoles') || [];
  return hostRoles.some(r => member.roles.cache.has(r));
}

// ─── Permission deny helpers ──────────────────────────────────────────────────
async function denyHost(interaction) {
  return interaction.reply({
    content: '❌ You need a **Host** role (or **Administrator**) to use this command. An admin can grant Host roles with `/setup`.',
    ephemeral: true,
  });
}

async function denyAdmin(interaction) {
  return interaction.reply({
    content: '❌ You need **Administrator** permissions to use this command.',
    ephemeral: true,
  });
}

module.exports = { isAdmin, isHost, denyHost, denyAdmin };
