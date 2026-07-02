// /setup — interactive per-guild configuration panel (admin only).
//
// Shows the current config and lets an admin set each channel/role via native
// channel/role picker menus. Everything is stored per-guild in guildconfig.js,
// so the bot works in any server once this has been run.
const {
  SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder,
  StringSelectMenuBuilder, ChannelSelectMenuBuilder, RoleSelectMenuBuilder,
  ButtonBuilder, ButtonStyle, ChannelType,
  ModalBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js');
const { isAdmin, denyAdmin } = require('./permissions');
const { getConfig, setKey } = require('./guildconfig');

const MEDAL_ICONS = { 1: '🥉', 2: '🥈', 3: '🥇' };
const MEDAL_DEFAULT_MVPS = { 1: 1, 2: 5, 3: 8 };

function medalSetting(n) {
  return {
    key: `medalRole${n}`,
    type: 'medal',
    roleKey: `medalRole${n}Id`,
    mvpsKey: `medalRole${n}Mvps`,
    defaultMvps: MEDAL_DEFAULT_MVPS[n],
    icon: MEDAL_ICONS[n],
    desc: 'Role granted once a player reaches this many MVPs',
  };
}

// Each configurable setting. type: 'channel' | 'role' | 'roles' | 'medal'
// 'medal' settings pair a role with a configurable MVP threshold (not preset).
const SETTINGS = [
  { key: 'logChannelId',      type: 'channel', label: '📢 Log Channel',      desc: 'List expiry / reset / reopen announcements' },
  { key: 'auditChannelId',    type: 'channel', label: '📝 Audit Log Channel', desc: 'Logs moderation & admin actions' },
  { key: 'rankingsChannelId', type: 'channel', label: '🏆 Rankings Channel', desc: 'Where the live leaderboard is pinned' },
  { key: 'hostRoles',         type: 'roles',   label: '🛡️ Host Roles',       desc: 'Roles allowed to run Host commands' },
  medalSetting(1), medalSetting(2), medalSetting(3),
];

// Finds which SETTINGS entry "owns" a given store key — either the entry's own
// key, or (for medal settings) its roleKey/mvpsKey sub-fields.
function ownerSetting(key) {
  const direct = SETTINGS.find(s => s.key === key);
  if (direct) return { owner: direct, subtype: direct.type };
  const medal = SETTINGS.find(s => s.type === 'medal' && (s.roleKey === key || s.mvpsKey === key));
  if (medal) return { owner: medal, subtype: medal.roleKey === key ? 'role' : 'number' };
  return null;
}

function settingLabel(setting, cfg) {
  if (setting.type === 'medal') {
    const mvps = cfg[setting.mvpsKey] ?? setting.defaultMvps;
    return `${setting.icon} Role for ${mvps}+ MVPs`;
  }
  return setting.label;
}

function renderValue(setting, cfg) {
  if (setting.type === 'medal') {
    const v = cfg[setting.roleKey];
    return v ? `<@&${v}>` : '❌ not set';
  }
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
    .addFields(SETTINGS.map(s => ({ name: settingLabel(s, cfg), value: renderValue(s, cfg), inline: true })));
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`setup_menu__${userId}`)
    .setPlaceholder('Choose a setting to configure...')
    .addOptions(SETTINGS.map(s => ({ label: settingLabel(s, cfg).slice(0, 100), description: s.desc.slice(0, 100), value: s.key })));
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] };
}

