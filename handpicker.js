const { isAdmin, isHost, denyHost, denyAdmin } = require('./permissions');
const { auditLog } = require('./auditlog');
const { getBlacklist, addBlacklist, removeBlacklist } = require('./blacklist');

const {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  REST,
  Routes,
  PermissionFlagsBits,
} = require('discord.js');
const fs   = require('fs');
const path = require('path');

const DATA_DIR      = process.env.DATA_DIR || path.join(__dirname, 'data');
const GAMES_FILE    = path.join(DATA_DIR, 'games.json');
const ROLES_FILE    = path.join(DATA_DIR, 'roles.json');

function load(file) {
  try { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {}; }
  catch { return {}; }
}
function save(file, data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

let games      = load(GAMES_FILE);
let majorRoles = load(ROLES_FILE);

// Parse "1d 2h 30m" → milliseconds
function parseDuration(str) {
  let ms = 0;
  const d = str.match(/(\d+)\s*d/i); if (d) ms += parseInt(d[1]) * 86400000;
  const h = str.match(/(\d+)\s*h/i); if (h) ms += parseInt(h[1]) * 3600000;
  const m = str.match(/(\d+)\s*m/i); if (m) ms += parseInt(m[1]) * 60000;
  return ms;
}

// Most-recent game for this guild
function mostRecentGuildGame(guildId) {
  const list = Object.entries(games).filter(([, g]) => g.guildId === guildId);
  if (!list.length) return null;
  list.sort((a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0));
  return list[0];
}

// Auto-reset timers
const AUTO_RESET_MS  = 3 * 60 * 60 * 1000;
const gameResetTimers = {};
let   _client        = null;

// Strip team roles from everyone who had a claim in a (deleted) game
async function stripAllTeamRoles(client, game) {
  try {
    const guild = await client.guilds.fetch(game.guildId);
    const { removeTeam } = require('./teams');
    for (const [factionName, faction] of Object.entries(game.factions || {})) {
      for (const uid of Object.values(faction.claims || {})) {
        if (uid) await removeTeam(guild, uid, factionName).catch(() => {});
      }
    }
  } catch (e) { console.warn('Could not strip team roles:', e.message); }
}

function scheduleGameReset(client, gameId) {
  if (gameResetTimers[gameId]) clearTimeout(gameResetTimers[gameId]);
  const game = games[gameId];
  if (!game) return;
  const elapsed   = game.createdAt ? Date.now() - game.createdAt : 0;
  const remaining = Math.max(0, AUTO_RESET_MS - elapsed);
  gameResetTimers[gameId] = setTimeout(async () => {
    delete gameResetTimers[gameId];
    const g = games[gameId];
    if (!g) return;
    delete games[gameId];
    save(GAMES_FILE, games);
    console.log(`Auto-reset: deleted game ${gameId}`);
    await stripAllTeamRoles(client, g);
    try {
      const ch = await client.channels.fetch('1508275084026974293');
      await ch.send({ embeds: [new EmbedBuilder()
        .setTitle('⏰ Handpick List Expired')
        .setDescription(`**"${g.title}"** has been automatically reset after 3 hours.`)
        .setColor(0xff9900).setTimestamp()
      ]});
    } catch {}
  }, remaining);
}

const pendingGames = {};

// ── List expiry (lock after posting) ─────────────────────────────────────────
const listExpiryTimers      = {};
const listExpiryCancelTimers = {}; // auto-cancel if host doesn't respond in 10 min
const LIST_EXPIRY_AUTO_CANCEL_MS = 10 * 60 * 1000;

function scheduleListExpiry(client, gameId, expiryMs) {
  if (listExpiryTimers[gameId]) clearTimeout(listExpiryTimers[gameId]);
  const game = games[gameId];
  if (!game) return;
  if (expiryMs !== undefined && !game.listExpiryAt) {
    game.listExpiryAt = Date.now() + expiryMs;
    save(GAMES_FILE, games);
  }
  if (!game.listExpiryAt) return;
  const remaining = Math.max(0, game.listExpiryAt - Date.now());
  listExpiryTimers[gameId] = setTimeout(() => fireListExpiry(client, gameId), remaining);
}

function clearListExpiryCancelTimer(gameId) {
  if (listExpiryCancelTimers[gameId]) {
    clearTimeout(listExpiryCancelTimers[gameId]);
    delete listExpiryCancelTimers[gameId];
  }
}

async function fireListExpiry(client, gameId) {
  delete listExpiryTimers[gameId];
  const game = games[gameId];
  if (!game || game.locked) return;
  game.locked = true;
  save(GAMES_FILE, games);
  try { await refreshMessage(client, gameId, game); } catch {}
  try {
    const host = await client.users.fetch(game.host);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`list_extend__${gameId}`).setLabel('Extend').setStyle(ButtonStyle.Primary).setEmoji('⏱️'),
      new ButtonBuilder().setCustomId(`list_unlock__${gameId}`).setLabel('Reopen List').setStyle(ButtonStyle.Success).setEmoji('🔓'),
    );
    await host.send({
      embeds: [new EmbedBuilder()
        .setTitle('⏰ Handpick List Closed')
        .setDescription(`**"${game.title}"** is now closed — no more claims are being accepted.\n\nExtend or reopen within **10 minutes**, otherwise the list is automatically deleted.`)
        .setColor(0xff9900).setTimestamp()
      ],
      components: [row],
    });
  } catch (e) { console.warn('fireListExpiry DM error:', e.message); }

  // Auto-cancel after 10 min of no response
  listExpiryCancelTimers[gameId] = setTimeout(async () => {
    delete listExpiryCancelTimers[gameId];
    const g = games[gameId];
    if (!g || !g.locked) return; // host already responded
    delete games[gameId];
    save(GAMES_FILE, games);
    await stripAllTeamRoles(client, g);
    try {
      const ch = await client.channels.fetch('1508275084026974293');
      await ch.send({ embeds: [new EmbedBuilder()
        .setTitle('🗑️ List Automatically Deleted')
        .setDescription(`**"${g.title}"** was deleted — the host didn't respond within 10 minutes of the list closing.`)
        .setColor(0xff4444).setTimestamp()
      ]});
    } catch {}
  }, LIST_EXPIRY_AUTO_CANCEL_MS);
}

// ── Extras lock: (Extra) countries are unclaimable until the host opens them ──
// When all main slots fill, the host gets a DM with Open/Remove buttons; only
// "Open Extras" sets game.extrasOpen and lifts the lock.
function extrasStillLocked(game, country) {
  if (!/\(extra\)/i.test(country)) return false;
  return !game.extrasOpen;
}

// ── Notify host on full fill or main-only fill ────────────────────────────────
async function checkClaimNotifications(client, gameId, game) {
  const allCountries     = Object.values(game.factions).flatMap(f => f.countries);
  const extraCountries   = allCountries.filter(c => /\(extra\)/i.test(c));
  const mainCountries    = allCountries.filter(c => !/\(extra\)/i.test(c));
  const claimedSet       = new Set(
    Object.values(game.factions).flatMap(f =>
      Object.entries(f.claims || {}).filter(([, v]) => v).map(([k]) => k)
    )
  );
  const allClaimed       = allCountries.every(c => claimedSet.has(c));
  const mainAllClaimed   = mainCountries.length > 0 && mainCountries.every(c => claimedSet.has(c));
  const hasExtras        = extraCountries.length > 0;
  const anyExtraClaimed  = extraCountries.some(c => claimedSet.has(c));
  try {
    const host = await client.users.fetch(game.host);
    if (allClaimed && !game._dmSentFull) {
      game._dmSentFull = true;
      save(GAMES_FILE, games);
      await host.send({ embeds: [new EmbedBuilder()
        .setTitle('✅ List Fully Filled!')
        .setDescription(`Every country in **"${game.title}"** has been claimed!`)
        .setColor(0x57f287).setTimestamp()
      ]});
    } else if (hasExtras && mainAllClaimed && !anyExtraClaimed && !game._dmSentMainFull) {
      game._dmSentMainFull = true;
      save(GAMES_FILE, games);
      const remaining = extraCountries.filter(c => !claimedSet.has(c)).map(c => `• ${c}`).join('\n');
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`extras_open__${gameId}`).setLabel('Open Extras').setStyle(ButtonStyle.Success).setEmoji('📦'),
        new ButtonBuilder().setCustomId(`extras_remove__${gameId}`).setLabel('Remove Extras').setStyle(ButtonStyle.Danger).setEmoji('🗑️'),
      );
      await host.send({
        embeds: [new EmbedBuilder()
          .setTitle('⚠️ Main Slots Filled — Open Extras?')
          .setDescription(`All main countries in **"${game.title}"** are claimed!\n\nThese **Extra** spots are waiting:\n${remaining}\n\nDo you want to open them for claiming?\n📦 **Open Extras** — announces in the channel that extras are claimable\n🗑️ **Remove Extras** — deletes them from the list and announces it`)
          .setColor(0xffa500).setTimestamp()
        ],
        components: [row],
      });
    }
  } catch (e) { console.warn('checkClaimNotifications error:', e.message); }
}

