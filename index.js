require('dotenv').config();
const { Client, GatewayIntentBits, Partials, REST, Routes } = require('discord.js');
const { setupHandpicker, handpickerCommands } = require('./handpicker');
const { setupLeaderboard, leaderboardCommands } = require('./leaderboard');
const { setupPresets, presetCommands } = require('./presets');
const { setupTeams, teamCommands } = require('./teams');
const { setupImporter, importerCommands } = require('./importer');
const { setupWatcher, watcherCommands } = require('./pollwatcher');
const { setupGuide, guideCommands } = require('./guide');

process.setMaxListeners(100);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageReactions,
    ...(GatewayIntentBits.GuildMessagePolls ? [GatewayIntentBits.GuildMessagePolls] : []),
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

client.setMaxListeners(100);

client.once('clientReady', async (readyClient) => {
  console.log(`✅ Logged in as ${readyClient.user.tag}`);

  const allCommands = [
    ...handpickerCommands,
    ...leaderboardCommands,
    ...presetCommands,
    ...teamCommands,
    ...importerCommands,
    ...watcherCommands,
    ...guideCommands,
  ];

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    // ── Clear global commands (removes duplicates from old versions) ──────────
    await rest.put(Routes.applicationCommands(readyClient.user.id), { body: [] });
    console.log('✅ Cleared global commands (no more duplicates)');

    // ── Register guild commands (instant, per server) ─────────────────────────
    const guilds = readyClient.guilds.cache;
    console.log(`📡 Registering ${allCommands.length} commands to ${guilds.size} server(s)...`);
    for (const [guildId] of guilds) {
      await rest.put(Routes.applicationGuildCommands(readyClient.user.id, guildId), { body: allCommands });
    }
    console.log(`✅ Registered ${allCommands.length} slash commands to all servers`);
  } catch (err) {
    console.error('Failed to register commands:', err);
  }
});

// ── Message expiry tracker ────────────────────────────────────────────────────
// Tracks interactive messages (with components) so they auto-delete after 5
// minutes of no interaction. Handpick list embeds are excluded — they use the
// 3-hour game reset timer instead.
const messageTimers = new Map();
const COMMAND_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
const FINAL_DELETE_MS   = 12 * 1000;     // 12 seconds for final/no-component replies

// Returns true if the components belong to an actual handpick list embed
// (identified by claim__ or unclaim__ customIds — those are managed separately)
function isHandpickList(components) {
  if (!components?.length) return false;
  try {
    const json = JSON.stringify(components);
    return json.includes('"unclaim__') || json.includes('"claim__');
  } catch { return false; }
}

// Arm or reset the 5-minute expiry timer for a message
function armExpiry(msgId, deleteFn) {
  const existing = messageTimers.get(msgId);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    messageTimers.delete(msgId);
    deleteFn();
  }, COMMAND_EXPIRY_MS);
  messageTimers.set(msgId, timer);
}

// Cancel the expiry timer for a message (used when it transitions to a final state)
function cancelExpiry(msgId) {
  const existing = messageTimers.get(msgId);
  if (existing) { clearTimeout(existing); messageTimers.delete(msgId); }
}

// ── Patch interaction.reply and interaction.update ────────────────────────────
client.on('interactionCreate', interaction => {
  // ── Patch reply ─────────────────────────────────────────────────────────────
  const _reply = interaction.reply?.bind(interaction);
  if (_reply) {
    interaction.reply = async (opts) => {
      const options = typeof opts === 'string' ? { content: opts } : { ...opts };
      delete options.ephemeral;
      let msg;
      try { msg = await _reply({ ...options, fetchReply: true }); } catch { return; }

      if (!options.components?.length) {
        // No components — final reply, delete after 12s
        setTimeout(() => msg?.delete?.().catch(() => {}), FINAL_DELETE_MS);
      } else if (!isHandpickList(options.components)) {
        // Interactive command message — arm 5-min expiry
        armExpiry(msg.id, () => msg.delete().catch(() => {}));
      }
      return msg;
    };
  }

  // ── Patch update (component interactions only) ──────────────────────────────
  const _update = interaction.update?.bind(interaction);
  if (_update) {
    interaction.update = async (opts) => {
      const options = typeof opts === 'string' ? { content: opts } : { ...opts };
      const prevMsgId = interaction.message?.id;
      let msg;
      try { msg = await _update({ ...options, fetchReply: true }); } catch { return; }

      if (!options.components?.length) {
        // Reached final state — cancel old timer, delete after 12s
        if (prevMsgId) cancelExpiry(prevMsgId);
        setTimeout(() => msg?.delete?.().catch(() => {}), FINAL_DELETE_MS);
      } else if (!isHandpickList(options.components)) {
        // Still interactive — reset the 5-min timer on the same message
        const msgId = msg?.id || prevMsgId;
        if (msgId) armExpiry(msgId, () => msg?.delete?.().catch(() => {}));
      }
      return msg;
    };
  }
});

setupHandpicker(client);
setupLeaderboard(client);
setupPresets(client);
setupTeams(client);
setupImporter(client);
setupWatcher(client);
setupGuide(client);

client.login(process.env.DISCORD_TOKEN);
