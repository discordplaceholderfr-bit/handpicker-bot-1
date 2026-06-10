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

  overview: {
    label: '⚡ Overview',
    color: 0x5865f2,
    fields: [
      {
        name: '💾 Presets — the fastest way to run events',
        value: '1. Build a list once with `/create_handpick`\n2. Save it with `/save_preset name:Your Name`\n3. Next event: `/load_preset` → pick it → list posts instantly\n4. Need to tweak it? `/edit_preset` — no need to rebuild from scratch',
      },
      {
        name: '📊 Poll Watcher — hands-free list posting',
        value: 'Set up with `/setup_schedule` pointing at your poll/reaction message. When votes hit the threshold the bot posts the preset automatically and pings your event role. Set `list_expiry` to lock claiming after X minutes — the bot DMs you when it locks so you can extend or reopen.\n\nAlternatively, use `/schedule_event` to skip the poll entirely — players RSVP directly on the event embed and the list fires automatically when the cap is hit or the event time arrives.',
      },
      {
        name: '🚫 Restrictions — keeping the count clean',
        value: '`/exclude_check` removes a player\'s vote from the watcher count (logged to #homage-poll-log). `/remove_exclusion` undoes it. For players who are a recurring problem, `/blacklist` stops them from claiming in any list for a set time.',
      },
      {
        name: '⭐ Majors — controlling who claims big countries',
        value: 'Any country whose name starts with `*` (e.g. `*Prussia`) is a Major country, locked behind approved roles. Use `/major_role role:@Role` to toggle a role on/off the approved list. Players without an approved role get blocked when they try to claim one.',
      },
      {
        name: '📬 When does the bot DM you?',
        value: '• **List expiry fires** — DM with Extend / Reopen buttons. You have 10 minutes to respond or the list is auto-deleted and the channel is notified.\n• **List fully filled** — DM when every country is claimed.\n• **Main slots filled, extras remain** — DM listing the unclaimed (Extra) countries if no extras have been picked yet.\n\nAll three only fire once per list.',
      },
    ],
  },

  creating: {
    label: '📋 Creating',
    color: 0x5865f2,
    fields: [
      {
        name: '`/create_handpick` — Host',
        value: 'Creates a new handpick list with a title and up to 5 factions. Each faction gets its own claiming dropdown in the posted embed.\n\n**Example:**\n`/create_handpick title:WW2 Europe faction1_name:Axis faction1_countries:*Germany, Italy, *Japan faction2_name:Allies faction2_countries:USA, *UK, France`\n\nAfter running it you\'re asked if you want to pre-assign players before the list posts. Click **Add Preset Players** to open the assignment form or **Skip** to post immediately.\n\n**Major countries:** prefix any country name with `*` to make it Major (e.g. `*Prussia`). It displays as 🔸 Prussia in the embed and is locked behind approved Major roles.',
      },
      {
        name: '`/import_handpick` — Host',
        value: 'Import a list by pasting formatted text into a popup instead of typing every country as a command option. Best used when you already have the list written out somewhere.\n\n**Format:**\n```\n[Faction Name]\n*Prussia\nCountry 2\n\n[Another Faction]\nCountry 3\n```\nPrefix any country with `*` to mark it as Major — it displays as 🔸 in the embed and requires an approved Major role to claim.',
      },
      {
        name: '`/add_faction` — Host',
        value: 'Add a new faction to an already active list. Provide the name and a comma-separated country list. Maximum 5 factions per list.\n\n**Example:**\n`/add_faction name:Comintern countries:*USSR, China, Mongolia`\n\nPrefix any country with `*` to mark it as Major — it shows as 🔸 in the embed and requires an approved Major role to claim.',
      },
      {
        name: '`/schedule_event` — Host',
        value: 'Posts an event embed in the channel. Players react ✅ to vote — the embed updates the count live. When votes hit the threshold the bot fires the linked preset as a handpick list.\n\n**Required:**\n• `title` — event name shown in the embed\n• `preset` — preset to post when threshold is hit\n• `threshold` — number of ✅ reactions needed\n\n**Optional:**\n• `deadline` — how long the event stays open before auto-expiring: `1d`, `2h 30m`, etc.\n• `delay` — minutes to wait after threshold before posting the list (default: 0)\n• `list_expiry` — minutes before the posted list locks for claiming\n• `event_ping` — ping the event role when the list fires\n• `description` — extra text shown in the embed\n\n**Example:**\n`/schedule_event title:Siege of Vienna preset:WW2 Europe threshold:20 deadline:2h delay:5 list_expiry:15`',
      },
      {
        name: '`/remove_event` · `/list_events` — Admin',
        value: '`/remove_event` — Remove an active event via dropdown.\n`/list_events` — Show all active events with vote counts and status.',
      },
      {
        name: '`/exclude_event` — Admin',
        value: 'Exclude a player\'s ✅ reaction from being counted toward the threshold. Applied to all active events in the server.\n\n**Example:** `/exclude_event user:@Player reason:Not attending`',
      },
      {
        name: '`/add_preset_players` — Host',
        value: 'Bulk pre-assign players to countries using a text popup. One entry per line — paste the country name, a colon, then the player\'s Discord User ID (right-click their name → Copy ID).\n\n**Format:**\n```\nGermany: 123456789012345678\nFrance: 987654321098765432\nRussia: 111222333444555666\n```\nWorks before the list posts (during setup) and on live lists. If a country is already claimed it overwrites the old claim.',
      },
    ],
  },

  editing: {
    label: '✏️ Editing',
    color: 0x4752c4,
    fields: [
      {
        name: '`/remove_faction` — Admin',
        value: 'Remove an entire faction and all its countries from an active list via dropdown. If multiple lists are active it asks which list first. The embed updates automatically.\n\n**Use case:** A faction becomes unplayable mid-setup and needs to be pulled entirely before anyone claims.',
      },
      {
        name: '`/remove_nation` — Admin',
        value: 'Remove a single country from a list. The embed updates automatically and the slot disappears — it can no longer be claimed. If the country was already claimed, that claim is wiped too.\n\n**Use case:** A specific country gets dropped last-minute (e.g. removing Finland from a faction right before the game).',
      },
      {
        name: '`/remove_player` — Admin',
        value: 'Remove a player\'s claim from the most recent list. Two ways:\n\n**Tag directly (fastest):**\n`/remove_player user:@Player` — the bot finds their claim and removes it in one step, then strips their team role.\n\n**No user specified:**\nShows a dropdown of every claimed country — pick whichever one you want to clear.\n\nEither way the slot returns to unclaimed on the embed.',
      },
      {
        name: '`/swap` — Anyone',
        value: 'Request a country swap with another player who already has a claim. The bot posts an embed tagging both players with **Accept** and **Cancel** buttons. **Both must click Accept within 2 minutes** for the swap to execute. Either side can cancel at any time.\n\n**Example:** `/swap player:@OtherPlayer`\n\nTeam roles are swapped automatically alongside the countries.',
      },
    ],
  },

  presets: {
    label: '💾 Presets',
    color: 0xfee75c,
    fields: [
      {
        name: '`/save_preset` — Host',
        value: 'Save a currently active handpick list as a reusable preset. Saves the title, all factions, and all countries — **not** the current claims. If multiple lists are active a dropdown lets you pick which one to save.\n\n**Example:** `/save_preset name:Europe 1936`\n\nPresets persist permanently until deleted — they survive bot restarts and redeployments.',
      },
      {
        name: '`/load_preset` — Host',
        value: 'Deploy a saved preset as a new handpick list. Pick from a dropdown. Before it posts you\'re asked about pre-assigning players.\n\n**Team role auto-mapping:** if your server has roles named **Team 1**, **Team 2**, **Team 3** etc., the bot maps them to factions in order automatically — no `/setup_team` needed.',
      },
      {
        name: '`/edit_preset` — Host',
        value: 'Edit a saved preset without deploying it. Pick the preset then choose an action:\n• **Rename Title** — change the stored list title\n• **Add Countries** — append new countries to a faction (comma-separated). Prefix with `*` to make them Major (e.g. `*Prussia, France`)\n• **Remove Countries** — multi-select which countries to remove from a faction\n• **Add New Faction** — create a new faction with a name and countries. Prefix any country with `*` to mark it as Major\n• **Remove Faction** — delete an entire faction from the preset',
      },
      {
        name: '`/list_presets` · `/preview_preset`',
        value: '`/list_presets` — Shows all saved presets with factions, country count, and save date. Includes a dropdown to preview any one inline.\n\n`/preview_preset` — Pick a preset from a dropdown to see all its factions and countries before you commit to loading it.',
      },
      {
        name: '`/delete_preset` — Admin',
        value: 'Permanently delete one saved preset via dropdown. This cannot be undone. Use `/reset_presets` to wipe all presets at once.',
      },
    ],
  },

  watcher: {
    label: '📊 Watcher',
    color: 0x57f287,
    fields: [
      {
        name: '`/setup_schedule` — Host',
        value: 'Posts a reaction embed in the channel. Players react ✅ to vote — when reactions hit the threshold the bot posts the selected preset as a handpick list. The bot reacts ✅ first as a visual cue (its reaction doesn\'t count toward the threshold).\n\n**All options are optional:**\n• `threshold` — ✅ reactions needed to fire *(default: 13)*\n• `delay` — minutes to wait after threshold before posting *(default: 5)*\n• `post_channel` — channel to post the list in *(default: this channel)*\n• `expire_in` — minutes before the watcher auto-removes if threshold not reached *(default: 30)*\n• `list_expiry` — minutes before the posted list locks for new claims *(default: 15)*\n• `ping_event` — ping the Event Ping role when the list fires\n• `preset_players` — pre-assign players: `Nation: UserID; Nation: UserID`\n\n**Example:**\n`/setup_schedule threshold:20 delay:5 list_expiry:30 ping_event:true`',
      },
      {
        name: '`/delay_schedule` — Admin',
        value: 'Add extra minutes to an active watcher\'s countdown or deadline without having to delete and recreate it.\n\n**Use case:** The game gets delayed 30 minutes — run `/delay_schedule`, pick the watcher, enter `30` to push its deadline back.',
      },
      {
        name: '`/list_schedules` — Admin',
        value: 'Show all active watchers in this server. Displays each watcher\'s preset name, vote threshold, current vote count, deadline, and whether it has already fired.',
      },
    ],
  },

  restrictions: {
    label: '🚫 Restrictions',
    color: 0xed4245,
    fields: [
      {
        name: '`/exclude_check` — Admin',
        value: 'Exclude a specific player\'s vote from the watcher count. A reason is required. The exclusion is logged automatically to **#homage-poll-log** with the player, reason, and who excluded them.\n\n**Use case:** A player reacted to the poll but confirmed they can\'t attend — exclude their vote so it doesn\'t push the count toward the threshold.\n\n**How:** `/exclude_check` → pick the player from the list → enter the reason.',
      },
      {
        name: '`/remove_exclusion` — Admin',
        value: 'Undo an exclusion so that player\'s vote counts again toward the threshold.\n\n**Use case:** You excluded someone but they\'ve since confirmed they can attend.',
      },
      {
        name: '`/remove_schedule` — Admin',
        value: 'Delete a specific watcher via dropdown. Stops it from monitoring the message entirely. The list it may have already posted is unaffected.\n\n**Use case:** An event is cancelled or you pointed the watcher at the wrong message.',
      },
      {
        name: '`/blacklist` — Admin',
        value: 'Block a player from claiming in **any** handpick list for a set duration. When they try to claim they see the reason and how long remains.\n\n**Options:**\n• `user` — the player to ban\n• `duration` — how long: `1d`, `2h 30m`, `30m`, etc.\n• `reason` — shown to the player on every failed claim attempt\n\nThe ban expires and lifts automatically.\n\n**Example:** `/blacklist user:@Player duration:2d reason:No-show at scheduled game`',
      },
      {
        name: '`/unblacklist` — Admin',
        value: 'Lift a blacklist early, restoring the player\'s ability to claim immediately.\n\n**Example:** `/unblacklist user:@Player`',
      },
    ],
  },

  awards: {
    label: '🏆 Awards',
    color: 0xffd700,
    fields: [
      {
        name: '`/give_mvp` · `/give_hm` — Host',
        value: '**Scoring system: 1 MVP = 2 pts · 1 HM = 1 pt**\n\n`/give_mvp user:@Player` — gives 1 MVP. Add `amount:3` to give up to 20 at once.\n`/give_hm user:@Player` — same for Honorable Mentions.\n\nBoth post a **public embed** in the channel showing the player\'s new MVP count, HM count, and total score.',
      },
      {
        name: '`/remove_mvp` · `/remove_hm` — Host',
        value: 'Remove award(s) from a player — use this to correct mistakes.\n\n`/remove_mvp user:@Player amount:1` — removes 1 MVP (default if no amount given).\n`/remove_hm user:@Player amount:2` — removes 2 HMs.\n\nCannot go below 0. Posts a public confirmation.',
      },
      {
        name: '`/rankings`',
        value: 'Posts the full server leaderboard ranked by score. Tied players share the same rank number. Includes a **Server Statistics** panel at the top:\n• Total players with at least one award\n• Total MVPs and HMs ever given\n• Average score across all ranked players\n• Current #1 player',
      },
      {
        name: '`/delete_player` — Host',
        value: 'Remove a specific player entirely from the leaderboard via dropdown — wipes all their MVPs and HMs in one go.\n\n**Use case:** A player left the server, was added by mistake, or needs a full reset.',
      },
    ],
  },

  majors: {
    label: '⭐ Majors',
    color: 0xff9900,
    fields: [
      {
        name: 'How Major countries work',
        value: 'Any country whose name starts with `*` is treated as a **Major** country. Major countries are locked behind approved roles — players without one get blocked when they try to claim.\n\n**Example list entry:** `*Prussia`, `*Austria`, `*France`\n\nMajor countries display with a 🔸 in the embed and dropdown so players know at a glance which countries require a Major role.',
      },
      {
        name: '`/major_role` — Host',
        value: 'Toggle a Discord role\'s permission to claim `*` Major countries. Run it on a role to **add** it to the approved list. Run it again on the same role to **remove** it.\n\n**Example:**\n`/major_role role:@Veteran` — Veteran players can now claim `*` countries.\nRun again → removes that permission.\n\nNo limit on how many roles you can approve. If no roles are approved at all, Major countries are claimable by anyone.',
      },
    ],
  },

  teams: {
    label: '🎖️ Teams',
    color: 0xeb459e,
    fields: [
      {
        name: 'How team roles work',
        value: 'When a player claims a country the bot checks which faction it belongs to and gives them the mapped Discord role automatically. When they unclaim or get removed, the role is stripped. This lets you control channel access entirely through Discord\'s permission system.',
      },
      {
        name: 'Auto-mapping on list creation',
        value: 'When you use `/create_handpick` or `/load_preset`, the bot looks for roles named **Team 1**, **Team 2**, **Team 3**, etc. in your server and maps them to factions in order. If those roles exist, no manual setup is needed — it happens silently.',
      },
      {
        name: '`/setup_team` — Host',
        value: 'Manually map a specific faction to a Discord role. The faction name must match **exactly** as it appears in the list, including capitalisation.\n\n**Example:** `/setup_team faction:Axis role:@Team 1`\n\nUse this to override auto-mapping or to set up roles that aren\'t named Team 1/2/3.',
      },
      {
        name: '`/list_teams`',
        value: 'Show all current faction → role mappings for this server. Run this after creating or loading a list to confirm auto-mapping worked correctly.',
      },
      {
        name: '`/remove_team` — Host',
        value: 'Delete one specific faction → role mapping via dropdown. Players who already have the role keep it — only future claims in that faction are affected.',
      },
    ],
  },

  resets: {
    label: '🗑️ Resets',
    color: 0xff4444,
    fields: [
      {
        name: '`/delete_list` · `/reset_list` — Admin',
        value: '`/delete_list` — Delete one active list via dropdown. Removes all its claims and the embed.\n`/reset_list` — Wipe **all** active lists at once. Both ask for confirmation first.\n\n**Rule of thumb:** Use `/delete_list` when one game is cancelled. Use `/reset_list` to fully clear after an event ends.',
      },
      {
        name: '`/delete_preset` · `/reset_presets` — Admin',
        value: '`/delete_preset` — Delete one saved preset via dropdown.\n`/reset_presets` — Delete **all** saved presets for this server. Asks for confirmation. Cannot be undone.',
      },
      {
        name: '`/delete_player` · `/reset_rankings` — Admin',
        value: '`/delete_player` — Remove one player from the leaderboard (wipes their MVPs and HMs).\n`/reset_rankings` — Wipe the **entire leaderboard** for this server. Asks for confirmation.',
      },
      {
        name: '`/clear_teams` — Admin',
        value: 'Remove **all** faction → team role mappings at once. Players who already have team roles keep them — only future claims are affected.',
      },
      {
        name: '`/reset_schedule` — Admin',
        value: 'Delete **all** active poll watchers for this server. Use `/remove_schedule` (in 🚫 Restrictions) to stop just one specific watcher.',
      },
    ],
  },

};

