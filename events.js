const { isHost, denyHost, isAdmin, denyAdmin } = require('./permissions');
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
const EVENTS_FILE  = path.join(DATA_DIR, 'events.json');
const PRESETS_FILE = path.join(DATA_DIR, 'presets.json');
const TEAMS_FILE   = path.join(DATA_DIR, 'teams.json');

const POLL_LOG_CHANNEL_ID = '1508275084026974293';
const VOTE_EMOJI          = '✅';

function loadEvents()  {
  try { return fs.existsSync(EVENTS_FILE)  ? JSON.parse(fs.readFileSync(EVENTS_FILE,  'utf8')) : {}; } catch { return {}; }
}
function saveEvents(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(EVENTS_FILE, JSON.stringify(data, null, 2));
}
function loadPresets() {
  try { return fs.existsSync(PRESETS_FILE) ? JSON.parse(fs.readFileSync(PRESETS_FILE, 'utf8')) : {}; } catch { return {}; }
}

function parseDuration(str) {
  if (!str) return 0;
  let ms = 0;
  const d = str.match(/(\d+)\s*d/i); if (d) ms += parseInt(d[1]) * 86400000;
  const h = str.match(/(\d+)\s*h/i); if (h) ms += parseInt(h[1]) * 3600000;
  const m = str.match(/(\d+)\s*m/i); if (m) ms += parseInt(m[1]) * 60000;
  return ms;
}

let events = loadEvents();

const delayTimers    = {}; // eventId → setTimeout (delay after threshold)
const expiryTimers   = {}; // eventId → setTimeout (deadline)
const autoTimers     = {}; // eventId → setTimeout (3-hour auto-reset)
const EVENT_AUTO_MS  = 3 * 60 * 60 * 1000;

// ── Build the event embed ─────────────────────────────────────────────────────
function buildEmbed(event) {
  const isActive    = !event.triggered && !event.posted && !event.cancelled;
  const voteDisplay = isActive
    ? `React ${VOTE_EMOJI} below — **${event.currentVotes ?? 0}/${event.threshold}** votes`
    : event.cancelled
    ? '🚫 Cancelled'
    : event.posted
    ? '✅ List posted!'
    : `⏳ Threshold reached — posting in ${event.delayMinutes ?? 0} min...`;

  const fields = [
    { name: '🎯 Threshold', value: `${event.threshold} ${VOTE_EMOJI} reactions`, inline: true },
    { name: '👁️ Votes',     value: voteDisplay,                                  inline: true },
  ];
  if (event.preset)      fields.push({ name: '📋 Preset',       value: `"${event.preset}"`,                                          inline: true });
  if (event.delayMinutes) fields.push({ name: '⏱️ Delay',       value: `${event.delayMinutes} min after threshold`,                  inline: true });
  if (event.expiresAt)   fields.push({ name: '⏰ Deadline',      value: `Expires <t:${Math.floor(event.expiresAt / 1000)}:R>`,        inline: true });
  if (event.listExpiryMs) fields.push({ name: '🔒 List Closes In', value: `${Math.round(event.listExpiryMs / 60000)} min after posting`, inline: true });
  if (event.description) fields.push({ name: '📝 Description',  value: event.description });

  return new EmbedBuilder()
    .setTitle(`📅 ${event.title}`)
    .setColor(event.cancelled ? 0x888888 : event.posted ? 0x57f287 : event.triggered ? 0xffa500 : 0x5865f2)
    .addFields(fields)
    .setFooter({ text: `ID: #${event.id.slice(-6)} · React ${VOTE_EMOJI} to vote` })
    .setTimestamp();
}

// ── Update the event message in-place ────────────────────────────────────────
async function updateMessage(client, eventId) {
  const event = events[eventId];
  if (!event?.messageId) return;
  try {
    const ch  = await client.channels.fetch(event.channelId);
    const msg = await ch.messages.fetch(event.messageId);
    await msg.edit({ embeds: [buildEmbed(event)] });
  } catch {}
}

