const { isAdmin, denyAdmin, isHost, denyHost } = require('./permissions');
const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

const POLL_LOG_CHANNEL_ID = '1508275084026974293';
const EVENT_PING_ROLE_ID  = '1464057119841062944';
const fs   = require('fs');
const path = require('path');

const DATA_DIR       = process.env.DATA_DIR || path.join(__dirname, 'data');
const WATCHERS_FILE  = path.join(DATA_DIR, 'watchers.json');
const PRESETS_FILE   = path.join(DATA_DIR, 'presets.json');
const TEAMS_FILE_PATH = path.join(DATA_DIR, 'teams.json');

function loadWatchers() {
  try { return fs.existsSync(WATCHERS_FILE) ? JSON.parse(fs.readFileSync(WATCHERS_FILE, 'utf8')) : {}; }
  catch { return {}; }
}
function saveWatchers(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(WATCHERS_FILE, JSON.stringify(data, null, 2));
}
function loadPresets() {
  try { return fs.existsSync(PRESETS_FILE) ? JSON.parse(fs.readFileSync(PRESETS_FILE, 'utf8')) : {}; }
  catch { return {}; }
}

let watchers = loadWatchers();
const activeTimers       = {}; // watcherId → countdown setTimeout handle
const expiryTimers       = {}; // watcherId → expiry setTimeout handle
const watcherAutoTimers  = {}; // watcherId → 3-hour auto-reset handle
const WATCHER_RESET_MS   = 3 * 60 * 60 * 1000;

function parseDuration(str) {
  let ms = 0;
  const d = str.match(/(\d+)\s*d/i); if (d) ms += parseInt(d[1]) * 86400000;
  const h = str.match(/(\d+)\s*h/i); if (h) ms += parseInt(h[1]) * 3600000;
  const m = str.match(/(\d+)\s*m/i); if (m) ms += parseInt(m[1]) * 60000;
  return ms;
}

function scheduleWatcherAutoReset(client, watcherId) {
  if (watcherAutoTimers[watcherId]) clearTimeout(watcherAutoTimers[watcherId]);
  const watcher = watchers[watcherId];
  if (!watcher) return;
  const elapsed   = watcher.createdAt ? Date.now() - watcher.createdAt : 0;
  const remaining = Math.max(0, WATCHER_RESET_MS - elapsed);
  watcherAutoTimers[watcherId] = setTimeout(async () => {
    delete watcherAutoTimers[watcherId];
    const w = watchers[watcherId];
    if (!w) return;
    if (activeTimers[watcherId]) { clearTimeout(activeTimers[watcherId]); delete activeTimers[watcherId]; }
    if (expiryTimers[watcherId]) { clearTimeout(expiryTimers[watcherId]); delete expiryTimers[watcherId]; }
    delete watchers[watcherId];
    saveWatchers(watchers);
    console.log(`Auto-reset: deleted watcher ${watcherId}`);
    try {
      const ch = await client.channels.fetch(w.channelId);
      await ch.send({ embeds: [new EmbedBuilder()
        .setTitle('⏰ Watcher Expired')
        .setDescription(`The watcher for **"${w.presetName}"** has been automatically removed after 3 hours.`)
        .setColor(0xff9900).setTimestamp()
      ]});
    } catch {}
  }, remaining);
}

// ── Parse a Discord message link ─────────────────────────────────────────────
function parseMessageLink(link) {
  const match = link.match(/channels\/(\d+)\/(\d+)\/(\d+)/);
  if (!match) return null;
  return { guildId: match[1], channelId: match[2], messageId: match[3] };
}

// ── Count valid votes / reactions (minus exclusions) ─────────────────────────
function isExcluded(watcher, userId) {
  const excl = (watcher.exclusions || {})[userId];
  if (!excl) return false;
  if (excl.expiresAt && Date.now() > excl.expiresAt) return false; // expired
  return true;
}

async function getEffectiveCount(client, watcherId) {
  const watcher = watchers[watcherId];
  if (!watcher) return 0;
  try {
    const channel = await client.channels.fetch(watcher.channelId);
    const message = await channel.messages.fetch(watcher.messageId);

    if (watcher.type === 'reaction') {
      const emoji    = watcher.emoji || '✅';
      const reaction = message.reactions.cache.find(r =>
        r.emoji.toString() === emoji ||
        r.emoji.name === emoji ||
        r.emoji.name === 'white_check_mark'
      );
      if (!reaction) return 0;
      await reaction.users.fetch();
      return reaction.users.cache.filter(u => !u.bot && !isExcluded(watcher, u.id)).size;
    }

    if (watcher.type === 'poll') {
      if (!message.poll) return 0;
      let bestAnswer = null;
      for (const answer of message.poll.answers.values()) {
        const text = (answer.text || '').toLowerCase();
        if (text.includes('yes') || answer.emoji?.name === '✅') { bestAnswer = answer; break; }
      }
      if (!bestAnswer) bestAnswer = message.poll.answers.first();
      if (!bestAnswer) return 0;

      try {
        const voters = await bestAnswer.fetchVoters();
        return voters.filter(u => !u.bot && !isExcluded(watcher, u.id)).size;
      } catch {
        const activeExcl = Object.values(watcher.exclusions || {}).filter(e => !e.expiresAt || Date.now() <= e.expiresAt).length;
        return Math.max(0, (bestAnswer.voteCount || 0) - activeExcl);
      }
    }
  } catch (e) {
    console.warn(`getEffectiveCount(${watcherId}):`, e.message);
  }
  return 0;
}

// ── Log exclusions to #homage-poll-log ───────────────────────────────────────
async function logExclusion(guild, watcher, watcherId, targetUser, reason, excludedBy) {
  try {
    const logCh = guild.channels.cache.get(POLL_LOG_CHANNEL_ID)
      ?? await guild.channels.fetch(POLL_LOG_CHANNEL_ID).catch(() => null);
    if (!logCh) return;
    await logCh.send({
      embeds: [new EmbedBuilder()
        .setTitle('🚫 Vote Excluded')
        .setColor(0xff9900)
        .addFields(
          { name: '👤 Excluded User', value: `<@${targetUser.id}> (${targetUser.tag ?? targetUser.id})`, inline: true },
          { name: '🛡️ By',           value: `<@${excludedBy.id}>`,                                       inline: true },
          { name: '📋 Reason',        value: reason },
          { name: '🔗 Message',       value: `[Jump](https://discord.com/channels/${watcher.guildId}/${watcher.channelId}/${watcher.messageId})`, inline: true },
          { name: '🆔 Watcher',       value: `#${watcherId.slice(-6)}`,                                  inline: true },
          { name: '📋 Preset',        value: watcher.presetName,                                          inline: true },
        )
        .setTimestamp()
      ],
    });
  } catch (e) {
    console.warn('logExclusion error:', e.message);
  }
}

