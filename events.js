const { isHost, denyHost, isAdmin, denyAdmin } = require('./permissions');
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
const EVENTS_FILE  = path.join(DATA_DIR, 'events.json');
const PRESETS_FILE = path.join(DATA_DIR, 'presets.json');
const TEAMS_FILE   = path.join(DATA_DIR, 'teams.json');

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

let events = loadEvents();

const warningTimers  = {};
const deadlineTimers = {};
const cleanupTimers  = {};

// ── Parse "YYYY-MM-DD HH:MM" → unix ms ───────────────────────────────────────
function parseDateTime(str) {
  const m = str.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/);
  if (!m) return null;
  const ts = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime();
  return isNaN(ts) ? null : ts;
}

// ── Build the event embed ─────────────────────────────────────────────────────
function buildEmbed(event) {
  const joined   = event.joined   || [];
  const declined = event.declined || [];

  let statusVal;
  if (event.cancelled)   statusVal = '🚫 Cancelled';
  else if (event.fired)  statusVal = '✅ Started — list posted!';
  else {
    const cap = event.cap ? `/${event.cap}` : '';
    statusVal = `${joined.length}${cap} joined`;
  }

  const joinedStr = joined.length
    ? joined.slice(0, 25).map(id => `<@${id}>`).join(', ') + (joined.length > 25 ? ` +${joined.length - 25} more` : '')
    : '*No one yet*';

  const fields = [
    { name: '📅 When',    value: `<t:${Math.floor(event.datetime / 1000)}:F>  (<t:${Math.floor(event.datetime / 1000)}:R>)`, inline: false },
    { name: '👥 Players', value: statusVal, inline: true },
  ];
  if (event.preset)      fields.push({ name: '📋 Preset',      value: `"${event.preset}"`,      inline: true });
  if (event.minPlayers)  fields.push({ name: '⚠️ Min Players', value: `${event.minPlayers}`,    inline: true });
  if (event.description) fields.push({ name: '📝 Description', value: event.description });
  fields.push({ name: `✅ Joining (${joined.length})`, value: joinedStr });

  return new EmbedBuilder()
    .setTitle(`📅 ${event.title}`)
    .setColor(event.cancelled ? 0x888888 : event.fired ? 0x57f287 : 0x5865f2)
    .addFields(fields)
    .setFooter({ text: `Hosted by ${event.hostTag}` })
    .setTimestamp(event.datetime);
}

function buildButtons(eventId, disabled = false) {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`event_join__${eventId}`).setLabel('Join').setStyle(ButtonStyle.Success).setEmoji('✅').setDisabled(disabled),
    new ButtonBuilder().setCustomId(`event_leave__${eventId}`).setLabel("Leave").setStyle(ButtonStyle.Secondary).setEmoji('↩️').setDisabled(disabled),
    new ButtonBuilder().setCustomId(`event_decline__${eventId}`).setLabel("Can't Make It").setStyle(ButtonStyle.Danger).setEmoji('❌').setDisabled(disabled),
  )];
}

// ── Update the event message in-place ────────────────────────────────────────
async function updateMessage(client, eventId) {
  const event = events[eventId];
  if (!event?.messageId) return;
  try {
    const ch  = await client.channels.fetch(event.channelId);
    const msg = await ch.messages.fetch(event.messageId);
    const done = event.cancelled || event.fired;
    await msg.edit({ embeds: [buildEmbed(event)], components: done ? [] : buildButtons(eventId) });
  } catch {}
}

// ── Post the handpick list (reuses watcher logic) ────────────────────────────
async function postHandpickList(client, event) {
  const presets = loadPresets();
  const preset  = presets[event.guildId]?.[event.preset];
  if (!preset) return false;

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

  const ch  = await client.channels.fetch(event.channelId);
  if (event.pingRole) await ch.send(`<@&${event.pingRole}>`);

  const msg = await ch.send({ embeds: [buildEmbedFromGame(game)], components: buildComponentsFromGame(game, gameId) });
  game.messageId = msg.id;
  saveGame(gameId, game);

  if (event.listExpiryMs) scheduleListExpiry(client, gameId, event.listExpiryMs);
  return true;
}