function buildEmbed(game) {
  const embed = new EmbedBuilder()
    .setTitle(game.title)
    .setDescription(`**Hosted by** <@${game.host}>\n\n**Current Country Claims by Faction**`)
    .setColor(0x2b2d31);

  const emojis = ['🔴','🔵','🟢','🟡','🟠','🟣'];
  Object.entries(game.factions).forEach(([name, faction], i) => {
    let lines = '';
    for (const country of faction.countries) {
      const isMajor  = country.startsWith('*');
      const display  = isMajor ? `🔸 ${country.slice(1)}` : country;
      const uid      = faction.claims[country];
      lines += uid ? `**${display}** — Claimed by <@${uid}>\n` : `${display}\n`;
    }
    embed.addFields({ name: `${emojis[i % emojis.length]} ${name}`, value: lines || '*No countries*', inline: false });
  });

  embed.setFooter({ text: game.locked
    ? '🔒 This list is closed — claiming is disabled'
    : 'Use the dropdowns to claim · Press the red button to unclaim your country'
  });
  if (game.locked) embed.setColor(0xff4444);
  return embed;
}

function buildComponents(game, gameId) {
  const rows = [];
  for (const [factionName, faction] of Object.entries(game.factions)) {
    const unclaimed = faction.countries.filter(c => !faction.claims[c]);
    if (unclaimed.length === 0) continue;
    if (rows.length >= 5) break;
    rows.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`claim__${gameId}__${factionName}`)
          .setPlaceholder(`Claim in ${factionName}...`)
          .addOptions(unclaimed.map(c => ({ label: (c.startsWith('*') ? `🔸 ${c.slice(1)}` : c).slice(0, 100), value: c })))
      )
    );
  }
  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`unclaim__${gameId}`)
        .setLabel('Unclaim My Country')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('🚫')
    )
  );
  return rows;
}

function findGuildGame(guildId) {
  return Object.entries(games).find(([, g]) => g.guildId === guildId) ?? null;
}

async function refreshMessage(client, gameId, game) {
  try {
    const channel = await client.channels.fetch(game.channelId);
    const msg     = await channel.messages.fetch(game.messageId);
    await msg.edit({ embeds: [buildEmbed(game)], components: buildComponents(game, gameId) });
  } catch (e) {
    console.warn('Could not refresh handpick message:', e.message);
  }
}

