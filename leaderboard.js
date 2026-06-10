const { isAdmin, isHost, denyHost, denyAdmin } = require('./permissions');

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

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const LB_FILE  = path.join(DATA_DIR, 'leaderboard.json');

function loadLB() {
  try { return fs.existsSync(LB_FILE) ? JSON.parse(fs.readFileSync(LB_FILE, 'utf8')) : {}; }
  catch { return {}; }
}
function saveLB(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(LB_FILE, JSON.stringify(data, null, 2));
}

let lb = loadLB();

function getUser(guildId, userId, username) {
  if (!lb[guildId]) lb[guildId] = {};
  if (!lb[guildId][userId]) lb[guildId][userId] = { username, mvps: 0, hms: 0 };
  else if (username) lb[guildId][userId].username = username;
  return lb[guildId][userId];
}

// Score: 1 MVP = 2 pts, 1 HM = 1 pt
function score(p) { return p.mvps * 2 + p.hms; }

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

// ─── Rankings embed with server statistics panel ──────────────────────────────
function buildRankingsEmbed(guildId) {
  const guildData = lb[guildId] || {};
  const players = Object.entries(guildData)
    .map(([uid, d]) => ({ uid, ...d }))
    .filter(p => p.mvps > 0 || p.hms > 0);

  if (players.length === 0) {
    return new EmbedBuilder()
      .setTitle('🏆 Server Rankings')
      .setDescription('No awards have been given yet!')
      .setColor(0xf0c040);
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

  // Build player lines, split into chunks of max 1000 chars to stay under Discord limit
  const allLines = ranked.map(p => {
    const parts = [];
    if (p.mvps > 0) parts.push(`⭐ ${p.mvps} MVP`);
    if (p.hms  > 0) parts.push(`🏅 ${p.hms} HM`);
    return `**#${p.rank}** <@${p.uid}> — ${parts.join(' · ')}`;
  });

  // Pack lines into chunks under 1000 chars each
  const chunks = [];
  let current = '';
  for (const line of allLines) {
    if (current.length + line.length + 1 > 1000) {
      chunks.push(current);
      current = line + '\n';
    } else {
      current += line + '\n';
    }
  }
  if (current) chunks.push(current);

  // Build embed — stats in description, player chunks as fields
  const statsBlock = [
    `👥 Players: ${totalPlayers}`,
    `⭐ Total MVP: ${totalMVP}`,
    `🏅 Total HM: ${totalHM}`,
    `📈 Avg Score: ${avgScore}`,
    `👑 Top Player: <@${topPlayer.uid}>`,
  ].join('\n');

  // Discord description limit is 4096 chars — join all chunks there
  const fullList = chunks.join('');

  return new EmbedBuilder()
    .setTitle('🏆 Server Rankings')
    .setDescription(`Ranked by score *(1 MVP = 2 HM points)*\n\n**📊 Server Statistics**\n${statsBlock}\n\n**🏅 Rankings**\n${fullList}`)
    .setFooter({ text: `${totalPlayers} player(s) with awards` })
    .setColor(0xf0c040);
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
];

// ─── Setup ────────────────────────────────────────────────────────────────────
function setupLeaderboard(client) {
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
      return interaction.reply({ embeds: [embed] }); // public
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
      return interaction.reply({ embeds: [embed] }); // public
    }

    if (commandName === 'remove_mvp') {
      if (!isHost(interaction.member)) return denyHost(interaction);
      const target = interaction.options.getUser('user');
      const amount = interaction.options.getInteger('amount') ?? 1;
      const user   = getUser(guildId, target.id, target.username);
      if (user.mvps === 0) return interaction.reply({ content: `❌ <@${target.id}> has no MVPs to remove.`, ephemeral: true });
      user.mvps = Math.max(0, user.mvps - amount);
      saveLB(lb);
      return interaction.reply({ content: `✅ Removed **${amount} MVP${amount !== 1 ? 's' : ''}** from <@${target.id}>. Now at **${user.mvps}**.` });
    }

    if (commandName === 'remove_hm') {
      if (!isHost(interaction.member)) return denyHost(interaction);
      const target = interaction.options.getUser('user');
      const amount = interaction.options.getInteger('amount') ?? 1;
      const user   = getUser(guildId, target.id, target.username);
      if (user.hms === 0) return interaction.reply({ content: `❌ <@${target.id}> has no HMs to remove.`, ephemeral: true });
      user.hms = Math.max(0, user.hms - amount);
      saveLB(lb);
      return interaction.reply({ content: `✅ Removed **${amount} HM${amount !== 1 ? 's' : ''}** from <@${target.id}>. Now at **${user.hms}**.` });
    }

    if (commandName === 'rankings') {
      return interaction.reply({ embeds: [buildRankingsEmbed(guildId)] });
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
      return interaction.reply({ content: '🗑️ Which player do you want to remove from the leaderboard?', components: [row] });
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
      return interaction.reply({ embeds: [confirmEmbed], components: [row] });
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
      lb[targetGuildId] = {};
      saveLB(lb);
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
      const embed = new EmbedBuilder()
        .setTitle('🗑️ Player Removed')
        .setDescription(`<@${targetUserId}> has been removed from the leaderboard.`)
        .setColor(0xff4444).setTimestamp();
      return interaction.update({ embeds: [embed], components: [] });
    }
  });
}

module.exports = { setupLeaderboard, leaderboardCommands, awardMVP, awardHM };