// ── Fire the event (RSVP cap hit or deadline reached) ────────────────────────
async function fireEvent(client, eventId) {
  const event = events[eventId];
  if (!event || event.fired || event.cancelled) return;

  // Clear pending timers
  if (warningTimers[eventId])  { clearTimeout(warningTimers[eventId]);  delete warningTimers[eventId]; }
  if (deadlineTimers[eventId]) { clearTimeout(deadlineTimers[eventId]); delete deadlineTimers[eventId]; }

  event.fired = true;
  saveEvents(events);
  await updateMessage(client, eventId);

  try {
    const ch = await client.channels.fetch(event.channelId);
    if (event.preset) {
      const ok = await postHandpickList(client, event);
      if (!ok) await ch.send(`❌ Preset **"${event.preset}"** no longer exists. Could not post the handpick list.`);
    } else {
      const pingText = event.pingRole ? `<@&${event.pingRole}> ` : '';
      await ch.send(`${pingText}🎮 **${event.title}** is starting now!`);
    }
  } catch (e) { console.error('fireEvent error:', e.message); }

  // Auto-cleanup 3 hours later
  scheduleCleanup(eventId, 3 * 60 * 60 * 1000);
}

// ── Schedule warning + deadline timers ───────────────────────────────────────
function scheduleTimers(client, eventId) {
  const event = events[eventId];
  if (!event || event.cancelled || event.fired) return;

  const now = Date.now();

  // Warning ping
  if (warningTimers[eventId]) clearTimeout(warningTimers[eventId]);
  if (event.warningMinutes) {
    const warnIn = (event.datetime - event.warningMinutes * 60 * 1000) - now;
    if (warnIn > 0) {
      warningTimers[eventId] = setTimeout(async () => {
        delete warningTimers[eventId];
        const ev = events[eventId];
        if (!ev || ev.cancelled || ev.fired) return;
        try {
          const ch       = await client.channels.fetch(ev.channelId);
          const pingText = ev.pingRole ? `<@&${ev.pingRole}> ` : '';
          await ch.send(`${pingText}⏰ **${ev.title}** starts in **${ev.warningMinutes} minute(s)!** — ${(ev.joined||[]).length} player(s) joined so far.`);
        } catch {}
      }, warnIn);
    }
  }

  // Deadline
  if (deadlineTimers[eventId]) clearTimeout(deadlineTimers[eventId]);
  const deadlineIn = event.datetime - now;
  if (deadlineIn > 0) {
    deadlineTimers[eventId] = setTimeout(async () => {
      delete deadlineTimers[eventId];
      const ev = events[eventId];
      if (!ev || ev.cancelled || ev.fired) return;

      const joinedCount = (ev.joined || []).length;
      const min         = ev.minPlayers || 0;

      if (min > 0 && joinedCount < min) {
        // Not enough players — auto-cancel
        ev.cancelled = true;
        saveEvents(events);
        await updateMessage(client, eventId);
        try {
          const ch = await client.channels.fetch(ev.channelId);
          await ch.send({ embeds: [new EmbedBuilder()
            .setTitle('❌ Event Cancelled — Not Enough Players')
            .setDescription(`**${ev.title}** only reached **${joinedCount}/${min}** minimum players and has been auto-cancelled.`)
            .setColor(0xff4444).setTimestamp()
          ]});
        } catch {}
        try {
          const host = await client.users.fetch(ev.hostId);
          await host.send(`❌ Your event **"${ev.title}"** was auto-cancelled — only ${joinedCount}/${min} minimum players joined.`);
        } catch {}
        scheduleCleanup(eventId, 3 * 60 * 60 * 1000);
      } else {
        await fireEvent(client, eventId);
      }
    }, deadlineIn);
  } else if (!event.fired) {
    // Already past deadline on bot restart — fire immediately if not fired
    fireEvent(client, eventId);
  }
}

function scheduleCleanup(eventId, delayMs) {
  if (cleanupTimers[eventId]) clearTimeout(cleanupTimers[eventId]);
  cleanupTimers[eventId] = setTimeout(() => {
    delete cleanupTimers[eventId];
    delete events[eventId];
    saveEvents(events);
  }, delayMs);
}

