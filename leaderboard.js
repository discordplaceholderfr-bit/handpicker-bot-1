const { isAdmin, isHost, denyHost, denyAdmin } = require('./permissions');
const { auditLog } = require('./auditlog');
const { paginate, pageButtons } = require('./pagination');

const {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} = require('discord.js');
const fs   = require('fs');
const path = require('path');
const { writeJson } = require('./jsonstore');

const DATA_DIR    = process.env.DATA_DIR || path.join(__dirname, 'data');
const LB_FILE     = path.join(DATA_DIR, 'leaderboard.json');
const RANKPIN_FILE = path.join(DATA_DIR, 'rankings_pin.json');

// The single live, auto-updating leaderboard always lives (and stays pinned) in
// this channel, regardless of where /rankings is run.
const RANKINGS_CHANNEL_ID = '1487616503250423961';

function loadLB() {
  try { return fs.existsSync(LB_FILE) ? JSON.parse(fs.readFileSync(LB_FILE, 'utf8')) : {}; }
  catch { return {}; }
}
function saveLB(data) {
  writeJson(LB_FILE, data);
}

function loadPins() {
  try { return fs.existsSync(RANKPIN_FILE) ? JSON.parse(fs.readFileSync(RANKPIN_FILE, 'utf8')) : {}; }
  catch { return {}; }
}
function savePins(data) {
  writeJson(RANKPIN_FILE, data);
}

let lb   = loadLB();
let pins = loadPins();
let _client = null;

function getUser(guildId, userId, username) {
  if (!lb[guildId]) lb[guildId] = {};
  if (!lb[guildId][userId]) lb[guildId][userId] = { username, mvps: 0, hms: 0 };
  else if (username) lb[guildId][userId].username = username;
  return lb[guildId][userId];
}

// Score: 1 MVP = 2 pts, 1 HM = 1 pt
function score(p) { return p.mvps * 2 + p.hms; }

// ── Medal roles by MVP count (highest tier only) ─────────────────────────────
// Sorted high → low so the first one a user qualifies for is their top medal.
const MEDAL_ROLES = [
  { roleId: '1463738464120869028', minMvps: 8, name: 'Purple Heart' },
  { roleId: '1463377181198782667', minMvps: 5, name: "Airman's Medal" },
  { roleId: '1463429416108429386', minMvps: 1, name: 'Bronze Star' },
];

// Give the member only the highest medal role they qualify for; strip the rest.
// Reads the user's current MVP count from the in-memory leaderboard.
async function syncMedalRoles(guild, userId) {
  if (!guild) return;
  let member;
  try { member = await guild.members.fetch(userId); } catch { return; } // left the server
  const mvps   = lb[guild.id]?.[userId]?.mvps || 0;
  const earned = MEDAL_ROLES.find(m => mvps >= m.minMvps) || null;
  for (const m of MEDAL_ROLES) {
    const has = member.roles.cache.has(m.roleId);
    if (earned && m.roleId === earned.roleId) {
      if (!has) await member.roles.add(m.roleId).catch(() => {});
    } else if (has) {
      await member.roles.remove(m.roleId).catch(() => {});
    }
  }
}

// One-time backfill: sync medals for everyone on a guild's leaderboard.
async function syncAllMedals(guild) {
  if (!guild) return 0;
  const ids = Object.keys(lb[guild.id] || {});
  for (const userId of ids) await syncMedalRoles(guild, userId);
  return ids.length;
}

function awardMVP(guildId, userId, username, amount = 1) {
  const user = getUser(guildId, userId, username);
  user.mvps += amount;
  saveLB(lb);
  return user;
}
function awardHM(guildId, userId, username, amount = 1) {
  const user = getUser(guildId, userId, username);
  user.hms += amount;
  saveLB(lb);
  return user;
}
function removeMVP(guildId, userId, amount = 1) {
  const user = getUser(guildId, userId, null);
  user.mvps = Math.max(0, user.mvps - amount);
  saveLB(lb);
  return user;
}
function removeHM(guildId, userId, amount = 1) {
  const user = getUser(guildId, userId, null);
  user.hms = Math.max(0, user.hms - amount);
  saveLB(lb);
  return user;
}