// ── Fire when threshold is first reached ─────────────────────────────────────
async function triggerWatcher(client, watcherId) {
  const watcher = watchers[watcherId];
  if (!watcher || watcher.triggered) return;
  watcher.triggered   = true;
  watcher.triggeredAt = Date.now();
  saveWatchers(watchers);

  const delayMs   = (watcher.delayMinutes ?? 5) * 60 * 1000;
  const delayText = watcher.delayMinutes === 0 ? 'right now' : `in **${watcher.delayMinutes} minute(s)**`;

  // Announce in the watched channel and save the message ID so it can be deleted on reset
  try {
    const ch  = await client.channels.fetch(watcher.channelId);
    const msg = await ch.send({
      embeds: [new EmbedBuilder()
        .setTitle('✅ Threshold Reached!')
        .setDescription(`The required **${watcher.threshold}** vote(s)/reaction(s) have been met.\nThe handpick list for **"${watcher.presetName}"** will be posted ${delayText}.`)
        .setColor(0x57f287)
        .setTimestamp()
      ],
    });
    watcher.triggerMsgId      = msg.id;
    watcher.triggerMsgChannel = msg.channelId;
    saveWatchers(watchers);
  } catch (e) { console.warn('triggerWatcher announce:', e.message); }

  const timer = setTimeout(() => postHandpickList(client, watcherId), delayMs);
  activeTimers[watcherId] = timer;
}

// ── Cancel countdown and reset so watcher can re-trigger ─────────────────────
async function resetWatcher(client, watcherId) {
  const watcher = watchers[watcherId];
  if (!watcher || watcher.posted) return; // already posted, can't undo
  if (activeTimers[watcherId]) { clearTimeout(activeTimers[watcherId]); delete activeTimers[watcherId]; }
  if (!watcher.triggered) return; // wasn't triggered, nothing to reset
  watcher.triggered   = false;
  watcher.triggeredAt = null;
  // Delete the old trigger announcement so only 1 status message exists at a time
  if (watcher.triggerMsgId) {
    try {
      const ch  = await client.channels.fetch(watcher.triggerMsgChannel ?? watcher.channelId);
      const msg = await ch.messages.fetch(watcher.triggerMsgId);
      await msg.delete();
    } catch {}
    watcher.triggerMsgId      = null;
    watcher.triggerMsgChannel = null;
  }
  saveWatchers(watchers);
}

// ── Post the handpick list using the ping_event choice set at setup ───────────
async function postHandpickList(client, watcherId) {
  const watcher = watchers[watcherId];
  if (!watcher || watcher.posted) return;
  delete activeTimers[watcherId];
  await doPostHandpickList(client, watcherId, watcher.pingEvent ?? false);
}

// ── Actually load and post the handpick list ──────────────────────────────────
async function doPostHandpickList(client, watcherId, sendPing) {
  const watcher = watchers[watcherId];
  if (!watcher || watcher.posted) return;
  watcher.posted = true;
  saveWatchers(watchers);

  try {
    const presets = loadPresets();
    const preset  = presets[watcher.guildId]?.[watcher.presetName];
    if (!preset) {
      const ch = await client.channels.fetch(watcher.postChannelId);
      await ch.send(`❌ Preset **"${watcher.presetName}"** no longer exists. Could not post the handpick list.`);
      return;
    }

    const { buildEmbedFromGame, buildComponentsFromGame, saveGame, pendingGames } = require('./handpicker');
    const gameId      = `${watcher.guildId}_${Date.now()}`;
    const factions    = {};
    const factionOrder = [];
    for (const [fName, f] of Object.entries(preset.factions)) {
      factions[fName] = { countries: [...f.countries], claims: {} };
      factionOrder.push(fName);
    }

    const game = {
      title:     preset.title,
      host:      watcher.hostId,
      guildId:   watcher.guildId,
      channelId: watcher.postChannelId,
      factions,
    };

    // Auto-map Team roles (same logic as load_preset)
    try {
      const guild = await client.guilds.fetch(watcher.guildId);
      await guild.roles.fetch();
      const teamRoles = guild.roles.cache
        .filter(r => /^Team\s*\d+$/i.test(r.name))
        .sort((a, b) => parseInt(a.name.match(/\d+/)[0]) - parseInt(b.name.match(/\d+/)[0]));

      if (teamRoles.size >= factionOrder.length) {
        let teamsData = {};
        try { teamsData = JSON.parse(fs.readFileSync(TEAMS_FILE_PATH, 'utf8')); } catch {}
        if (!teamsData[watcher.guildId]) teamsData[watcher.guildId] = {};
        const roleArray = [...teamRoles.values()];
        factionOrder.forEach((fName, i) => {
          teamsData[watcher.guildId][fName] = { roleId: roleArray[i].id };
        });
        fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(TEAMS_FILE_PATH, JSON.stringify(teamsData, null, 2));
        try { const tm = require('./teams'); if (tm._reloadTeams) tm._reloadTeams(); } catch {}
      }
    } catch (e) { console.warn('auto-map team roles error:', e.message); }

    // Apply preset players if any were set during watcher setup
    if (watcher.presetPlayers && Object.keys(watcher.presetPlayers).length > 0) {
      for (const [country, userId] of Object.entries(watcher.presetPlayers)) {
        for (const faction of Object.values(factions)) {
          const exact = faction.countries.find(c => c.toLowerCase() === country.toLowerCase());
          if (exact) { faction.claims[exact] = userId; break; }
        }
      }
    }

    // Post the live handpick list
    const postCh = await client.channels.fetch(watcher.postChannelId);
    if (sendPing) {
      await postCh.send(`<@&${EVENT_PING_ROLE_ID}>`);
      try {
        const guild  = await client.guilds.fetch(watcher.guildId);
        const logCh  = guild.channels.cache.get(POLL_LOG_CHANNEL_ID)
          ?? await guild.channels.fetch(POLL_LOG_CHANNEL_ID).catch(() => null);
        if (logCh) await logCh.send({
          embeds: [new EmbedBuilder()
            .setTitle('📣 Event Ping Sent')
            .setColor(0x5865f2)
            .addFields(
              { name: '📋 Preset',    value: watcher.presetName,         inline: true },
              { name: '📋 Posted to', value: `<#${watcher.postChannelId}>`, inline: true },
              { name: '🛡️ Set up by', value: `<@${watcher.hostId}>`,     inline: true },
            )
            .setTimestamp()
          ],
        });
      } catch (e) { console.warn('ping log error:', e.message); }
    }
    const msg    = await postCh.send({
      embeds:     [buildEmbedFromGame(game)],
      components: buildComponentsFromGame(game, gameId),
    });

    game.messageId = msg.id;
    saveGame(gameId, game);

    // Start list expiry timer if set
    if (watcher.listExpiryMs) {
      const { scheduleListExpiry } = require('./handpicker');
      scheduleListExpiry(client, gameId, watcher.listExpiryMs);
    }

    // DM the host
    try {
      const host = await client.users.fetch(watcher.hostId);
      await host.send({
        embeds: [new EmbedBuilder()
          .setTitle('✅ Handpick List Posted!')
          .setDescription(`The handpick list for **"${watcher.presetName}"** has been posted in <#${watcher.postChannelId}>.`)
          .setColor(0x57f287)
          .setTimestamp()
        ],
      });
    } catch (e) { console.warn('host DM error:', e.message); }

    console.log(`✅ Watcher ${watcherId}: posted handpick list for preset "${watcher.presetName}"`);
  } catch (e) {
    console.error('postHandpickList error:', e.message);
    try {
      const ch = await client.channels.fetch(watcher.channelId);
      await ch.send(`❌ Failed to post the handpick list: ${e.message}`);
    } catch {}
  }
}

