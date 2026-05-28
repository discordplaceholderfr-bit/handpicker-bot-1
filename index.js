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

// ── Make all command replies public and auto-delete confirmations ─────────────
client.on('interactionCreate', interaction => {
  const _reply = interaction.reply?.bind(interaction);
  if (!_reply) return;
  interaction.reply = async (opts) => {
    const options = typeof opts === 'string' ? { content: opts } : { ...opts };
    delete options.ephemeral;
    let msg;
    try { msg = await _reply({ ...options, fetchReply: true }); } catch { return; }
    // Only auto-delete if the reply has no buttons/dropdowns (i.e. it's a final confirmation)
    if (!options.components?.length) {
      setTimeout(() => msg?.delete?.().catch(() => {}), 12000);
    }
    return msg;
  };
});

setupHandpicker(client);
setupLeaderboard(client);
setupPresets(client);
setupTeams(client);
setupImporter(client);
setupWatcher(client);
setupGuide(client);

client.login(process.env.DISCORD_TOKEN);
