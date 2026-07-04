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
const { TEAM_SLOT_COUNT, teamRoleKey } = require('./teams');

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

// The 5 Team Role slots — position-based (slot N = whichever faction ends up
// in position N of a given handpick list), so they're configured once here
// instead of per-list.
function teamSlots() {
  return Array.from({ length: TEAM_SLOT_COUNT }, (_, i) => ({ position: i + 1, key: teamRoleKey(i + 1) }));
}

// Each configurable setting. type: 'channel' | 'role' | 'roles' | 'medal' | 'teamgroup'
// 'medal' settings pair a role with a configurable MVP threshold (not preset).
// 'teamgroup' is a single menu entry that opens a sub-panel for the 5 Team Role slots.
const SETTINGS = [
  { key: 'logChannelId',      type: 'channel',   label: '📢 Log Channel',      desc: 'List expiry / reset / reopen announcements' },
  { key: 'auditChannelId',    type: 'channel',   label: '📝 Audit Log Channel', desc: 'Logs moderation & admin actions' },
  { key: 'rankingsChannelId', type: 'channel',   label: '🏆 Rankings Channel', desc: 'Where the live leaderboard is pinned' },
  { key: 'updatesChannelId',  type: 'channel',   label: '🔔 Updates Channel',  desc: 'Posted here whenever the bot ships a new command/feature' },
  { key: 'hostRoles',         type: 'roles',     label: '🛡️ Host Roles',       desc: 'Roles allowed to run Host commands' },
  medalSetting(1), medalSetting(2), medalSetting(3),
  { key: 'teamRoles',         type: 'teamgroup', label: '🎖️ Team Roles',       desc: 'Assign a role per faction position — applies to every list automatically' },
];

// Finds which SETTINGS entry "owns" a given store key — either the entry's own
// key, a medal setting's roleKey/mvpsKey sub-fields, or one of the 5 team slots.
function ownerSetting(key) {
  const direct = SETTINGS.find(s => s.key === key);
  if (direct) return { owner: direct, subtype: direct.type };
  const medal = SETTINGS.find(s => s.type === 'medal' && (s.roleKey === key || s.mvpsKey === key));
  if (medal) return { owner: medal, subtype: medal.roleKey === key ? 'role' : 'number' };
  if (teamSlots().some(s => s.key === key)) {
    return { owner: SETTINGS.find(s => s.type === 'teamgroup'), subtype: 'teamslot' };
  }
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
  if (setting.type === 'teamgroup') {
    const count = teamSlots().filter(s => cfg[s.key]).length;
    return `${count}/${TEAM_SLOT_COUNT} configured`;
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

function teamGroupPayload(userId, guildId) {
  const cfg   = getConfig(guildId);
  const slots = teamSlots();
  const lines = slots.map(s => `**Team ${s.position}** → ${cfg[s.key] ? `<@&${cfg[s.key]}>` : '❌ not set'}`);
  const embed = new EmbedBuilder()
    .setTitle('⚙️ Setup — Team Roles')
    .setColor(0x5865f2)
    .setDescription(`Assign a role to each **position** in your handpick lists. Whichever faction ends up in that position (1st, 2nd, 3rd...) automatically gets the matching role when claimed — no need to re-run this per list.\n\n${lines.join('\n')}`);
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`setup_teamslot_menu__${userId}`)
    .setPlaceholder('Pick a slot to set its role...')
    .addOptions(slots.map(s => ({
      label: `Team ${s.position}${cfg[s.key] ? ' ✅' : ''}`,
      description: cfg[s.key] ? 'Role set — pick to change' : 'No role set yet',
      value: s.key,
    })));
  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(menu),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`setup_back__${userId}`).setLabel('◀ Back').setStyle(ButtonStyle.Secondary)
      ),
    ],
  };
}

function teamSlotPickerPayload(slotKey, userId, guildId) {
  const position = teamSlots().find(s => s.key === slotKey)?.position ?? '?';
  const roleSelect = new RoleSelectMenuBuilder()
    .setCustomId(`setup_set__${slotKey}__${userId}`)
    .setPlaceholder(`Pick the role for Team ${position}`)
    .setMinValues(1).setMaxValues(1);
  const embed = new EmbedBuilder()
    .setTitle(`⚙️ Setup — Team ${position} Role`)
    .setColor(0x5865f2)
    .setDescription(`Whoever claims the faction in position **${position}** of a handpick list automatically receives this role (and loses it on unclaim/removal/swap).`);
  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(roleSelect),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`setup_teamback__${userId}`).setLabel('◀ Back to Team Roles').setStyle(ButtonStyle.Secondary)
      ),
    ],
  };
}

const setupCommands = [
  new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Admin: Configure this server — log channels, host roles, medal & team roles')
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
        if (setting.type === 'teamgroup') return interaction.update(teamGroupPayload(userId, interaction.guildId));
        return interaction.update(pickerPayload(setting, userId, interaction.guildId));
      }

      // ── Team slot picked from the Teams sub-panel → show its role picker ──
      if (interaction.isStringSelectMenu() && interaction.customId.startsWith('setup_teamslot_menu__')) {
        const userId = interaction.customId.split('__')[1];
        if (interaction.user.id !== userId) return notYours(interaction);
        return interaction.update(teamSlotPickerPayload(interaction.values[0], userId, interaction.guildId));
      }

      // ── Back → return to panel ──
      if (interaction.isButton() && interaction.customId.startsWith('setup_back__')) {
        const userId = interaction.customId.split('__')[1];
        if (interaction.user.id !== userId) return notYours(interaction);
        return interaction.update(panelPayload(interaction.guildId, userId));
      }

      // ── Back (from a team slot picker) → return to the Teams sub-panel ──
      if (interaction.isButton() && interaction.customId.startsWith('setup_teamback__')) {
        const userId = interaction.customId.split('__')[1];
        if (interaction.user.id !== userId) return notYours(interaction);
        return interaction.update(teamGroupPayload(userId, interaction.guildId));
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
        // easy to set right after); team slots go back to the Teams sub-panel;
        // everything else returns to the main panel.
        if (found && found.owner.type === 'medal') {
          return interaction.update(pickerPayload(found.owner, userId, interaction.guildId));
        }
        if (found && found.subtype === 'teamslot') {
          return interaction.update(teamGroupPayload(userId, interaction.guildId));
        }
        return interaction.update(panelPayload(interaction.guildId, userId));
      }
    } catch (err) {
      console.error('setup interaction error:', err);
    }
  });
}

module.exports = { setupCommands, setupSetup };