function pickerPayload(setting, userId, guildId) {
  if (setting.type === 'medal') {
    const cfg = getConfig(guildId);
    const mvps = cfg[setting.mvpsKey] ?? setting.defaultMvps;
    const roleSelect = new RoleSelectMenuBuilder()
      .setCustomId(`setup_set__${setting.roleKey}__${userId}`)
      .setPlaceholder(`Pick the role for ${mvps}+ MVPs`)
      .setMinValues(1).setMaxValues(1);
    const thresholdBtn = new ButtonBuilder()
      .setCustomId(`setup_threshold__${setting.mvpsKey}__${userId}`)
      .setLabel(`Set MVP requirement (currently ${mvps})`)
      .setStyle(ButtonStyle.Secondary);
    const embed = new EmbedBuilder()
      .setTitle(`⚙️ Setup — Role for ${mvps}+ MVPs`)
      .setColor(0x5865f2)
      .setDescription('Pick the role to grant, and set how many MVPs are required to earn it.');
    return {
      embeds: [embed],
      components: [
        new ActionRowBuilder().addComponents(roleSelect),
        new ActionRowBuilder().addComponents(thresholdBtn),
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`setup_back__${userId}`).setLabel('◀ Back').setStyle(ButtonStyle.Secondary)
        ),
      ],
    };
  }

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
        return interaction.update(pickerPayload(setting, userId, interaction.guildId));
      }

      // ── Back → return to panel ──
      if (interaction.isButton() && interaction.customId.startsWith('setup_back__')) {
        const userId = interaction.customId.split('__')[1];
        if (interaction.user.id !== userId) return notYours(interaction);
        return interaction.update(panelPayload(interaction.guildId, userId));
      }

      // ── Medal threshold button → show a modal for the MVP count ──
      if (interaction.isButton() && interaction.customId.startsWith('setup_threshold__')) {
        const parts   = interaction.customId.split('__'); // ['setup_threshold', mvpsKey, userId]
        const mvpsKey = parts[1];
        const userId  = parts[2];
        if (interaction.user.id !== userId) return notYours(interaction);
        const medal = SETTINGS.find(s => s.type === 'medal' && s.mvpsKey === mvpsKey);
        if (!medal) return interaction.update(panelPayload(interaction.guildId, userId));
        const cfg = getConfig(interaction.guildId);
        const current = cfg[mvpsKey] ?? medal.defaultMvps;
        const modal = new ModalBuilder()
          .setCustomId(`setup_modal__${mvpsKey}__${userId}`)
          .setTitle('Set MVP Requirement')
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('mvps_value')
                .setLabel('MVPs required to earn this role')
                .setStyle(TextInputStyle.Short)
                .setValue(String(current))
                .setRequired(true)
                .setMaxLength(4)
            )
          );
        return interaction.showModal(modal);
      }

      // ── Modal submit → validate + save the MVP threshold, back to the medal picker ──
      if (interaction.isModalSubmit() && interaction.customId.startsWith('setup_modal__')) {
        const parts   = interaction.customId.split('__'); // ['setup_modal', mvpsKey, userId]
        const mvpsKey = parts[1];
        const userId  = parts[2];
        if (interaction.user.id !== userId) return notYours(interaction);
        const medal = SETTINGS.find(s => s.type === 'medal' && s.mvpsKey === mvpsKey);
        if (!medal) return interaction.update(panelPayload(interaction.guildId, userId));
        const raw = interaction.fields.getTextInputValue('mvps_value').trim();
        const n = parseInt(raw, 10);
        if (!Number.isInteger(n) || n <= 0 || String(n) !== raw) {
          return interaction.reply({ content: '❌ Enter a whole number greater than 0.', ephemeral: true });
        }
        setKey(interaction.guildId, mvpsKey, n);
        return interaction.update(pickerPayload(medal, userId, interaction.guildId));
      }

      // ── Channel / role value chosen → save + re-render ──
      if ((interaction.isChannelSelectMenu() || interaction.isRoleSelectMenu()) && interaction.customId.startsWith('setup_set__')) {
        const parts  = interaction.customId.split('__'); // ['setup_set', key, userId]
        const key    = parts[1];
        const userId = parts[2];
        if (interaction.user.id !== userId) return notYours(interaction);
        const found = ownerSetting(key);
        if (found) {
          const value = found.subtype === 'roles' ? [...interaction.values] : (interaction.values[0] ?? null);
          setKey(interaction.guildId, key, value);
        }
        // Medal sub-fields go back to that medal's picker (so the threshold is
        // easy to set right after); everything else returns to the main panel.
        if (found && found.owner.type === 'medal') {
          return interaction.update(pickerPayload(found.owner, userId, interaction.guildId));
        }
        return interaction.update(panelPayload(interaction.guildId, userId));
      }
    } catch (err) {
      console.error('setup interaction error:', err);
    }
  });
}

module.exports = { setupCommands, setupSetup };