// ── Count valid votes (non-bot reactions, minus exclusions) ───────────────────
async function getVoteCount(client, eventId) {
  const event = events[eventId];
  if (!event) return 0;
  try {
    const ch  = await client.channels.fetch(event.channelId);
    const msg = await ch.messages.fetch(event.messageId);
    const reaction = msg.reactions.cache.find(r => r.emoji.name === VOTE_EMOJI);
    if (!reaction) return 0;
    const users = await reaction.users.fetch();
    const excl  = event.exclusions || {};
    let count = 0;
    for (const [uid, user] of users) {
      if (user.bot) continue;
      const ex = excl[uid];
      if (ex && (!ex.expiresAt || Date.now() < ex.expiresAt)) continue;
      count++;
    }
    return count;
  } catch { return 0; }
}

// ── Post the handpick list ────────────────────────────────────────────────────
async function postHandpickList(client, eventId) {
  const event = events[eventId];
  if (!event || event.posted) return;
  event.posted = true;
  saveEvents(events);

  try {
    const presets = loadPresets();
    const preset  = presets[event.guildId]?.[event.preset];
    const ch      = await client.channels.fetch(event.channelId);

    if (!preset) {
      await ch.send(`❌ Preset **"${event.preset}"** no longer exists.`);
      return;
    }

    const { buildEmbedFromGame, buildComponentsFromGame, saveGame, scheduleListExpiry } = require('./handpicker');

    const gameId       = `${event.guildId}_${Date.now()}`;
    const factions     = {};
    const factionOrder = [];
    for (const [fName, f] of Object.entries(preset.factions)) {
      factions[fName] = { countries: [...f.countries], claims: {} };
      factionOrder.push(fName);
    }

    const game = {
      title:     preset.title,
      host:      event.hostId,
      guildId:   event.guildId,
      channelId: event.channelId,
      factions,
    };

    // Auto-map Team roles
    try {
      const guild = await client.guilds.fetch(event.guildId);
      await guild.roles.fetch();
      const teamRoles = guild.roles.cache
        .filter(r => /^Team\s*\d+$/i.test(r.name))
        .sort((a, b) => parseInt(a.name.match(/\d+/)[0]) - parseInt(b.name.match(/\d+/)[0]));
      if (teamRoles.size >= factionOrder.length) {
        let teamsData = {};
        try { teamsData = JSON.parse(fs.readFileSync(TEAMS_FILE, 'utf8')); } catch {}
        if (!teamsData[event.guildId]) teamsData[event.guildId] = {};
        const roleArr = [...teamRoles.values()];
        factionOrder.forEach((fName, i) => { teamsData[event.guildId][fName] = { roleId: roleArr[i].id }; });
        fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(TEAMS_FILE, JSON.stringify(teamsData, null, 2));
        try { const tm = require('./teams'); if (tm._reloadTeams) tm._reloadTeams(); } catch {}
      }
    } catch {}

    if (event.pingRole) await ch.send(`<@&${event.pingRole}>`);

    const msg = await ch.send({ embeds: [buildEmbedFromGame(game)], components: buildComponentsFromGame(game, gameId) });
    game.messageId = msg.id;
    saveGame(gameId, game);

    if (event.listExpiryMs) scheduleListExpiry(client, gameId, event.listExpiryMs);

    await updateMessage(client, eventId);
    console.log(`✅ Event ${eventId}: posted handpick list for "${event.preset}"`);
  } catch (e) {
    console.error('postHandpickList (events) error:', e.message);
  }
}

// ── Trigger: threshold reached, start delay countdown ────────────────────────
async function triggerEvent(client, eventId) {
  const event = events[eventId];
  if (!event || event.triggered || event.posted || event.cancelled) return;

  if (expiryTimers[eventId]) { clearTimeout(expiryTimers[eventId]); delete expiryTimers[eventId]; }

  event.triggered = true;
  saveEvents(events);
  await updateMessage(client, eventId);

  const delayMs = (event.delayMinutes ?? 0) * 60 * 1000;
  if (delayMs > 0) {
    delayTimers[eventId] = setTimeout(() => {
      delete delayTimers[eventId];
      postHandpickList(client, eventId);
    }, delayMs);
  } else {
    await postHandpickList(client, eventId);
  }
}

