// /setup — interactive per-guild configuration panel (admin only).
//
// Shows the current config and lets an admin set each channel/role via native
// channel/role picker menus. Everything is stored per-guild in guildconfig.js,
// so the bot works in any server once this has been run.
const {
  SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder,
  StringSelectMenuBuilder, ChannelSelectMenuBuilder, RoleSelectMenuBuilder,
  ButtonBuilder, ButtonStyle, ChannelType,
} = require('discord.js');
const { isAdmin, denyAdmin } = require('./permissions');
const { getConfig, setKey } = require('./guildconfig');

// Each configurable setting. type: 'channel' | 'role' | 'roles'
const SETTINGS = [
  { key: 'logChannelId',      type: 'channel', label: '📢 Log Channel',           desc: 'List expiry / reset / reopen announcements' },
  { key: 'auditChannelId',    type: 'channel', label: '📝 Audit Log Channel',     desc: 'Logs moderation & admin actions' },
  { key: 'rankingsChannelId', type: 'channel', label: '🏆 Rankings Channel',      desc: 'Where the live leaderboard is pinned' },
  { key: 'hostRoles',         type: 'roles',   label: '🛡️ Host Roles',            desc: 'Roles allowed to run Host commands' },
  { key: 'medalBronzeRoleId', type: 'role',    label: '🟫 Bronze Star (1+ MVP)',  desc: 'Medal role granted at 1+ MVPs' },
  { key: 'medalAirmanRoleId', type: 'role',    label: "✈️ Airman's Medal (5+ MVP)", desc: 'Medal role granted at 5+ MVPs' },
  { key: 'medalPurpleRoleId', type: 'role',    label: '💜 Purple Heart (8+ MVP)', desc: 'Medal role granted at 8+ MVPs' },
];

function renderValue(setting, cfg) {
  const v = cfg[setting.key];
  if (setting.type === 'channel') return v ? `<#${v}>` : '❌ not set';
  if (setting.type === 'role')    return v ? `<@&${v}>` : '❌ not set';
  if (setting.type === 'roles')   return (v && v.length) ? v.map(r => `<@&${r}>`).join(', ') : '❌ none set';
  return '❌';
}

function panelPayload(guildId, userId) {
  const cfg = getConfig(guildId);
  const embed = new EmbedBuilder()
    .setTitle('⚙️ Bot Setup')
    .setColor(0x5865f2)
    .setDescription('Pick a setting below to configure it. Changes save immediately.')
    .addFields(SETTINGS.map(s => ({ name: s.label, value: renderValue(s, cfg), inline: true })));
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`setup_menu__${userId}`)
    .setPlaceholder('Choose a setting to configure...')
    .addOptions(SETTINGS.map(s => ({ label: s.label.slice(0, 100), description: s.desc.slice(0, 100), value: s.key })));
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] };
}

function pickerPayload(setting, userId) {
  let picker;
  if (setting.type === 'channel') {
    picker = new ChannelSelectMenuBuilder()
      .setCustomId(`setup_set__${setting.key}__${userId}`)
      .setPlaceholder(`Pick a channel for ${setting.label}`)
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.PublicThread, ChannelType.PrivateThread, ChannelType.AnnouncementThread)
      .setMinValues(1).setMaxValues(1);
  } else if (setting.type === 'role') {
    picker = new RoleSelectMenuBuilder()
      .setCustomId(`setup_set__${setting.key}__${userId}`)
      .setPlaceholder(`Pick a role for ${setting.label}`)
      .setMinValues(1).setMaxValues(1);
  } else { // 'roles' — multi, allow clearing by selecting none
    picker = new RoleSelectMenuBuilder()
      .setCustomId(`setup_set__${setting.key}__${userId}`)
      .setPlaceholder(`Pick role(s) for ${setting.label}`)
      .setMinValues(0).setMaxValues(10);
  }
  const embed = new EmbedBuilder()
    .setTitle(`⚙️ Setup — ${setting.label}`)
    .setColor(0x5865f2)
    .setDescription(`${setting.desc}\n\nSelect below to set it${setting.type === 'roles' ? ' (select none to clear)' : ''}.`);
  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(picker),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`setup_back__${userId}`).setLabel('◀ Back').setStyle(ButtonStyle.Secondary)
      ),
    ],
  };
}

const setupCommands = [
  new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Admin: Configure this server — log channels, host roles, medal roles')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),
];

function setupSetup(client) {
  const notYours = (interaction) =>
    interaction.reply({ content: '❌ This setup panel isn\'t for you — run `/setup` yourself.', ephemeral: true });

  client.on('interactionCreate', async interaction => {
    try {
      // ── /setup command → open panel ──
      if (interaction.isChatInputCommand() && interaction.commandName === 'setup') {
        if (!isAdmin(interaction.member)) return denyAdmin(interaction);
        return interaction.reply({ ...panelPayload(interaction.guildId, interaction.user.id), ephemeral: true });
      }

      // ── Setting picked from the menu → show its picker ──
      if (interaction.isStringSelectMenu() && interaction.customId.startsWith('setup_menu__')) {
        const userId = interaction.customId.split('__')[1];
        if (interaction.user.id !== userId) return notYours(interaction);
        const setting = SETTINGS.find(s => s.key === interaction.values[0]);
        if (!setting) return interaction.update(panelPayload(interaction.guildId, userId));
        return interaction.update(pickerPayload(setting, userId));
      }

      // ── Back → return to panel ──
      if (interaction.isButton() && interaction.customId.startsWith('setup_back__')) {
        const userId = interaction.customId.split('__')[1];
        if (interaction.user.id !== userId) return notYours(interaction);
        return interaction.update(panelPayload(interaction.guildId, userId));
      }

      // ── Channel / role value chosen → save + re-render panel ──
      if ((interaction.isChannelSelectMenu() || interaction.isRoleSelectMenu()) && interaction.customId.startsWith('setup_set__')) {
        const parts  = interaction.customId.split('__'); // ['setup_set', key, userId]
        const key    = parts[1];
        const userId = parts[2];
        if (interaction.user.id !== userId) return notYours(interaction);
        const setting = SETTINGS.find(s => s.key === key);
        if (!setting) return interaction.update(panelPayload(interaction.guildId, userId));
        const value = setting.type === 'roles' ? [...interaction.values] : (interaction.values[0] ?? null);
        setKey(interaction.guildId, key, value);
        return interaction.update(panelPayload(interaction.guildId, userId));
      }
    } catch (err) {
      console.error('setup interaction error:', err);
    }
  });
}

module.exports = { setupCommands, setupSetup };
