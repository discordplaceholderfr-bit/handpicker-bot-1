const { isHost, denyHost } = require('./permissions');

const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

// ─── Category definitions ─────────────────────────────────────────────────────
const CATEGORIES = {

  creating: {
    label: '📋 Creating',
    color: 0x5865f2,
    fields: [
      {
        name: '`/create_handpick` — Host',
        value: 'Creates a new handpick list with a title and up to 5 factions. Each faction gets its own claiming dropdown.\n\n**Example:**\n`/create_handpick title:WW2 Europe faction1_name:Axis faction1_countries:Germany, Italy, Japan faction2_name:Allies faction2_countries:USA, UK, France`\n\nAfter running it, you\'re asked if you want to pre-assign players before the list posts publicly.',
      },
      {
        name: '`/import_handpick` — Host',
        value: 'Import a list by pasting formatted text into a popup instead of typing every country as a command option.\n\n**Format:**\n```\n[Faction Name]\nCountry 1\nCountry 2\n\n[Another Faction]\nCountry 3\n```',
      },
      {
        name: '`/add_faction` — Host',
        value: 'Add a new faction to an already active list. Provide the name and a comma-separated country list. Maximum 5 factions per list.\n\n**Example:**\n`/add_faction name:Comintern countries:USSR, China, Mongolia`',
      },
      {
        name: '`/add_preset_players` — Host',
        value: 'Bulk pre-assign players to countries using a text popup. One entry per line.\n\n**Format:**\n```\nGermany: 123456789012345678\nFrance: 987654321098765432\n```\nUse the Discord User ID (right-click → Copy ID). Works on both live lists and newly created ones before they post.',
      },
    ],
  },

  editing: {
    label: '✏️ Editing',
    color: 0x4752c4,
    fields: [
      {
        name: '`/remove_faction` — Admin',
        value: 'Remove an entire faction and all its countries from an active list via dropdown. If multiple lists are active it asks which list first.\n\n**Use case:** A faction becomes unplayable mid-setup and needs to be pulled entirely.',
      },
      {
        name: '`/remove_nation` — Admin',
        value: 'Remove a single country from a list. The embed updates automatically and the country can no longer be claimed.\n\n**Use case:** A specific country gets dropped last-minute — e.g. removing Finland from a faction.',
      },
      {
        name: '`/remove_player` — Admin',
        value: 'Remove a player\'s claim from the most recent list. Two ways to use it:\n\n**Tag the player directly (fastest):**\n`/remove_player user:@Player` — finds their claim automatically and removes it in one step.\n\n**No user provided:**\nShows a dropdown of every claimed country so you can pick which one to remove.\n\nEither way the country returns to unclaimed and their team role is removed.',
      },
      {
        name: '`/swap` — Anyone',
        value: 'Request a country swap with another player in the list. The bot tags both players and shows Accept/Cancel buttons. **Both must click Accept within 2 minutes.** Either side can cancel.\n\n**Example:**\n`/swap player:@OtherPlayer`',
      },
    ],
  },

  presets: {
    label: '💾 Presets',
    color: 0xfee75c,
    fields: [
      {
        name: '`/save_preset` — Host',
        value: 'Save a currently active handpick list as a reusable preset with a name. Saves the title, factions, and all countries — but not the claims.\n\n**Example:**\n`/save_preset name:Europe 1936`',
      },
      {
        name: '`/load_preset` — Host',
        value: 'Deploy a saved preset as a new handpick list via dropdown. If your server has roles named **Team 1**, **Team 2**, etc. they map to factions automatically. You\'ll be asked about pre-assigning players before it posts.',
      },
      {
        name: '`/edit_preset` — Host',
        value: 'Edit a saved preset without deploying it. After picking the preset, choose an action:\n• **Rename Title** — change the stored list title\n• **Add Countries** — append countries to a faction (comma-separated)\n• **Remove Countries** — multi-select countries to remove\n• **Add New Faction** — new faction with name and countries\n• **Remove Faction** — delete an entire faction from the preset',
      },
      {
        name: '`/list_presets` · `/preview_preset`',
        value: '`/list_presets` — All saved presets with factions, country count, and save date. Includes a dropdown to preview any one.\n\n`/preview_preset` — Pick a preset to see all its factions and countries before loading.',
      },
      {
        name: '`/delete_preset` — Admin',
        value: 'Permanently delete a saved preset via dropdown. Use `/reset_presets` to wipe all at once.',
      },
    ],
  },

  watcher: {
    label: '📊 Watcher',
    color: 0x57f287,
    fields: [
      {
        name: '`/setup_watcher` — Admin',
        value: 'Watch a poll or reaction message and post a handpick list automatically when enough votes are reached.\n\n**Required:**\n• `message_id` — the poll/reaction message to watch\n• `preset` — which preset to post when triggered\n• `threshold` — number of votes needed\n\n**Optional:**\n• `list_expiry` — minutes before the posted list locks *(default: 15)*\n• `event_ping` — role to ping when the list posts\n• `deadline` — cutoff date, format: `YYYY-MM-DD HH:MM`\n\n**Example:**\n`/setup_watcher message_id:1234567890 preset:Europe 1936 threshold:20 list_expiry:30`',
      },
      {
        name: '`/delay_watcher` — Admin',
        value: 'Add extra minutes to an active watcher\'s countdown or expiry deadline.\n\n**Use case:** Game gets delayed — push the deadline back without recreating the watcher.',
      },
      {
        name: '`/list_watchers` — Admin',
        value: 'Show all active watchers — preset name, threshold, current vote count, deadline, and whether each has fired.',
      },
    ],
  },

  exclusions: {
    label: '🚫 Exclusions',
    color: 0xed4245,
    fields: [
      {
        name: '`/exclude_check` — Admin',
        value: 'Exclude a specific player\'s vote from the watcher count. A reason is required and the exclusion is logged to **#homage-poll-log**.\n\n**Use case:** A player reacted to the poll but confirmed they can\'t attend — exclude their vote so it doesn\'t inflate the count.\n\n**Example:**\n`/exclude_check` → pick the player → enter reason: *"Confirmed absent"*',
      },
      {
        name: '`/remove_exclusion` — Admin',
        value: 'Undo an exclusion so that player\'s vote counts again toward the threshold.\n\n**Use case:** A previously excluded player confirms they can attend after all.',
      },
      {
        name: '`/remove_watcher` — Admin',
        value: 'Delete a specific watcher via dropdown. Stops it from monitoring the message.\n\n**Use case:** An event is cancelled or you set up the wrong watcher.',
      },
    ],
  },

  awards: {
    label: '🏆 Awards',
    color: 0xffd700,
    fields: [
      {
        name: '`/give_mvp` · `/give_hm` — Host',
        value: '**Scoring: 1 MVP = 2 pts · 1 HM = 1 pt**\n\n`/give_mvp user:@Player` — gives 1 MVP. Add `amount:3` for multiple (max 20).\n`/give_hm user:@Player` — same for Honorable Mentions.\n\nBoth post a public embed showing the player\'s updated totals and score.',
      },
      {
        name: '`/remove_mvp` · `/remove_hm` — Host',
        value: 'Remove award(s) from a player if given by mistake.\n\n`/remove_mvp user:@Player amount:1` — removes 1 MVP.\n`/remove_hm user:@Player amount:2` — removes 2 HMs.\n\nCannot go below 0.',
      },
      {
        name: '`/rankings`',
        value: 'Shows the full leaderboard ranked by score. Tied players share the same rank. Includes a **Server Statistics** panel:\n• Total players with awards\n• Total MVPs and HMs given\n• Average score\n• Current top player',
      },
      {
        name: '`/delete_player` — Host',
        value: 'Remove a player entirely from the leaderboard via dropdown. Wipes all their MVPs and HMs.\n\n**Use case:** Clean up a player who left the server or was added by mistake.',
      },
    ],
  },

  teams: {
    label: '🎖️ Teams',
    color: 0xeb459e,
    fields: [
      {
        name: 'How it works',
        value: 'When a player claims a country the bot checks which faction it belongs to and gives them the mapped Discord role automatically. When they unclaim, the role is removed — letting you control channel access through Discord\'s own permissions.',
      },
      {
        name: 'Auto-mapping',
        value: 'When using `/create_handpick` or `/load_preset`, if your server has roles named **Team 1**, **Team 2**, **Team 3** etc., the bot maps them to factions in order. No manual setup needed if those roles exist.',
      },
      {
        name: '`/setup_team` — Host',
        value: 'Manually map a faction to a Discord role. The faction name must match **exactly** as it appears in the list — including capitalisation.\n\n**Example:**\n`/setup_team faction:Axis role:@Team 1`',
      },
      {
        name: '`/list_teams`',
        value: 'Show all current faction → role mappings for this server. Useful to verify that auto-mapping worked correctly after loading a preset.',
      },
      {
        name: '`/remove_team` — Host',
        value: 'Delete a specific faction → role mapping via dropdown. Players who already have the role keep it — only future claims are affected.',
      },
    ],
  },

  players: {
    label: '🛡️ Players',
    color: 0xff9900,
    fields: [
      {
        name: '`/blacklist` — Admin',
        value: 'Block a player from claiming in any handpick list for a set duration.\n\n**Options:**\n• `user` — the player to ban\n• `duration` — how long (`1d`, `2h 30m`, `30m`, etc.)\n• `reason` — shown to the player when they try to claim\n\nThe ban expires automatically.\n\n**Example:**\n`/blacklist user:@Player duration:2d reason:No-show at scheduled game`',
      },
      {
        name: '`/unblacklist` — Admin',
        value: 'Remove a player from the blacklist early, restoring their ability to claim immediately.\n\n**Example:**\n`/unblacklist user:@Player`',
      },
      {
        name: '`/major_role` — Host',
        value: 'Toggle a role\'s ability to claim **Major** countries. Countries labelled as Major can only be claimed by players with an approved role. Run the command again on the same role to remove it from the list.\n\n**Example:**\n`/major_role role:@Veteran` — adds Veteran to the approved Major list. Run again → removes it.',
      },
    ],
  },

  resets: {
    label: '🗑️ Resets',
    color: 0xff4444,
    fields: [
      {
        name: '`/delete_list` · `/reset_list` — Admin',
        value: '`/delete_list` — Delete one specific list via dropdown. Removes all claims and the embed.\n`/reset_list` — Wipe **all** active lists in this server at once. Asks for confirmation.\n\n**Rule of thumb:** Use `/delete_list` when only one game is cancelled. Use `/reset_list` to fully clear after an event.',
      },
      {
        name: '`/delete_preset` · `/reset_presets` — Admin',
        value: '`/delete_preset` — Delete one saved preset via dropdown.\n`/reset_presets` — Delete **all** saved presets for this server. Asks for confirmation.',
      },
      {
        name: '`/delete_player` · `/reset_rankings` — Admin',
        value: '`/delete_player` — Remove one player from the leaderboard via dropdown.\n`/reset_rankings` — Wipe the **entire leaderboard** — all MVPs and HMs for every player. Asks for confirmation.',
      },
      {
        name: '`/clear_teams` — Admin',
        value: 'Remove **all** faction → team role mappings at once. Does not remove roles from players who already have them.',
      },
      {
        name: '`/reset_watcher` — Admin',
        value: 'Delete **all** active poll watchers for this server. Use `/remove_watcher` instead to stop just one.',
      },
    ],
  },

};