// ── Reset trigger (vote count dropped below threshold) ───────────────────────
async function resetTrigger(client, eventId) {
  const event = events[eventId];
  if (!event || !event.triggered || event.posted || event.cancelled) return;
  if (delayTimers[eventId]) { clearTimeout(delayTimers[eventId]); delete delayTimers[eventId]; }
  event.triggered = false;
  saveEvents(events);
  await updateMessage(client, eventId);
  // Restart expiry timer if there's a deadline
  scheduleExpiry(client, eventId);
}

// ── Schedule deadline expiry ──────────────────────────────────────────────────
function scheduleExpiry(client, eventId) {
  const event = events[eventId];
  if (!event || !event.expiresAt) return;
  if (expiryTimers[eventId]) clearTimeout(expiryTimers[eventId]);
  const remaining = event.expiresAt - Date.now();
  if (remaining <= 0) {
    cancelEvent(client, eventId, 'deadline');
    return;
  }
  expiryTimers[eventId] = setTimeout(() => {
    delete expiryTimers[eventId];
    cancelEvent(client, eventId, 'deadline');
  }, remaining);
}

// ── Cancel event (deadline or manual) ────────────────────────────────────────
async function cancelEvent(client, eventId, reason) {
  const event = events[eventId];
  if (!event || event.posted || event.cancelled) return;
  if (delayTimers[eventId])  { clearTimeout(delayTimers[eventId]);  delete delayTimers[eventId]; }
  if (expiryTimers[eventId]) { clearTimeout(expiryTimers[eventId]); delete expiryTimers[eventId]; }
  if (autoTimers[eventId])   { clearTimeout(autoTimers[eventId]);   delete autoTimers[eventId]; }
  event.cancelled = true;
  saveEvents(events);
  await updateMessage(client, eventId);
  if (reason === 'deadline') {
    try {
      const ch = await client.channels.fetch(event.channelId);
      await ch.send({ embeds: [new EmbedBuilder()
        .setTitle('⏰ Event Expired')
        .setDescription(`**"${event.title}"** didn't reach **${event.threshold}** votes before the deadline and has been removed.`)
        .setColor(0xff9900).setTimestamp()
      ]});
    } catch {}
  }
}

// ── 3-hour auto-reset ─────────────────────────────────────────────────────────
function scheduleAutoReset(client, eventId) {
  if (autoTimers[eventId]) clearTimeout(autoTimers[eventId]);
  const event = events[eventId];
  if (!event) return;
  const elapsed   = event.createdAt ? Date.now() - event.createdAt : 0;
  const remaining = Math.max(0, EVENT_AUTO_MS - elapsed);
  autoTimers[eventId] = setTimeout(async () => {
    delete autoTimers[eventId];
    const ev = events[eventId];
    if (!ev) return;
    if (delayTimers[eventId])  { clearTimeout(delayTimers[eventId]);  delete delayTimers[eventId]; }
    if (expiryTimers[eventId]) { clearTimeout(expiryTimers[eventId]); delete expiryTimers[eventId]; }
    delete events[eventId];
    saveEvents(events);
    try {
      const ch = await client.channels.fetch(ev.channelId);
      await ch.send({ embeds: [new EmbedBuilder()
        .setTitle('⏰ Event Removed')
        .setDescription(`**"${ev.title}"** has been automatically removed after 3 hours.`)
        .setColor(0xff9900).setTimestamp()
      ]});
    } catch {}
  }, remaining);
}