// ── Slash commands ────────────────────────────────────────────────────────────
const eventCommands = [
  new SlashCommandBuilder()
    .setName('schedule_event')
    .setDescription('Host: Schedule an event with RSVP tracking — auto-posts a handpick list when it fires')
    .addStringOption(o => o.setName('title').setDescription('Event title').setRequired(true))
    .addStringOption(o => o.setName('datetime').setDescription('When the event starts — format: YYYY-MM-DD HH:MM (e.g. 2025-06-15 20:00)').setRequired(true))
    .addIntegerOption(o => o.setName('cap').setDescription('Max players — fires the list instantly when reached (optional)').setMinValue(1))
    .addStringOption(o => o.setName('preset').setDescription('Preset to post as a handpick list when the event fires (optional)'))
    .addIntegerOption(o => o.setName('min_players').setDescription('Minimum RSVPs needed — auto-cancels if not reached by start time (optional)').setMinValue(1))
    .addIntegerOption(o => o.setName('warning_minutes').setDescription('Send a warning ping X minutes before start (optional)').setMinValue(1))
    .addIntegerOption(o => o.setName('list_expiry').setDescription('Minutes before the posted handpick list locks for new claims (optional)').setMinValue(1))
    .addRoleOption(o => o.setName('ping_role').setDescription('Role to ping when the list fires (optional)'))
    .addStringOption(o => o.setName('description').setDescription('Optional description shown in the event embed'))
    .toJSON(),

  new SlashCommandBuilder()
    .setName('cancel_event')
    .setDescription('Host: Cancel a scheduled event')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('list_events')
    .setDescription('Show all upcoming scheduled events for this server')
    .toJSON(),
];