// ─── Rankings embed with server statistics panel (paged) ──────────────────────
// Returns { embeds, components } for one page. Nav buttons use the `rankpage`
// idBase; the button handler in setup re-renders the requested page.
function buildRankingsPayload(guildId, page = 0) {
  const guildData = lb[guildId] || {};
  const players = Object.entries(guildData)
    .map(([uid, d]) => ({ uid, ...d }))
    .filter(p => p.mvps > 0 || p.hms > 0);

  if (players.length === 0) {
    return { embeds: [new EmbedBuilder()
      .setTitle('🏆 Server Rankings')
      .setDescription('No awards have been given yet!')
      .setColor(0xf0c040)], components: [] };
  }

  players.sort((a, b) => score(b) - score(a) || b.mvps - a.mvps || b.hms - a.hms);

  // Assign ranks with ties
  const ranked = [];
  let currentRank = 1;
  for (let i = 0; i < players.length; i++) {
    if (i > 0 && score(players[i]) < score(players[i - 1])) currentRank = i + 1;
    ranked.push({ rank: currentRank, ...players[i] });
  }

  // Server statistics
  const totalPlayers = players.length;
  const totalMVP     = players.reduce((s, p) => s + p.mvps, 0);
  const totalHM      = players.reduce((s, p) => s + p.hms, 0);
  const totalScore   = players.reduce((s, p) => s + score(p), 0);
  const avgScore     = (totalScore / totalPlayers).toFixed(2);
  const topPlayer    = ranked[0];

  const lines = ranked.map(p => {
    const parts = [];
    if (p.mvps > 0) parts.push(`⭐ ${p.mvps} MVP`);
    if (p.hms  > 0) parts.push(`🏅 ${p.hms} HM`);
    return `**#${p.rank}** <@${p.uid}> — ${parts.join(' · ')}`;
  });

  const statsBlock = [
    `👥 Players: ${totalPlayers}`,
    `⭐ Total MVP: ${totalMVP}`,
    `🏅 Total HM: ${totalHM}`,
    `📈 Avg Score: ${avgScore}`,
    `👑 Top Player: <@${topPlayer.uid}>`,
  ].join('\n');

  // Page the player lines; budget leaves room for the stats header on each page
  const pages = paginate(lines, { maxChars: 3400, maxPer: 20 });
  page = Math.max(0, Math.min(page, pages.length - 1));

  const embed = new EmbedBuilder()
    .setTitle('🏆 Server Rankings')
    .setColor(0xf0c040)
    .setDescription(
      `Ranked by score *(1 MVP = 2 HM points)*\n\n**📊 Server Statistics**\n${statsBlock}\n\n**🏅 Rankings**\n${pages[page].join('\n')}`
    )
    .setFooter({ text: `Page ${page + 1}/${pages.length} · ${totalPlayers} player(s) with awards` });

  const nav = pageButtons('rankpage', page, pages.length);
  return { embeds: [embed], components: nav ? [nav] : [] };
}

// ─── Auto-refresh pinned rankings message ─────────────────────────────────────
async function refreshRankingsMessage(guildId) {
  if (!_client) return;
  try {
    const channel = await _client.channels.fetch(RANKINGS_CHANNEL_ID).catch(() => null);
    if (!channel) return;

    // Reuse the tracked message only if it's the one in the fixed channel
    const pin = pins[guildId];
    let msg = (pin?.channelId === RANKINGS_CHANNEL_ID && pin.messageId)
      ? await channel.messages.fetch(pin.messageId).catch(() => null)
      : null;

    const payload = buildRankingsPayload(guildId, 0);
    if (msg) {
      await msg.edit(payload);
    } else {
      // First run, deleted, or previously pinned elsewhere — post a fresh live
      // message in the fixed channel and pin it.
      msg = await channel.send(payload);
      pins[guildId] = { channelId: RANKINGS_CHANNEL_ID, messageId: msg.id };
      savePins(pins);
      try { await msg.pin(); } catch { /* bot lacks Manage Messages — leave unpinned */ }
    }
  } catch (e) {
    console.warn('refreshRankingsMessage failed:', e.message);
  }
}