// ── Start or restart the expiry timer for a watcher ─────────────────────────
function startExpiryTimer(client, watcherId) {
  const watcher = watchers[watcherId];
  if (!watcher?.expiresAt) return;
  if (expiryTimers[watcherId]) { clearTimeout(expiryTimers[watcherId]); delete expiryTimers[watcherId]; }
  const remaining = watcher.expiresAt - Date.now();
  if (remaining <= 0) { handleExpiry(client, watcherId); return; }
  expiryTimers[watcherId] = setTimeout(() => handleExpiry(client, watcherId), remaining);
}

// ── Fire when deadline passes without threshold being met ────────────────────
async function handleExpiry(client, watcherId) {
  const watcher = watchers[watcherId];
  if (!watcher || watcher.triggered || watcher.posted) return; // already handled
  delete expiryTimers[watcherId];
  try {
    const host = await client.users.fetch(watcher.hostId);
    const row  = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`expiry_delay__${watcherId}__30`).setLabel('+30 min').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`expiry_delay__${watcherId}__60`).setLabel('+1 hour').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`expiry_delay__${watcherId}__120`).setLabel('+2 hours').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`expiry_custom__${watcherId}`).setLabel('Custom').setStyle(ButtonStyle.Secondary).setEmoji('✏️'),
      new ButtonBuilder().setCustomId(`expiry_cancel__${watcherId}`).setLabel('Cancel Event').setStyle(ButtonStyle.Danger).setEmoji('🗑️'),
    );
    await host.send({
      embeds: [new EmbedBuilder()
        .setTitle('⏰ Deadline Passed — Threshold Not Met')
        .setDescription(`The deadline for **"${watcher.presetName}"** passed without reaching **${watcher.threshold}** votes/reactions.\n\nDelay the deadline or cancel the event?`)
        .setColor(0xff9900)
        .setTimestamp()
      ],
      components: [row],
    });
  } catch (e) { console.warn('handleExpiry DM error:', e.message); }
}