// ── Slash commands ────────────────────────────────────────────────────────────
const eventCommands = [
  new SlashCommandBuilder()
    .setName('schedule_event')
    .setDescription('Host: Post an event embed — react ✅ to vote, fires a handpick list when threshold is reached')
    .addStringOption(o => o.setName('title').setDescription('Event title shown in the embed').setRequired(true))
    .addStringOption(o => o.setName('preset').setDescription('Preset to post as a handpick list when threshold is hit').setRequired(true))
    .addIntegerOption(o => o.setName('threshold').setDescription('Number of ✅ reactions needed to fire the list').setRequired(true).setMinValue(1))
    .addStringOption(o => o.setName('deadline').setDescription('How long the event stays open — format: 1d, 2h, 30m, or combined (e.g. 1h 30m)'))
    .addIntegerOption(o => o.setName('delay').setDescription('Minutes to wait after threshold before posting the list (default: 0)').setMinValue(0))
    .addIntegerOption(o => o.setName('list_expiry').setDescription('Minutes before the posted handpick list locks for new claims').setMinValue(1))
    .addBooleanOption(o => o.setName('event_ping').setDescription('Ping the event role when the list fires'))
    .addStringOption(o => o.setName('description').setDescription('Optional description shown in the event embed'))
    .toJSON(),

  new SlashCommandBuilder()
    .setName('list_events')
    .setDescription('Show all active events for this server')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('remove_event')
    .setDescription('Admin: Remove an active event')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('exclude_event')
    .setDescription('Admin: Exclude a user\'s vote from an event\'s reaction count')
    .addUserOption(o => o.setName('user').setDescription('User to exclude').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason for exclusion').setRequired(true))
    .toJSON(),
];

// ── Setup ─────────────────────────────────────────────────────────────────────
function setupEvents(client) {

  // Resume timers on restart
  client.once('ready', () => {
    events = loadEvents();
    for (const [eventId, event] of Object.entries(events)) {
      if (event.cancelled || event.posted) continue;
      if (event.triggered) {
        // Resume delay countdown
        const delayMs = (event.delayMinutes ?? 0) * 60 * 1000;
        if (delayMs > 0) {
          delayTimers[eventId] = setTimeout(() => {
            delete delayTimers[eventId];
            postHandpickList(client, eventId);
          }, delayMs);
        } else {
          postHandpickList(client, eventId);
        }
      } else {
        scheduleExpiry(client, eventId);
      }
      scheduleAutoReset(client, eventId);
    }
    console.log(`📅 Resumed ${Object.keys(events).length} event(s)`);
  });

  // ── Commands ────────────────────────────────────────────────────────────────
  client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    const { commandName, guildId } = interaction;

    // ── /schedule_event ───────────────────────────────────────────────────────
    if (commandName === 'schedule_event') {
      if (!isHost(interaction.member)) return denyHost(interaction);

      const title        = interaction.options.getString('title');
      const presetName   = interaction.options.getString('preset');
      const threshold    = interaction.options.getInteger('threshold');
      const deadlineStr  = interaction.options.getString('deadline')    ?? null;
      const delayMinutes = interaction.options.getInteger('delay')      ?? 0;
      const listExpiryM  = interaction.options.getInteger('list_expiry') ?? null;
      const eventPing    = interaction.options.getBoolean('event_ping') ?? false;
      const description  = interaction.options.getString('description') ?? null;

      // Validate preset
      const presets = loadPresets();
      if (!presets[guildId]?.[presetName]) {
        return interaction.reply({ content: `❌ No preset named **"${presetName}"** found. Check \`/list_presets\`.`, ephemeral: true });
      }

      let expiresAt = null;
      if (deadlineStr) {
        const ms = parseDuration(deadlineStr);
        if (!ms) return interaction.reply({ content: '❌ Invalid deadline format. Use `1d`, `2h`, `30m`, or combined like `1h 30m`.', ephemeral: true });
        expiresAt = Date.now() + ms;
      }

      const eventId = `${guildId}_${Date.now()}`;
      const event = {
        id:           eventId,
        guildId,
        channelId:    interaction.channelId,
        hostId:       interaction.user.id,
        title,
        preset:       presetName,
        threshold,
        delayMinutes,
        expiresAt,
        listExpiryMs: listExpiryM ? listExpiryM * 60 * 1000 : null,
        pingEvent:    eventPing,
        pingRole:     null, // resolved at post time from EVENT_PING_ROLE_ID if eventPing
        description,
        currentVotes: 0,
        exclusions:   {},
        triggered:    false,
        posted:       false,
        cancelled:    false,
        createdAt:    Date.now(),
        messageId:    null,
      };

      events[eventId] = event;
      saveEvents(events);

      const msg = await interaction.reply({
        embeds:     [buildEmbed(event)],
        fetchReply: true,
      });

      event.messageId = msg.id;
      saveEvents(events);

      // Bot reacts with ✅ to seed the reaction
      try { await msg.react(VOTE_EMOJI); } catch {}

      scheduleExpiry(client, eventId);
      scheduleAutoReset(client, eventId);
      return;
    }

    // ── /list_events ──────────────────────────────────────────────────────────
    if (commandName === 'list_events') {
      const guildEvents = Object.entries(events)
        .filter(([, e]) => e.guildId === guildId && !e.cancelled)
        .sort(([, a], [, b]) => (a.createdAt ?? 0) - (b.createdAt ?? 0));

      if (guildEvents.length === 0) return interaction.reply({ content: '📅 No active events.' });

      const desc = guildEvents.map(([, e]) => {
        const status = e.posted ? '✅ Posted' : e.triggered ? '⏳ Triggered' : '👀 Watching';
        const parts  = [`**${e.title}**`, status, `${e.currentVotes ?? 0}/${e.threshold} votes`, `📋 ${e.preset}`];
        if (e.expiresAt) parts.push(`⏰ <t:${Math.floor(e.expiresAt / 1000)}:R>`);
        return parts.join(' · ');
      }).join('\n\n');

      return interaction.reply({ embeds: [new EmbedBuilder()
        .setTitle('📅 Active Events')
        .setDescription(desc)
        .setColor(0x5865f2)
        .setFooter({ text: `${guildEvents.length} event(s)` })
      ]});
    }

    // ── /remove_event ─────────────────────────────────────────────────────────
    if (commandName === 'remove_event') {
      if (!isAdmin(interaction.member)) return denyAdmin(interaction);
      const guildEvents = Object.entries(events).filter(([, e]) => e.guildId === guildId && !e.posted && !e.cancelled);
      if (guildEvents.length === 0) return interaction.reply({ content: '❌ No active events to remove.', ephemeral: true });

      if (guildEvents.length === 1) {
        const [eventId, event] = guildEvents[0];
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`event_remove_confirm__${eventId}`).setLabel(`Yes, remove "${event.title.slice(0,40)}"`).setStyle(ButtonStyle.Danger).setEmoji('🗑️'),
          new ButtonBuilder().setCustomId('event_remove_abort').setLabel('Cancel').setStyle(ButtonStyle.Secondary).setEmoji('✖️'),
        );
        return interaction.reply({ embeds: [new EmbedBuilder().setTitle('⚠️ Remove Event?').setDescription(`Remove **"${event.title}"**?`).setColor(0xff4444)], components: [row] });
      }

      const opts = guildEvents.map(([id, e]) => ({
        label:       e.title.slice(0, 100),
        description: `${e.currentVotes ?? 0}/${e.threshold} votes · 📋 ${e.preset}`,
        value:       id,
      }));
      const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`event_remove_pick__${interaction.user.id}`)
          .setPlaceholder('Choose an event to remove...')
          .addOptions(opts)
      );
      return interaction.reply({ content: '🗑️ Which event do you want to remove?', components: [row] });
    }

    // ── /exclude_event ────────────────────────────────────────────────────────
    if (commandName === 'exclude_event') {
      if (!isAdmin(interaction.member)) return denyAdmin(interaction);
      const guildEvents = Object.entries(events).filter(([, e]) => e.guildId === guildId && !e.posted && !e.cancelled);
      if (guildEvents.length === 0) return interaction.reply({ content: '❌ No active events.', ephemeral: true });

      const targetUser = interaction.options.getUser('user');
      const reason     = interaction.options.getString('reason');

      for (const [eventId, event] of guildEvents) {
        if (!event.exclusions) event.exclusions = {};
        event.exclusions[targetUser.id] = { reason, excludedBy: interaction.user.id, timestamp: Date.now() };
        // Recalculate votes
        const count = await getVoteCount(client, eventId);
        event.currentVotes = count;
        if (event.triggered && count < event.threshold) await resetTrigger(client, eventId);
      }
      saveEvents(events);

      return interaction.reply({ embeds: [new EmbedBuilder()
        .setTitle('🚫 Vote Excluded')
        .setColor(0xff9900)
        .addFields(
          { name: '👤 User',    value: `<@${targetUser.id}>`, inline: true },
          { name: '📋 Reason',  value: reason,                inline: true },
          { name: '📋 Applied', value: `All **${guildEvents.length}** active event(s)` },
        )
        .setTimestamp()
      ]});
    }
  });

  // ── Reaction add ─────────────────────────────────────────────────────────────
  client.on('messageReactionAdd', async (reaction, user) => {
    if (user.bot) return;
    if (reaction.emoji.name !== VOTE_EMOJI) return;
    if (reaction.partial) { try { await reaction.fetch(); } catch { return; } }

    const msgId   = reaction.message.id;
    const eventId = Object.keys(events).find(id => events[id].messageId === msgId);
    if (!eventId) return;

    const event = events[eventId];
    if (!event || event.triggered || event.posted || event.cancelled) return;

    const count = await getVoteCount(client, eventId);
    event.currentVotes = count;
    saveEvents(events);
    await updateMessage(client, eventId);

    if (count >= event.threshold) await triggerEvent(client, eventId);
  });

  // ── Reaction remove ───────────────────────────────────────────────────────────
  client.on('messageReactionRemove', async (reaction, user) => {
    if (user.bot) return;
    if (reaction.emoji.name !== VOTE_EMOJI) return;
    if (reaction.partial) { try { await reaction.fetch(); } catch { return; } }

    const msgId   = reaction.message.id;
    const eventId = Object.keys(events).find(id => events[id].messageId === msgId);
    if (!eventId) return;

    const event = events[eventId];
    if (!event || event.posted || event.cancelled) return;

    const count = await getVoteCount(client, eventId);
    event.currentVotes = count;
    saveEvents(events);
    await updateMessage(client, eventId);

    if (event.triggered && count < event.threshold) await resetTrigger(client, eventId);
  });

  // ── Button handlers ───────────────────────────────────────────────────────────
  client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;
    const { customId } = interaction;

    if (customId.startsWith('event_remove_confirm__')) {
      const eventId = customId.replace('event_remove_confirm__', '');
      await cancelEvent(client, eventId, 'manual');
      delete events[eventId];
      saveEvents(events);
      return interaction.update({ content: '✅ Event removed.', embeds: [], components: [] });
    }

    if (customId === 'event_remove_abort') {
      return interaction.update({ content: '👍 Event kept.', embeds: [], components: [] });
    }
  });

  // ── Select menu handlers ──────────────────────────────────────────────────────
  client.on('interactionCreate', async interaction => {
    if (!interaction.isStringSelectMenu()) return;
    const { customId } = interaction;

    if (customId.startsWith('event_remove_pick__')) {
      const userId  = customId.replace('event_remove_pick__', '');
      if (interaction.user.id !== userId) return interaction.reply({ content: '❌ This menu is not for you.', ephemeral: true });

      const eventId = interaction.values[0];
      const event   = events[eventId];
      if (!event) return interaction.update({ content: '❌ Event not found.', components: [] });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`event_remove_confirm__${eventId}`).setLabel(`Yes, remove "${event.title.slice(0,40)}"`).setStyle(ButtonStyle.Danger).setEmoji('🗑️'),
        new ButtonBuilder().setCustomId('event_remove_abort').setLabel('Cancel').setStyle(ButtonStyle.Secondary).setEmoji('✖️'),
      );
      return interaction.update({ content: `⚠️ Remove **"${event.title}"**?`, components: [row] });
    }
  });
}

module.exports = { setupEvents, eventCommands };
