const { isAdmin, isHost, denyHost, denyAdmin } = require('./permissions');

const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  PermissionFlagsBits,
  ChannelType,
} = require('discord.js');
const fs   = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const TEAMS_FILE = path.join(DATA_DIR, 'teams.json');
const GAMES_FILE = path.join(DATA_DIR, 'games.json');

function loadTeams() {
  try { return fs.existsSync(TEAMS_FILE) ? JSON.parse(fs.readFileSync(TEAMS_FILE, 'utf8')) : {}; }
  catch { return {}; }
}
function saveTeams(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(TEAMS_FILE, JSON.stringify(data, null, 2));
}
function loadGames() {
  try { return fs.existsSync(GAMES_FILE) ? JSON.parse(fs.readFileSync(GAMES_FILE, 'utf8')) : {}; }
  catch { return {}; }
}

let teams = loadTeams();

function _reloadTeams() { teams = loadTeams(); }

async function assignTeam(guild, userId, factionName) {
  const mapping = teams[guild.id]?.[factionName];
  if (!mapping?.roleId) return;
  try {
    const member = await guild.members.fetch(userId);
    const role   = guild.roles.cache.get(mapping.roleId);
    if (role) await member.roles.add(role);
  } catch (e) {
    console.warn(`assignTeam failed for ${userId} / ${factionName}:`, e.message);
  }
}

async function removeTeam(guild, userId, factionName) {
  const mapping = teams[guild.id]?.[factionName];
  if (!mapping?.roleId) return;
  try {
    const member = await guild.members.fetch(userId);
    const role   = guild.roles.cache.get(mapping.roleId);
    if (role) await member.roles.remove(role);
  } catch (e) {
    console.warn(`removeTeam failed for ${userId} / ${factionName}:`, e.message);
  }
}

const teamCommands = [
  new SlashCommandBuilder()
    .setName('setup_team')
    .setDescription('Manually map a faction to a team role')
    .addStringOption(o => o.setName('faction').setDescription('Faction name exactly as in the handpick list').setRequired(true))
    .addRoleOption(o => o.setName('role').setDescription('Team role to give when this faction is claimed').setRequired(true))
    .toJSON(),

  new SlashCommandBuilder()
    .setName('list_teams')
    .setDescription('Show all current faction → team role mappings')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('remove_team')
    .setDescription('Remove the team mapping for a specific faction')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('clear_teams')
    .setDescription('Admin: Remove ALL team mappings for this server')
    .toJSON(),
];

module.exports.teamCommands = teamCommands;
module.exports.assignTeam   = assignTeam;
module.exports.removeTeam   = removeTeam;

function setupTeams(client) {
  client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    const { commandName, guildId, guild } = interaction;

    if (commandName === 'setup_team') {
      if (!isHost(interaction.member)) return denyHost(interaction);
      const faction = interaction.options.getString('faction').trim();
      const role    = interaction.options.getRole('role');
      if (!teams[guildId]) teams[guildId] = {};
      teams[guildId][faction] = { roleId: role.id };
      saveTeams(teams);
      const embed = new EmbedBuilder()
        .setTitle('✅ Team Mapping Saved')
        .setColor(0x57f287)
        .addFields(
          { name: '⚔️ Faction', value: faction,          inline: true },
          { name: '🎖️ Role',    value: `<@&${role.id}>`, inline: true },
        )
        .setFooter({ text: 'Players claiming a country in this faction will receive this role automatically.' });
      return interaction.reply({ embeds: [embed] });
    }

    if (commandName === 'list_teams') {
      const guildTeams = teams[guildId] || {};
      const entries    = Object.entries(guildTeams);
      if (entries.length === 0) {
        return interaction.reply({ content: '❌ No team mappings set up yet. Use `/setup_team`.' });
      }
      let desc = '';
      for (const [faction, mapping] of entries) {
        const role = mapping.roleId ? `<@&${mapping.roleId}>` : '*no role*';
        desc += `**${faction}** → ${role}\n`;
      }
      const embed = new EmbedBuilder()
        .setTitle('🎖️ Faction → Team Mappings')
        .setDescription(desc)
        .setColor(0x5865f2)
        .setFooter({ text: 'Roles already control channel access via Discord permissions' });
      return interaction.reply({ embeds: [embed] });
    }

    if (commandName === 'remove_team') {
      if (!isHost(interaction.member)) return denyHost(interaction);
      const guildTeams = teams[guildId] || {};
      const entries = Object.entries(guildTeams);
      if (entries.length === 0) return interaction.reply({ content: '❌ No team mappings to remove.', ephemeral: true });
      const options = entries.map(([factionName, mapping]) => ({
        label: factionName.slice(0, 100),
        description: mapping.roleId ? `Role ID: ${mapping.roleId}` : 'No role',
        value: factionName,
      }));
      const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`remove_team_pick__${interaction.user.id}`)
          .setPlaceholder('Choose a faction mapping to remove...')
          .addOptions(options)
      );
      return interaction.reply({ content: '🗑️ Which team mapping do you want to remove?', components: [row], ephemeral: true });
    }

    if (commandName === 'clear_teams') {
      if (!isAdmin(interaction.member)) return denyAdmin(interaction);
      teams[guildId] = {};
      saveTeams(teams);
      const embed = new EmbedBuilder()
        .setTitle('🗑️ Team Mappings Cleared')
        .setDescription('All faction → team role mappings have been removed.')
        .setColor(0xff4444).setTimestamp();
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
  });

  // ── Dropdown: remove_team_pick ──────────────────────────────────────────────
  client.on('interactionCreate', async interaction => {
    if (!interaction.isStringSelectMenu()) return;
    if (!interaction.customId.startsWith('remove_team_pick__')) return;
    const userId = interaction.customId.split('__')[1];
    if (interaction.user.id !== userId) return interaction.reply({ content: '❌ This menu is not for you.', ephemeral: true });
    const { guildId } = interaction;
    const factionName = interaction.values[0];
    if (!teams[guildId]?.[factionName]) {
      return interaction.update({ content: `❌ No mapping found for **"${factionName}"**.`, components: [] });
    }
    delete teams[guildId][factionName];
    saveTeams(teams);
    return interaction.update({ content: `✅ Team mapping for **"${factionName}"** removed.`, components: [] });
  });
}

module.exports = { setupTeams, teamCommands, assignTeam, removeTeam, _reloadTeams };