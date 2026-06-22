const { isAdmin, isHost, denyHost, denyAdmin } = require('./permissions');
const { awardMVP, awardHM, removeMVP, removeHM, refreshRankingsMessage, syncMedalRoles } = require('./leaderboard');
const { auditLog } = require('./auditlog');

const {
  SlashCommandBuilder,
  ContextMenuCommandBuilder,
  ApplicationCommandType,
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

// Parse a posted results message into MVP/HM user IDs.
// A line naming "MVP" / "HM"(/"HMS"/"honorable mention") is a heading that
// "arms" that award type; the FIRST non-bot @mention after it (on the heading
// line itself or a following line) wins ONE award, then it disarms until the
// next heading. This grants one recipient per heading (two MVP headings = two
// MVPs) and stops trailing pings / ally-mentions from piling up. Bot mentions
// are always skipped, and mentions before the first heading (your summary) are
// ignored. `botIds` is the set of bot user IDs mentioned in the message.
function parseAwards(content, botIds = new Set()) {
  const mentionRe = /<@!?(\d+)>/g;
  const mvp = new Set(), hm = new Set();
  let mode = null, armed = false;
  for (const line of (content || '').split('\n')) {
    const lower = line.toLowerCase();
    if (/\bmvp\b/.test(lower))                                              { mode = 'mvp'; armed = true; }
    else if (/\bhms?\b/.test(lower) || lower.includes('honorable mention')) { mode = 'hm';  armed = true; }
    if (!armed || !mode) continue;
    const id = [...line.matchAll(mentionRe)].map(m => m[1]).find(i => !botIds.has(i));
    if (id) { (mode === 'mvp' ? mvp : hm).add(id); armed = false; }
  }
  return { mvps: [...mvp], hms: [...hm] };
}

// Award + save a logged result record (used by /log_results and the context menu).
function logResults(interaction, { mvps, hms, eventName, sourceUrl }) {
  const guildId = interaction.guildId;
  if (!allResults[guildId]) allResults[guildId] = {};
  const resultId = `result_${guildId}_${Date.now()}`;
  allResults[guildId][resultId] = {
    eventName:    eventName || 'Logged results',
    summary:      '',
    factions:     [{ name: 'Results', mvps: [...mvps], hms: [...hms] }],
    createdAt:    Date.now(),
    postedById:   interaction.user.id,
    postedByName: interaction.user.username,
    sourceUrl:    sourceUrl || null,
  };
  saveResults(allResults);
  const medalUsers = new Set();
  for (const id of mvps) { awardMVP(guildId, id, null, 1); medalUsers.add(id); }
  for (const id of hms)  awardHM(guildId, id, null, 1);
  refreshRankingsMessage(guildId).catch(() => {});
  for (const id of medalUsers) syncMedalRoles(interaction.guild, id).catch(() => {});
  return resultId;
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
  new SlashCommandBuilder()
    .setName('edit_result')
    .setDescription('Admin: Edit a saved event result and adjust leaderboard awards automatically')
    .addStringOption(o => o.setName('result_name').setDescription('Pick the result to edit (most recent first)').setRequired(true).setAutocomplete(true))
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

  // Right-click a results message → Apps → "Log Results (read message)"
  new ContextMenuCommandBuilder()
    .setName('Log Results (read message)')
    .setType(ApplicationCommandType.Message)
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

  // ── Autocomplete: live result picker for /edit_result ───────────────────────
  client.on('interactionCreate', async interaction => {
    if (!interaction.isAutocomplete()) return;
    if (interaction.commandName !== 'edit_result') return;
    try {
      const typed   = interaction.options.getFocused().toLowerCase();
      const entries = Object.entries(allResults[interaction.guildId] || {})
        .filter(([, r]) => r.eventName.toLowerCase().includes(typed))
        .sort((a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0))
        .slice(0, 25);
      await interaction.respond(entries.map(([id, r]) => ({
        name: `${r.eventName} — ${new Date(r.createdAt).toLocaleDateString()}`.slice(0, 100),
        value: id,
      })));
    } catch { /* autocomplete timed out */ }
  });

  // ── Context menu: read a posted results message and auto-award ──────────────
  client.on('interactionCreate', async interaction => {
    if (!interaction.isMessageContextMenuCommand()) return;
    if (interaction.commandName !== 'Log Results (read message)') return;
    if (!isHost(interaction.member)) return denyHost(interaction);

    const msg = interaction.targetMessage;
    const { mvps, hms } = parseAwards(msg?.content || '');
    if (!mvps.length && !hms.length) {
      return interaction.reply({ content: '❌ Couldn\'t find any MVP or HM @mentions in that message.\nMake sure award lines name the winner with an @mention under an "MVP"/"HM" heading.', ephemeral: true });
    }

    logResults(interaction, { mvps, hms, eventName: null, sourceUrl: msg.url });

    const parts = [];
    if (mvps.length) parts.push(`**${mvps.length} MVP${mvps.length > 1 ? 's' : ''}** — ${mvps.map(id => `<@${id}>`).join(', ')}`);
    if (hms.length)  parts.push(`**${hms.length} HM${hms.length > 1 ? 's' : ''}** — ${hms.map(id => `<@${id}>`).join(', ')}`);
    auditLog('🏁 Results Logged', `<@${interaction.user.id}> logged ${parts.join(' · ')} from a [message](${msg.url}).`, 0x57f287);

    // Non-ephemeral confirmation (auto-deleted after 12s by index.js)
    return interaction.reply({ content: `✅ Read [that message](${msg.url}) and logged:\n${parts.join('\n')}\n\nRankings and medal roles updated. *(Use \`/remove_mvp\`/\`/remove_hm\` if it picked up someone by mistake.)*` });
  });

  // ── Slash commands ──────────────────────────────────────────────────────────
  client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    const { commandName, guildId } = interaction;

    if (commandName === 'edit_result') {
      if (!isAdmin(interaction.member)) return denyAdmin(interaction);
      await interaction.deferReply({ ephemeral: true });
      try {

      const rawName   = interaction.options.getString('result_name')?.trim();
      const guildData = allResults[guildId] || {};
      let resultId, existing;
      if (guildData[rawName]) {
        // Picked from the autocomplete list — value is the result ID
        resultId = rawName;
        existing = guildData[rawName];
      } else {
        // Typed manually — match by name; duplicates resolve to the most recent
        const matches = Object.entries(guildData)
          .filter(([, r]) => r.eventName.toLowerCase() === rawName?.toLowerCase())
          .sort((a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0));
        if (!matches.length) {
          return interaction.editReply({ content: `❌ No result found with the name **"${rawName}"**. Use \`/list_results\` to see saved names.` });
        }
        [resultId, existing] = matches[0];
      }

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

      const mvpChanged = new Set([...Object.keys(oldMVPs), ...Object.keys(newMVPs)]);
      for (const uid of mvpChanged) {
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
      for (const uid of mvpChanged) syncMedalRoles(interaction.guild, uid).catch(() => {});
      auditLog('✏️ Result Edited', `<@${interaction.user.id}> edited the result **"${existing.eventName}"**.`, 0xfee75c);
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
      return interaction.reply({ embeds: [confirmEmbed], components: [row], ephemeral: true });
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

    const date     = new Date(result.createdAt).toLocaleDateString();
    const allMvps  = (result.factions || []).flatMap(f => f.mvps || []);
    const allHms   = (result.factions || []).flatMap(f => f.hms  || []);
    const awards   = [];
    if (allMvps.length) awards.push(`⭐ **MVP:** ${allMvps.map(id => `<@${id}>`).join(', ')}`);
    if (allHms.length)  awards.push(`🏅 **HM:** ${allHms.map(id => `<@${id}>`).join(', ')}`);
    const link     = result.sourceUrl ? `\n\n🔗 [Jump to the results message](${result.sourceUrl})` : '';

    const confirmEmbed = new EmbedBuilder()
      .setTitle('⚠️ Confirm Result Deletion')
      .setDescription(
        `Delete **${result.eventName}** *(${date})*?` +
        (awards.length ? `\n\n${awards.join('\n')}` : '') +
        `\n\nThese awards **will be removed** from the leaderboard and medal roles re-synced.${link}\n\n**This cannot be undone.**`
      )
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
        for (const f of result.factions) for (const uid of f.mvps || []) syncMedalRoles(interaction.guild, uid).catch(() => {});
        auditLog('🗑️ Result Deleted', `<@${interaction.user.id}> deleted the result **"${result.eventName}"** (awards revoked).`, 0xff4444);
      }
      return interaction.update({ content: '🗑️ Event result deleted and awards removed.', embeds: [], components: [] });
    }

    if (interaction.customId.startsWith('confirm_reset_results__')) {
      const guildId   = interaction.customId.split('__')[1];
      const guildData = allResults[guildId] || {};
      const medalUsers = new Set();
      for (const result of Object.values(guildData)) {
        revokeAwards(guildId, result.factions);
        for (const f of result.factions) for (const uid of f.mvps || []) medalUsers.add(uid);
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
      for (const uid of medalUsers) syncMedalRoles(interaction.guild, uid).catch(() => {});
      auditLog('🗑️ All Results Wiped', `<@${interaction.user.id}> wiped all event results (awards revoked).`, 0xff4444);
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
  const options = entries.map(([id, r]) => {
    const mvps = (r.factions || []).reduce((s, f) => s + (f.mvps?.length || 0), 0);
    const hms  = (r.factions || []).reduce((s, f) => s + (f.hms?.length  || 0), 0);
    return {
      label:       r.eventName.slice(0, 100),
      description: `${new Date(r.createdAt).toLocaleDateString()} · ⭐${mvps} 🏅${hms}`.slice(0, 100),
      value:       id,
    };
  });
  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`${customIdPrefix}__${guildId}`)
      .setPlaceholder('Choose a result...')
      .addOptions(options)
  );
  // Ephemeral so only the admin who ran the command can use the dropdown/buttons
  return interaction.reply({ content: placeholder, components: [row], ephemeral: true });
}

module.exports = { setupResults, resultsCommands };