// ─── Button rows ──────────────────────────────────────────────────────────────
const ROW1_KEYS = ['overview', 'creating', 'editing', 'presets', 'watcher'];
const ROW2_KEYS = ['restrictions', 'awards', 'majors', 'teams', 'resets'];

function buildRows(activeKey) {
  function btn(key) {
    const cat    = CATEGORIES[key];
    const active = key === activeKey;
    const style  = key === 'resets'
      ? (active ? ButtonStyle.Success : ButtonStyle.Danger)
      : (active ? ButtonStyle.Success : ButtonStyle.Primary);
    return new ButtonBuilder()
      .setCustomId(`guide_btn__${key}`)
      .setLabel(cat.label)
      .setStyle(style)
      .setDisabled(active);
  }
  return [
    new ActionRowBuilder().addComponents(ROW1_KEYS.map(btn)),
    new ActionRowBuilder().addComponents(ROW2_KEYS.map(btn)),
  ];
}

// ─── Embeds ───────────────────────────────────────────────────────────────────
function buildEmbed(key) {
  const cat = CATEGORIES[key];
  const footer = key === 'overview'
    ? 'Click a category button below to see full command details'
    : 'Active button is greyed out · ⚡ Overview to go back';
  return new EmbedBuilder()
    .setTitle(cat.label)
    .addFields(cat.fields)
    .setColor(cat.color)
    .setFooter({ text: footer });
}

// ─── Command ──────────────────────────────────────────────────────────────────
const guideCommands = [
  new SlashCommandBuilder()
    .setName('host_guide')
    .setDescription('Open the host guide — quick overview and full command reference by category')
    .toJSON(),
];

// ─── Setup ────────────────────────────────────────────────────────────────────
function setupGuide(client) {
  client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== 'host_guide') return;
    if (!isHost(interaction.member)) return denyHost(interaction);
    return interaction.reply({ embeds: [buildEmbed('overview')], components: buildRows('overview') });
  });

  client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;
    if (!interaction.customId.startsWith('guide_btn__')) return;
    const key = interaction.customId.replace('guide_btn__', '');
    if (!CATEGORIES[key]) return interaction.update({ content: '❌ Unknown category.', components: [] });
    return interaction.update({ embeds: [buildEmbed(key)], components: buildRows(key) });
  });
}

module.exports = { setupGuide, guideCommands };
