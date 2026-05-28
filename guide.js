const { isHost, denyHost } = require('./permissions');

const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
} = require('discord.js');

// ─── Category definitions ─────────────────────────────────────────────────────
const CATEGORIES = {

  creating: {
    label: '📋 Creating Lists',
    description: 'How to set up a new handpick list from scratch or from a template',
    color: 0x5865f2,
    fields: [
      {
        name: '`/create_handpick` — Host',
        value: 'Creates a new handpick list with a title and up to 5 factions. Each faction gets its own set of countries shown as a dropdown.\n\n**Example:**\n`/create_handpick title:WW2 Europe faction1_name:Axis faction1_countries:Germany, Italy, Japan faction2_name:Allies faction2_countries:USA, UK, France`\n\nAfter running it, you\'ll be asked if you want to pre-assign players before the list posts.',
      },
      {
        name: '`/import_handpick` — Host',
        value: 'Import a list by pasting formatted text into a popup instead of typing every country as a command option. Useful when you already have a list written out.\n\n**Format:**\n```\n[Faction Name]\nCountry 1\nCountry 2\n\n[Another Faction]\nCountry 3\n```',
      },
      {
        name: '`/add_faction` — Host',
        value: 'Add a new faction to an already active list. Provide the faction name and a comma-separated country list. Maximum 5 factions per list.\n\n**Example:**\n`/add_faction name:Comintern countries:USSR, China, Mongolia`',
      },
      {
        name: '`/add_preset_players` — Host',
        value: 'Bulk pre-assign players to countries using a text popup before or after the list posts. One entry per line.\n\n**Format:**\n```\nGermany: 123456789012345678\nFrance: 987654321098765432\nRussia: 111222333444555666\n```\nUse the Discord User ID (right-click → Copy ID). Works on both live lists and newly created ones.',
      },
    ],
  },

  editing: {
    label: '✏️ Editing Lists',
    description: 'Modifying active lists — removing factions, nations, and players',
    color: 0x4752c4,
    fields: [
      {
        name: '`/remove_faction` — Admin',
        value: 'Remove an entire faction and all its countries from an active list. Shows a dropdown to pick which faction to delete. If multiple lists are active it asks which list first.\n\n**Use case:** A faction becomes unplayable mid-setup and you need to pull it entirely.',
      },
      {
        name: '`/remove_nation` — Admin',
        value: 'Remove a single country from a list without touching the rest of the faction. The embed updates automatically and the country can no longer be claimed.\n\n**Use case:** A specific country gets dropped last-minute — e.g. removing Finland from a faction.',
      },
      {
        name: '`/remove_player` — Admin',
        value: 'Remove a specific player\'s claim via dropdown. Shows every currently claimed country with the faction and player ID. The country goes back to unclaimed on the list.\n\n**Use case:** A player claims the wrong country or drops out and you need to free their slot.',
      },
      {
        name: '`/swap` — Anyone',
        value: 'Request a country swap with another player who is already in the list. The bot tags both players and shows Accept/Cancel buttons. **Both must click Accept within 2 minutes** for the swap to go through. Either side can cancel at any time.\n\n**Example:**\n`/swap player:@OtherPlayer`',
      },
    ],
  },

  presets: {
    label: '💾 Presets',
    description: 'Saving, loading, editing, and deleting reusable list templates',
    color: 0xfee75c,
    fields: [
      {
        name: '`/save_preset` — Host',
        value: 'Save a currently active handpick list as a reusable preset with a name. Saves the title, all factions, and all countries — but not the claims. If multiple lists are active, a dropdown lets you pick which one.\n\n**Example:**\n`/save_preset name:Europe 1936`',
      },
      {
        name: '`/load_preset` — Host',
        value: 'Deploy a saved preset as a new handpick list. Pick from a dropdown. If your server has roles named **Team 1**, **Team 2**, etc. the bot maps them to factions automatically. You\'ll be asked about pre-assigning players before the list posts.',
      },
      {
        name: '`/edit_preset` — Host',
        value: 'Edit a saved preset without deploying it. Pick the preset, then pick an action:\n• **Rename Title** — change the list title stored in the preset\n• **Add Countries** — append new countries to a faction (comma-separated)\n• **Remove Countries** — multi-select countries to delete from a faction\n• **Add New Faction** — create a new faction with a name and countries\n• **Remove Faction** — delete an entire faction from the preset',
      },
      {
        name: '`/list_presets` · `/preview_preset`',
        value: '`/list_presets` — Shows all saved presets with their factions, country count, and save date. Includes a dropdown to preview any one.\n\n`/preview_preset` — Pick a preset to see all its factions and countries before loading it. Useful for confirming the right preset before a game.',
      },
      {
        name: '`/delete_preset` — Admin',
        value: 'Permanently delete a saved preset via dropdown. Cannot be undone. Use `/reset_presets` to wipe all of them at once.',
      },
    ],
  },

  watcher_setup: {
    label: '📊 Poll Watcher — Setup',
    description: 'Configuring watchers that auto-post lists on vote thresholds',
    color: 0x57f287,
    fields: [
      {
        name: '`/setup_watcher` — Admin',
        value: 'Watch a poll or reaction message and automatically post a handpick list when enough votes are reached. **Required options:**\n• `message_id` — ID of the poll/reaction message to watch\n• `preset` — which saved preset to post when triggered\n• `threshold` — number of votes needed\n\n**Optional options:**\n• `list_expiry` — minutes before the posted list locks for claims *(default: 15)*\n• `event_ping` — role to ping when the list posts (e.g. @Event Ping)\n• `deadline` — date/time after which the watcher stops checking *(format: YYYY-MM-DD HH:MM)*\n\n**Example:**\n`/setup_watcher message_id:1234567890 preset:Europe 1936 threshold:20 list_expiry:30 event_ping:@Members`',
      },
      {
        name: '`/delay_watcher` — Admin',
        value: 'Add extra minutes to an active watcher\'s countdown or expiry deadline. Use this when a game is delayed and you need to push the cutoff back.\n\n**Example:**\n`/delay_watcher` → picks from active watchers → enter minutes to add',
      },
      {
        name: '`/list_watchers` — Admin',
        value: 'Show all active watchers in this server — displays the preset name, vote threshold, current vote count, deadline, and whether each watcher has already fired.',
      },
    ],
  },

  watcher_exclusions: {
    label: '🚫 Watcher — Exclusions',
    description: 'Controlling which votes count toward the threshold',
    color: 0xed4245,
    fields: [
      {
        name: '`/exclude_check` — Admin',
        value: 'Exclude a specific user\'s vote from the watcher count. You must provide a reason. The exclusion is logged to **#homage-poll-log**.\n\n**Use case:** A player reacted to a poll but later confirmed they can\'t attend — exclude their vote so it doesn\'t inflate the count toward the threshold.\n\n**Example:**\n`/exclude_check` → picks user from list → enter reason: "Confirmed absent"',
      },
      {
        name: '`/remove_exclusion` — Admin',
        value: 'Undo an exclusion so that user\'s vote counts again toward the threshold. Use this if a previously excluded player confirms they can attend after all.',
      },
      {
        name: '`/remove_watcher` — Admin',
        value: 'Delete a specific watcher via dropdown. Stops it from monitoring the message entirely. Use this when an event is cancelled or you set up the wrong watcher.',
      },
    ],
  },

  awards: {
    label: '🏆 Awards & Rankings',
    description: 'Giving MVPs, HMs, and viewing the leaderboard',
    color: 0xffd700,
    fields: [
      {
        name: '`/give_mvp` · `/give_hm` — Host',
        value: '**Scoring: 1 MVP = 2 pts · 1 HM = 1 pt**\n\n`/give_mvp user:@Player` — gives 1 MVP. Add `amount:3` to give multiple at once (max 20).\n`/give_hm user:@Player` — same but for Honorable Mentions.\n\nBoth post a public embed showing the player\'s updated totals and score.',
      },
      {
        name: '`/remove_mvp` · `/remove_hm` — Host',
        value: 'Remove award(s) from a player if given by mistake.\n\n`/remove_mvp user:@Player` — removes 1 MVP. Add `amount:2` to remove more.\n`/remove_hm user:@Player` — same for HMs.\n\nCan\'t go below 0.',
      },
      {
        name: '`/rankings`',
        value: 'Show the full server leaderboard ranked by score. Tied players share the same rank. Includes a **Server Statistics** panel at the top:\n• Total players with awards\n• Total MVPs and HMs given\n• Average score per player\n• Current top player',
      },
      {
        name: '`/delete_player` — Host',
        value: 'Remove a specific player entirely from the leaderboard via dropdown. Wipes all their MVPs and HMs. Use this to clean up players who left the server or were added by mistake.',
      },
    ],
  },

  teams: {
    label: '🎖️ Team Roles',
    description: 'Auto-assigning Discord roles when players claim countries',
    color: 0xeb459e,
    fields: [
      {
        name: 'How it works',
        value: 'When a player claims a country the bot checks which faction it belongs to and gives them the mapped Discord role automatically. When they unclaim, the role is removed. This lets you control channel access through Discord\'s own permissions.',
      },
      {
        name: 'Auto-mapping',
        value: 'When you use `/create_handpick` or `/load_preset`, the bot checks if your server has roles named **Team 1**, **Team 2**, **Team 3**, etc. and maps them to factions in order. If those roles exist, no manual setup is needed.',
      },
      {
        name: '`/setup_team` — Host',
        value: 'Manually map a specific faction to a Discord role. The faction name must match **exactly** as it appears in the list — including capitalisation.\n\n**Example:**\n`/setup_team faction:Axis role:@Team 1`',
      },
      {
        name: '`/list_teams`',
        value: 'Show all current faction → role mappings for this server. Useful to verify auto-mapping worked correctly after loading a preset.',
      },
      {
        name: '`/remove_team` — Host',
        value: 'Delete a specific faction → role mapping via dropdown. Players who already have the role keep it — only future claims are affected.',
      },
    ],
  },

  player_controls: {
    label: '🛡️ Player Controls',
    description: 'Blacklisting players and controlling Major country access',
    color: 0xff9900,
    fields: [
      {
        name: '`/blacklist` — Admin',
        value: 'Prevent a player from claiming in any handpick list for a set duration. Requires three options:\n• `user` — the player to ban\n• `duration` — how long (e.g. `1d`, `2h 30m`, `30m`)\n• `reason` — shown to the player if they try to claim\n\nThe ban expires automatically. The player sees the reason and expiry time when they try to claim.\n\n**Example:**\n`/blacklist user:@Player duration:2d reason:No-show at scheduled game`',
      },
      {
        name: '`/unblacklist` — Admin',
        value: 'Remove a player from the blacklist early, restoring their ability to claim immediately.\n\n**Example:**\n`/unblacklist user:@Player`',
      },
      {
        name: '`/major_role` — Host',
        value: 'Toggle a role\'s ability to claim **Major** countries. Countries labelled as Major in the list can only be claimed by players who hold an approved Major role. Run the command again on the same role to remove it from the approved list.\n\n**Example:**\n`/major_role role:@Veteran` — adds Veteran to the approved Major list.\nRun again → removes it.',
      },
    ],
  },

  resets: {
    label: '🗑️ Resets & Deletions',
    description: 'Wiping lists, presets, rankings, teams, and watchers',
    color: 0xff4444,
    fields: [
      {
        name: '`/delete_list` — Admin',
        value: 'Delete one specific active handpick list. If multiple lists are active, shows a dropdown to pick which one. Removes all claims and the embed.\n\n**Use when:** A game gets cancelled and you want to clean up one list without touching others.',
      },
      {
        name: '`/reset_list` — Admin',
        value: 'Wipe **all** active handpick lists in this server at once. Asks for confirmation first.\n\n**Use when:** The event is fully over and you want a clean slate.',
      },
      {
        name: '`/delete_preset` · `/reset_presets` — Admin',
        value: '`/delete_preset` — Delete one saved preset via dropdown.\n`/reset_presets` — Delete **all** saved presets for this server at once. Asks for confirmation. Cannot be undone.',
      },
      {
        name: '`/reset_rankings` — Admin',
        value: 'Wipe the **entire leaderboard** — all MVPs and HMs for every player in this server. Asks for confirmation. Use `/delete_player` instead if you only want to remove one person.',
      },
      {
        name: '`/clear_teams` — Admin',
        value: 'Remove **all** faction → team role mappings for this server at once. Does not remove roles from players who already have them.',
      },
      {
        name: '`/reset_watcher` — Admin',
        value: 'Delete **all** active poll watchers for this server at once. Use `/remove_watcher` instead if you only want to stop one specific watcher.',
      },
    ],
  },

};

