const { isHost, denyHost } = require('./permissions');

const {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} = require('discord.js');

// ─── Parser ───────────────────────────────────────────────────────────────────
// Rules:
//   Line WITHOUT colon = faction heading (max 5)
//   Line WITH colon    = "Country: anything" → only country name kept
//   Multiple entries on one line are split first
function parseHandpickText(raw) {
  // Step 1: clean and split into lines
  const lines = raw
    .split('\n')
    .map(l => {
      // Strip markdown formatting but preserve a leading * (Major country prefix)
      const hasMajor = /^\*[^*]/.test(l.trim());
      const cleaned  = l.replace(/\*\*/g,'').replace(/__/g,'').replace(/[_~`]/g,'').replace(/\*/g,'').trim();
      return hasMajor ? `*${cleaned}` : cleaned;
    })
    .filter(l => l.length > 0);

  // Step 2: handle multiple "Country: Player Country2: Player2" on one line.
  // We find every occurrence of a colon in the line and check if there's more than one.
  // If so, split at positions where a new "word(s): " pattern starts AFTER a player name ends.
  // Safe approach: if a line has 2+ colons, split on spaces that are followed by
  // a new word-sequence ending in colon where the preceding text looks like a player name
  // (i.e. after the first colon value there are non-colon words then another colon).
  const expanded = [];
  for (const line of lines) {
    const colonCount = (line.match(/:/g) || []).length;
    if (colonCount <= 1) {
      expanded.push(line);
      continue;
    }
    // Multiple colons — split into individual "Country: Player" chunks.
    // Strategy: find all positions of ":" and split between the player-name text
    // and the next country name. We tokenize by colon positions.
    // e.g. "Italy: Tonk Romania: 4cer" → colons at idx 5 and idx 19
    // Between them: " Tonk Romania" — split just before "Romania"
    // We do this by finding "text: text text: text" and splitting greedily.
    const chunks = [];
    let remaining = line;
    while (remaining.length > 0) {
      // Find the first colon
      const ci = remaining.indexOf(':');
      if (ci === -1) { chunks.push(remaining.trim()); break; }
      const country  = remaining.slice(0, ci).trim();
      const rest     = remaining.slice(ci + 1).trim(); // everything after first colon
      // Find where the next country starts: a word boundary before the next colon's country portion.
      // Look for the last space before the next colon that separates player from next country.
      const nextCi = rest.indexOf(':');
      if (nextCi === -1) {
        // No more colons — rest is just the player name
        chunks.push(country + ': ' + rest);
        break;
      }
      // nextCi found — the text before it in "rest" is "PlayerName NextCountry"
      // We need to find where PlayerName ends and NextCountry begins.
      // NextCountry is the last "word group" before nextCi in rest.
      const beforeNextColon = rest.slice(0, nextCi); // e.g. "Tonk Romania"
      const spaceIdx = beforeNextColon.lastIndexOf(' ');
      if (spaceIdx === -1) {
        // No space — can't split, treat whole thing as one
        chunks.push(remaining.trim());
        break;
      }
      const playerName   = beforeNextColon.slice(0, spaceIdx).trim();
      const nextCountry  = beforeNextColon.slice(spaceIdx + 1).trim();
      chunks.push(country + ': ' + playerName);
      remaining = nextCountry + ':' + rest.slice(nextCi + 1);
    }
    for (const c of chunks) { if (c.trim()) expanded.push(c.trim()); }
  }

  // Step 3: parse expanded lines
  const factions     = {};
  const factionOrder = [];
  let   current      = null;

  for (const line of expanded) {
    const colonIdx = line.indexOf(':');

    if (colonIdx === -1) {
      // No colon → FACTION HEADING
      if (factionOrder.length >= 5) continue;
      const name = line.trim();
      if (!name || factions[name]) continue;
      factions[name] = { countries: [] };
      factionOrder.push(name);
      current = name;
    } else {
      // Has colon → COUNTRY entry (ignore everything after colon)
      if (!current) continue;
      const country = line.slice(0, colonIdx).trim();
      if (!country) continue;
      if (!factions[current].countries.includes(country)) {
        factions[current].countries.push(country);
      }
    }
  }

  return { factions, factionOrder };
}

// ─── Slash command ────────────────────────────────────────────────────────────
const importerCommands = [
  new SlashCommandBuilder()
    .setName('import_handpick')
    .setDescription('Paste a handpick list as text. Prefix countries with * for Major (e.g. *Prussia)')
    .toJSON(),
];

module.exports.importerCommands = importerCommands;

// ─── Setup ────────────────────────────────────────────────────────────────────
function setupImporter(client) {

  // ── /import_handpick → show modal ────────────────────────────────────────
  client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== 'import_handpick') return;

    try {
      if (!isHost(interaction.member)) return denyHost(interaction);
      const modal = new ModalBuilder()
        .setCustomId('import_modal')
        .setTitle('Import Handpick List');

      const titleInput = new TextInputBuilder()
        .setCustomId('handpick_title')
        .setLabel('List Title')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('e.g. Europe 1936, WW1, Napoleonic Wars')
        .setRequired(true)
        .setMaxLength(100);

      const textInput = new TextInputBuilder()
        .setCustomId('handpick_text')
        .setLabel('Faction (no colon) / Country: Player')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Faction Name\nCountry: Player\nCountry2: Player\n\nFaction 2\nCountry3: Player')
        .setRequired(true)
        .setMaxLength(4000);

      modal.addComponents(
        new ActionRowBuilder().addComponents(titleInput),
        new ActionRowBuilder().addComponents(textInput),
      );
      await interaction.showModal(modal);
    } catch (err) {
      console.error('import_handpick command error:', err);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: `❌ Error: ${err.message}`, ephemeral: true }).catch(() => {});
      }
    }
  });

  // ── Modal submit → parse and build list ───────────────────────────────────
  client.on('interactionCreate', async interaction => {
    if (!interaction.isModalSubmit()) return;
    if (interaction.customId !== 'import_modal') return;

    try {
      await interaction.deferReply();

      const title = interaction.fields.getTextInputValue('handpick_title') || 'Imported Handpick List';
      const raw   = interaction.fields.getTextInputValue('handpick_text');
      const { factions, factionOrder } = parseHandpickText(raw);

      // Validation
      if (factionOrder.length === 0) {
        return interaction.editReply('❌ No factions detected. Faction names must be on their own line with **no colon**. Countries must have a colon e.g. `Germany: Player`');
      }
      if (factionOrder.every(f => factions[f].countries.length === 0)) {
        return interaction.editReply('❌ No countries detected. Countries must have a colon e.g. `Germany: Player` or `Germany:`');
      }

      const { buildEmbedFromGame, buildComponentsFromGame, saveGame, postUnclaimMessage } = require('./handpicker');
      const guildId      = interaction.guildId;
      const gameId       = `${guildId}_${Date.now()}`;
      const gameFactions = {};

      for (const name of factionOrder) {
        gameFactions[name] = { countries: factions[name].countries, claims: {} };
      }

      const game = {
        title,
        host:      interaction.user.id,
        guildId,
        channelId: interaction.channelId,
        factions:  gameFactions,
      };

      // Preview embed
      let previewText = '';
      for (const name of factionOrder) {
        const countries = factions[name].countries;
        previewText += `**${name}** (${countries.length})\n${countries.join(', ')}\n\n`;
      }
      if (previewText.length > 2000) previewText = previewText.slice(0, 2000) + '...';

      const totalCountries = factionOrder.reduce((s, f) => s + factions[f].countries.length, 0);
      const previewEmbed   = new EmbedBuilder()
        .setTitle(`✅ Detected "${title}"`)
        .setDescription(previewText)
        .setFooter({ text: `${factionOrder.length} factions · ${totalCountries} countries` })
        .setColor(0x57f287);

      await interaction.editReply({ embeds: [previewEmbed] });

      // Live handpick list
      const listMsg = await interaction.followUp({
        embeds:     [buildEmbedFromGame(game)],
        components: [buildComponentsFromGame(game, gameId)].flat(),
      });
      game.messageId = listMsg.id;
      await postUnclaimMessage(interaction.channel, game, gameId);
      saveGame(gameId, game);

    } catch (err) {
      console.error('import_modal submit error:', err);
      const msg = `❌ Something went wrong: ${err.message}`;
      if (interaction.deferred) {
        await interaction.editReply(msg).catch(() => {});
      } else {
        await interaction.reply({ content: msg, ephemeral: true }).catch(() => {});
      }
    }
  });
}

module.exports = { setupImporter, importerCommands };