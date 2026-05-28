const { isHost, denyHost } = require('./permissions');

const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
} = require('discord.js');

// ─── Category definitions ─────────────────────────────────────────────────────
const CATEGORIES = {
  handpick: {
    label: '📋 Handpick Lists',
    description: 'Creating, managing, and deleting lists',
    color: 0x5865f2,
    fields: [
      {
        name: '`/create_handpick`',
        value: 'Create a new handpick list with a title and up to 5 factions. Each faction holds its own set of countries. After running it you\'re asked whether to pre-assign players before the list posts publicly.',
      },
      {
        name: '`/import_handpick`',
        value: 'Import a list by pasting formatted text into a popup — one country per line, with faction headers separating groups. Faster than typing everything manually.',
      },
      {
        name: '`/add_faction`',
        value: 'Add a new faction to the current active list. Provide the faction name and a comma-separated list of countries. Maximum 5 factions per list.',
      },
      {
        name: '`/remove_faction` *(Admin)*',
        value: 'Remove an entire faction and all its countries from a list. Shows a dropdown to pick the faction. If multiple lists are active, picks the list first.',
      },
      {
        name: '`/remove_nation` *(Admin)*',
        value: 'Remove a single country from a list entirely — it disappears from the embed and can no longer be claimed. Useful for last-minute roster changes.',
      },
      {
        name: '`/remove_player` *(Admin)*',
        value: 'Remove a specific player\'s claim from the list via dropdown. Shows every claimed country so you can pick which one to wipe. The country goes back to unclaimed.',
      },
      {
        name: '`/add_preset_players` *(Host)*',
        value: 'Bulk pre-assign players to countries using a text popup. Format: one entry per line — `CountryName: UserID`. Works on both live lists and newly created ones before they post.',
      },
      {
        name: '`/swap`',
        value: 'Request a country swap with another player. Both players must click **Accept** within 2 minutes for it to go through. Either side can cancel.',
      },
      {
        name: '`/delete_list` *(Admin)*',
        value: 'Delete one active handpick list. If there are multiple active lists, shows a dropdown to pick which one. Removes all claims and the list message.',
      },
      {
        name: '`/reset_list` *(Admin)*',
        value: 'Wipe **all** active handpick lists in this server at once. Asks for confirmation first.',
      },
    ],
  },

  presets: {
    label: '💾 Presets',
    description: 'Saving, loading, and editing reusable lists',
    color: 0xfee75c,
    fields: [
      {
        name: '`/save_preset` *(Host)*',
        value: 'Save a currently active handpick list as a reusable preset. Give it a name. If multiple lists are active, a dropdown lets you pick which one to save. Saves the title, factions, and all countries.',
      },
      {
        name: '`/load_preset` *(Host)*',
        value: 'Deploy a saved preset as a new handpick list. Pick from a dropdown. Team roles auto-map if your server has roles named **Team 1**, **Team 2**, etc. You\'ll be asked about pre-assigning players before it posts.',
      },
      {
        name: '`/edit_preset` *(Host)*',
        value: 'Edit a saved preset without deploying it. After picking the preset you choose an action:\n• **Rename Title** — change the list title\n• **Add Countries** — append new countries to a faction\n• **Remove Countries** — delete specific countries from a faction via multi-select\n• **Add New Faction** — create a new faction with countries\n• **Remove Faction** — delete an entire faction from the preset',
      },
      {
        name: '`/list_presets`',
        value: 'Show all saved presets with their factions, country count, and save date. Includes a dropdown to preview any preset\'s full country list.',
      },
      {
        name: '`/preview_preset`',
        value: 'Pick a preset from a dropdown to see all its factions and countries before committing to loading it.',
      },
      {
        name: '`/delete_preset` *(Admin)*',
        value: 'Permanently delete a saved preset via dropdown. Cannot be undone.',
      },
      {
        name: '`/reset_presets` *(Admin)*',
        value: 'Wipe **all** saved presets for this server at once. Asks for confirmation first.',
      },
    ],
  },

  watcher: {
    label: '📊 Poll Watcher',
    description: 'Auto-posting lists when vote thresholds are hit',
    color: 0x57f287,
    fields: [
      {
        name: '`/setup_watcher` *(Admin)*',
        value: 'Watch a poll or reaction message and automatically post a handpick list when enough votes are reached. Key options:\n• **message_id** — the poll/reaction message to watch\n• **preset** — which preset to post when threshold is hit\n• **threshold** — votes needed to trigger\n• **list_expiry** — minutes before the posted list locks for claims *(default: 15)*\n• **event_ping** — optional role to ping when the list posts\n• **deadline** — optional cutoff date after which the watcher stops',
      },
      {
        name: '`/delay_watcher` *(Admin)*',
        value: 'Add extra minutes to an active watcher\'s countdown or expiry deadline. Useful when a game gets delayed.',
      },
      {
        name: '`/list_watchers` *(Admin)*',
        value: 'Show all active watchers in this server — their preset, threshold, current vote count, and deadline.',
      },
      {
        name: '`/exclude_check` *(Admin)*',
        value: 'Exclude a specific user\'s vote from the watcher count with a required reason. The exclusion is logged to **#homage-poll-log**. Use this for votes that shouldn\'t count toward the threshold.',
      },
      {
        name: '`/remove_exclusion` *(Admin)*',
        value: 'Undo an exclusion so that user\'s vote counts again toward the threshold.',
      },
      {
        name: '`/remove_watcher` *(Admin)*',
        value: 'Delete a specific watcher via dropdown. Stops it from monitoring the message.',
      },
      {
        name: '`/reset_watcher` *(Admin)*',
        value: 'Delete **all** active watchers for this server at once.',
      },
    ],
  },

  rankings: {
    label: '🏆 Rankings & Awards',
    description: 'MVPs, HMs, and the server leaderboard',
    color: 0xffd700,
    fields: [
      {
        name: '`/give_mvp` *(Host)*',
        value: 'Give MVP award(s) to a player. **1 MVP = 2 points.** Use the optional `amount` option to give up to 20 at once. Posts a public embed showing their updated total.',
      },
      {
        name: '`/give_hm` *(Host)*',
        value: 'Give Honorable Mention award(s) to a player. **1 HM = 1 point.** Same as above — optional `amount` up to 20.',
      },
      {
        name: '`/remove_mvp` *(Host)*',
        value: 'Remove MVP award(s) from a player. Specify `amount` (default 1). Can\'t go below 0.',
      },
      {
        name: '`/remove_hm` *(Host)*',
        value: 'Remove HM award(s) from a player. Specify `amount` (default 1). Can\'t go below 0.',
      },
      {
        name: '`/rankings`',
        value: 'Show the full server leaderboard ranked by score. Ties are ranked together. Includes a **Server Statistics** panel with total players, total awards, average score, and the top player.',
      },
      {
        name: '`/delete_player` *(Host)*',
        value: 'Remove a player entirely from the leaderboard via dropdown — wipes all their MVPs and HMs. Cannot be undone.',
      },
      {
        name: '`/reset_rankings` *(Admin)*',
        value: 'Wipe the **entire leaderboard** for this server. Clears all MVPs and HMs for every player. Asks for confirmation first.',
      },
    ],
  },

  teams: {
    label: '🎖️ Team Roles',
    description: 'Mapping factions to Discord roles',
    color: 0xeb459e,
    fields: [
      {
        name: 'How it works',
        value: 'When a player claims a country, the bot checks which faction that country belongs to and automatically gives them the mapped Discord role. When they unclaim, the role is removed.',
      },
      {
        name: 'Auto-mapping',
        value: 'When you use `/create_handpick` or `/load_preset`, the bot **automatically maps** factions to roles if your server has roles named **Team 1**, **Team 2**, **Team 3**, etc. (in order). No manual setup needed if those roles exist.',
      },
      {
        name: '`/setup_team` *(Host)*',
        value: 'Manually map a faction name to a specific Discord role. The faction name must match **exactly** as it appears in the handpick list (case-sensitive).',
      },
      {
        name: '`/list_teams`',
        value: 'Show all active faction → team role mappings for this server.',
      },
      {
        name: '`/remove_team` *(Host)*',
        value: 'Delete a specific faction → role mapping via dropdown. Players who already have the role keep it — only future claims are affected.',
      },
      {
        name: '`/clear_teams` *(Admin)*',
        value: 'Remove **all** faction → role mappings for this server at once.',
      },
    ],
  },

  admin: {
    label: '⚙️ Admin Tools',
    description: 'Blacklist, major roles, and other controls',
    color: 0xff4444,
    fields: [
      {
        name: '`/blacklist` *(Admin)*',
        value: 'Prevent a player from claiming in any handpick list. Requires three options:\n• **user** — the player to ban\n• **duration** — how long (e.g. `1d`, `2h 30m`, `30m`)\n• **reason** — displayed to the player if they try to claim\nThe ban expires automatically at the end of the duration.',
      },
      {
        name: '`/unblacklist` *(Admin)*',
        value: 'Remove a player from the blacklist early, restoring their ability to claim.',
      },
      {
        name: '`/major_role` *(Host)*',
        value: 'Toggle a role\'s ability to claim **Major** countries. Countries labelled as Major can only be claimed by players who hold an approved Major role. Run the command again on the same role to remove it from the list.',
      },
    ],
  },
};