// ── Slash command definitions ─────────────────────────────────────────────────
const watcherCommands = [
  new SlashCommandBuilder()
    .setName('setup_watcher')
    .setDescription('Host: Post a reaction embed — players react ✅ to vote, fires a handpick list when threshold is reached')
    .addIntegerOption(o => o.setName('threshold').setDescription('✅ reactions needed to trigger (default: 13)').setMinValue(1))
    .addIntegerOption(o => o.setName('delay').setDescription('Minutes to wait after threshold before posting the list (default: 5)').setMinValue(0))
    .addChannelOption(o => o.setName('post_channel').setDescription('Channel to post the handpick list in (default: this channel)'))
    .addIntegerOption(o => o.setName('expire_in').setDescription('Remove watcher after X minutes if threshold not reached (default: 30)').setMinValue(1))
    .addIntegerOption(o => o.setName('list_expiry').setDescription('Minutes before the posted list closes for claims (default: 15)').setMinValue(1))
    .addBooleanOption(o => o.setName('ping_event').setDescription('Ping Event Ping role when the handpick list is posted? (default: false)'))
    .addStringOption(o => o.setName('preset_players').setDescription('Pre-assign players: Nation: UserID; Nation: UserID (leave empty for none)'))
    .toJSON(),

  new SlashCommandBuilder()
    .setName('exclude_check')
    .setDescription('Host: Exclude a user\'s vote/reaction from the count (logged to #homage-poll-log)')
    .addUserOption(o => o.setName('user').setDescription('User whose vote to exclude').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason for exclusion').setRequired(true))
    .addStringOption(o => o.setName('duration').setDescription('How long to exclude e.g. 1d 2h 30m (default: 30m)').setRequired(true))
    .toJSON(),

  new SlashCommandBuilder()
    .setName('list_watchers')
    .setDescription('Show all active poll/reaction watchers in this server')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('remove_watcher')
    .setDescription('Admin: Remove a poll/reaction watcher')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('delay_watcher')
    .setDescription('Admin: Add extra minutes to an active countdown or deadline')
    .addIntegerOption(o => o.setName('minutes').setDescription('Minutes to add').setRequired(true).setMinValue(1))
    .toJSON(),

  new SlashCommandBuilder()
    .setName('remove_exclusion')
    .setDescription('Admin: Remove an exclusion from a watcher so that vote counts again')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('reset_watcher')
    .setDescription('Admin: Delete ALL watchers for this server')
    .toJSON(),
];

module.exports.watcherCommands = watcherCommands;

// ── Main setup ────────────────────────────────────────────────────────────────
function setupWatcher(client) {

  // ── Restore timers on startup (bot restart recovery) ───────────────────────
  for (const [watcherId, watcher] of Object.entries(watchers)) {
    if (!watcher.createdAt) watcher.createdAt = Date.now();
    if (watcher.triggered && !watcher.posted && watcher.triggeredAt) {
      const delayMs   = (watcher.delayMinutes ?? 5) * 60 * 1000;
      const elapsed   = Date.now() - watcher.triggeredAt;
      const remaining = Math.max(0, delayMs - elapsed);
      activeTimers[watcherId] = setTimeout(() => postHandpickList(client, watcherId), remaining);
    }
    if (!watcher.triggered && !watcher.posted && watcher.expiresAt) {
      startExpiryTimer(client, watcherId);
    }
    if (!watcher.posted && !watcher._pending) {
      scheduleWatcherAutoReset(client, watcherId);
    }
  }

  // ── Slash commands ──────────────────────────────────────────────────────────
  client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    const { commandName, guildId, guild } = interaction;

    // ── /setup_watcher ──────────────────────────────────────────────────────
    if (commandName === 'setup_watcher') {
      if (!isHost(interaction.member)) return denyHost(interaction);

      const threshold    = interaction.options.getInteger('threshold')    ?? 13;
      const delayMinutes = interaction.options.getInteger('delay')        ?? 5;
      const postChannel  = interaction.options.getChannel('post_channel');
      const expireIn     = interaction.options.getInteger('expire_in')    ?? 30;
      const expiresAt    = Date.now() + expireIn * 60 * 1000;
      const listExpiryMin    = interaction.options.getInteger('list_expiry')   ?? 15;
      const pingEvent        = interaction.options.getBoolean('ping_event')    ?? false;
      const presetPlayersRaw = interaction.options.getString('preset_players') ?? '';

      // Parse "Nation: UserID; Nation: UserID" into an object
      const presetPlayers = {};
      if (presetPlayersRaw.trim()) {
        for (const part of presetPlayersRaw.split(';').map(s => s.trim()).filter(Boolean)) {
          const colonIdx = part.indexOf(':');
          if (colonIdx === -1) continue;
          const nation = part.slice(0, colonIdx).trim();
          const userId = part.slice(colonIdx + 1).replace(/\s/g, '').replace(/[<@!>]/g, '');
          if (nation && /^\d{17,20}$/.test(userId)) presetPlayers[nation] = userId;
        }
      }

      // Check presets exist
      const presets = loadPresets();
      const guildPresets = presets[guildId] || {};
      const presetNames  = Object.keys(guildPresets);
      if (presetNames.length === 0) {
        return interaction.reply({ content: '❌ No presets saved yet. Save one first with `/save_preset`.', ephemeral: true });
      }

      // Build pending config (stored until preset is chosen)
      const pendingId = `pending_${interaction.user.id}_${Date.now()}`;
      watchers[pendingId] = {
        _pending:      true,
        guildId,
        channelId:     interaction.channelId,
        messageId:     null, // set after bot posts the embed
        type:          'reaction',
        emoji:         '✅',
        threshold,
        delayMinutes,
        postChannelId: postChannel?.id ?? interaction.channelId,
        hostId:        interaction.user.id,
        exclusions:    {},
        triggered:     false,
        triggeredAt:   null,
        posted:        false,
        expiresAt,
        listExpiryMs:  listExpiryMin * 60 * 1000,
        pingEvent,
        presetPlayers,
      };

      // Show preset dropdown
      const opts = presetNames.map(name => {
        const p = guildPresets[name];
        const countries = Object.values(p.factions).reduce((s, f) => s + f.countries.length, 0);
        return {
          label:       name.slice(0, 100),
          description: `${p.title} · ${Object.keys(p.factions).join(', ')} · ${countries} countries`.slice(0, 100),
          value:       `${pendingId}|||${name}`,
        };
      });

      const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`watcher_preset_pick__${interaction.user.id}`)
          .setPlaceholder('Choose the preset to post when threshold is met...')
          .addOptions(opts)
      );
      return interaction.reply({
        content: `📋 Which preset should be posted when **${threshold}** ✅ reactions are reached?`,
        components: [row],
      });
    }

    // ── /exclude_check ──────────────────────────────────────────────────────
    if (commandName === 'exclude_check') {
      if (!isAdmin(interaction.member)) return denyAdmin(interaction);
      const guildWatchers = Object.entries(watchers).filter(([, w]) => w.guildId === guildId && !w.posted && !w._pending);
      if (guildWatchers.length === 0) return interaction.reply({ content: '❌ No active watchers in this server.', ephemeral: true });

      const targetUser    = interaction.options.getUser('user');
      const reason        = interaction.options.getString('reason');
      const durationStr   = interaction.options.getString('duration') ?? '30m';
      const durationMs    = parseDuration(durationStr) || 30 * 60 * 1000;
      const exclExpiresAt = Date.now() + durationMs;

      // Apply to ALL active watchers in the server
      for (const [watcherId, watcher] of guildWatchers) {
        if (!watcher.exclusions) watcher.exclusions = {};
        watcher.exclusions[targetUser.id] = { reason, excludedBy: interaction.user.id, timestamp: Date.now(), expiresAt: exclExpiresAt };
        if (guild) await logExclusion(guild, watcher, watcherId, targetUser, reason, interaction.user);
        const countAfter = await getEffectiveCount(client, watcherId);
        if (countAfter < watcher.threshold) await resetWatcher(client, watcherId);
      }
      saveWatchers(watchers);
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setTitle('🚫 Vote Excluded')
          .setColor(0xff9900)
          .addFields(
            { name: '👤 User',     value: `<@${targetUser.id}>`,                         inline: true },
            { name: '⏰ Expires',  value: `<t:${Math.floor(exclExpiresAt/1000)}:R>`,     inline: true },
            { name: '📋 Reason',   value: reason },
            { name: '📋 Watchers', value: `Applied to all **${guildWatchers.length}** active watcher(s)` },
          )
          .setFooter({ text: 'Logged to #homage-poll-log' })
          .setTimestamp()
        ],
      });
    }

    // ── /list_watchers ──────────────────────────────────────────────────────
    if (commandName === 'list_watchers') {
      if (!isHost(interaction.member)) return denyHost(interaction);
      const guildWatchers = Object.entries(watchers).filter(([, w]) => w.guildId === guildId && !w._pending);
      if (guildWatchers.length === 0) return interaction.reply({ content: '❌ No watchers set up for this server.' });
      let desc = '';
      for (const [watcherId, w] of guildWatchers) {
        const status    = w.posted ? '✅ Posted' : w.triggered ? `⏳ Waiting ${w.delayMinutes}m...` : '👀 Watching';
        const exclCount = Object.keys(w.exclusions || {}).length;
        desc += `**#${watcherId.slice(-6)}** — ${status}\n`;
        desc += `Preset: **"${w.presetName}"** · Type: \`${w.type}\`${w.type === 'reaction' ? ` (${w.emoji})` : ''}\n`;
        desc += `Threshold: **${w.threshold}** · Delay: **${w.delayMinutes}m** · Posts to: <#${w.postChannelId}>\n`;
        if (exclCount > 0) desc += `Exclusions: **${exclCount}**\n`;
        desc += '\n';
      }
      return interaction.reply({
        embeds: [new EmbedBuilder().setTitle('👀 Active Watchers').setDescription(desc.trim()).setColor(0x5865f2)],
      });
    }

    // ── /remove_exclusion ───────────────────────────────────────────────────
    if (commandName === 'remove_exclusion') {
      if (!isAdmin(interaction.member)) return denyAdmin(interaction); // vote exclusion — admin only
      const guildWatchers = Object.entries(watchers).filter(([, w]) => w.guildId === guildId && !w._pending);
      if (guildWatchers.length === 0) return interaction.reply({ content: '❌ No active watchers in this server.', ephemeral: true });

      // Find all watchers that have at least one exclusion
      const watchersWithExcl = guildWatchers.filter(([, w]) => Object.keys(w.exclusions || {}).length > 0);
      if (watchersWithExcl.length === 0) return interaction.reply({ content: '❌ No exclusions to remove.', ephemeral: true });

      if (watchersWithExcl.length === 1) {
        // Skip to exclusion picker directly
        const [watcherId, watcher] = watchersWithExcl[0];
        const excEntries = Object.entries(watcher.exclusions || {});
        const opts = excEntries.map(([userId, data]) => ({
          label:       `User ${userId}`.slice(0, 100),
          description: `Reason: ${data.reason}`.slice(0, 100),
          value:       `${watcherId}|||${userId}`,
        }));
        const row = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`remove_excl_pick__${interaction.user.id}`)
            .setPlaceholder('Choose an exclusion to remove...')
            .addOptions(opts)
        );
        return interaction.reply({ content: `🗑️ **"${watcher.presetName}"** — which exclusion do you want to remove?`, components: [row] });
      }

      // Multiple watchers with exclusions → pick watcher first
      const opts = watchersWithExcl.map(([watcherId, w]) => ({
        label:       `#${watcherId.slice(-6)} — ${w.presetName}`.slice(0, 100),
        description: `${Object.keys(w.exclusions || {}).length} exclusion(s)`.slice(0, 100),
        value:       watcherId,
      }));
      const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`remove_excl_watcher__${interaction.user.id}`)
          .setPlaceholder('Choose a watcher...')
          .addOptions(opts)
      );
      return interaction.reply({ content: '🗑️ Which watcher do you want to remove an exclusion from?', components: [row] });
    }

    // ── /reset_watcher ──────────────────────────────────────────────────────
    if (commandName === 'reset_watcher') {
      if (!isAdmin(interaction.member)) return denyAdmin(interaction);
      const guildWatchers = Object.entries(watchers).filter(([, w]) => w.guildId === guildId && !w._pending);
      if (guildWatchers.length === 0) return interaction.reply({ content: '❌ No active watchers in this server.', ephemeral: true });

      const confirmEmbed = new EmbedBuilder()
        .setTitle('⚠️ Confirm Watcher Reset')
        .setDescription(`Are you sure you want to **delete all ${guildWatchers.length} watcher(s)** for this server?\nThis will cancel any active countdowns and remove all watchers.\n\n**This cannot be undone.**`)
        .setColor(0xff4444);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`confirm_reset_watcher__${guildId}`).setLabel(`Yes, delete all ${guildWatchers.length} watcher(s)`).setStyle(ButtonStyle.Danger).setEmoji('🗑️'),
        new ButtonBuilder().setCustomId('cancel_reset_watcher').setLabel('Cancel').setStyle(ButtonStyle.Secondary).setEmoji('✖️'),
      );
      return interaction.reply({ embeds: [confirmEmbed], components: [row] });
    }

    // ── /delay_watcher ──────────────────────────────────────────────────────
    if (commandName === 'delay_watcher') {
      if (!isHost(interaction.member)) return denyHost(interaction);
      const minutes       = interaction.options.getInteger('minutes');
      const addMs         = minutes * 60 * 1000;
      const guildWatchers = Object.entries(watchers).filter(([, w]) => w.guildId === guildId && !w._pending && !w.posted);
      if (guildWatchers.length === 0) return interaction.reply({ content: '❌ No active watchers to delay.', ephemeral: true });

      const applyDelay = (watcherId) => {
        const watcher = watchers[watcherId];
        // Extend countdown if currently triggered
        if (watcher.triggered && activeTimers[watcherId]) {
          clearTimeout(activeTimers[watcherId]);
          const elapsed   = Date.now() - watcher.triggeredAt;
          const baseDelta = (watcher.delayMinutes ?? 5) * 60 * 1000;
          const remaining = Math.max(0, baseDelta - elapsed) + addMs;
          activeTimers[watcherId] = setTimeout(() => postHandpickList(client, watcherId), remaining);
          watcher.triggeredAt = Date.now() - baseDelta + remaining; // adjust so restart recovery works
        }
        // Extend expiry deadline if set
        if (watcher.expiresAt) {
          watcher.expiresAt += addMs;
          startExpiryTimer(client, watcherId);
        }
        saveWatchers(watchers);
      };

      if (guildWatchers.length === 1) {
        const [watcherId, watcher] = guildWatchers[0];
        applyDelay(watcherId);
        const parts = [];
        if (watcher.triggered) parts.push('countdown');
        if (watcher.expiresAt) parts.push('deadline');
        return interaction.reply({
          embeds: [new EmbedBuilder()
            .setTitle('⏱️ Watcher Delayed')
            .setDescription(`**"${watcher.presetName}"** — ${parts.join(' and ')} extended by **${minutes} minute(s)**.`)
            .setColor(0x5865f2).setTimestamp()
          ],
          ephemeral: true,
        });
      }

      const opts = guildWatchers.map(([watcherId, w]) => ({
        label:       `#${watcherId.slice(-6)} — ${w.presetName}`.slice(0, 100),
        description: `${w.triggered ? '⏳ Counting down' : '👀 Watching'}${w.expiresAt ? ' · has deadline' : ''}`.slice(0, 100),
        value:       `${watcherId}|||${minutes}`,
      }));
      const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`delay_watcher_pick__${interaction.user.id}`)
          .setPlaceholder('Choose a watcher to delay...')
          .addOptions(opts)
      );
      return interaction.reply({ content: `⏱️ Which watcher do you want to delay by **${minutes} min**?`, components: [row], ephemeral: true });
    }

    // ── /remove_watcher ─────────────────────────────────────────────────────
    if (commandName === 'remove_watcher') {
      if (!isHost(interaction.member)) return denyHost(interaction);
      const guildWatchers = Object.entries(watchers).filter(([, w]) => w.guildId === guildId && !w._pending);
      if (guildWatchers.length === 0) return interaction.reply({ content: '❌ No watchers to remove.', ephemeral: true });
      const opts = guildWatchers.map(([watcherId, w]) => ({
        label:       `#${watcherId.slice(-6)} — ${w.presetName}`.slice(0, 100),
        description: `${w.type} · threshold ${w.threshold} · ${w.posted ? 'Posted' : w.triggered ? 'Triggered' : 'Watching'}`.slice(0, 100),
        value:       watcherId,
      }));
      const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`remove_watcher_pick__${interaction.user.id}`)
          .setPlaceholder('Choose a watcher to remove...')
          .addOptions(opts)
      );
      return interaction.reply({ content: '🗑️ Which watcher do you want to remove?', components: [row], ephemeral: true });
    }
  });

  // ── Dropdown: preset picker (step 2 of setup) ───────────────────────────────
  client.on('interactionCreate', async interaction => {
    if (!interaction.isStringSelectMenu()) return;
    if (!interaction.customId.startsWith('watcher_preset_pick__')) return;
    const userId = interaction.customId.split('__')[1];
    if (interaction.user.id !== userId) return interaction.reply({ content: '❌ This menu is not for you.', ephemeral: true });

    const [pendingId, presetName] = interaction.values[0].split('|||');
    const pending = watchers[pendingId];
    if (!pending?._pending) return interaction.update({ content: '❌ Setup expired. Run `/setup_watcher` again.', components: [] });

    pending.presetName = presetName;

    const result = await finalizePending(pendingId);
    if (!result) return interaction.update({ content: '❌ Setup expired. Run `/setup_watcher` again.', components: [] });
    return interaction.update({ content: '✅ Watcher posted! Players can now react ✅ to vote.', components: [], embeds: [] });
  });

  // ── Helper: finalize pending → post reaction embed, react ✅, start watcher ──
  async function finalizePending(pendingId) {
    const pending = watchers[pendingId];
    if (!pending?._pending) return null;
    delete pending._pending;
    pending.createdAt = Date.now();
    const watcherId = `watcher_${pending.guildId}_${Date.now()}`;
    watchers[watcherId] = pending;
    delete watchers[pendingId];

    // Post the reaction embed in the watcher's channel
    const expiryText  = pending.expiresAt ? `Expires <t:${Math.floor(pending.expiresAt / 1000)}:R>` : 'No deadline';
    const playerCount = Object.keys(pending.presetPlayers || {}).length;
    const watchEmbed  = new EmbedBuilder()
      .setTitle('👀 Watcher Active!')
      .setColor(0x57f287)
      .addFields(
        { name: '📋 Preset',         value: `"${pending.presetName}"`,                                             inline: true },
        { name: '🎯 Threshold',      value: `${pending.threshold} ✅ reactions`,                                  inline: true },
        { name: '⏱️ Delay',          value: `${pending.delayMinutes} minute(s) after threshold`,                  inline: true },
        { name: '📋 Posts to',       value: `<#${pending.postChannelId}>`,                                        inline: true },
        { name: '⏰ Deadline',       value: expiryText,                                                            inline: true },
        { name: '🔒 List Closes In', value: `${Math.round(pending.listExpiryMs / 60000)} min after posting`,      inline: true },
        { name: '👥 Preset Players', value: playerCount > 0 ? `${playerCount} pre-assigned` : 'None',             inline: true },
      )
      .setFooter({ text: `ID: #${watcherId.slice(-6)} · Exclusion logs → #homage-poll-log · React ✅ to vote` })
      .setTimestamp();

    try {
      const ch  = await client.channels.fetch(pending.channelId);
      const msg = await ch.send({ embeds: [watchEmbed] });
      pending.messageId = msg.id;
      // Bot reacts ✅ as a visual cue — bot reactions don't count toward threshold
      await msg.react('✅');
    } catch (e) {
      console.warn('finalizePending: failed to post/react to watcher embed:', e.message);
    }

    saveWatchers(watchers);
    startExpiryTimer(client, watcherId);
    scheduleWatcherAutoReset(client, watcherId);
    return { watcherId };
  }

  // ── Button: skip preset players ────────────────────────────────────────────
  client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;
    if (!interaction.customId.startsWith('watcher_skip_players__')) return;
    const pendingId = interaction.customId.replace('watcher_skip_players__', '');
    const result = await finalizePending(pendingId);
    if (!result) return interaction.update({ content: '❌ Setup expired. Run `/setup_watcher` again.', components: [] });
    return interaction.update({ content: '✅ Watcher posted! Players can now react ✅ to vote.', components: [], embeds: [] });
  });

  // ── Button: open preset players modal ──────────────────────────────────────
  client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;
    if (!interaction.customId.startsWith('watcher_add_players__')) return;
    const pendingId = interaction.customId.replace('watcher_add_players__', '');
    if (!watchers[pendingId]?._pending) return interaction.reply({ content: '❌ Setup expired.', ephemeral: true });
    const modal = new ModalBuilder()
      .setCustomId(`watcher_players_modal__${pendingId}`)
      .setTitle('Pre-assign Players');
    modal.addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('players_text')
        .setLabel('Nation: UserID (one per line)')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Germany: 123456789012345678\nFrance: 987654321098765432\nRussia: 111222333444555666')
        .setRequired(true)
        .setMaxLength(4000)
    ));
    await interaction.showModal(modal);
  });

  // ── Modal: preset players submit ───────────────────────────────────────────
  client.on('interactionCreate', async interaction => {
    if (!interaction.isModalSubmit()) return;
    if (!interaction.customId.startsWith('watcher_players_modal__')) return;
    const pendingId = interaction.customId.replace('watcher_players_modal__', '');
    const pending   = watchers[pendingId];
    if (!pending?._pending) return interaction.reply({ content: '❌ Setup expired. Run `/setup_watcher` again.', ephemeral: true });

    await interaction.deferUpdate();

    const raw      = interaction.fields.getTextInputValue('players_text');
    const assigned = [], failed = [];
    for (const line of raw.split('\n').map(l => l.trim()).filter(Boolean)) {
      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) { failed.push(`"${line}" — missing colon`); continue; }
      const nation = line.slice(0, colonIdx).trim();
      const userId = line.slice(colonIdx + 1).replace(/\s/g, '').replace(/[<@!>]/g, '');
      if (!userId || !/^\d{17,20}$/.test(userId)) { failed.push(`${nation}: invalid ID`); continue; }
      if (!pending.presetPlayers) pending.presetPlayers = {};
      pending.presetPlayers[nation] = userId;
      assigned.push(`**${nation}** → <@${userId}>`);
    }

    const result = await finalizePending(pendingId);
    if (!result) return interaction.editReply({ content: '❌ Setup expired.', components: [], embeds: [] });

    let summary = '✅ Watcher posted! Players can now react ✅ to vote.\n\n';
    if (assigned.length > 0) summary += `📋 **${assigned.length}** pre-assigned:\n${assigned.join('\n')}\n\n`;
    if (failed.length > 0)   summary += `⚠️ **${failed.length}** failed:\n${failed.map(f => `• ${f}`).join('\n')}`;

    return interaction.editReply({ content: summary.trim(), embeds: [], components: [] });
  });

  // ── Button: expiry custom delay (opens modal) ──────────────────────────────
  client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;
    if (!interaction.customId.startsWith('expiry_custom__')) return;
    const watcherId = interaction.customId.replace('expiry_custom__', '');
    const modal = new ModalBuilder()
      .setCustomId(`expiry_custom_modal__${watcherId}`)
      .setTitle('Custom Delay');
    modal.addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('custom_minutes')
        .setLabel('How many minutes to extend the deadline?')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('e.g. 45')
        .setRequired(true)
        .setMaxLength(5)
    ));
    await interaction.showModal(modal);
  });

  // ── Modal: expiry custom delay submit ──────────────────────────────────────
  client.on('interactionCreate', async interaction => {
    if (!interaction.isModalSubmit()) return;
    if (!interaction.customId.startsWith('expiry_custom_modal__')) return;
    const watcherId = interaction.customId.replace('expiry_custom_modal__', '');
    const watcher   = watchers[watcherId];
    const raw       = interaction.fields.getTextInputValue('custom_minutes');
    const minutes   = parseInt(raw);
    if (!watcher)           return interaction.reply({ content: '❌ Watcher no longer exists.', ephemeral: true });
    if (isNaN(minutes) || minutes < 1) return interaction.reply({ content: '❌ Enter a valid number of minutes.', ephemeral: true });
    if (watcher.triggered || watcher.posted) return interaction.reply({ content: '✅ Threshold was already reached — no delay needed.', ephemeral: true });
    watcher.expiresAt = (watcher.expiresAt ?? Date.now()) + minutes * 60 * 1000;
    saveWatchers(watchers);
    startExpiryTimer(client, watcherId);
    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setTitle('⏱️ Deadline Extended')
        .setDescription(`Deadline for **"${watcher.presetName}"** extended by **${minutes} minute(s)**.\nNew deadline: <t:${Math.floor(watcher.expiresAt / 1000)}:R>`)
        .setColor(0x5865f2).setTimestamp()
      ],
      ephemeral: true,
    });
  });

  // ── Dropdown: exclude watcher pick ─────────────────────────────────────────
  client.on('interactionCreate', async interaction => {
    if (!interaction.isStringSelectMenu()) return;
    if (!interaction.customId.startsWith('excl_watcher_pick__')) return;
    const userId = interaction.customId.split('__')[1];
    if (interaction.user.id !== userId) return interaction.reply({ content: '❌ This menu is not for you.', ephemeral: true });

    const [watcherId, targetUserId, encodedReason, expiresAtStr] = interaction.values[0].split('|||');
    const reason     = decodeURIComponent(encodedReason);
    const expiresAt  = parseInt(expiresAtStr) || (Date.now() + 30 * 60 * 1000);
    const watcher    = watchers[watcherId];
    if (!watcher) return interaction.update({ content: '❌ Watcher no longer exists.', components: [] });
    if (isExcluded(watcher, targetUserId)) {
      return interaction.update({ content: `❌ <@${targetUserId}> is already excluded from this watcher.`, components: [] });
    }
    if (!watcher.exclusions) watcher.exclusions = {};
    watcher.exclusions[targetUserId] = { reason, excludedBy: interaction.user.id, timestamp: Date.now(), expiresAt };
    saveWatchers(watchers);

    const targetUser = await interaction.client.users.fetch(targetUserId).catch(() => ({ id: targetUserId, tag: targetUserId }));
    if (interaction.guild) await logExclusion(interaction.guild, watcher, watcherId, targetUser, reason, interaction.user);

    const countAfter = await getEffectiveCount(client, watcherId);
    if (countAfter < watcher.threshold) await resetWatcher(client, watcherId);

    return interaction.update({
      content: `✅ <@${targetUserId}>'s vote excluded from watcher **#${watcherId.slice(-6)}** ("${watcher.presetName}"). Logged to #homage-poll-log.`,
      components: [],
    });
  });

  // ── Dropdown: remove watcher pick ──────────────────────────────────────────
  client.on('interactionCreate', async interaction => {
    if (!interaction.isStringSelectMenu()) return;
    if (!interaction.customId.startsWith('remove_watcher_pick__')) return;
    const userId = interaction.customId.split('__')[1];
    if (interaction.user.id !== userId) return interaction.reply({ content: '❌ This menu is not for you.', ephemeral: true });
    const watcherId = interaction.values[0];
    if (activeTimers[watcherId]) { clearTimeout(activeTimers[watcherId]); delete activeTimers[watcherId]; }
    const name = watchers[watcherId]?.presetName ?? watcherId;
    delete watchers[watcherId];
    saveWatchers(watchers);
    return interaction.update({ content: `✅ Watcher for **"${name}"** removed.`, components: [] });
  });

  // ── Dropdown: remove_excl_watcher (step 1: pick watcher) ──────────────────
  client.on('interactionCreate', async interaction => {
    if (!interaction.isStringSelectMenu()) return;
    if (!interaction.customId.startsWith('remove_excl_watcher__')) return;
    const userId = interaction.customId.split('__')[1];
    if (interaction.user.id !== userId) return interaction.reply({ content: '❌ This menu is not for you.', ephemeral: true });
    const watcherId = interaction.values[0];
    const watcher   = watchers[watcherId];
    if (!watcher) return interaction.update({ content: '❌ Watcher no longer exists.', components: [] });
    const excEntries = Object.entries(watcher.exclusions || {});
    if (excEntries.length === 0) return interaction.update({ content: '❌ No exclusions on this watcher.', components: [] });
    const opts = excEntries.map(([uid, data]) => ({
      label:       `User ${uid}`.slice(0, 100),
      description: `Reason: ${data.reason}`.slice(0, 100),
      value:       `${watcherId}|||${uid}`,
    }));
    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`remove_excl_pick__${userId}`)
        .setPlaceholder('Choose an exclusion to remove...')
        .addOptions(opts)
    );
    return interaction.update({ content: `🗑️ **"${watcher.presetName}"** — which exclusion do you want to remove?`, components: [row] });
  });

  // ── Dropdown: remove_excl_pick (step 2: pick exclusion) ───────────────────
  client.on('interactionCreate', async interaction => {
    if (!interaction.isStringSelectMenu()) return;
    if (!interaction.customId.startsWith('remove_excl_pick__')) return;
    const userId = interaction.customId.split('__')[1];
    if (interaction.user.id !== userId) return interaction.reply({ content: '❌ This menu is not for you.', ephemeral: true });
    const [watcherId, targetUserId] = interaction.values[0].split('|||');
    const watcher = watchers[watcherId];
    if (!watcher) return interaction.update({ content: '❌ Watcher no longer exists.', components: [] });
    const excData = (watcher.exclusions || {})[targetUserId];
    if (!excData) return interaction.update({ content: '❌ That exclusion no longer exists.', components: [] });
    delete watcher.exclusions[targetUserId];
    saveWatchers(watchers);
    // Re-check threshold now that the vote is restored
    const count = await getEffectiveCount(client, watcherId);
    if (count >= watcher.threshold && !watcher.triggered) await triggerWatcher(client, watcherId);
    return interaction.update({
      content: `✅ Exclusion for <@${targetUserId}> removed from **"${watcher.presetName}"**. Their vote counts again.\n*Reason was: ${excData.reason}*`,
      components: [],
    });
  });

  // ── Dropdown: delay_watcher_pick ───────────────────────────────────────────
  client.on('interactionCreate', async interaction => {
    if (!interaction.isStringSelectMenu()) return;
    if (!interaction.customId.startsWith('delay_watcher_pick__')) return;
    const userId = interaction.customId.split('__')[1];
    if (interaction.user.id !== userId) return interaction.reply({ content: '❌ This menu is not for you.', ephemeral: true });
    const [watcherId, minutesStr] = interaction.values[0].split('|||');
    const minutes = parseInt(minutesStr);
    const addMs   = minutes * 60 * 1000;
    const watcher = watchers[watcherId];
    if (!watcher) return interaction.update({ content: '❌ Watcher no longer exists.', components: [] });
    if (watcher.triggered && activeTimers[watcherId]) {
      clearTimeout(activeTimers[watcherId]);
      const elapsed   = Date.now() - watcher.triggeredAt;
      const baseDelta = (watcher.delayMinutes ?? 5) * 60 * 1000;
      const remaining = Math.max(0, baseDelta - elapsed) + addMs;
      activeTimers[watcherId] = setTimeout(() => postHandpickList(client, watcherId), remaining);
      watcher.triggeredAt = Date.now() - baseDelta + remaining;
    }
    if (watcher.expiresAt) { watcher.expiresAt += addMs; startExpiryTimer(client, watcherId); }
    saveWatchers(watchers);
    const parts = [];
    if (watcher.triggered) parts.push('countdown');
    if (watcher.expiresAt) parts.push('deadline');
    return interaction.update({
      content: `✅ **"${watcher.presetName}"** — ${parts.join(' and ')} extended by **${minutes} minute(s)**.`,
      components: [],
    });
  });

  // ── Buttons: expiry DM responses ───────────────────────────────────────────
  client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;

    if (interaction.customId.startsWith('expiry_delay__')) {
      const parts     = interaction.customId.split('__');
      const watcherId = parts[1];
      const minutes   = parseInt(parts[2]);
      const watcher   = watchers[watcherId];
      if (!watcher) return interaction.update({ content: '❌ Watcher no longer exists.', components: [] });
      if (watcher.triggered || watcher.posted) return interaction.update({ content: '✅ Threshold was already reached — no delay needed.', components: [] });
      watcher.expiresAt = Date.now() + minutes * 60 * 1000;
      saveWatchers(watchers);
      startExpiryTimer(client, watcherId);
      return interaction.update({
        embeds: [new EmbedBuilder()
          .setTitle('⏱️ Deadline Extended')
          .setDescription(`Deadline for **"${watcher.presetName}"** extended by **${minutes} minute(s)**.\nNew deadline: <t:${Math.floor(watcher.expiresAt / 1000)}:R>`)
          .setColor(0x5865f2).setTimestamp()
        ],
        components: [],
      });
    }

    if (interaction.customId.startsWith('expiry_cancel__')) {
      const watcherId = interaction.customId.split('__')[1];
      const watcher   = watchers[watcherId];
      if (!watcher) return interaction.update({ content: '❌ Watcher no longer exists.', components: [] });
      if (watcher.triggered || watcher.posted) return interaction.update({ content: '✅ Threshold was already reached — nothing to cancel.', components: [] });
      // Cancel timers and delete watcher
      if (activeTimers[watcherId])  { clearTimeout(activeTimers[watcherId]);  delete activeTimers[watcherId]; }
      if (expiryTimers[watcherId])  { clearTimeout(expiryTimers[watcherId]);  delete expiryTimers[watcherId]; }
      if (watcher.triggerMsgId) {
        try {
          const ch  = await interaction.client.channels.fetch(watcher.triggerMsgChannel ?? watcher.channelId);
          const msg = await ch.messages.fetch(watcher.triggerMsgId);
          await msg.delete();
        } catch {}
      }
      delete watchers[watcherId];
      saveWatchers(watchers);
      // Post cancellation embed in the watched channel
      try {
        const ch = await interaction.client.channels.fetch(watcher.channelId);
        await ch.send({
          embeds: [new EmbedBuilder()
            .setTitle('❌ Event Cancelled')
            .setDescription(`The event for **"${watcher.presetName}"** has been cancelled.\nThe threshold of **${watcher.threshold}** was not reached in time.`)
            .setColor(0xff4444).setTimestamp()
          ],
        });
      } catch (e) { console.warn('expiry_cancel channel announce error:', e.message); }
      return interaction.update({
        embeds: [new EmbedBuilder()
          .setTitle('✅ Event Cancelled')
          .setDescription(`**"${watcher.presetName}"** has been cancelled and the watcher removed.`)
          .setColor(0xff4444).setTimestamp()
        ],
        components: [],
      });
    }
  });

  // ── Buttons: watcher controls ──────────────────────────────────────────────
  client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;

    if (interaction.customId === 'cancel_reset_watcher') {
      return interaction.update({ content: '✅ Action cancelled.', embeds: [], components: [] });
    }

    if (interaction.customId.startsWith('confirm_reset_watcher__')) {
      const targetGuildId = interaction.customId.split('__')[1];
      const guildWatchers = Object.entries(watchers).filter(([, w]) => w.guildId === targetGuildId && !w._pending);
      for (const [watcherId] of guildWatchers) {
        await resetWatcher(client, watcherId);
        delete watchers[watcherId];
      }
      saveWatchers(watchers);
      return interaction.update({
        embeds: [new EmbedBuilder()
          .setTitle('🗑️ All Watchers Deleted')
          .setDescription(`All **${guildWatchers.length}** watcher(s) for this server have been removed.`)
          .setColor(0xff4444).setTimestamp()
        ],
        components: [],
      });
    }

  });

  // ── Reaction add: check watchers ───────────────────────────────────────────
  client.on('messageReactionAdd', async (reaction, user) => {
    if (user.bot) return;
    if (reaction.partial) { try { await reaction.fetch(); } catch { return; } }
    const msgId = reaction.message.id;
    for (const [watcherId, watcher] of Object.entries(watchers)) {
      if (watcher._pending || watcher.messageId !== msgId || watcher.type !== 'reaction' || watcher.triggered) continue;
      const count = await getEffectiveCount(client, watcherId);
      if (count >= watcher.threshold) await triggerWatcher(client, watcherId);
    }
  });

  // ── Poll vote add: check watchers ──────────────────────────────────────────
  client.on('messagePollVoteAdd', async (pollAnswer) => {
    try {
      const msgId = pollAnswer.poll?.message?.id;
      if (!msgId) return;
      for (const [watcherId, watcher] of Object.entries(watchers)) {
        if (watcher._pending || watcher.messageId !== msgId || watcher.type !== 'poll' || watcher.triggered) continue;
        const count = await getEffectiveCount(client, watcherId);
        if (count >= watcher.threshold) await triggerWatcher(client, watcherId);
      }
    } catch (e) {
      console.warn('messagePollVoteAdd error:', e.message);
    }
  });

  // ── Reaction remove: check if countdown should be cancelled ────────────────
  client.on('messageReactionRemove', async (reaction, user) => {
    if (user.bot) return;
    if (reaction.partial) { try { await reaction.fetch(); } catch { return; } }
    const msgId = reaction.message.id;
    for (const [watcherId, watcher] of Object.entries(watchers)) {
      if (watcher._pending || watcher.messageId !== msgId || watcher.type !== 'reaction' || watcher.posted) continue;
      const count = await getEffectiveCount(client, watcherId);
      if (count < watcher.threshold) await resetWatcher(client, watcherId);
    }
  });

  // ── Poll vote remove: check if countdown should be cancelled ───────────────
  client.on('messagePollVoteRemove', async (pollAnswer) => {
    try {
      const msgId = pollAnswer.poll?.message?.id;
      if (!msgId) return;
      for (const [watcherId, watcher] of Object.entries(watchers)) {
        if (watcher._pending || watcher.messageId !== msgId || watcher.type !== 'poll' || watcher.posted) continue;
        const count = await getEffectiveCount(client, watcherId);
        if (count < watcher.threshold) await resetWatcher(client, watcherId);
      }
    } catch (e) {
      console.warn('messagePollVoteRemove error:', e.message);
    }
  });
}

module.exports = { setupWatcher, watcherCommands };