// ─── Slash command definitions ────────────────────────────────────────────────
const leaderboardCommands = [
  new SlashCommandBuilder()
    .setName('give_mvp')
    .setDescription('Give an MVP award to a user')
    .addUserOption(o => o.setName('user').setDescription('User to receive MVP').setRequired(true))
    .addIntegerOption(o => o.setName('amount').setDescription('Number of MVPs to give (default 1)').setMinValue(1).setMaxValue(20))
    .toJSON(),

  new SlashCommandBuilder()
    .setName('give_hm')
    .setDescription('Give an Honorable Mention award to a user')
    .addUserOption(o => o.setName('user').setDescription('User to receive HM').setRequired(true))
    .addIntegerOption(o => o.setName('amount').setDescription('Number of HMs to give (default 1)').setMinValue(1).setMaxValue(20))
    .toJSON(),

  new SlashCommandBuilder()
    .setName('remove_mvp')
    .setDescription('Remove MVP awards from a user')
    .addUserOption(o => o.setName('user').setDescription('User to remove MVPs from').setRequired(true))
    .addIntegerOption(o => o.setName('amount').setDescription('Number of MVPs to remove (default 1)').setMinValue(1).setMaxValue(20))
    .toJSON(),

  new SlashCommandBuilder()
    .setName('remove_hm')
    .setDescription('Remove Honorable Mention awards from a user')
    .addUserOption(o => o.setName('user').setDescription('User to remove HMs from').setRequired(true))
    .addIntegerOption(o => o.setName('amount').setDescription('Number of HMs to remove (default 1)').setMinValue(1).setMaxValue(20))
    .toJSON(),

  new SlashCommandBuilder()
    .setName('rankings')
    .setDescription('Show the MVP/HM leaderboard for this server')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('reset_rankings')
    .setDescription('Admin: Wipe the entire leaderboard for this server (IRREVERSIBLE)')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('delete_player')
    .setDescription('Admin: Pick a player from a dropdown and remove them from the leaderboard')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('sync_medals')
    .setDescription('Admin: Re-sync MVP medal roles for everyone on the leaderboard')
    .toJSON(),
];

