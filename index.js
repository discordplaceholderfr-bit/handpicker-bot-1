require('dotenv').config();
const { Client, GatewayIntentBits, Partials, REST, Routes } = require('discord.js');
const { setupHandpicker, handpickerCommands } = require('./handpicker');
const { setupLeaderboard, leaderboardCommands } = require('./leaderboard');
const { setupPresets, presetCommands } = require('./presets');
const { setupTeams, teamCommands } = require('./teams');
const { setupImporter, importerCommands } = require('./importer');
const { setupGuide, guideCommands } = require('./guide');
const { setupResults, resultsCommands } = require('./results');
const { setupSetup, setupCommands } = require('./setup');
const { initAuditLog } = require('./auditlog');
const lock = require('./lock');

process.setMaxListeners(100);

// Keep the bot alive on unexpected errors instead of crashing the whole process.
// A single bad interaction handler should never take the bot down.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});

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
    ...guideCommands,
    ...resultsCommands,
    ...setupCommands,
    // Guild-installable, guild-only context so the bot can be added to any server
  ].map(c => ({ ...c, integration_types: [0], contexts: [0] }));

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    // Register GLOBAL commands so the bot works in every server that adds it.
    // (Global registration can take up to ~1h to propagate the first time.)
    await rest.put(Routes.applicationCommands(readyClient.user.id), { body: allCommands });
    console.log(`✅ Registered ${allCommands.length} global slash commands`);

    // Safety net: older versions of this bot registered commands guild-scoped
    // to every server it was in. Those were never cleared when we switched to
    // global-only, so servers the bot was already in before this show every
    // command twice (once guild-scoped, once global). Clearing is idempotent —
    // a no-op on guilds that never had guild commands — so it's safe to run
    // on every boot rather than a one-off script.
    for (const guild of readyClient.guilds.cache.values()) {
      try {
        await rest.put(Routes.applicationGuildCommands(readyClient.user.id, guild.id), { body: [] });
      } catch (err) {
        console.error(`Failed to clear guild-scoped commands for ${guild.id}:`, err);
      }
    }
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

// Returns true if the message should be treated as a persistent embed
// (handpick lists identified by claim__/unclaim__ customIds, or watcher active embeds)
function isPersistentEmbed(options) {
  if (isHandpickList(options?.components)) return true;
  const embeds = options?.embeds || [];
  return embeds.some(e => {
    const title = e?.data?.title ?? e?.title ?? '';
    return title.startsWith('📅') || title.includes('Server Rankings') || title.includes('Event Results') || title.includes('Event Over');
  });
}

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

      // Ephemeral replies are user-only and auto-dismiss — pass through untouched
      if (options.ephemeral) {
        try { return await _reply(options); } catch { return; }
      }

      let msg;
      try { msg = await _reply({ ...options, fetchReply: true }); } catch { return; }

      if (isPersistentEmbed(options)) {
        // Persistent embed (handpick list or watcher active) — no auto-delete
      } else if (!options.components?.length) {
        // No components — final reply, delete after 12s
        setTimeout(() => msg?.delete?.().catch(() => {}), FINAL_DELETE_MS);
      } else {
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

      if (isPersistentEmbed(options)) {
        // Persistent embed (handpick list or watcher active) — cancel any old timer, no auto-delete
        if (prevMsgId) cancelExpiry(prevMsgId);
      } else if (!options.components?.length) {
        // Reached final state — cancel old timer, delete after 12s
        if (prevMsgId) cancelExpiry(prevMsgId);
        setTimeout(() => msg?.delete?.().catch(() => {}), FINAL_DELETE_MS);
      } else {
        // Still interactive — reset the 5-min timer on the same message
        const msgId = msg?.id || prevMsgId;
        if (msgId) armExpiry(msgId, () => msg?.delete?.().catch(() => {}));
      }
      return msg;
    };
  }
});

initAuditLog(client);
setupHandpicker(client);
setupLeaderboard(client);
setupPresets(client);
setupTeams(client);
setupImporter(client);
setupGuide(client);
setupResults(client);
setupSetup(client);

// Acquire the single-instance lock BEFORE connecting, so only one copy of the
// bot is ever on the gateway (prevents double reactions / double posts / double
// role assignments during Railway redeploys).
(async () => {
  await lock.acquire();
  await client.login(process.env.DISCORD_TOKEN);
})();