const handpickerCommands = [
  new SlashCommandBuilder()
    .setName('create_handpick')
    .setDescription('Create a new handpick list with title and factions')
    .addStringOption(o => o.setName('title').setDescription('Title of the handpick list').setRequired(true))
    .addStringOption(o => o.setName('faction1_name').setDescription('First faction name (e.g. Axis)').setRequired(true))
    .addStringOption(o => o.setName('faction1_countries').setDescription('Comma-separated countries. Prefix with * for Major (e.g. *Prussia)').setRequired(true))
    .addStringOption(o => o.setName('faction2_name').setDescription('Second faction name (e.g. Allies)').setRequired(false))
    .addStringOption(o => o.setName('faction2_countries').setDescription('Comma-separated countries. Prefix with * for Major (e.g. *Prussia)').setRequired(false))
    .addStringOption(o => o.setName('faction3_name').setDescription('Third faction name').setRequired(false))
    .addStringOption(o => o.setName('faction3_countries').setDescription('Comma-separated countries. Prefix with * for Major (e.g. *Prussia)').setRequired(false))
    .addStringOption(o => o.setName('faction4_name').setDescription('Fourth faction name').setRequired(false))
    .addStringOption(o => o.setName('faction4_countries').setDescription('Comma-separated countries. Prefix with * for Major (e.g. *Prussia)').setRequired(false))
    .addStringOption(o => o.setName('faction5_name').setDescription('Fifth faction name').setRequired(false))
    .addStringOption(o => o.setName('faction5_countries').setDescription('Comma-separated countries. Prefix with * for Major (e.g. *Prussia)').setRequired(false))
    .toJSON(),

  new SlashCommandBuilder()
    .setName('add_faction')
    .setDescription('Add a faction to the handpick list')
    .addStringOption(o => o.setName('name').setDescription('Faction name').setRequired(true))
    .addStringOption(o => o.setName('countries').setDescription('Comma-separated countries. Prefix with * for Major (e.g. *Prussia)').setRequired(true))
    .toJSON(),

  new SlashCommandBuilder()
    .setName('remove_faction')
    .setDescription('Admin: Remove a faction from the handpick list')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('claim')
    .setDescription('Claim a country from a faction')
    .addStringOption(o => o.setName('country').setDescription('Country name to claim').setRequired(true))
    .toJSON(),

  new SlashCommandBuilder()
    .setName('remove_player')
    .setDescription('Admin: Remove a player\'s claim from the most recent list')
    .addUserOption(o => o.setName('user').setDescription('Player to remove — skips the dropdown').setRequired(false))
    .toJSON(),

  new SlashCommandBuilder()
    .setName('blacklist')
    .setDescription('Admin: Prohibit a player from claiming in handpick lists')
    .addUserOption(o => o.setName('user').setDescription('Player to blacklist').setRequired(true))
    .addStringOption(o => o.setName('duration').setDescription('Duration e.g. 1d 2h 30m').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason for blacklist').setRequired(true))
    .toJSON(),

  new SlashCommandBuilder()
    .setName('unblacklist')
    .setDescription('Admin: Remove a player from the blacklist')
    .addUserOption(o => o.setName('user').setDescription('Player to unblacklist').setRequired(true))
    .toJSON(),

  new SlashCommandBuilder()
    .setName('list')
    .setDescription('Show the current handpick list')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('major_role')
    .setDescription('Admin: Set which roles can claim Major countries')
    .addRoleOption(o => o.setName('role').setDescription('Role to toggle on/off the major list').setRequired(true))
    .toJSON(),

  new SlashCommandBuilder()
    .setName('delete_list')
    .setDescription('Host/Admin: Delete one active handpick list')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('remove_nation')
    .setDescription('Admin: Remove a nation from a handpick list entirely (updates list automatically)')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('add_preset_players')
    .setDescription('Host/Admin: Pre-assign players to countries in an active handpick list')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('swap')
    .setDescription('Request to swap your claimed country with another player\'s')
    .addUserOption(o => o.setName('player').setDescription('The player you want to swap with').setRequired(true))
    .toJSON(),

  new SlashCommandBuilder()
    .setName('reset_list')
    .setDescription('Admin: Reset all handpick lists in this server')
    .toJSON(),

];

module.exports.handpickerCommands = handpickerCommands;

async function removeAllTeamRoles(guild, game) {
  if (!guild || !game) return;
  try {
    const { removeTeam } = require('./teams');
    for (const [factionName, faction] of Object.entries(game.factions)) {
      for (const userId of Object.values(faction.claims)) {
        await removeTeam(guild, userId, factionName).catch(() => {});
      }
    }
  } catch (e) {
    console.warn('removeAllTeamRoles error:', e.message);
  }
}

function setupHandpicker(client) {
  _client = client;
  // Schedule auto-resets for games already on disk
  for (const [gameId, game] of Object.entries(games)) {
    if (!game.createdAt) game.createdAt = Date.now();
    scheduleGameReset(client, gameId);
    if (game.listExpiryAt && !game.locked) scheduleListExpiry(client, gameId);
  }

  const pendingSwaps = {}; // swapId → swap data

  client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    const { commandName, guildId } = interaction;

    if (commandName === 'create_handpick') {
      if (!isHost(interaction.member)) return denyHost(interaction);
      await interaction.deferReply();
      const title    = interaction.options.getString('title');
      const factions = {};
      const factionOrder = [];

      for (let i = 1; i <= 5; i++) {
        const name = interaction.options.getString(`faction${i}_name`);
        const raw  = interaction.options.getString(`faction${i}_countries`);
        if (!name || !raw) continue;
        factions[name] = { countries: raw.split(',').map(s => s.trim()).filter(Boolean), claims: {} };
        factionOrder.push(name);
      }
      if (factionOrder.length === 0)
        return interaction.editReply('❌ You must provide at least one faction.');

      const gameId = `${guildId}_${Date.now()}`;
      const game   = { title, host: interaction.user.id, guildId, channelId: interaction.channelId, factions };

      pendingGames[gameId] = { game, factionOrder, channelId: interaction.channelId };

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

      const presetBtn = new ButtonBuilder()
        .setCustomId(`open_preset_players__${gameId}`)
        .setLabel('Add Preset Players')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('👥');
      const skipBtn = new ButtonBuilder()
        .setCustomId(`skip_preset_players__${gameId}`)
        .setLabel('Skip')
        .setStyle(ButtonStyle.Secondary);

      await interaction.editReply({
        content: '👥 Do you want to pre-assign players to countries?',
        components: [new ActionRowBuilder().addComponents(presetBtn, skipBtn)],
      });
      return;
    }

    if (commandName === 'add_faction') {
      if (!isHost(interaction.member)) return denyHost(interaction);
      const entry = findGuildGame(guildId);
      if (!entry) return interaction.reply({ content: '❌ No active handpick list.', ephemeral: true });
      const [gameId, game] = entry;
      const name      = interaction.options.getString('name');
      const countries = interaction.options.getString('countries').split(',').map(s => s.trim()).filter(Boolean);
      if (game.factions[name]) return interaction.reply({ content: `❌ Faction **${name}** already exists.`, ephemeral: true });
      if (Object.keys(game.factions).length >= 5) return interaction.reply({ content: '❌ Maximum 5 factions.', ephemeral: true });
      game.factions[name] = { countries, claims: {} };
      save(GAMES_FILE, games);
      await refreshMessage(client, gameId, game);
      return interaction.reply({ content: `✅ Faction **${name}** added (${countries.length} countries).` });
    }

    if (commandName === 'remove_faction') {
      if (!isAdmin(interaction.member)) return denyAdmin(interaction);
      const guildGames = Object.entries(games).filter(([, g]) => g.guildId === guildId);
      if (guildGames.length === 0) return interaction.reply({ content: '❌ No active handpick lists.', ephemeral: true });

      if (guildGames.length === 1) {
        const [gameId, game] = guildGames[0];
        const factionNames = Object.keys(game.factions);
        if (factionNames.length === 0) return interaction.reply({ content: '❌ No factions in this list.', ephemeral: true });
        const options = factionNames.map(name => ({
          label: name.slice(0, 100),
          description: `${game.factions[name].countries.length} countries`,
          value: `${gameId}|||${name}`,
        }));
        const row = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`remove_faction_simple_pick__${interaction.user.id}`)
            .setPlaceholder('Choose a faction to remove...')
            .addOptions(options)
        );
        return interaction.reply({ content: `🗑️ **${game.title}** — which faction do you want to remove?`, components: [row] });
      }

      const listOptions = guildGames.map(([gameId, game]) => ({
        label: game.title.slice(0, 100),
        description: Object.keys(game.factions).join(', ').slice(0, 100),
        value: gameId,
      }));
      const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`remove_faction_list2__${interaction.user.id}`)
          .setPlaceholder('Choose a list...')
          .addOptions(listOptions)
      );
      return interaction.reply({ content: '🗑️ Which list do you want to remove a faction from?', components: [row] });
    }

    if (commandName === 'claim') {
      const entry = findGuildGame(guildId);
      if (!entry) return interaction.reply({ content: '❌ No active handpick list.', ephemeral: true });
      const [gameId, game] = entry;
      if (game.locked) return interaction.reply({ content: '❌ This handpick list is closed — no more claims are being accepted.', ephemeral: true });
      const country = interaction.options.getString('country').trim();
      const userId  = interaction.user.id;

      // Blacklist check
      const bl = getBlacklist(guildId, userId);
      if (bl) return interaction.reply({ content: `❌ You are blacklisted from claiming until <t:${Math.floor(bl.expiresAt/1000)}:R>.\nReason: ${bl.reason}`, ephemeral: true });

      for (const [fn, f] of Object.entries(game.factions)) {
        for (const [c, uid] of Object.entries(f.claims)) {
          if (uid === userId) return interaction.reply({ content: `❌ You already claimed **${c}** (${fn}).`, ephemeral: true });
        }
      }

      let claimedName = null;
      for (const faction of Object.values(game.factions)) {
        const match = faction.countries.find(c => c.toLowerCase() === country.toLowerCase());
        if (match) {
          if (faction.claims[match]) return interaction.reply({ content: `❌ **${match}** is already claimed.`, ephemeral: true });
          // Extras lock check
          if (extrasStillLocked(game, match)) return interaction.reply({ content: `❌ **${match}** is an **Extra** slot — it unlocks once all main countries are claimed and the host opens extras.`, ephemeral: true });
          // Major country check
          if (match.startsWith('*')) {
            const approvedRoles = majorRoles[guildId] || [];
            const hasMajorRole  = approvedRoles.length > 0 && approvedRoles.some(r => interaction.member.roles.cache.has(r));
            if (!hasMajorRole) return interaction.reply({ content: `❌ **${match}** is a **Major** country and is restricted to players with an approved Major role.`, ephemeral: true });
          }
          faction.claims[match] = userId;
          claimedName = match;
          break;
        }
      }
      if (!claimedName) return interaction.reply({ content: `❌ Country **${country}** not found.`, ephemeral: true });

      save(GAMES_FILE, games);
      await refreshMessage(client, gameId, game);
      checkClaimNotifications(client, gameId, game).catch(() => {});

      if (interaction.guild) {
        const { assignTeam } = require('./teams');
        let claimedFaction = null;
        for (const [fn, f] of Object.entries(game.factions)) {
          if (Object.keys(f.claims).includes(claimedName)) { claimedFaction = fn; break; }
        }
        if (claimedFaction) await assignTeam(interaction.guild, userId, claimedFaction);
      }

      if (claimedName.startsWith('*')) {
        auditLog('⭐ Major Country Claimed', `<@${userId}> claimed the Major country **${claimedName.slice(1)}** in **"${game.title}"**.`, 0xff9900);
      }

      return interaction.reply({ content: `✅ You claimed **${claimedName}**!` });
    }

    if (commandName === 'remove_player') {
      if (!isAdmin(interaction.member)) return denyAdmin(interaction);
      const recent = mostRecentGuildGame(guildId);
      if (!recent) return interaction.reply({ content: '❌ No active handpick lists.', ephemeral: true });
      const [gameId, game] = recent;

      // If a user was provided, remove their claim directly without a dropdown
      const targetUser = interaction.options.getUser('user');
      if (targetUser) {
        let foundCountry = null, foundFaction = null;
        for (const [factionName, faction] of Object.entries(game.factions)) {
          for (const [country, uid] of Object.entries(faction.claims || {})) {
            if (uid === targetUser.id) { foundCountry = country; foundFaction = factionName; break; }
          }
          if (foundCountry) break;
        }
        if (!foundCountry) return interaction.reply({ content: `❌ <@${targetUser.id}> has no claim in **${game.title}**.`, ephemeral: true });
        delete game.factions[foundFaction].claims[foundCountry];
        save(GAMES_FILE, games);
        if (interaction.guild) { const { removeTeam } = require('./teams'); await removeTeam(interaction.guild, targetUser.id, foundFaction).catch(() => {}); }
        await refreshMessage(client, gameId, game);
        return interaction.reply({ content: `✅ Removed <@${targetUser.id}>'s claim on **${foundCountry}** (${foundFaction}).` });
      }

      // No user provided — show dropdown of all claims
      const options = [];
      for (const [factionName, faction] of Object.entries(game.factions)) {
        for (const [country, userId] of Object.entries(faction.claims || {})) {
          options.push({ label: country.slice(0, 100), description: `${factionName} · <@${userId}>`.slice(0, 100), value: `${gameId}|||${factionName}|||${country}|||${userId}` });
        }
      }
      if (options.length === 0) return interaction.reply({ content: '❌ No claims to remove.', ephemeral: true });
      const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId(`remove_player_pick__${interaction.user.id}`).setPlaceholder('Choose a player claim to remove...').addOptions(options.slice(0, 25))
      );
      return interaction.reply({ content: `🗑️ **${game.title}** — which claim do you want to remove?`, components: [row] });
    }

    if (commandName === 'blacklist') {
      if (!isAdmin(interaction.member)) return denyAdmin(interaction);
      const target      = interaction.options.getUser('user');
      const durationStr = interaction.options.getString('duration');
      const reason      = interaction.options.getString('reason');
      const ms          = parseDuration(durationStr);
      if (ms <= 0) return interaction.reply({ content: '❌ Invalid duration. Use format like `1d`, `2h`, `30m`, or combined `1d 2h 30m`.', ephemeral: true });
      const expiresAt = Date.now() + ms;
      addBlacklist(guildId, target.id, { reason, bannedBy: interaction.user.id, expiresAt });
      auditLog('🚫 Player Blacklisted', `<@${interaction.user.id}> blacklisted <@${target.id}> for **${durationStr}**.\n**Reason:** ${reason}`, 0xff4444);

      // DM the blacklisted user with the reason and when it expires
      try {
        const u = await client.users.fetch(target.id);
        await u.send({ embeds: [new EmbedBuilder()
          .setTitle('🚫 You have been blacklisted')
          .setDescription(`You have been blacklisted in **${interaction.guild?.name ?? 'the server'}**. While blacklisted, your ✅ votes don't count toward schedules and you can't claim countries in any handpick list.`)
          .addFields(
            { name: '⏰ Expires', value: `<t:${Math.floor(expiresAt/1000)}:F> (<t:${Math.floor(expiresAt/1000)}:R>)` },
            { name: '📋 Reason',  value: reason },
          )
          .setColor(0xff4444).setTimestamp()
        ]});
      } catch { /* DMs closed */ }

      return interaction.reply({ embeds: [new EmbedBuilder()
        .setTitle('🚫 Player Blacklisted')
        .setColor(0xff4444)
        .addFields(
          { name: '👤 Player',  value: `<@${target.id}>`,                              inline: true },
          { name: '⏰ Expires', value: `<t:${Math.floor(expiresAt/1000)}:R>`,          inline: true },
          { name: '📋 Reason',  value: reason },
        ).setTimestamp()
      ]});
    }

    if (commandName === 'unblacklist') {
      if (!isAdmin(interaction.member)) return denyAdmin(interaction);
      const target = interaction.options.getUser('user');
      if (!removeBlacklist(guildId, target.id)) return interaction.reply({ content: `❌ <@${target.id}> is not blacklisted.`, ephemeral: true });
      auditLog('✅ Player Unblacklisted', `<@${interaction.user.id}> removed <@${target.id}> from the blacklist.`, 0x57f287);

      // DM the user that they've been unblacklisted
      try {
        const u = await client.users.fetch(target.id);
        await u.send({ embeds: [new EmbedBuilder()
          .setTitle('✅ You have been unblacklisted')
          .setDescription(`Your blacklist in **${interaction.guild?.name ?? 'the server'}** has been lifted. You can vote and claim countries again.`)
          .setColor(0x57f287).setTimestamp()
        ]});
      } catch { /* DMs closed */ }

      return interaction.reply({ content: `✅ <@${target.id}> has been removed from the blacklist.` });
    }

    if (commandName === 'list') {
      const guildGames = Object.entries(games).filter(([, g]) => g.guildId === guildId);
      if (guildGames.length === 0) return interaction.reply({ content: '❌ No active handpick lists in this server.' });

      if (guildGames.length === 1) {
        return interaction.reply({ embeds: [buildEmbed(guildGames[0][1])] });
      }

      const options = guildGames.map(([gameId, game]) => ({
        label:       game.title.slice(0, 100),
        description: `${Object.keys(game.factions).join(', ')} · ${Object.values(game.factions).reduce((s,f) => s+f.countries.length, 0)} countries`.slice(0, 100),
        value:       gameId,
      }));
      const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`view_list_pick__${interaction.user.id}`)
          .setPlaceholder('Choose a list to view...')
          .addOptions(options)
      );
      return interaction.reply({ content: `📋 There are **${guildGames.length}** active lists. Which one do you want to view?`, components: [row] });
    }

    if (commandName === 'major_role') {
      if (!isAdmin(interaction.member)) return denyAdmin(interaction);
      const role = interaction.options.getRole('role');
      if (!majorRoles[guildId]) majorRoles[guildId] = [];
      const idx = majorRoles[guildId].indexOf(role.id);
      if (idx === -1) {
        majorRoles[guildId].push(role.id);
        save(ROLES_FILE, majorRoles);
        return interaction.reply({ content: `✅ <@&${role.id}> added to Major roles.` });
      } else {
        majorRoles[guildId].splice(idx, 1);
        save(ROLES_FILE, majorRoles);
        return interaction.reply({ content: `✅ <@&${role.id}> removed from Major roles.` });
      }
    }

    if (commandName === 'delete_list') {
      if (!isAdmin(interaction.member)) return denyAdmin(interaction);
      const guildGames = Object.entries(games).filter(([, g]) => g.guildId === guildId);
      if (guildGames.length === 0) return interaction.reply({ content: '❌ No active handpick lists to delete.' });

      if (guildGames.length === 1) {
        const [gameId, game] = guildGames[0];
        const confirmEmbed = new EmbedBuilder()
          .setTitle('⚠️ Confirm List Deletion')
          .setDescription(`Are you sure you want to delete **"${game.title}"**?\n\nThis will remove the list and all its claims.\n\n**This cannot be undone.**`)
          .setColor(0xff4444);
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`confirm_delete_list__${gameId}`).setLabel(`Yes, delete "${game.title.slice(0, 50)}"`).setStyle(ButtonStyle.Danger).setEmoji('🗑️'),
          new ButtonBuilder().setCustomId('cancel_reset').setLabel('Cancel').setStyle(ButtonStyle.Secondary).setEmoji('✖️'),
        );
        return interaction.reply({ embeds: [confirmEmbed], components: [row] });
      }

      const options = guildGames.map(([gameId, game]) => ({
        label:       game.title.slice(0, 100),
        description: `${Object.keys(game.factions).join(', ')} · ${Object.values(game.factions).reduce((s, f) => s + f.countries.length, 0)} countries`,
        value:       gameId,
      }));
      const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId(`delete_list_pick__${interaction.user.id}`).setPlaceholder('Choose which list to delete...').addOptions(options)
      );
      return interaction.reply({ content: `🗑️ You have **${guildGames.length}** active lists. Which one do you want to delete?`, components: [row] });
    }

    if (commandName === 'remove_nation') {
      if (!isAdmin(interaction.member)) return denyAdmin(interaction);
      const guildGames = Object.entries(games).filter(([, g]) => g.guildId === guildId);
      if (guildGames.length === 0) return interaction.reply({ content: '❌ No active handpick lists.', ephemeral: true });

      if (guildGames.length === 1) {
        const [gameId, game] = guildGames[0];
        const options = [];
        for (const [factionName, faction] of Object.entries(game.factions)) {
          for (const country of faction.countries) {
            options.push({ label: country.slice(0, 100), description: factionName.slice(0, 100), value: `${gameId}|||${factionName}|||${country}` });
            if (options.length >= 25) break;
          }
          if (options.length >= 25) break;
        }
        const row = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder().setCustomId(`remove_nation_pick__${interaction.user.id}`).setPlaceholder('Choose a nation to remove...').addOptions(options)
        );
        return interaction.reply({ content: `🗑️ **${game.title}** — which nation do you want to remove?`, components: [row] });
      }

      const listOptions = guildGames.map(([gameId, game]) => ({
        label: game.title.slice(0, 100),
        description: Object.keys(game.factions).join(', ').slice(0, 100),
        value: gameId,
      }));
      const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId(`remove_nation_list__${interaction.user.id}`).setPlaceholder('Choose a list...').addOptions(listOptions)
      );
      return interaction.reply({ content: '🗑️ Which list do you want to remove a nation from?', components: [row] });
    }

    if (commandName === 'add_preset_players') {
      if (!isHost(interaction.member)) return denyHost(interaction);
      const recent = mostRecentGuildGame(guildId);
      if (!recent) return interaction.reply({ content: '❌ No active handpick lists.', ephemeral: true });
      const [gameId] = recent;
      const modal = new ModalBuilder()
        .setCustomId(`preset_players_modal__${gameId}__live`)
        .setTitle('Add Preset Players');
      const textInput = new TextInputBuilder()
        .setCustomId('preset_players_text')
        .setLabel('Country: @username or UserID (one per line)')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Germany: 123456789012345678\nFrance: 987654321098765432\nRussia: 111222333444555666')
        .setRequired(true)
        .setMaxLength(4000);
      modal.addComponents(new ActionRowBuilder().addComponents(textInput));
      await interaction.showModal(modal);
      return;
    }

    if (commandName === 'swap') {
      try {
        const targetUser = interaction.options.getUser('player');
        if (targetUser.id === interaction.user.id) return interaction.reply({ content: '❌ You can\'t swap with yourself.', ephemeral: true });

        const guildGames = Object.entries(games)
          .filter(([, g]) => g.guildId === guildId)
          .sort((a, b) => parseInt(b[0].split('_').pop()) - parseInt(a[0].split('_').pop()));
        if (guildGames.length === 0) return interaction.reply({ content: '❌ No active handpick lists.', ephemeral: true });
        const [gameId, game] = guildGames[0];

        // Find both players' claims
        let myCountry = null, myFaction = null, theirCountry = null, theirFaction = null;
        for (const [fn, f] of Object.entries(game.factions)) {
          for (const [country, uid] of Object.entries(f.claims || {})) {
            if (uid === interaction.user.id) { myCountry = country; myFaction = fn; }
            if (uid === targetUser.id)        { theirCountry = country; theirFaction = fn; }
          }
        }
        if (!myCountry)    return interaction.reply({ content: '❌ You haven\'t claimed any country in the current list.', ephemeral: true });
        if (!theirCountry) return interaction.reply({ content: `❌ <@${targetUser.id}> hasn't claimed any country in the current list.`, ephemeral: true });

        const swapId = `${Date.now()}_${interaction.user.id}`;
        pendingSwaps[swapId] = {
          gameId,
          initiatorId: interaction.user.id, initiatorCountry: myCountry,    initiatorFaction: myFaction,
          targetId:    targetUser.id,        targetCountry:    theirCountry, targetFaction:    theirFaction,
          initiatorConfirmed: true, targetConfirmed: false,
        };
        setTimeout(() => { delete pendingSwaps[swapId]; }, 2 * 60 * 1000);

        const embed = new EmbedBuilder()
          .setTitle('🔄 Swap Request')
          .setColor(0x5865f2)
          .setDescription('Both players must accept for the swap to happen.')
          .addFields(
            { name: myFaction,    value: `<@${interaction.user.id}> — **${myCountry}**`, inline: true },
            { name: '↔️',         value: '​',                                             inline: true },
            { name: theirFaction, value: `<@${targetUser.id}> — **${theirCountry}**`,    inline: true },
          )
          .setFooter({ text: 'Expires in 2 minutes' })
          .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`swap_accept__${swapId}`).setLabel('✅ Accept').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`swap_cancel__${swapId}`).setLabel('❌ Cancel').setStyle(ButtonStyle.Danger),
        );
        return interaction.reply({ content: `<@${interaction.user.id}> <@${targetUser.id}>`, embeds: [embed], components: [row] });
      } catch (e) {
        console.error('swap command error:', e.message);
        return interaction.reply({ content: '❌ Something went wrong. Try again.', ephemeral: true });
      }
    }

    if (commandName === 'reset_list') {
      if (!isAdmin(interaction.member)) return denyAdmin(interaction);
      const guildGames = Object.entries(games).filter(([, g]) => g.guildId === guildId);
      if (guildGames.length === 0) return interaction.reply({ content: '❌ No active handpick lists to reset.', ephemeral: true });
      const confirmEmbed = new EmbedBuilder()
        .setTitle('⚠️ Confirm Reset')
        .setDescription(`Are you sure you want to **reset ALL handpick lists** in this server?\nThis will remove **${guildGames.length}** active list(s) and all their claims.\n\n**This action cannot be undone.**`)
        .setColor(0xff4444);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('confirm_reset_list').setLabel('Yes, reset everything').setStyle(ButtonStyle.Danger).setEmoji('🗑️'),
        new ButtonBuilder().setCustomId('cancel_reset').setLabel('Cancel').setStyle(ButtonStyle.Secondary).setEmoji('✖️'),
      );
      return interaction.reply({ embeds: [confirmEmbed], components: [row] });
    }

  });

  client.on('interactionCreate', async interaction => {
    if (!interaction.isStringSelectMenu()) return;
    if (!interaction.customId.startsWith('claim__')) return;
    const parts       = interaction.customId.split('__');
    const gameId      = parts[1];
    const factionName = parts[2];
    const guildId     = interaction.guildId;
    const game        = games[gameId];
    if (!game) return interaction.reply({ content: '❌ Game not found.', ephemeral: true });
    if (game.locked) return interaction.reply({ content: '❌ This handpick list is closed — no more claims are being accepted.', ephemeral: true });
    const faction = game.factions[factionName];
    const country = interaction.values[0];
    const userId  = interaction.user.id;
    // Blacklist check
    const bl = getBlacklist(guildId, userId);
    if (bl) return interaction.reply({ content: `❌ You are blacklisted from claiming until <t:${Math.floor(bl.expiresAt/1000)}:R>.\nReason: ${bl.reason}`, ephemeral: true });
    for (const [fn, f] of Object.entries(game.factions)) {
      for (const [c, uid] of Object.entries(f.claims)) {
        if (uid === userId) return interaction.reply({ content: `❌ You already claimed **${c}** (${fn}). Use the **Unclaim** button first.`, ephemeral: true });
      }
    }
    if (faction.claims[country]) return interaction.reply({ content: `❌ **${country}** was just claimed by someone else!`, ephemeral: true });
    // Extras lock check
    if (extrasStillLocked(game, country)) return interaction.reply({ content: `❌ **${country}** is an **Extra** slot — it unlocks once all main countries are claimed and the host opens extras.`, ephemeral: true });
    // Major country check
    if (country.startsWith('*')) {
      const approvedRoles = majorRoles[guildId] || [];
      const hasMajorRole  = approvedRoles.length > 0 && approvedRoles.some(r => interaction.member.roles.cache.has(r));
      if (!hasMajorRole) return interaction.reply({ content: `❌ **${country}** is a **Major** country and is restricted to players with an approved Major role.`, ephemeral: true });
    }
    faction.claims[country] = userId;
    save(GAMES_FILE, games);
    await interaction.update({ embeds: [buildEmbed(game)], components: buildComponents(game, gameId) });
    checkClaimNotifications(client, gameId, game).catch(() => {});
    if (country.startsWith('*')) {
      auditLog('⭐ Major Country Claimed', `<@${userId}> claimed the Major country **${country.slice(1)}** in **"${game.title}"**.`, 0xff9900);
    }
    if (interaction.guild) {
      const { assignTeam } = require('./teams');
      await assignTeam(interaction.guild, userId, factionName);
    }
  });

  // ── Extras open/remove buttons (sent to the host via DM) ────────────────────
  client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;
    const { customId } = interaction;
    if (!customId.startsWith('extras_open__') && !customId.startsWith('extras_remove__')) return;
    const gameId = customId.split('__')[1];
    const game   = games[gameId];
    if (!game) return interaction.update({ content: '❌ This handpick list no longer exists.', embeds: [], components: [] });

    if (customId.startsWith('extras_open__')) {
      game.extrasOpen = true;
      save(GAMES_FILE, games);
      try {
        const channel = await client.channels.fetch(game.channelId);
        await channel.send(`📦 All main countries in **"${game.title}"** are claimed — **Extra countries are now claimable!**`);
      } catch (e) { console.warn('Could not announce extras open:', e.message); }
      return interaction.update({ content: `✅ Extras for **"${game.title}"** are now open — the channel has been notified.`, embeds: [], components: [] });
    }

    // Remove all (Extra) countries from the list
    for (const faction of Object.values(game.factions)) {
      for (const c of faction.countries.filter(x => /\(extra\)/i.test(x))) {
        faction.countries = faction.countries.filter(x => x !== c);
        delete faction.claims[c];
      }
    }
    save(GAMES_FILE, games);
    await refreshMessage(client, gameId, game);
    try {
      const channel = await client.channels.fetch(game.channelId);
      await channel.send(`🗑️ The **Extra** countries in **"${game.title}"** have been removed — the list is now main slots only.`);
    } catch (e) { console.warn('Could not announce extras removal:', e.message); }
    checkClaimNotifications(client, gameId, game).catch(() => {});
    return interaction.update({ content: `✅ Extras removed from **"${game.title}"** — the channel has been notified.`, embeds: [], components: [] });
  });

  client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;
    if (!interaction.customId.startsWith('unclaim__')) return;
    const gameId = interaction.customId.split('__')[1];
    const game   = games[gameId];
    if (!game) return interaction.reply({ content: '❌ Game not found.', ephemeral: true });
    const userId = interaction.user.id;
    let found = false, removedFaction = null;
    for (const [factionName, faction] of Object.entries(game.factions)) {
      for (const [country, uid] of Object.entries(faction.claims)) {
        if (uid === userId) { delete faction.claims[country]; found = true; removedFaction = factionName; break; }
      }
      if (found) break;
    }
    if (!found) return interaction.reply({ content: "❌ You haven't claimed any country.", ephemeral: true });
    save(GAMES_FILE, games);
    await interaction.update({ embeds: [buildEmbed(game)], components: buildComponents(game, gameId) });
    if (interaction.guild && removedFaction) {
      const { removeTeam } = require('./teams');
      await removeTeam(interaction.guild, userId, removedFaction);
    }
  });

  client.on('interactionCreate', async interaction => {
    if (!interaction.isStringSelectMenu()) return;
    if (!interaction.customId.startsWith('remove_nation_list__')) return;
    const userId = interaction.customId.split('__')[1];
    if (interaction.user.id !== userId) return interaction.reply({ content: '❌ This menu is not for you.', ephemeral: true });
    const gameId = interaction.values[0];
    const game   = games[gameId];
    if (!game) return interaction.update({ content: '❌ List no longer exists.', components: [] });
    const options = [];
    for (const [factionName, faction] of Object.entries(game.factions)) {
      for (const country of faction.countries) {
        options.push({ label: country.slice(0, 100), description: factionName.slice(0, 100), value: `${gameId}|||${factionName}|||${country}` });
        if (options.length >= 25) break;
      }
      if (options.length >= 25) break;
    }
    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId(`remove_nation_pick__${userId}`).setPlaceholder('Choose a nation to remove...').addOptions(options)
    );
    return interaction.update({ content: `🗑️ **${game.title}** — which nation do you want to remove?`, components: [row] });
  });

  client.on('interactionCreate', async interaction => {
    if (!interaction.isStringSelectMenu()) return;
    if (!interaction.customId.startsWith('remove_faction_simple_pick__')) return;
    const userId = interaction.customId.split('__')[1];
    if (interaction.user.id !== userId) return interaction.reply({ content: '❌ This menu is not for you.', ephemeral: true });
    const [gameId, factionName] = interaction.values[0].split('|||');
    const game = games[gameId];
    if (!game) return interaction.update({ content: '❌ List no longer exists.', components: [] });
    const faction = game.factions[factionName];
    if (faction && interaction.guild) {
      const { removeTeam } = require('./teams');
      for (const uid of Object.values(faction.claims)) {
        await removeTeam(interaction.guild, uid, factionName).catch(() => {});
      }
    }
    delete game.factions[factionName];
    save(GAMES_FILE, games);
    await refreshMessage(client, gameId, game);
    return interaction.update({ content: `✅ Faction **${factionName}** and all its countries have been removed from **${game.title}**.`, components: [] });
  });

  client.on('interactionCreate', async interaction => {
    if (!interaction.isStringSelectMenu()) return;
    if (!interaction.customId.startsWith('remove_faction_list2__')) return;
    const userId = interaction.customId.split('__')[1];
    if (interaction.user.id !== userId) return interaction.reply({ content: '❌ This menu is not for you.', ephemeral: true });
    const gameId = interaction.values[0];
    const game   = games[gameId];
    if (!game) return interaction.update({ content: '❌ List no longer exists.', components: [] });
    const options = Object.keys(game.factions).map(name => ({
      label: name.slice(0, 100),
      description: `${game.factions[name].countries.length} countries`,
      value: `${gameId}|||${name}`,
    }));
    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId(`remove_faction_simple_pick__${userId}`).setPlaceholder('Choose a faction to remove...').addOptions(options)
    );
    return interaction.update({ content: `🗑️ **${game.title}** — which faction do you want to remove?`, components: [row] });
  });

  client.on('interactionCreate', async interaction => {
    if (!interaction.isStringSelectMenu()) return;
    if (!interaction.customId.startsWith('remove_nation_pick__')) return;
    const userId = interaction.customId.split('__')[1];
    if (interaction.user.id !== userId) return interaction.reply({ content: '❌ This menu is not for you.', ephemeral: true });
    const [gameId, factionName, country] = interaction.values[0].split('|||');
    const game = games[gameId];
    if (!game) return interaction.update({ content: '❌ List no longer exists.', components: [] });
    const faction = game.factions[factionName];
    if (!faction) return interaction.update({ content: '❌ Faction no longer exists.', components: [] });
    const claimedBy = faction.claims[country];
    if (claimedBy && interaction.guild) {
      const { removeTeam } = require('./teams');
      await removeTeam(interaction.guild, claimedBy, factionName).catch(() => {});
    }
    faction.countries = faction.countries.filter(c => c !== country);
    delete faction.claims[country];
    save(GAMES_FILE, games);
    await refreshMessage(client, gameId, game);
    return interaction.update({ content: `✅ **${country}** has been removed from **${factionName}** in **${game.title}**. The list has been updated.`, components: [] });
  });

  client.on('interactionCreate', async interaction => {
    if (!interaction.isStringSelectMenu()) return;
    if (!interaction.customId.startsWith('remove_player_pick__')) return;
    const userId = interaction.customId.split('__')[1];
    if (interaction.user.id !== userId) return interaction.reply({ content: '❌ This menu is not for you.', ephemeral: true });
    const [gameId, factionName, country, targetUserId] = interaction.values[0].split('|||');
    const game = games[gameId];
    if (!game) return interaction.update({ content: '❌ List no longer exists.', components: [] });
    delete game.factions[factionName]?.claims[country];
    save(GAMES_FILE, games);
    if (interaction.guild) { const { removeTeam } = require('./teams'); await removeTeam(interaction.guild, targetUserId, factionName).catch(() => {}); }
    await refreshMessage(client, gameId, game);
    return interaction.update({ content: `✅ <@${targetUserId}>'s claim on **${country}** has been removed.`, components: [] });
  });

  client.on('interactionCreate', async interaction => {
    if (!interaction.isStringSelectMenu()) return;
    if (!interaction.customId.startsWith('preset_players_list_pick__')) return;
    const userId  = interaction.customId.split('__')[1];
    if (interaction.user.id !== userId) return interaction.reply({ content: '❌ This menu is not for you.', ephemeral: true });
    const gameId = interaction.values[0];
    const game   = games[gameId];
    if (!game) return interaction.update({ content: '❌ List no longer exists.', components: [] });
    await interaction.update({ content: '📋 Opening preset players form...', components: [] });
    const modal = new ModalBuilder().setCustomId(`preset_players_modal__${gameId}__live`).setTitle('Add Preset Players');
    const textInput = new TextInputBuilder().setCustomId('preset_players_text').setLabel('Country: UserID (one per line)').setStyle(TextInputStyle.Paragraph).setPlaceholder('Germany: 123456789012345678\nFrance: 987654321098765432').setRequired(true).setMaxLength(4000);
    modal.addComponents(new ActionRowBuilder().addComponents(textInput));
    await interaction.followUp({ content: '⬇️ Fill in the form below:', ephemeral: true });
  });

  client.on('interactionCreate', async interaction => {
    if (!interaction.isModalSubmit()) return;
    if (!interaction.customId.startsWith('preset_players_modal__')) return;
    try {
      await interaction.deferReply();
      const withoutPrefix = interaction.customId.replace('preset_players_modal__', '');
      const lastDunder = withoutPrefix.lastIndexOf('__');
      const gameId    = withoutPrefix.slice(0, lastDunder);
      const isPending = withoutPrefix.slice(lastDunder + 2) === 'pending';
      const game = isPending ? pendingGames[gameId]?.game : games[gameId];
      if (!game) return interaction.editReply('❌ List no longer exists.');
      const raw   = interaction.fields.getTextInputValue('preset_players_text');
      const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
      const assigned = [], failed = [];
      for (const line of lines) {
        const colonIdx = line.indexOf(':');
        if (colonIdx === -1) continue;
        const country  = line.slice(0, colonIdx).trim();
        const userPart = line.slice(colonIdx + 1).trim();
        const userId = userPart.replace(/[<@!>]/g, '').trim();
        if (!userId || !/^\d{17,19}$/.test(userId)) { failed.push(`${country}: invalid ID "${userPart}"`); continue; }
        let foundFaction = null;
        for (const [factionName, faction] of Object.entries(game.factions)) {
          if (faction.countries.map(c => c.toLowerCase()).includes(country.toLowerCase())) { foundFaction = factionName; break; }
        }
        if (!foundFaction) { failed.push(`${country}: not found in any faction`); continue; }
        const existing = game.factions[foundFaction].claims[country];
        if (existing && existing !== userId) {
          if (interaction.guild) { const { removeTeam } = require('./teams'); await removeTeam(interaction.guild, existing, foundFaction).catch(() => {}); }
        }
        const exactCountry = game.factions[foundFaction].countries.find(c => c.toLowerCase() === country.toLowerCase());
        game.factions[foundFaction].claims[exactCountry] = userId;
        assigned.push({ country: exactCountry, userId, factionName: foundFaction });
      }
      save(GAMES_FILE, games);
      if (interaction.guild) {
        const { assignTeam } = require('./teams');
        for (const { userId, factionName } of assigned) { await assignTeam(interaction.guild, userId, factionName).catch(() => {}); }
      }
      let resultText = `✅ **${assigned.length}** player(s) pre-assigned:\n`;
      for (const { country, userId } of assigned) { resultText += `**${country}** → <@${userId}>\n`; }
      if (failed.length > 0) { resultText += `\n⚠️ **${failed.length}** failed:\n` + failed.map(f => `• ${f}`).join('\n'); }
      if (isPending) { await postPendingGame(interaction, gameId); } else { await refreshMessage(client, gameId, game); }
      return interaction.editReply(resultText);
    } catch (err) {
      console.error('preset_players_modal error:', err);
      const msg = `❌ Error: ${err.message}`;
      if (interaction.deferred) await interaction.editReply(msg).catch(() => {});
      else await interaction.reply({ content: msg, ephemeral: true }).catch(() => {});
    }
  });

  client.on('interactionCreate', async interaction => {
    if (!interaction.isStringSelectMenu()) return;
    if (!interaction.customId.startsWith('view_list_pick__')) return;
    const userId = interaction.customId.split('__')[1];
    if (interaction.user.id !== userId) return interaction.reply({ content: '❌ This menu is not for you.', ephemeral: true });
    const gameId = interaction.values[0];
    const game   = games[gameId];
    if (!game) return interaction.update({ content: '❌ That list no longer exists.', components: [] });
    await interaction.update({ content: '✅ Loading list...', embeds: [], components: [] });
    return interaction.followUp({ embeds: [buildEmbed(game)] });
  });

  client.on('interactionCreate', async interaction => {
    if (!interaction.isStringSelectMenu()) return;
    if (!interaction.customId.startsWith('delete_list_pick__')) return;
    const userId  = interaction.customId.split('__')[1];
    if (interaction.user.id !== userId) return interaction.reply({ content: '❌ This menu is not for you.', ephemeral: true });
    const gameId = interaction.values[0];
    const game   = games[gameId];
    if (!game) return interaction.update({ content: '❌ That list no longer exists.', components: [] });
    const confirmEmbed = new EmbedBuilder()
      .setTitle('⚠️ Confirm List Deletion')
      .setDescription(`Are you sure you want to delete **"${game.title}"**?\n\nThis will remove the list and all its claims.\n\n**This cannot be undone.**`)
      .setColor(0xff4444);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`confirm_delete_list__${gameId}`).setLabel(`Yes, delete "${game.title.slice(0, 50)}"`).setStyle(ButtonStyle.Danger).setEmoji('🗑️'),
      new ButtonBuilder().setCustomId('cancel_reset').setLabel('Cancel').setStyle(ButtonStyle.Secondary).setEmoji('✖️'),
    );
    return interaction.update({ embeds: [confirmEmbed], components: [row] });
  });

  // ── Buttons: swap accept / cancel ─────────────────────────────────────────────
  client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;

    if (interaction.customId.startsWith('swap_accept__')) {
      const swapId = interaction.customId.replace('swap_accept__', '');
      const swap   = pendingSwaps[swapId];
      if (!swap) return interaction.reply({ content: '❌ This swap has expired or was already resolved.', ephemeral: true });
      if (interaction.user.id !== swap.initiatorId && interaction.user.id !== swap.targetId)
        return interaction.reply({ content: '❌ This swap is not for you.', ephemeral: true });

      if (interaction.user.id === swap.initiatorId) swap.initiatorConfirmed = true;
      if (interaction.user.id === swap.targetId)    swap.targetConfirmed    = true;

      if (!swap.initiatorConfirmed || !swap.targetConfirmed) {
        const waitingFor = swap.initiatorConfirmed ? `<@${swap.targetId}>` : `<@${swap.initiatorId}>`;
        return interaction.reply({ content: `✅ You accepted! Waiting for ${waitingFor} to accept.`, ephemeral: true });
      }

      // Both confirmed — execute the swap
      const game = games[swap.gameId];
      delete pendingSwaps[swapId];
      if (!game) return interaction.update({ content: '❌ List no longer exists.', embeds: [], components: [] });

      if (game.factions[swap.initiatorFaction]?.claims[swap.initiatorCountry] !== swap.initiatorId ||
          game.factions[swap.targetFaction]?.claims[swap.targetCountry]       !== swap.targetId) {
        return interaction.update({ content: '❌ One of the claims changed before the swap could complete.', embeds: [], components: [] });
      }

      game.factions[swap.initiatorFaction].claims[swap.initiatorCountry] = swap.targetId;
      game.factions[swap.targetFaction].claims[swap.targetCountry]       = swap.initiatorId;
      save(GAMES_FILE, games);

      if (interaction.guild) {
        const { assignTeam, removeTeam } = require('./teams');
        await removeTeam(interaction.guild, swap.initiatorId, swap.initiatorFaction).catch(() => {});
        await removeTeam(interaction.guild, swap.targetId,    swap.targetFaction).catch(() => {});
        await assignTeam(interaction.guild, swap.initiatorId, swap.targetFaction).catch(() => {});
        await assignTeam(interaction.guild, swap.targetId,    swap.initiatorFaction).catch(() => {});
      }

      await refreshMessage(client, swap.gameId, game);

      const doneEmbed = new EmbedBuilder()
        .setTitle('✅ Swap Complete!')
        .setColor(0x57f287)
        .addFields(
          { name: swap.initiatorFaction, value: `<@${swap.initiatorId}> → **${swap.targetCountry}**`,   inline: true },
          { name: '↔️',                  value: '​',                                                inline: true },
          { name: swap.targetFaction,    value: `<@${swap.targetId}> → **${swap.initiatorCountry}**`,   inline: true },
        )
        .setTimestamp();
      return interaction.update({ embeds: [doneEmbed], components: [], content: '' });
    }

    if (interaction.customId.startsWith('swap_cancel__')) {
      const swapId = interaction.customId.replace('swap_cancel__', '');
      const swap   = pendingSwaps[swapId];
      if (!swap) return interaction.update({ content: '❌ Swap already resolved.', embeds: [], components: [] });
      if (interaction.user.id !== swap.initiatorId && interaction.user.id !== swap.targetId)
        return interaction.reply({ content: '❌ This swap is not for you.', ephemeral: true });
      delete pendingSwaps[swapId];
      return interaction.update({
        embeds: [new EmbedBuilder().setTitle('❌ Swap Cancelled').setColor(0xff4444).setDescription(`Cancelled by <@${interaction.user.id}>.`).setTimestamp()],
        components: [], content: '',
      });
    }
  });

  // ── Buttons: list expiry — extend (opens modal) or unlock ────────────────────
  client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;

    if (interaction.customId.startsWith('list_extend__')) {
      const gameId = interaction.customId.replace('list_extend__', '');
      const modal = new ModalBuilder()
        .setCustomId(`list_extend_modal__${gameId}`)
        .setTitle('Extend Handpick List');
      modal.addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('extend_duration')
          .setLabel('How long to extend? (e.g. 30m, 1h, 1h 30m)')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('30m')
          .setRequired(true)
          .setMaxLength(20)
      ));
      await interaction.showModal(modal);
      return;
    }

    if (interaction.customId.startsWith('list_unlock__')) {
      const gameId = interaction.customId.replace('list_unlock__', '');
      clearListExpiryCancelTimer(gameId);
      const game = games[gameId];
      if (!game) return interaction.update({ content: '❌ List no longer exists.', components: [] });
      game.locked = false;
      game.listExpiryAt = null;
      save(GAMES_FILE, games);
      try { await refreshMessage(client, gameId, game); } catch {}
      try {
        const ch = await client.channels.fetch('1508275084026974293');
        await ch.send({ embeds: [new EmbedBuilder()
          .setTitle('🔓 List Reopened')
          .setDescription(`**"${game.title}"** is open again — players can claim countries.`)
          .setColor(0x57f287).setTimestamp()
        ]});
      } catch {}
      return interaction.update({
        embeds: [new EmbedBuilder().setTitle('🔓 List Reopened').setDescription(`**"${game.title}"** is now open for claims.`).setColor(0x57f287).setTimestamp()],
        components: [],
      });
    }
  });

  // ── Modal: list expiry extend ─────────────────────────────────────────────────
  client.on('interactionCreate', async interaction => {
    if (!interaction.isModalSubmit()) return;
    if (!interaction.customId.startsWith('list_extend_modal__')) return;
    const gameId = interaction.customId.replace('list_extend_modal__', '');
    clearListExpiryCancelTimer(gameId);
    const game = games[gameId];
    if (!game) return interaction.reply({ content: '❌ List no longer exists.', ephemeral: true });
    const raw = interaction.fields.getTextInputValue('extend_duration');
    const ms  = parseDuration(raw);
    if (ms <= 0) return interaction.reply({ content: '❌ Invalid duration. Use format like `30m`, `1h`, or `1h 30m`.', ephemeral: true });
    game.locked = false;
    game.listExpiryAt = Date.now() + ms;
    save(GAMES_FILE, games);
    scheduleListExpiry(client, gameId);
    try { await refreshMessage(client, gameId, game); } catch {}
    try {
      const ch = await client.channels.fetch('1508275084026974293');
      await ch.send({ embeds: [new EmbedBuilder()
        .setTitle('⏱️ List Extended')
        .setDescription(`**"${game.title}"** is open again for **${raw}**.\nNew deadline: <t:${Math.floor(game.listExpiryAt / 1000)}:R>`)
        .setColor(0x5865f2).setTimestamp()
      ]});
    } catch {}
    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setTitle('⏱️ List Extended')
        .setDescription(`**"${game.title}"** reopened for **${raw}**.\nNew deadline: <t:${Math.floor(game.listExpiryAt / 1000)}:R>`)
        .setColor(0x5865f2).setTimestamp()
      ],
      ephemeral: true,
    });
  });

  async function postPendingGame(interaction, gameId) {
    const pending = pendingGames[gameId];
    if (!pending) return;
    delete pendingGames[gameId];
    const { game } = pending;
    const msg = await interaction.followUp({ embeds: [buildEmbed(game)], components: buildComponents(game, gameId) });
    game.messageId = msg.id;
    games[gameId]  = game;
    save(GAMES_FILE, games);
  }

  client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;
    if (interaction.customId.startsWith('skip_preset_players__')) {
      const gameId = interaction.customId.split('__')[1];
      await interaction.update({ content: '✅ Skipped — players can claim using the dropdowns.', components: [] });
      await postPendingGame(interaction, gameId);
      return;
    }
    if (interaction.customId === 'skip_preset_players') {
      return interaction.update({ content: '✅ Skipped — players can claim using the dropdowns.', components: [] });
    }
    if (interaction.customId.startsWith('open_preset_players__')) {
      const gameId = interaction.customId.split('__')[1];
      const isPending = !!pendingGames[gameId];
      const modal = new ModalBuilder().setCustomId(`preset_players_modal__${gameId}__${isPending ? 'pending' : 'live'}`).setTitle('Add Preset Players');
      const textInput = new TextInputBuilder().setCustomId('preset_players_text').setLabel('Country: UserID (one per line)').setStyle(TextInputStyle.Paragraph).setPlaceholder('Germany: 123456789012345678\nFrance: 987654321098765432').setRequired(true).setMaxLength(4000);
      modal.addComponents(new ActionRowBuilder().addComponents(textInput));
      await interaction.showModal(modal);
      return;
    }
  });

  client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;
    if (interaction.customId === 'cancel_reset') {
      return interaction.update({ content: '✅ Action cancelled.', embeds: [], components: [] });
    }
    if (interaction.customId.startsWith('confirm_delete_list__')) {
      const gameId = interaction.customId.split('__')[1];
      const game   = games[gameId];
      const title  = game?.title ?? 'Unknown';
      if (game && interaction.guild) await removeAllTeamRoles(interaction.guild, game);
      delete games[gameId];
      save(GAMES_FILE, games);
      auditLog('🗑️ List Deleted', `<@${interaction.user.id}> deleted the handpick list **"${title}"**.`, 0xff4444);
      const embed = new EmbedBuilder().setTitle('🗑️ List Deleted').setDescription(`Handpick list **"${title}"** has been deleted.`).setColor(0xff4444).setTimestamp();
      return interaction.update({ embeds: [embed], components: [] });
    }
    if (interaction.customId === 'confirm_reset_list') {
      const { guildId } = interaction;
      const guildGameIds = Object.keys(games).filter(id => games[id].guildId === guildId);
      if (interaction.guild) {
        for (const id of guildGameIds) { await removeAllTeamRoles(interaction.guild, games[id]).catch(() => {}); }
      }
      for (const id of guildGameIds) { delete games[id]; }
      save(GAMES_FILE, games);
      auditLog('🗑️ All Lists Reset', `<@${interaction.user.id}> wiped all handpick lists.`, 0xff4444);
      const embed = new EmbedBuilder().setTitle('🗑️ Lists Reset').setDescription(`All handpick lists for this server have been wiped.`).setColor(0xff4444).setTimestamp();
      return interaction.update({ embeds: [embed], components: [] });
    }
  });
}

function buildEmbedFromGame(game)          { return buildEmbed(game); }
function buildComponentsFromGame(game, id) { return buildComponents(game, id); }
function saveGame(gameId, game) {
  if (!game.createdAt) game.createdAt = Date.now();
  games[gameId] = game;
  save(GAMES_FILE, games);
  if (_client) scheduleGameReset(_client, gameId);
}

module.exports = { setupHandpicker, handpickerCommands, buildEmbedFromGame, buildComponentsFromGame, saveGame, pendingGames, scheduleListExpiry };