// ── Setup ─────────────────────────────────────────────────────────────────────
function setupEvents(client) {

  // Resume timers on bot restart
  client.once('ready', () => {
    events = loadEvents();
    for (const [eventId, event] of Object.entries(events)) {
      if (!event.cancelled && !event.fired) {
        scheduleTimers(client, eventId);
      }
    }
    console.log(`📅 Resumed ${Object.keys(events).length} event(s)`);
  });

  client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    const { commandName, guildId } = interaction;

    // ── /schedule_event ───────────────────────────────────────────────────────
    if (commandName === 'schedule_event') {
      if (!isHost(interaction.member)) return denyHost(interaction);

      const title          = interaction.options.getString('title');
      const datetimeStr    = interaction.options.getString('datetime');
      const cap            = interaction.options.getInteger('cap')            ?? null;
      const presetName     = interaction.options.getString('preset')          ?? null;
      const minPlayers     = interaction.options.getInteger('min_players')    ?? null;
      const warningMinutes = interaction.options.getInteger('warning_minutes') ?? null;
      const listExpiryMin  = interaction.options.getInteger('list_expiry')    ?? null;
      const pingRole       = interaction.options.getRole('ping_role')         ?? null;
      const description    = interaction.options.getString('description')     ?? null;

      const datetime = parseDateTime(datetimeStr);
      if (!datetime) return interaction.reply({ content: '❌ Invalid date format. Use `YYYY-MM-DD HH:MM` — e.g. `2025-06-15 20:00`', ephemeral: true });
      if (datetime <= Date.now()) return interaction.reply({ content: '❌ That date is in the past.', ephemeral: true });

      // Validate preset if given
      if (presetName) {
        const presets = loadPresets();
        if (!presets[guildId]?.[presetName]) {
          return interaction.reply({ content: `❌ No preset named **"${presetName}"** found. Check \`/list_presets\`.`, ephemeral: true });
        }
      }

      const eventId = `${guildId}_${Date.now()}`;
      const event = {
        id:             eventId,
        guildId,
        channelId:      interaction.channelId,
        hostId:         interaction.user.id,
        hostTag:        interaction.user.username,
        title,
        description,
        datetime,
        cap,
        minPlayers,
        warningMinutes,
        listExpiryMs:   listExpiryMin ? listExpiryMin * 60 * 1000 : null,
        pingRole:       pingRole?.id ?? null,
        preset:         presetName,
        joined:         [],
        declined:       [],
        fired:          false,
        cancelled:      false,
        createdAt:      Date.now(),
        messageId:      null,
      };

      events[eventId] = event;
      saveEvents(events);

      const msg = await interaction.reply({
        embeds:     [buildEmbed(event)],
        components: buildButtons(eventId),
        fetchReply: true,
      });

      // Store message ID so we can update it later
      event.messageId = msg.id;
      saveEvents(events);

      scheduleTimers(client, eventId);
      return;
    }

    // ── /cancel_event ─────────────────────────────────────────────────────────
    if (commandName === 'cancel_event') {
      if (!isHost(interaction.member)) return denyHost(interaction);

      const guildEvents = Object.entries(events).filter(([, e]) => e.guildId === guildId && !e.cancelled && !e.fired);
      if (guildEvents.length === 0) return interaction.reply({ content: '❌ No active events to cancel.', ephemeral: true });

      if (guildEvents.length === 1) {
        const [eventId, event] = guildEvents[0];
        const confirmRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`event_cancel_confirm__${eventId}`).setLabel(`Yes, cancel "${event.title.slice(0, 40)}"`).setStyle(ButtonStyle.Danger).setEmoji('🗑️'),
          new ButtonBuilder().setCustomId('event_cancel_abort').setLabel('Keep it').setStyle(ButtonStyle.Secondary).setEmoji('✖️'),
        );
        return interaction.reply({ embeds: [new EmbedBuilder()
          .setTitle('⚠️ Cancel Event?')
          .setDescription(`Cancel **"${event.title}"**? This will notify everyone who joined.`)
          .setColor(0xff4444)
        ], components: [confirmRow] });
      }

      const opts = guildEvents.map(([id, e]) => ({
        label:       e.title.slice(0, 100),
        description: `<t:${Math.floor(e.datetime / 1000)}:f> · ${(e.joined||[]).length} joined`,
        value:       id,
      }));
      const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`event_cancel_pick__${interaction.user.id}`)
          .setPlaceholder('Choose an event to cancel...')
          .addOptions(opts)
      );
      return interaction.reply({ content: '🗑️ Which event do you want to cancel?', components: [row] });
    }

    // ── /list_events ──────────────────────────────────────────────────────────
    if (commandName === 'list_events') {
      const guildEvents = Object.entries(events)
        .filter(([, e]) => e.guildId === guildId && !e.cancelled && !e.fired)
        .sort(([, a], [, b]) => a.datetime - b.datetime);

      if (guildEvents.length === 0) return interaction.reply({ content: '📅 No upcoming events scheduled.' });

      const desc = guildEvents.map(([, e]) => {
        const cap  = e.cap ? `/${e.cap}` : '';
        const line = [
          `**${e.title}**`,
          `<t:${Math.floor(e.datetime / 1000)}:F>`,
          `👥 ${(e.joined||[]).length}${cap} joined`,
          e.preset ? `📋 ${e.preset}` : null,
        ].filter(Boolean).join(' · ');
        return line;
      }).join('\n\n');

      return interaction.reply({ embeds: [new EmbedBuilder()
        .setTitle('📅 Upcoming Events')
        .setDescription(desc)
        .setColor(0x5865f2)
        .setFooter({ text: `${guildEvents.length} event(s)` })
      ]});
    }
  });

  // ── Button handlers ───────────────────────────────────────────────────────
  client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;
    const { customId } = interaction;

    // Join
    if (customId.startsWith('event_join__')) {
      const eventId = customId.replace('event_join__', '');
      const event   = events[eventId];
      if (!event || event.cancelled || event.fired) return interaction.reply({ content: '❌ This event is no longer active.', ephemeral: true });

      const userId = interaction.user.id;
      if ((event.joined || []).includes(userId)) return interaction.reply({ content: '✅ You\'re already on the list!', ephemeral: true });

      if (!event.joined)   event.joined   = [];
      if (!event.declined) event.declined = [];

      // Remove from declined if they were there
      event.declined = event.declined.filter(id => id !== userId);
      event.joined.push(userId);
      saveEvents(events);

      await interaction.reply({ content: `✅ You joined **${event.title}**!`, ephemeral: true });
      await updateMessage(client, eventId);

      // Fire if cap hit
      if (event.cap && event.joined.length >= event.cap) {
        await fireEvent(client, eventId);
      }
      return;
    }

    // Leave
    if (customId.startsWith('event_leave__')) {
      const eventId = customId.replace('event_leave__', '');
      const event   = events[eventId];
      if (!event || event.cancelled || event.fired) return interaction.reply({ content: '❌ This event is no longer active.', ephemeral: true });

      const userId = interaction.user.id;
      if (!(event.joined || []).includes(userId)) return interaction.reply({ content: "❌ You're not on the list.", ephemeral: true });

      event.joined = (event.joined || []).filter(id => id !== userId);
      saveEvents(events);

      await interaction.reply({ content: `↩️ You left **${event.title}**.`, ephemeral: true });
      await updateMessage(client, eventId);
      return;
    }

    // Can't make it
    if (customId.startsWith('event_decline__')) {
      const eventId = customId.replace('event_decline__', '');
      const event   = events[eventId];
      if (!event || event.cancelled || event.fired) return interaction.reply({ content: '❌ This event is no longer active.', ephemeral: true });

      const userId = interaction.user.id;
      if (!event.declined) event.declined = [];
      if (!event.joined)   event.joined   = [];

      event.joined   = event.joined.filter(id => id !== userId);
      if (!event.declined.includes(userId)) event.declined.push(userId);
      saveEvents(events);

      await interaction.reply({ content: `❌ Marked you as unavailable for **${event.title}**.`, ephemeral: true });
      await updateMessage(client, eventId);
      return;
    }

    // Cancel confirm
    if (customId.startsWith('event_cancel_confirm__')) {
      const eventId = customId.replace('event_cancel_confirm__', '');
      const event   = events[eventId];
      if (!event) return interaction.update({ content: '❌ Event not found.', components: [] });

      if (warningTimers[eventId])  { clearTimeout(warningTimers[eventId]);  delete warningTimers[eventId]; }
      if (deadlineTimers[eventId]) { clearTimeout(deadlineTimers[eventId]); delete deadlineTimers[eventId]; }

      event.cancelled = true;
      saveEvents(events);
      await updateMessage(client, eventId);

      // Notify everyone who joined
      const joined = event.joined || [];
      for (const uid of joined) {
        try {
          const user = await client.users.fetch(uid);
          await user.send(`❌ **${event.title}** has been cancelled by the host.`);
        } catch {}
      }

      await interaction.update({ content: `✅ **"${event.title}"** cancelled. Notified ${joined.length} player(s).`, embeds: [], components: [] });
      scheduleCleanup(eventId, 60 * 60 * 1000); // clean up in 1 hour
      return;
    }

    if (customId === 'event_cancel_abort') {
      return interaction.update({ content: '👍 Event kept.', embeds: [], components: [] });
    }
  });

  // ── Select menu handlers ──────────────────────────────────────────────────
  client.on('interactionCreate', async interaction => {
    if (!interaction.isStringSelectMenu()) return;
    const { customId } = interaction;

    if (customId.startsWith('event_cancel_pick__')) {
      const userId  = customId.replace('event_cancel_pick__', '');
      if (interaction.user.id !== userId) return interaction.reply({ content: '❌ This menu is not for you.', ephemeral: true });

      const eventId = interaction.values[0];
      const event   = events[eventId];
      if (!event) return interaction.update({ content: '❌ Event not found.', components: [] });

      const confirmRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`event_cancel_confirm__${eventId}`).setLabel(`Yes, cancel "${event.title.slice(0, 40)}"`).setStyle(ButtonStyle.Danger).setEmoji('🗑️'),
        new ButtonBuilder().setCustomId('event_cancel_abort').setLabel('Keep it').setStyle(ButtonStyle.Secondary).setEmoji('✖️'),
      );
      return interaction.update({ content: `⚠️ Cancel **"${event.title}"**? This will notify everyone who joined.`, components: [confirmRow] });
    }
  });
}

module.exports = { setupEvents, eventCommands };