// ─── Main embed ───────────────────────────────────────────────────────────────
function buildHomeEmbed() {
  return new EmbedBuilder()
    .setTitle('📖 Host Guide')
    .setDescription(
      'Everything hosts and admins need to run handpick events.\n\n' +
      'Use the dropdown below to browse each category.\n\n' +
      '**Categories**\n' +
      '📋 Handpick Lists — creating and managing live lists\n' +
      '💾 Presets — saving and loading reusable lists\n' +
      '📊 Poll Watcher — auto-post lists on vote thresholds\n' +
      '🏆 Rankings & Awards — MVPs, HMs, and the leaderboard\n' +
      '🎖️ Team Roles — auto-assigning Discord roles on claim\n' +
      '⚙️ Admin Tools — blacklist, major roles\n\n' +
      '*Labels show who can run each command: (Host) or (Admin).*'
    )
    .setColor(0x5865f2)
    .setFooter({ text: 'Select a category below to see detailed command info' });
}

function buildCategoryEmbed(key) {
  const cat = CATEGORIES[key];
  return new EmbedBuilder()
    .setTitle(cat.label)
    .setDescription(cat.description)
    .addFields(cat.fields)
    .setColor(cat.color)
    .setFooter({ text: 'Use the dropdown to switch categories · /host_guide to reopen' });
}

