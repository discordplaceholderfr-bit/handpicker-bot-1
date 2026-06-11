const { isAdmin, isHost, denyHost, denyAdmin } = require('./permissions');
const { awardMVP, awardHM, removeMVP, removeHM, refreshRankingsMessage } = require('./leaderboard');

const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} = require('discord.js');
const fs   = require('fs');
const path = require('path');

const DATA_DIR     = process.env.DATA_DIR || path.join(__dirname, 'data');
const RESULTS_FILE = path.join(DATA_DIR, 'results.json');

function loadResults() {
  try { return fs.existsSync(RESULTS_FILE) ? JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8')) : {}; }
  catch { return {}; }
}
function saveResults(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(RESULTS_FILE, JSON.stringify(data, null, 2));
}

let allResults = loadResults();

function buildResultEmbed(result) {
  const embed = new EmbedBuilder()
    .setTitle(`${result.eventName} - Event Over`)
    .setColor(0x57f287)
    .setTimestamp(new Date(result.createdAt));

  for (const faction of result.factions) {
    const mvpText = faction.mvps.length ? faction.mvps.map(id => `<@${id}>`).join(', ') : 'N/A';
    const hmText  = faction.hms.length  ? faction.hms.map(id => `<@${id}>`).join(', ')  : 'N/A';
    embed.addFields({ name: faction.name, value: `⭐ **MVP:** ${mvpText}\n🏅 **HM:** ${hmText}` });
  }

  embed.addFields({ name: 'Host', value: `<@${result.postedById}>`, inline: true });

  if (result.summary) embed.addFields({ name: 'Summary', value: result.summary });

  return embed;
}

// Shared options builder — used by both post_results and edit_result
function addFactionOptions(builder) {
  return builder
    .addStringOption(o => o.setName('faction1_name').setDescription('First faction name').setRequired(true))
    .addUserOption(o => o.setName('faction1_mvp').setDescription('MVP of faction 1'))
    .addUserOption(o => o.setName('faction1_hm1').setDescription('HM 1 of faction 1'))
    .addUserOption(o => o.setName('faction1_hm2').setDescription('HM 2 of faction 1'))
    .addUserOption(o => o.setName('faction1_hm3').setDescription('HM 3 of faction 1'))
    .addStringOption(o => o.setName('faction2_name').setDescription('Second faction name'))
    .addUserOption(o => o.setName('faction2_mvp').setDescription('MVP of faction 2'))
    .addUserOption(o => o.setName('faction2_hm1').setDescription('HM 1 of faction 2'))
    .addUserOption(o => o.setName('faction2_hm2').setDescription('HM 2 of faction 2'))
    .addUserOption(o => o.setName('faction2_hm3').setDescription('HM 3 of faction 2'))
    .addStringOption(o => o.setName('summary').setDescription('Brief summary (optional)'));
}

// Read faction options from an interaction (i=1 or 2)
function readFactions(interaction) {
  const factions = [];
  for (let i = 1; i <= 2; i++) {
    const factionName = interaction.options.getString(`faction${i}_name`);
    if (!factionName) continue;
    const mvpUser = interaction.options.getUser(`faction${i}_mvp`);
    const hm1User = interaction.options.getUser(`faction${i}_hm1`);
    const hm2User = interaction.options.getUser(`faction${i}_hm2`);
    const hm3User = interaction.options.getUser(`faction${i}_hm3`);
    factions.push({
      name: factionName,
      mvps: [mvpUser?.id].filter(Boolean),
      hms:  [hm1User?.id, hm2User?.id, hm3User?.id].filter(Boolean),
    });
  }
  return factions;
}

// ─── Slash command definitions ────────────────────────────────────────────────
const resultsCommands = [
  addFactionOptions(
    new SlashCommandBuilder()
      .setName('post_results')
      .setDescription('Host: Post event results and auto-log MVPs/HMs to the leaderboard')
      .addStringOption(o => o.setName('event_name').setDescription('Name of the event').setRequired(true))
  ).toJSON(),

  new SlashCommandBuilder()
    .setName('edit_result')
    .setDescription('Admin: Edit a saved event result and adjust leaderboard awards automatically')
    .addStringOption(o => o.setName('result_name').setDescription('Current event name of the result to edit').setRequired(true))
    .addStringOption(o => o.setName('faction1_name').setDescription('First faction name (leave blank to keep current factions)'))
    .addUserOption(o => o.setName('faction1_mvp').setDescription('MVP of faction 1'))
    .addUserOption(o => o.setName('faction1_hm1').setDescription('HM 1 of faction 1'))
    .addUserOption(o => o.setName('faction1_hm2').setDescription('HM 2 of faction 1'))
    .addUserOption(o => o.setName('faction1_hm3').setDescription('HM 3 of faction 1'))
    .addStringOption(o => o.setName('faction2_name').setDescription('Second faction name'))
    .addUserOption(o => o.setName('faction2_mvp').setDescription('MVP of faction 2'))
    .addUserOption(o => o.setName('faction2_hm1').setDescription('HM 1 of faction 2'))
    .addUserOption(o => o.setName('faction2_hm2').setDescription('HM 2 of faction 2'))
    .addUserOption(o => o.setName('faction2_hm3').setDescription('HM 3 of faction 2'))
    .addStringOption(o => o.setName('event_name').setDescription('New event name (leave blank to keep current)'))
    .addStringOption(o => o.setName('summary').setDescription('Brief summary (optional)'))
    .toJSON(),

  new SlashCommandBuilder()
    .setName('list_results')
    .setDescription('Show all saved event results for this server')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('delete_result')
    .setDescription('Admin: Delete a saved event result')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('reset_results')
    .setDescription('Admin: Wipe all event results for this server (IRREVERSIBLE)')
    .toJSON(),
];

// ─── Setup ────────────────────────────────────────────────────────────────────
function setupResults(client) {

  // ── Slash commands ──────────────────────────────────────────────────────────
  client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    const { commandName, guildId } = interaction;

    if (commandName === 'post_results') {
      if (!isHost(interaction.member)) return denyHost(interaction);
      await interaction.deferReply();

      const eventName = interaction.options.getString('event_name');
      const summary   = interaction.options.getString('summary') || '';
      const factions  = readFactions(interaction);

      if (!factions.length) {
        return interaction.editReply({ content: '❌ At least one faction is required.' });
      }

      if (!allResults[guildId]) allResults[guildId] = {};
      for (const faction of factions) {
        for (const uid of faction.mvps) awardMVP(guildId, uid, null, 1);
        for (const uid of faction.hms)  awardHM(guildId, uid, null, 1);
      }
      const resultId = `result_${guildId}_${Date.now()}`;
      allResults[guildId][resultId] = {
        eventName, summary, factions,
        createdAt:    Date.now(),
        postedById:   interaction.user.id,
        postedByName: interaction.user.username,
      };
      saveResults(allResults);
      const msg = await interaction.editReply({ embeds: [buildResultEmbed(allResults[guildId][resultId])] });
      if (msg) {
        allResults[guildId][resultId].messageId = msg.id;
        allResults[guildId][resultId].channelId = msg.channelId;
        saveResults(allResults);
      }
      refreshRankingsMessage(guildId).catch(() => {});
      return;
    }

    if (commandName === 'edit_result') {
      if (!isAdmin(interaction.member)) return denyAdmin(interaction);
      await interaction.deferReply({ ephemeral: true });
      try {

      const resultName = interaction.options.getString('result_name')?.trim().toLowerCase();
      const guildData  = allResults[guildId] || {};
      // If multiple results share the same name, edit the most recent one
      const matches    = Object.entries(guildData)
        .filter(([, r]) => r.eventName.toLowerCase() === resultName)
        .sort((a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0));
      if (!matches.length) {
        return interaction.editReply({ content: `❌ No result found with the name **"${interaction.options.getString('result_name')}"**. Use \`/list_results\` to see saved names.` });
      }
      const [resultId, existing] = matches[0];

      const newEventName = interaction.options.getString('event_name')?.trim() || existing.eventName;
      const summary      = interaction.options.getString('summary') ?? existing.summary ?? '';
      // No faction options given → keep the existing factions/awards untouched
      const provided = readFactions(interaction);
      const factions = provided.length ? provided : existing.factions;

      // Diff old vs new awards and adjust leaderboard
      const countAwards = (factionList, type) => {
        const map = {};
        for (const f of factionList) for (const uid of f[type] || []) map[uid] = (map[uid] || 0) + 1;
        return map;
      };
      const oldMVPs = countAwards(existing.factions, 'mvps');
      const newMVPs = countAwards(factions, 'mvps');
      const oldHMs  = countAwards(existing.factions, 'hms');
      const newHMs  = countAwards(factions, 'hms');

      for (const uid of new Set([...Object.keys(oldMVPs), ...Object.keys(newMVPs)])) {
        const diff = (newMVPs[uid] || 0) - (oldMVPs[uid] || 0);
        if (diff > 0) awardMVP(guildId, uid, null, diff);
        if (diff < 0) removeMVP(guildId, uid, -diff);
      }
      for (const uid of new Set([...Object.keys(oldHMs), ...Object.keys(newHMs)])) {
        const diff = (newHMs[uid] || 0) - (oldHMs[uid] || 0);
        if (diff > 0) awardHM(guildId, uid, null, diff);
        if (diff < 0) removeHM(guildId, uid, -diff);
      }

      existing.eventName = newEventName;
      existing.summary   = summary;
      existing.factions  = factions;
      saveResults(allResults);

      // Edit the original posted message in-place
      if (existing.messageId && existing.channelId) {
        try {
          const ch  = await client.channels.fetch(existing.channelId);
          const msg = await ch.messages.fetch(existing.messageId);
          await msg.edit({ embeds: [buildResultEmbed(existing)] });
        } catch { /* original message was deleted */ }
      }

      refreshRankingsMessage(guildId).catch(() => {});
      return interaction.editReply({ content: '✅ Result updated and leaderboard adjusted.' });
      } catch (e) {
        console.error('edit_result error:', e);
        return interaction.editReply({ content: `❌ Something went wrong: ${e.message}` }).catch(() => {});
      }
    }

    if (commandName === 'list_results') {
      const entries = Object.entries(allResults[guildId] || {});
      if (!entries.length) return interaction.reply({ content: '❌ No event results saved for this server.', ephemeral: true });
      const lines = entries.map(([id, r]) => {
        const date     = new Date(r.createdAt).toLocaleDateString();
        const factions = r.factions.map(f => f.name).join(', ');
        return `**${r.eventName}** — ${date}\n${factions} · \`ID: ${id.slice(-6)}\``;
      });
      const embed = new EmbedBuilder()
        .setTitle('📋 Event Results')
        .setColor(0x57f287)
        .setDescription(lines.join('\n\n'));
      return interaction.reply({ embeds: [embed] });
    }

    if (commandName === 'delete_result') {
      if (!isAdmin(interaction.member)) return denyAdmin(interaction);
      return showResultPicker(interaction, guildId, 'delete_result_pick', '🗑️ Which event result do you want to delete?');
    }

    if (commandName === 'reset_results') {
      if (!isAdmin(interaction.member)) return denyAdmin(interaction);
      const confirmEmbed = new EmbedBuilder()
        .setTitle('⚠️ Confirm Results Reset')
        .setDescription('Wipe **all event results** for this server?\n\nAwards already given to the leaderboard are **not** reversed.\n\n**This cannot be undone.**')
        .setColor(0xff4444);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`confirm_reset_results__${guildId}`).setLabel('Yes, wipe all').setStyle(ButtonStyle.Danger).setEmoji('🗑️'),
        new ButtonBuilder().setCustomId('cancel_reset').setLabel('Cancel').setStyle(ButtonStyle.Secondary).setEmoji('✖️'),
      );
      return interaction.reply({ embeds: [confirmEmbed], components: [row] });
    }
  });

  // ── Dropdowns ───────────────────────────────────────────────────────────────
  client.on('interactionCreate', async interaction => {
    if (!interaction.isStringSelectMenu()) return;
    if (!interaction.customId.startsWith('delete_result_pick__')) return;

    const guildId  = interaction.customId.split('__')[1];
    const resultId = interaction.values[0];
    const result   = allResults[guildId]?.[resultId];
    if (!result) return interaction.update({ content: '❌ Result not found.', components: [] });

    const confirmEmbed = new EmbedBuilder()
      .setTitle('⚠️ Confirm Result Deletion')
      .setDescription(`Delete **${result.eventName}**?\n\nAwards already given to the leaderboard are **not** reversed.\n\n**This cannot be undone.**`)
      .setColor(0xff4444);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`confirm_delete_result__${guildId}__${resultId}`).setLabel('Yes, delete it').setStyle(ButtonStyle.Danger).setEmoji('🗑️'),
      new ButtonBuilder().setCustomId('cancel_reset').setLabel('Cancel').setStyle(ButtonStyle.Secondary).setEmoji('✖️'),
    );
    return interaction.update({ embeds: [confirmEmbed], components: [row] });
  });

  // ── Buttons ─────────────────────────────────────────────────────────────────
  client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;

    if (interaction.customId.startsWith('confirm_delete_result__')) {
      const parts    = interaction.customId.split('__');
      const guildId  = parts[1];
      const resultId = parts.slice(2).join('__');
      const result   = allResults[guildId]?.[resultId];
      if (result) {
        revokeAwards(guildId, result.factions);
        if (result.messageId && result.channelId) {
          try {
            const ch  = await client.channels.fetch(result.channelId);
            const msg = await ch.messages.fetch(result.messageId);
            await msg.delete();
          } catch { /* already deleted */ }
        }
        delete allResults[guildId][resultId];
        saveResults(allResults);
        refreshRankingsMessage(guildId).catch(() => {});
      }
      return interaction.update({ content: '🗑️ Event result deleted and awards removed.', embeds: [], components: [] });
    }

    if (interaction.customId.startsWith('confirm_reset_results__')) {
      const guildId   = interaction.customId.split('__')[1];
      const guildData = allResults[guildId] || {};
      for (const result of Object.values(guildData)) {
        revokeAwards(guildId, result.factions);
        if (result.messageId && result.channelId) {
          try {
            const ch  = await client.channels.fetch(result.channelId);
            const msg = await ch.messages.fetch(result.messageId);
            await msg.delete();
          } catch { /* already deleted */ }
        }
      }
      allResults[guildId] = {};
      saveResults(allResults);
      refreshRankingsMessage(guildId).catch(() => {});
      return interaction.update({ content: '🗑️ All event results wiped and awards removed.', embeds: [], components: [] });
    }
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function revokeAwards(guildId, factions) {
  for (const f of factions) {
    for (const uid of f.mvps || []) removeMVP(guildId, uid, 1);
    for (const uid of f.hms  || []) removeHM(guildId, uid, 1);
  }
}

function showResultPicker(interaction, guildId, customIdPrefix, placeholder) {
  const entries = Object.entries(allResults[guildId] || {});
  if (!entries.length) return interaction.reply({ content: '❌ No event results saved for this server.', ephemeral: true });
  const options = entries.map(([id, r]) => ({
    label:       r.eventName.slice(0, 100),
    description: new Date(r.createdAt).toLocaleDateString(),
    value:       id,
  }));
  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`${customIdPrefix}__${guildId}`)
      .setPlaceholder('Choose a result...')
      .addOptions(options)
  );
  return interaction.reply({ content: placeholder, components: [row] });
}

module.exports = { setupResults, resultsCommands };
