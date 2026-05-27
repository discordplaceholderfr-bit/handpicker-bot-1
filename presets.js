const { isAdmin, isHost, denyHost, denyAdmin } = require('./permissions');

const {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const fs   = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PRESETS_FILE = path.join(DATA_DIR, 'presets.json');
const GAMES_FILE   = path.join(DATA_DIR, 'games.json');

function loadPresets() {
  try { return fs.existsSync(PRESETS_FILE) ? JSON.parse(fs.readFileSync(PRESETS_FILE, 'utf8')) : {}; }
  catch { return {}; }
}
function savePresets(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(PRESETS_FILE, JSON.stringify(data, null, 2));
}
function loadGames() {
  try { return fs.existsSync(GAMES_FILE) ? JSON.parse(fs.readFileSync(GAMES_FILE, 'utf8')) : {}; }
  catch { return {}; }
}

let presets = loadPresets();
const pendingSaves = {};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function presetOptions(guildId) {
  return Object.entries(presets[guildId] || {}).map(([n, p]) => ({
    label:       n.slice(0, 100),
    description: `${p.title} · ${Object.values(p.factions).reduce((s,f)=>s+f.countries.length,0)} countries`.slice(0,100),
    value:       n,
  }));
}

function gameOptions(guildId) {
  const games = loadGames();
  return Object.entries(games)
    .filter(([,g]) => g.guildId === guildId)
    .map(([gameId, game]) => ({
      label:       game.title.slice(0, 100),
      description: `${Object.keys(game.factions).join(', ')} · ${Object.values(game.factions).reduce((s,f)=>s+f.countries.length,0)} countries`.slice(0,100),
      value:       gameId,
    }));
}

function buildSavedEmbed(presetName, game, savedBy) {
  const factionsTemplate = {};
  for (const [fName, faction] of Object.entries(game.factions)) {
    factionsTemplate[fName] = { countries: [...faction.countries] };
  }
  const countryCount = Object.values(factionsTemplate).reduce((s,f) => s+f.countries.length, 0);
  return new EmbedBuilder()
    .setTitle('💾 Preset Saved!')
    .setDescription(`Preset **"${presetName}"** saved successfully!`)
    .addFields(
      { name: '📋 Title',     value: game.title,                              inline: true },
      { name: '⚔️ Factions',  value: Object.keys(factionsTemplate).join(', '), inline: true },
      { name: '🌍 Countries', value: `${countryCount} total`,                  inline: true },
    )
    .setColor(0x57f287)
    .setFooter({ text: `Saved by ${savedBy}` })
    .setTimestamp();
}

// ─── Slash command definitions ────────────────────────────────────────────────
// NOTE: load_preset, delete_preset, preview_preset no longer take a string option —
//       they show a dropdown instead, so no option needed.
const presetCommands = [
  new SlashCommandBuilder()
    .setName('save_preset')
    .setDescription('Save one of your active handpick lists as a reusable preset')
    .addStringOption(o => o.setName('name').setDescription('Name for this preset (e.g. "Europe 1936")').setRequired(true))
    .toJSON(),

  new SlashCommandBuilder()
    .setName('load_preset')
    .setDescription('Pick a saved preset from a dropdown and deploy it as a new handpick list')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('list_presets')
    .setDescription('Show all saved presets for this server with a browsable dropdown')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('delete_preset')
    .setDescription('Pick a preset from a dropdown and delete it')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('preview_preset')
    .setDescription('Pick a preset from a dropdown to preview its countries')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('reset_presets')
    .setDescription('Admin: Wipe all saved presets for this server (IRREVERSIBLE)')
    .toJSON(),
];

module.exports.presetCommands = presetCommands;

// ─── Setup ────────────────────────────────────────────────────────────────────
function setupPresets(client) {

  // ── Slash commands ──────────────────────────────────────────────────────────
  client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    const { commandName, guildId } = interaction;

    // ── /save_preset ──────────────────────────────────────────────────────────
    if (commandName === 'save_preset') {
      if (!isHost(interaction.member)) return denyHost(interaction);
      const guildGames = gameOptions(guildId);
      if (guildGames.length === 0) {
        return interaction.reply({ content: '❌ No active handpick lists found. Create one first with `/create_handpick`.', ephemeral: true });
      }

      const presetName = interaction.options.getString('name').trim();

      if (guildGames.length === 1) {
        // Only one game — save directly
        const games = loadGames();
        const game  = Object.values(games).find(g => g.guildId === guildId);
        if (!presets[guildId]) presets[guildId] = {};
        const factionsTemplate = {};
        for (const [fName, faction] of Object.entries(game.factions)) {
          factionsTemplate[fName] = { countries: [...faction.countries] };
        }
        presets[guildId][presetName] = { title: game.title, factions: factionsTemplate, savedAt: new Date().toISOString(), savedBy: interaction.user.id };
        savePresets(presets);
        return interaction.reply({ embeds: [buildSavedEmbed(presetName, game, interaction.user.username)] });
      }

      // Multiple games — show dropdown
      pendingSaves[interaction.user.id] = { presetName, guildId };
      const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`savepreset_pick__${interaction.user.id}`)
          .setPlaceholder('Choose which list to save as preset...')
          .addOptions(guildGames)
      );
      return interaction.reply({ content: `📋 You have **${guildGames.length}** active lists. Which one do you want to save as **"${presetName}"**?`, components: [row] });
    }

    // ── /load_preset — dropdown picker ────────────────────────────────────────
    if (commandName === 'load_preset') {
      if (!isHost(interaction.member)) return denyHost(interaction);
      const opts = presetOptions(guildId);
      if (opts.length === 0) return interaction.reply({ content: '❌ No presets saved yet. Use `/save_preset` first.', ephemeral: true });

      const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`load_preset_pick__${interaction.user.id}`)
          .setPlaceholder('Choose a preset to load...')
          .addOptions(opts)
      );
      return interaction.reply({ content: '📋 Which preset do you want to deploy?', components: [row] });
    }

    // ── /list_presets — dropdown to preview each ──────────────────────────────
    if (commandName === 'list_presets') {
      const guildPresets = presets[guildId] || {};
      const names        = Object.keys(guildPresets);
      if (names.length === 0) return interaction.reply({ content: '❌ No presets saved yet.', ephemeral: true });

      // Show summary embed + dropdown to preview any one
      let desc = '';
      for (const [pName, p] of Object.entries(guildPresets)) {
        const factionNames = Object.keys(p.factions).join(', ');
        const countryCount = Object.values(p.factions).reduce((s,f) => s+f.countries.length, 0);
        const savedDate    = new Date(p.savedAt).toLocaleDateString();
        desc += `**"${pName}"** — *${p.title}*\n┗ ${factionNames} · ${countryCount} countries · saved ${savedDate}\n\n`;
      }
      const embed = new EmbedBuilder()
        .setTitle(`💾 Saved Presets (${names.length})`)
        .setDescription(desc)
        .setColor(0x5865f2)
        .setFooter({ text: 'Use the dropdown below to preview any preset' });

      const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`preview_preset_pick__${interaction.user.id}`)
          .setPlaceholder('Preview a preset...')
          .addOptions(presetOptions(guildId))
      );
      return interaction.reply({ embeds: [embed], components: [row] });
    }

    // ── /delete_preset — dropdown picker ─────────────────────────────────────
    if (commandName === 'delete_preset') {
      if (!isAdmin(interaction.member)) return denyAdmin(interaction);
      const opts = presetOptions(guildId);
      if (opts.length === 0) return interaction.reply({ content: '❌ No presets saved to delete.', ephemeral: true });

      const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`delete_preset_pick__${guildId}__${interaction.user.id}`)
          .setPlaceholder('Choose a preset to delete...')
          .addOptions(opts)
      );
      return interaction.reply({ content: '🗑️ Which preset do you want to delete?', components: [row] });
    }

    // ── /preview_preset — dropdown picker ────────────────────────────────────
    if (commandName === 'preview_preset') {
      const opts = presetOptions(guildId);
      if (opts.length === 0) return interaction.reply({ content: '❌ No presets saved yet.', ephemeral: true });

      const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`preview_preset_pick__${interaction.user.id}`)
          .setPlaceholder('Choose a preset to preview...')
          .addOptions(opts)
      );
      return interaction.reply({ content: '🔍 Which preset do you want to preview?', components: [row] });
    }

    // ── /reset_presets ────────────────────────────────────────────────────────
    if (commandName === 'reset_presets') {
      if (!isAdmin(interaction.member)) return denyAdmin(interaction);
      const guildPresets = presets[guildId] || {};
      const count = Object.keys(guildPresets).length;
      if (count === 0) return interaction.reply({ content: '❌ There are no saved presets to reset.', ephemeral: true });

      const confirmEmbed = new EmbedBuilder()
        .setTitle('⚠️ Confirm Preset Reset')
        .setDescription(`Are you sure you want to **delete all ${count} saved preset${count !== 1 ? 's' : ''}** for this server?\n\n**This action cannot be undone.**`)
        .setColor(0xff4444);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`confirm_reset_presets__${guildId}`).setLabel(`Yes, delete all ${count} preset${count !== 1 ? 's' : ''}`).setStyle(ButtonStyle.Danger).setEmoji('🗑️'),
        new ButtonBuilder().setCustomId('cancel_reset').setLabel('Cancel').setStyle(ButtonStyle.Secondary).setEmoji('✖️'),
      );
      return interaction.reply({ embeds: [confirmEmbed], components: [row], ephemeral: true });
    }
  });

  // ── Dropdown: preview_preset_pick ─────────────────────────────────────────
  client.on('interactionCreate', async interaction => {
    if (!interaction.isStringSelectMenu()) return;
    if (!interaction.customId.startsWith('preview_preset_pick__')) return;

    const userId = interaction.customId.split('__')[1];
    if (interaction.user.id !== userId) return interaction.reply({ content: '❌ This menu is not for you.', ephemeral: true });

    const name   = interaction.values[0];
    // Reload in case guildId needed — get from the preset keys
    let foundGuildId = null;
    for (const [gId, gPresets] of Object.entries(presets)) {
      if (gPresets[name]) { foundGuildId = gId; break; }
    }
    const preset = foundGuildId ? presets[foundGuildId][name] : null;
    if (!preset) return interaction.reply({ content: '❌ Preset not found.', ephemeral: true });

    const embed = new EmbedBuilder()
      .setTitle(`🔍 Preview — "${name}"`)
      .setDescription(`**${preset.title}**\nSaved by <@${preset.savedBy}> on ${new Date(preset.savedAt).toLocaleDateString()}`)
      .setColor(0xfee75c);

    const emojis = ['🔴','🔵','🟢','🟡','🟠','🟣'];
    Object.entries(preset.factions).forEach(([fName, f], i) => {
      embed.addFields({ name: `${emojis[i % emojis.length]} ${fName} (${f.countries.length})`, value: f.countries.join(', ') || '*empty*', inline: false });
    });
    embed.setFooter({ text: 'Use /load_preset to deploy this preset' });

    // If this came from /list_presets the message already has an embed — update it
    return interaction.update({ embeds: [embed], components: interaction.message.components });
  });

  // ── Dropdown: load_preset_pick ────────────────────────────────────────────
  client.on('interactionCreate', async interaction => {
    if (!interaction.isStringSelectMenu()) return;
    if (!interaction.customId.startsWith('load_preset_pick__')) return;

    const userId = interaction.customId.split('__')[1];
    if (interaction.user.id !== userId) return interaction.reply({ content: '❌ This menu is not for you.', ephemeral: true });

    // Find the preset across all guilds by name
    const name = interaction.values[0];
    const guildId = interaction.guildId;
    const preset  = presets[guildId]?.[name];
    if (!preset) return interaction.update({ content: '❌ Preset not found.', components: [] });

    await interaction.update({ content: `⏳ Setting up **"${name}"**...`, components: [] });

    const { saveGame, pendingGames } = require('./handpicker');
    const gameId      = `${guildId}_${Date.now()}`;
    const factions    = {};
    const factionOrder = [];
    for (const [fName, f] of Object.entries(preset.factions)) {
      factions[fName] = { countries: [...f.countries], claims: {} };
      factionOrder.push(fName);
    }
    const game = { title: preset.title, host: interaction.user.id, guildId, channelId: interaction.channelId, factions };

    // Store as pending — don't post list yet
    pendingGames[gameId] = { game, factionOrder, channelId: interaction.channelId };

    // ── Auto-map team roles ────────────────────────────────────────────────
    if (interaction.guild) {
      const teamRoles = interaction.guild.roles.cache
        .filter(r => /^Team\s*\d+$/i.test(r.name))
        .sort((a, b) => parseInt(a.name.match(/\d+/)[0]) - parseInt(b.name.match(/\d+/)[0]));

      if (teamRoles.size >= factionOrder.length) {
        const TEAMS_FILE_PATH = require('path').join(__dirname, 'data', 'teams.json');
        let teamsData = {};
        try { teamsData = JSON.parse(require('fs').readFileSync(TEAMS_FILE_PATH, 'utf8')); } catch {}
        if (!teamsData[guildId]) teamsData[guildId] = {};
        const roleArray = [...teamRoles.values()];
        factionOrder.forEach((factionName, i) => {
          teamsData[guildId][factionName] = { roleId: roleArray[i].id };
        });
        require('fs').mkdirSync(require('path').join(__dirname, 'data'), { recursive: true });
        require('fs').writeFileSync(TEAMS_FILE_PATH, JSON.stringify(teamsData, null, 2));
        try { const tm = require('./teams'); if (tm._reloadTeams) tm._reloadTeams(); } catch {}
      }
    }

    // ── Ask about preset players FIRST ───────────────────────────────────────
    const presetBtn = new ButtonBuilder()
      .setCustomId(`open_preset_players__${gameId}`)
      .setLabel('Add Preset Players')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('👥');
    const skipBtn = new ButtonBuilder()
      .setCustomId(`skip_preset_players__${gameId}`)
      .setLabel('Skip')
      .setStyle(ButtonStyle.Secondary);

    await interaction.followUp({
      content: '👥 Do you want to pre-assign players to countries?',
      components: [new ActionRowBuilder().addComponents(presetBtn, skipBtn)],
    });
  });

    // ── Dropdown: delete_preset_pick ──────────────────────────────────────────
  client.on('interactionCreate', async interaction => {
    if (!interaction.isStringSelectMenu()) return;
    if (!interaction.customId.startsWith('delete_preset_pick__')) return;

    const parts   = interaction.customId.split('__');
    const guildId = parts[1];
    const userId  = parts[2];
    if (interaction.user.id !== userId) return interaction.reply({ content: '❌ This menu is not for you.', ephemeral: true });

    const name = interaction.values[0];
    if (!presets[guildId]?.[name]) return interaction.update({ content: '❌ That preset no longer exists.', components: [] });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`confirm_delete_preset__${guildId}__${encodeURIComponent(name)}`).setLabel(`Yes, delete "${name.slice(0,50)}"`).setStyle(ButtonStyle.Danger).setEmoji('🗑️'),
      new ButtonBuilder().setCustomId('cancel_reset').setLabel('Cancel').setStyle(ButtonStyle.Secondary).setEmoji('✖️'),
    );
    return interaction.update({ content: `⚠️ Are you sure you want to delete preset **"${name}"**? This cannot be undone.`, components: [row] });
  });

  // ── Dropdown: savepreset_pick ─────────────────────────────────────────────
  client.on('interactionCreate', async interaction => {
    if (!interaction.isStringSelectMenu()) return;
    if (!interaction.customId.startsWith('savepreset_pick__')) return;

    const userId  = interaction.customId.split('__')[1];
    if (interaction.user.id !== userId) return interaction.reply({ content: '❌ This menu is not for you.', ephemeral: true });

    const pending = pendingSaves[userId];
    if (!pending) return interaction.reply({ content: '❌ Session expired. Run `/save_preset` again.', ephemeral: true });

    const gameId = interaction.values[0];
    const games  = loadGames();
    const game   = games[gameId];
    if (!game) return interaction.reply({ content: '❌ That game no longer exists.', ephemeral: true });

    const { presetName, guildId } = pending;
    delete pendingSaves[userId];
    if (!presets[guildId]) presets[guildId] = {};

    const factionsTemplate = {};
    for (const [fName, faction] of Object.entries(game.factions)) {
      factionsTemplate[fName] = { countries: [...faction.countries] };
    }
    presets[guildId][presetName] = { title: game.title, factions: factionsTemplate, savedAt: new Date().toISOString(), savedBy: interaction.user.id };
    savePresets(presets);
    return interaction.update({ content: '', components: [], embeds: [buildSavedEmbed(presetName, game, interaction.user.username)] });
  });

  // ── Buttons ───────────────────────────────────────────────────────────────
  client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;

    if (interaction.customId === 'cancel_reset') {
      return interaction.update({ content: '✅ Action cancelled.', embeds: [], components: [] });
    }

    if (interaction.customId.startsWith('confirm_delete_preset__')) {
      const parts   = interaction.customId.split('__');
      const guildId = parts[1];
      const name    = decodeURIComponent(parts[2]);
      delete presets[guildId]?.[name];
      savePresets(presets);
      return interaction.update({ content: `🗑️ Preset **"${name}"** has been deleted.`, components: [] });
    }

    if (interaction.customId.startsWith('confirm_reset_presets__')) {
      const targetGuildId = interaction.customId.split('__')[1];
      presets[targetGuildId] = {};
      savePresets(presets);
      const embed = new EmbedBuilder()
        .setTitle('🗑️ Presets Reset')
        .setDescription('All saved presets for this server have been deleted.')
        .setColor(0xff4444).setTimestamp();
      return interaction.update({ embeds: [embed], components: [] });
    }
  });
}

module.exports = { setupPresets, presetCommands };