function buildRow() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('guide_category')
      .setPlaceholder('Browse categories...')
      .addOptions(
        Object.entries(CATEGORIES).map(([key, cat]) => ({
          label: cat.label,
          description: cat.description,
          value: key,
        }))
      )
  );
}

// ─── Command definition ───────────────────────────────────────────────────────
const guideCommands = [
  new SlashCommandBuilder()
    .setName('host_guide')
    .setDescription('Show the full host guide with category-by-category command breakdowns')
    .toJSON(),
];

// ─── Setup ────────────────────────────────────────────────────────────────────
function setupGuide(client) {
  // Slash command
  client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== 'host_guide') return;
    if (!isHost(interaction.member)) return denyHost(interaction);
    return interaction.reply({ embeds: [buildHomeEmbed()], components: [buildRow()] });
  });

  // Dropdown — anyone can browse once it's posted
  client.on('interactionCreate', async interaction => {
    if (!interaction.isStringSelectMenu()) return;
    if (interaction.customId !== 'guide_category') return;
    const key = interaction.values[0];
    if (!CATEGORIES[key]) return interaction.update({ content: '❌ Unknown category.', components: [] });
    return interaction.update({ embeds: [buildCategoryEmbed(key)], components: [buildRow()] });
  });
}

module.exports = { setupGuide, guideCommands };