// ─── Setup ────────────────────────────────────────────────────────────────────
function setupLeaderboard(client) {
  _client = client;
  client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    const { commandName, guildId } = interaction;

    if (commandName === 'give_mvp') {
      if (!isHost(interaction.member)) return denyHost(interaction);
      const target = interaction.options.getUser('user');
      const amount = interaction.options.getInteger('amount') ?? 1;
      const user   = getUser(guildId, target.id, target.username);
      user.mvps   += amount;
      saveLB(lb);
      const embed = new EmbedBuilder()
        .setTitle('⭐ MVP Awarded!')
        .setDescription(`<@${interaction.user.id}> gave **${amount} MVP${amount !== 1 ? 's' : ''}** to <@${target.id}>!`)
        .addFields(
          { name: '⭐ Total MVPs', value: `${user.mvps}`, inline: true },
          { name: '🏅 Total HMs',  value: `${user.hms}`,  inline: true },
          { name: '📊 Score',      value: `${score(user)} pts`, inline: true },
        )
        .setColor(0xffd700).setTimestamp();
      await interaction.reply({ embeds: [embed] }); // public
      refreshRankingsMessage(guildId).catch(() => {});
      syncMedalRoles(interaction.guild, target.id).catch(() => {});
      auditLog('⭐ MVP Given', `<@${interaction.user.id}> gave **${amount} MVP${amount !== 1 ? 's' : ''}** to <@${target.id}> (now at ${user.mvps}).`, 0xffd700);
      return;
    }

    if (commandName === 'give_hm') {
      if (!isHost(interaction.member)) return denyHost(interaction);
      const target = interaction.options.getUser('user');
      const amount = interaction.options.getInteger('amount') ?? 1;
      const user   = getUser(guildId, target.id, target.username);
      user.hms    += amount;
      saveLB(lb);
      const embed = new EmbedBuilder()
        .setTitle('🏅 Honorable Mention Awarded!')
        .setDescription(`<@${interaction.user.id}> gave **${amount} HM${amount !== 1 ? 's' : ''}** to <@${target.id}>!`)
        .addFields(
          { name: '⭐ Total MVPs', value: `${user.mvps}`, inline: true },
          { name: '🏅 Total HMs',  value: `${user.hms}`,  inline: true },
          { name: '📊 Score',      value: `${score(user)} pts`, inline: true },
        )
        .setColor(0xc0c0c0).setTimestamp();
      await interaction.reply({ embeds: [embed] }); // public
      refreshRankingsMessage(guildId).catch(() => {});
      auditLog('🏅 HM Given', `<@${interaction.user.id}> gave **${amount} HM${amount !== 1 ? 's' : ''}** to <@${target.id}> (now at ${user.hms}).`, 0xc0c0c0);
      return;
    }

    if (commandName === 'remove_mvp') {
      if (!isHost(interaction.member)) return denyHost(interaction);
      const target = interaction.options.getUser('user');
      const amount = interaction.options.getInteger('amount') ?? 1;
      const user   = getUser(guildId, target.id, target.username);
      if (user.mvps === 0) return interaction.reply({ content: `❌ <@${target.id}> has no MVPs to remove.`, ephemeral: true });
      user.mvps = Math.max(0, user.mvps - amount);
      saveLB(lb);
      await interaction.reply({ content: `✅ Removed **${amount} MVP${amount !== 1 ? 's' : ''}** from <@${target.id}>. Now at **${user.mvps}**.` });
      refreshRankingsMessage(guildId).catch(() => {});
      syncMedalRoles(interaction.guild, target.id).catch(() => {});
      auditLog('⭐ MVP Removed', `<@${interaction.user.id}> removed **${amount} MVP${amount !== 1 ? 's' : ''}** from <@${target.id}> (now at ${user.mvps}).`, 0xed4245);
      return;
    }

    if (commandName === 'remove_hm') {
      if (!isHost(interaction.member)) return denyHost(interaction);
      const target = interaction.options.getUser('user');
      const amount = interaction.options.getInteger('amount') ?? 1;
      const user   = getUser(guildId, target.id, target.username);
      if (user.hms === 0) return interaction.reply({ content: `❌ <@${target.id}> has no HMs to remove.`, ephemeral: true });
      user.hms = Math.max(0, user.hms - amount);
      saveLB(lb);
      await interaction.reply({ content: `✅ Removed **${amount} HM${amount !== 1 ? 's' : ''}** from <@${target.id}>. Now at **${user.hms}**.` });
      refreshRankingsMessage(guildId).catch(() => {});
      auditLog('🏅 HM Removed', `<@${interaction.user.id}> removed **${amount} HM${amount !== 1 ? 's' : ''}** from <@${target.id}> (now at ${user.hms}).`, 0xed4245);
      return;
    }

    if (commandName === 'rankings') {
      // Ack immediately, then (re)post/refresh the single pinned live leaderboard
      // in the fixed channel so the auto-updating copy always lives there.
      await interaction.reply({
        content: `📌 The live leaderboard is pinned in <#${RANKINGS_CHANNEL_ID}> and updates automatically whenever awards change.`,
        ephemeral: true,
      });
      refreshRankingsMessage(guildId).catch(() => {});
      return;
    }

    if (commandName === 'sync_medals') {
      if (!isAdmin(interaction.member)) return denyAdmin(interaction);
      await interaction.deferReply({ ephemeral: true });
      const count = await syncAllMedals(interaction.guild);
      auditLog('🎖️ Medals Synced', `<@${interaction.user.id}> re-synced MVP medal roles for **${count}** player(s).`, 0xffd700);
      return interaction.editReply({ content: `✅ Synced medal roles for **${count}** player(s) on the leaderboard.` });
    }

    if (commandName === 'delete_player') {
      if (!isHost(interaction.member)) return denyHost(interaction);
      const guildData = lb[guildId] || {};
      const players   = Object.entries(guildData).filter(([, p]) => p.mvps > 0 || p.hms > 0);

      if (players.length === 0) {
        return interaction.reply({ content: '❌ No players with awards on the leaderboard.', ephemeral: true });
      }

      const options = players.map(([uid, p]) => ({
        label:       (p.username || uid).slice(0, 100),
        description: `⭐ ${p.mvps} MVP · 🏅 ${p.hms} HM`,
        value:       uid,
      }));

      const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`delete_player_pick__${guildId}`)
          .setPlaceholder('Choose a player to remove...')
          .addOptions(options)
      );
      return interaction.reply({ content: '🗑️ Which player do you want to remove from the leaderboard?', components: [row], ephemeral: true });
    }
    if (commandName === 'reset_rankings') {
      if (!isAdmin(interaction.member)) return denyAdmin(interaction);
      const confirmEmbed = new EmbedBuilder()
        .setTitle('⚠️ Confirm Leaderboard Reset')
        .setDescription('Are you sure you want to **wipe the entire leaderboard**?\nThis will delete all MVPs and HMs for every player in this server.\n\n**This action cannot be undone.**')
        .setColor(0xff4444);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`confirm_reset_rankings__${guildId}`).setLabel('Yes, wipe it').setStyle(ButtonStyle.Danger).setEmoji('🗑️'),
        new ButtonBuilder().setCustomId('cancel_reset').setLabel('Cancel').setStyle(ButtonStyle.Secondary).setEmoji('✖️'),
      );
      return interaction.reply({ embeds: [confirmEmbed], components: [row], ephemeral: true });
    }
  });

  // ── Dropdown: pick which player to delete ────────────────────────────────
  client.on('interactionCreate', async interaction => {
    if (!interaction.isStringSelectMenu()) return;
    if (!interaction.customId.startsWith('delete_player_pick__')) return;

    const guildId = interaction.customId.split('__')[1];
    const uid     = interaction.values[0];
    const p       = lb[guildId]?.[uid];
    if (!p) return interaction.update({ content: '❌ Player not found.', components: [] });

    const confirmEmbed = new EmbedBuilder()
      .setTitle('⚠️ Confirm Player Removal')
      .setDescription(`Are you sure you want to remove **<@${uid}>** from the leaderboard?

They currently have ⭐ **${p.mvps} MVP** and 🏅 **${p.hms} HM**.

**This cannot be undone.**`)
      .setColor(0xff4444);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`confirm_delete_player__${guildId}__${uid}`).setLabel(`Yes, remove ${(p.username || uid).slice(0,50)}`).setStyle(ButtonStyle.Danger).setEmoji('🗑️'),
      new ButtonBuilder().setCustomId('cancel_reset').setLabel('Cancel').setStyle(ButtonStyle.Secondary).setEmoji('✖️'),
    );
    return interaction.update({ embeds: [confirmEmbed], components: [row] });
  });

  // ── Confirmation buttons ────────────────────────────────────────────────────
  client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;

    if (interaction.customId === 'cancel_reset') {
      return interaction.update({ content: '✅ Action cancelled.', embeds: [], components: [] });
    }

    if (interaction.customId.startsWith('confirm_reset_rankings__')) {
      const targetGuildId = interaction.customId.split('__')[1];
      const clearedIds    = Object.keys(lb[targetGuildId] || {});
      lb[targetGuildId] = {};
      saveLB(lb);
      refreshRankingsMessage(targetGuildId).catch(() => {});
      // Strip medal roles from everyone who was on the leaderboard (now 0 MVPs)
      if (interaction.guild) for (const uid of clearedIds) syncMedalRoles(interaction.guild, uid).catch(() => {});
      auditLog('🗑️ Leaderboard Reset', `<@${interaction.user.id}> wiped the entire leaderboard.`, 0xff4444);
      const embed = new EmbedBuilder()
        .setTitle('🗑️ Leaderboard Reset')
        .setDescription('The server leaderboard has been completely wiped. All MVPs and HMs cleared.')
        .setColor(0xff4444).setTimestamp();
      return interaction.update({ embeds: [embed], components: [] });
    }

    if (interaction.customId.startsWith('confirm_delete_player__')) {
      const parts         = interaction.customId.split('__');
      const targetGuildId = parts[1];
      const targetUserId  = parts[2];
      delete lb[targetGuildId]?.[targetUserId];
      saveLB(lb);
      refreshRankingsMessage(targetGuildId).catch(() => {});
      syncMedalRoles(interaction.guild, targetUserId).catch(() => {}); // now 0 MVPs → strips medals
      auditLog('🗑️ Player Removed from Leaderboard', `<@${interaction.user.id}> removed <@${targetUserId}> from the leaderboard.`, 0xff4444);
      const embed = new EmbedBuilder()
        .setTitle('🗑️ Player Removed')
        .setDescription(`<@${targetUserId}> has been removed from the leaderboard.`)
        .setColor(0xff4444).setTimestamp();
      return interaction.update({ embeds: [embed], components: [] });
    }
  });

  // ── Buttons: /rankings pagination (◀ Prev / Next ▶) ──────────────────────────
  client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;
    if (!interaction.customId.startsWith('rankpage__')) return;
    const page = parseInt(interaction.customId.split('__')[1]) || 0;
    return interaction.update(buildRankingsPayload(interaction.guildId, page));
  });
}

module.exports = { setupLeaderboard, leaderboardCommands, awardMVP, awardHM, removeMVP, removeHM, refreshRankingsMessage, syncMedalRoles };