// Team Role assignment — fully configured via /setup → 🎖️ Team Roles.
//
// Instead of matching a faction NAME (old /setup_team, and the old auto-map
// that scanned for roles literally named "Team 1"/"Team 2"/etc. and re-wrote
// the mapping on every /create_handpick, /import_handpick and /load_preset),
// roles are now assigned by POSITION: Team Slot 1's role goes to whoever
// claims the faction in position 1 of a given list, Slot 2 to position 2, and
// so on. Configured once per server, it applies to every list automatically.
// Position is derived from `Object.keys(game.factions)` — JS objects preserve
// insertion order for string keys, so this reflects the order factions were
// added in that specific game.
const { getConfig } = require('./guildconfig');

const TEAM_SLOT_COUNT = 5;

function teamRoleKey(position) {
  return `teamRole${position}Id`;
}

function factionPosition(game, factionName) {
  return Object.keys(game?.factions || {}).indexOf(factionName);
}

async function assignTeam(guild, userId, factionName, game) {
  const index = factionPosition(game, factionName);
  if (index < 0 || index >= TEAM_SLOT_COUNT) return;
  const roleId = getConfig(guild.id)[teamRoleKey(index + 1)];
  if (!roleId) return;
  try {
    const member = await guild.members.fetch(userId);
    const role   = guild.roles.cache.get(roleId);
    if (role) await member.roles.add(role);
  } catch (e) {
    console.warn(`assignTeam failed for ${userId} / ${factionName}:`, e.message);
  }
}

async function removeTeam(guild, userId, factionName, game) {
  const index = factionPosition(game, factionName);
  if (index < 0 || index >= TEAM_SLOT_COUNT) return;
  const roleId = getConfig(guild.id)[teamRoleKey(index + 1)];
  if (!roleId) return;
  try {
    const member = await guild.members.fetch(userId);
    const role   = guild.roles.cache.get(roleId);
    if (role) await member.roles.remove(role);
  } catch (e) {
    console.warn(`removeTeam failed for ${userId} / ${factionName}:`, e.message);
  }
}

module.exports = { assignTeam, removeTeam, TEAM_SLOT_COUNT, teamRoleKey };