// ─── Build navigation button rows ─────────────────────────────────────────────
const BUTTON_ROWS_HOME = [
  new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('guide_btn__creating').setLabel('📋 Creating').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('guide_btn__editing').setLabel('✏️ Editing').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('guide_btn__presets').setLabel('💾 Presets').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('guide_btn__watcher').setLabel('📊 Watcher').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('guide_btn__exclusions').setLabel('🚫 Exclusions').setStyle(ButtonStyle.Primary),
  ),
  new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('guide_btn__awards').setLabel('🏆 Awards').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('guide_btn__teams').setLabel('🎖️ Teams').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('guide_btn__players').setLabel('🛡️ Players').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('guide_btn__resets').setLabel('🗑️ Resets').setStyle(ButtonStyle.Danger),
  ),
];

function buildCategoryRows(activeKey) {
  // Same buttons but highlight the active one in green, home button added
  const row1Keys = ['creating', 'editing', 'presets', 'watcher', 'exclusions'];
  const row2Keys = ['awards', 'teams', 'players', 'resets'];

  function btn(key) {
    const cat = CATEGORIES[key];
    const isActive = key === activeKey;
    const style = key === 'resets'
      ? (isActive ? ButtonStyle.Success : ButtonStyle.Danger)
      : (isActive ? ButtonStyle.Success : ButtonStyle.Primary);
    return new ButtonBuilder().setCustomId(`guide_btn__${key}`).setLabel(cat.label).setStyle(style).setDisabled(isActive);
  }

  return [
    new ActionRowBuilder().addComponents(row1Keys.map(btn)),
    new ActionRowBuilder().addComponents(
      ...row2Keys.map(btn),
      new ButtonBuilder().setCustomId('guide_btn__home').setLabel('🏠 Home').setStyle(ButtonStyle.Secondary),
    ),
  ];
}