// ─── Main embed ───────────────────────────────────────────────────────────────
function buildHomeEmbed() {
  return new EmbedBuilder()
    .setTitle('📖 Host Guide')
    .setDescription(
      'Full reference for every command hosts and admins need to run handpick events.\n\n' +
      'Pick a category from the dropdown below.\n\n' +
      '**📋 Creating Lists** — setting up new lists and bulk-assigning players\n' +
      '**✏️ Editing Lists** — removing factions, nations, players, and swapping\n' +
      '**💾 Presets** — saving, loading, and editing reusable list templates\n' +
      '**📊 Poll Watcher — Setup** — auto-posting lists when votes hit a threshold\n' +
      '**🚫 Watcher — Exclusions** — controlling which votes count\n' +
      '**🏆 Awards & Rankings** — giving MVPs, HMs, and the leaderboard\n' +
      '**🎖️ Team Roles** — auto-assigning Discord roles on claim\n' +
      '**🛡️ Player Controls** — blacklisting and Major country access\n' +
      '**🗑️ Resets & Deletions** — wiping lists, presets, rankings, and watchers\n\n' +
      '*Commands are labelled (Host) or (Admin) — Admins can always run Host commands too.*'
    )
    .setColor(0x5865f2)
    .setFooter({ text: 'Select a category below to see detailed info and examples' });
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
  client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== 'host_guide') return;
    if (!isHost(interaction.member)) return denyHost(interaction);
    return interaction.reply({ embeds: [buildHomeEmbed()], components: [buildRow()] });
  });

  client.on('interactionCreate', async interaction => {
    if (!interaction.isStringSelectMenu()) return;
    if (interaction.customId !== 'guide_category') return;
    const key = interaction.values[0];
    if (!CATEGORIES[key]) return interaction.update({ content: '❌ Unknown category.', components: [] });
    return interaction.update({ embeds: [buildCategoryEmbed(key)], components: [buildRow()] });
  });
}

module.exports = { setupGuide, guideCommands };
