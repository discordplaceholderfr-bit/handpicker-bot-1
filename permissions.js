// ─── Role IDs ─────────────────────────────────────────────────────────────────
const HOST_ROLE_ID           = '1449480011005431818';
const UNDERCLASS_HOST_ROLE_ID = '1472021412888707164';

// ─── Permission check helpers ─────────────────────────────────────────────────
function isAdmin(member) {
  return member.permissions.has('Administrator');
}

function isHost(member) {
  return (
    member.roles.cache.has(HOST_ROLE_ID) ||
    member.roles.cache.has(UNDERCLASS_HOST_ROLE_ID) ||
    isAdmin(member)
  );
}

// ─── Permission deny helper ───────────────────────────────────────────────────
async function denyHost(interaction) {
  return interaction.reply({
    content: '❌ You need the **Host** or **Underclass Host** role to use this command.',
    ephemeral: true,
  });
}

async function denyAdmin(interaction) {
  return interaction.reply({
    content: '❌ You need **Administrator** permissions to use this command.',
    ephemeral: true,
  });
}

module.exports = { isAdmin, isHost, denyHost, denyAdmin, HOST_ROLE_ID, UNDERCLASS_HOST_ROLE_ID };