// ─── Embeds ───────────────────────────────────────────────────────────────────
function buildHomeEmbed() {
  return new EmbedBuilder()
    .setTitle('📖 Host Guide')
    .setDescription(
      'Full reference for every command hosts and admins need to run handpick events.\n\n' +
      '**📋 Creating** — set up new lists and bulk-assign players\n' +
      '**✏️ Editing** — remove factions, nations, players, and swap countries\n' +
      '**💾 Presets** — save, load, and edit reusable list templates\n' +
      '**📊 Watcher** — auto-post lists when votes hit a threshold\n' +
      '**🚫 Exclusions** — control which votes count toward the threshold\n' +
      '**🏆 Awards** — give MVPs, HMs, and view the leaderboard\n' +
      '**🎖️ Teams** — auto-assign Discord roles when players claim countries\n' +
      '**🛡️ Players** — blacklist players and control Major country access\n' +
      '**🗑️ Resets** — wipe lists, presets, rankings, teams, and watchers\n\n' +
      '*Commands are labelled (Host) or (Admin). Admins can always run Host commands too.*'
    )
    .setColor(0x5865f2)
    .setFooter({ text: 'Click a button below to open a category' });
}

function buildCategoryEmbed(key) {
  const cat = CATEGORIES[key];
  return new EmbedBuilder()
    .setTitle(cat.label)
    .addFields(cat.fields)
    .setColor(cat.color)
    .setFooter({ text: 'Active category is greyed out · 🏠 Home to go back' });
}

// ─── Command ──────────────────────────────────────────────────────────────────
const guideCommands = [
  new SlashCommandBuilder()
    .setName('host_guide')
    .setDescription('Show the full host guide — click buttons to browse each category')
    .toJSON(),
];

// ─── Setup ────────────────────────────────────────────────────────────────────
function setupGuide(client) {
  // Slash command
  client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== 'host_guide') return;
    if (!isHost(interaction.member)) return denyHost(interaction);
    return interaction.reply({ embeds: [buildHomeEmbed()], components: BUTTON_ROWS_HOME });
  });

  // Button handler
  client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;
    if (!interaction.customId.startsWith('guide_btn__')) return;

    const key = interaction.customId.replace('guide_btn__', '');

    if (key === 'home') {
      return interaction.update({ embeds: [buildHomeEmbed()], components: BUTTON_ROWS_HOME });
    }

    if (!CATEGORIES[key]) return interaction.update({ content: '❌ Unknown category.', components: [] });
    return interaction.update({ embeds: [buildCategoryEmbed(key)], components: buildCategoryRows(key) });
  });
}

module.exports = { setupGuide, guideCommands };
