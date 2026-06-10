const { isAdmin, isHost, denyHost, denyAdmin } = require('./permissions');
const { awardMVP, awardHM, removeMVP, removeHM } = require('./leaderboard');

const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
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

// Resolve a user token to a Discord user ID.
// Accepts: raw ID, <@id> mention, or @username / username (searched in guild).
async function resolveUserId(str, guild) {
  str = str.trim();
  const idMatch = str.match(/^<?@?!?(\d+)>?$/);
  if (idMatch) return idMatch[1];

  // @name or plain name — search guild members
  const query = str.replace(/^@/, '');
  if (!query || !guild) return null;
  try {
    const members = await guild.members.search({ query, limit: 10 });
    if (!members.size) return null;
    const q = query.toLowerCase();
    const exact = members.find(m =>
      m.user.username.toLowerCase() === q ||
      m.displayName.toLowerCase() === q
    );
    return (exact ?? members.first()).id;
  } catch { return null; }
}

// Parse text like:
//   Faction Name
//   MVP: @Jor
//   HM: @Alice, @Bob, @Charlie
async function parseResultsText(text, guild) {
  const factions = [];
  let current = null;
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const mvpMatch = line.match(/^mvp:\s*(.+)$/i);
    const hmMatch  = line.match(/^hm:\s*(.+)$/i);
    if (mvpMatch) {
      if (current) {
        const ids = await Promise.all(mvpMatch[1].split(',').map(s => resolveUserId(s, guild)));
        current.mvps = ids.filter(Boolean).slice(0, 1);
      }
    } else if (hmMatch) {
      if (current) {
        const ids = await Promise.all(hmMatch[1].split(',').map(s => resolveUserId(s, guild)));
        current.hms = ids.filter(Boolean).slice(0, 3);
      }
    } else {
      if (current) factions.push(current);
      current = { name: line, mvps: [], hms: [] };
    }
  }
  if (current) factions.push(current);
  return factions.slice(0, 2);
}

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

// ─── Slash command definitions ────────────────────────────────────────────────
const resultsCommands = [
  new SlashCommandBuilder()
    .setName('post_results')
    .setDescription('Host: Post event results and auto-log MVPs/HMs to the leaderboard')
    .addStringOption(o => o.setName('event_name').setDescription('Name of the event').setRequired(true))
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

  new SlashCommandBuilder()
    .setName('edit_result')
    .setDescription('Admin: Edit a saved event result and adjust leaderboard awards automatically')
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
      const factions  = [];

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
      return;
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

    if (commandName === 'edit_result') {
      if (!isAdmin(interaction.member)) return denyAdmin(interaction);
      return showResultPicker(interaction, guildId, 'edit_result_pick', '✏️ Which event result do you want to edit?');
    }
  });

  // ── Modal submit (edit_result only) ────────────────────────────────────────
  client.on('interactionCreate', async interaction => {
    if (!interaction.isModalSubmit()) return;
    const { customId, guildId } = interaction;
    if (!customId.startsWith('edit_result_modal__')) return;

    const eventName   = interaction.fields.getTextInputValue('event_name').trim();
    const summary     = interaction.fields.getTextInputValue('summary')?.trim() || '';
    const resultsText = interaction.fields.getTextInputValue('results_text');
    const factions    = await parseResultsText(resultsText, interaction.guild);

    if (!factions.length) {
      return interaction.reply({ content: '❌ Could not parse any factions. Use the format:\n```\nFaction Name\nMVP: @Jor\nHM: @Alice, @Bob, @Charlie\n```', ephemeral: true });
    }

    const resultId = customId.replace('edit_result_modal__', '');
    const existing = allResults[guildId]?.[resultId];
    if (!existing) return interaction.reply({ content: '❌ Result no longer exists.', ephemeral: true });

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

    existing.eventName = eventName;
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

    return interaction.reply({ content: '✅ Result updated and leaderboard adjusted.', ephemeral: true });
  });

  // ── Dropdowns ───────────────────────────────────────────────────────────────
  client.on('interactionCreate', async interaction => {
    if (!interaction.isStringSelectMenu()) return;
    const { customId } = interaction;

    if (customId.startsWith('delete_result_pick__')) {
      const guildId  = customId.split('__')[1];
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
    }

    if (customId.startsWith('edit_result_pick__')) {
      const guildId  = customId.split('__')[1];
      const resultId = interaction.values[0];
      const result   = allResults[guildId]?.[resultId];
      if (!result) return interaction.update({ content: '❌ Result not found.', components: [] });

      const prefill = result.factions.map(f => {
        const lines = [f.name];
        if (f.mvps.length) lines.push(`MVP: ${f.mvps.join(', ')}`);
        if (f.hms.length)  lines.push(`HM: ${f.hms.join(', ')}`);
        return lines.join('\n');
      }).join('\n\n');

      return interaction.showModal(buildModal(`edit_result_modal__${resultId}`, 'Edit Event Results', result.eventName, result.summary, prefill));
    }
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
      return interaction.update({ content: '🗑️ All event results wiped and awards removed.', embeds: [], components: [] });
    }
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function buildModal(customId, title, eventName = '', summary = '', resultsText = '') {
  const modal = new ModalBuilder().setCustomId(customId).setTitle(title);
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('event_name').setLabel('Event Name').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('e.g. Summer Scramble').setValue(eventName)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('summary').setLabel('Summary (optional)').setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder('Brief description of how the event went').setValue(summary)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('results_text')
        .setLabel('Results (1 MVP, up to 3 HMs per faction)')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setPlaceholder('Faction Name\nMVP: @Jor\nHM: @Alice, @Bob, @Charlie\n\nFaction 2\nMVP: @Dave\nHM: @Eve')
        .setValue(resultsText)
    ),
  );
  return modal;
}

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
