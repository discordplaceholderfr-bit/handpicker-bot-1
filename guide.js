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
        name: '📋 Creating lists',
        value: '`/create_handpick` — build a list from scratch with a title and up to 5 factions.\n`/import_handpick` — paste a pre-written list into a popup (fastest when you already have it written).\n`/add_faction` — add a faction to an already active list.\n\nPrefix any country with `*` to mark it as a Major (e.g. `*Prussia`) — it shows as 🔸 and requires an approved role to claim.',
      },
      {
        name: '💾 Presets — the fastest way to run events',
        value: '1. Build a list once with `/create_handpick`\n2. Save it with `/save_preset name:Your Name`\n3. Next event: `/load_preset` → pick it → list posts instantly\n4. Need to tweak it? `/edit_preset` — no need to rebuild from scratch',
      },
      {
        name: '📊 Schedule — hands-free list posting',
        value: 'Set up with `/setup_schedule` — the bot posts a reaction embed and watches it. When ✅ reactions hit the threshold the preset fires automatically.\n\nAlternatively, `/setup_schedule` with a custom preset and threshold handles the whole flow: players react, bot fires the list, pings your event role, and DMs you when the list locks.',
      },
      {
        name: '✏️ Editing active lists',
        value: '`/remove_player` — remove a player\'s claim (by tag or dropdown).\n`/remove_nation` — remove a country from a list entirely.\n`/remove_faction` — remove a whole faction.\n`/swap` — let two players swap countries (both must accept within 2 minutes).\n`/add_preset_players` — bulk pre-assign players to countries via a text popup.',
      },
      {
        name: '🎖️ Teams — automatic role assignment',
        value: 'When a player claims a country the bot gives them the mapped Discord role automatically, and strips it on unclaim. Roles named **Team 1**, **Team 2**, etc. are auto-mapped to factions on list creation — no setup needed. Use `/setup_team` to manually map a faction to any role.',
      },
      {
        name: '⭐ Majors — controlling who claims big countries',
        value: 'Any country whose name starts with `*` (e.g. `*Prussia`) is a Major country, locked behind approved roles. Use `/major_role role:@Role` to toggle a role on/off the approved list. Players without an approved role get blocked when they try to claim one.',
      },
      {
        name: '🚫 Restrictions — keeping the count clean',
        value: '`/exclude_check` removes a player\'s vote from the schedule count (logged to #homage-poll-log). `/remove_exclusion` undoes it. `/blacklist` stops a player from claiming in any list for a set duration — they see the reason and time remaining on every failed attempt.',
      },
      {
        name: '🏆 Awards & Rankings',
        value: '`/give_mvp` and `/give_hm` give awards manually *(1 MVP = 2 pts · 1 HM = 1 pt)*. `/rankings` shows the full leaderboard with server stats. Use `/remove_mvp` or `/remove_hm` to correct mistakes.',
      },
      {
        name: '🏁 Results — post outcomes and auto-log awards',
        value: 'After an event ends, `/post_results` posts a results embed and logs MVPs/HMs to the leaderboard in one step — up to 5 factions, users tagged by `@Username`, ID, or mention.\n\n`/edit_result` reopens the form pre-filled and adjusts the leaderboard automatically. Deleting a result also revokes its awards.',
      },
      {
        name: '📬 When does the bot DM you?',
        value: '• **List expiry fires** — DM with Extend / Reopen buttons. You have 10 minutes to respond or the list is auto-deleted.\n• **List fully filled** — DM when every country (including Extras) is claimed.\n• **Main slots filled, extras remain** — DM listing unclaimed `(Extra)` countries the moment all main slots fill but no extras have been taken yet.\n\nAll three only fire once per list. See the **📦 Extras** category for full details on how Extra countries work.',
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
    label: '📊 Schedule',
    color: 0x57f287,
    fields: [
      {
        name: '`/setup_schedule` — Host',
        value: 'Posts a reaction embed in the channel. Players react ✅ to vote — when reactions hit the threshold the bot posts the selected preset as a handpick list. The bot reacts ✅ first as a visual cue (its reaction doesn\'t count toward the threshold).\n\n**All options are optional:**\n• `threshold` — ✅ reactions needed to fire *(default: 13)*\n• `delay` — minutes to wait after threshold before posting *(default: 5)*\n• `post_channel` — channel to post the list in *(default: this channel)*\n• `expire_in` — minutes before the schedule auto-removes if threshold not reached *(default: 30)*\n• `list_expiry` — minutes before the posted list locks for new claims *(default: 15)*\n• `ping_event` — ping the Event Ping role when the list fires\n• `preset_players` — pre-assign players: `Nation: UserID; Nation: UserID`\n\n**Example:**\n`/setup_schedule threshold:20 delay:5 list_expiry:30 ping_event:true`',
      },
      {
        name: '`/delay_schedule` — Admin',
        value: 'Add extra minutes to an active schedule\'s countdown or deadline without having to delete and recreate it.\n\n**Use case:** The game gets delayed 30 minutes — run `/delay_schedule`, pick the schedule, enter `30` to push its deadline back.',
      },
      {
        name: '`/list_schedules` — Admin',
        value: 'Show all active schedules in this server. Displays each schedule\'s preset name, vote threshold, current vote count, deadline, and whether it has already fired.',
      },
    ],
  },

  restrictions: {
    label: '🚫 Restrictions',
    color: 0xed4245,
    fields: [
      {
        name: '`/exclude_check` — Admin',
        value: 'Exclude a specific player\'s vote from the schedule count. A reason is required. The exclusion is logged automatically to **#homage-poll-log** with the player, reason, and who excluded them.\n\n**Use case:** A player reacted to the schedule but confirmed they can\'t attend — exclude their vote so it doesn\'t push the count toward the threshold.\n\n**How:** `/exclude_check` → pick the player from the list → enter the reason.',
      },
      {
        name: '`/remove_exclusion` — Admin',
        value: 'Undo an exclusion so that player\'s vote counts again toward the threshold.\n\n**Use case:** You excluded someone but they\'ve since confirmed they can attend.',
      },
      {
        name: '`/remove_schedule` — Admin',
        value: 'Delete a specific schedule via dropdown. Stops it from tracking reactions entirely. The list it may have already posted is unaffected.\n\n**Use case:** An event is cancelled and you no longer need the schedule.',
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
      {
        name: '`/post_results` — Host',
        value: 'Post an event results embed and automatically log MVPs and HMs to the leaderboard in one step. Opens a popup with three fields:\n• **Event Name** — shown as the embed title\n• **Summary** *(optional)* — short description of the event\n• **Results** — faction blocks, one per faction, up to 5:\n```\nFaction Name\nMVP: @Username, 123456789\nHM: @AnotherUser\n\nFaction 2\nMVP: @Player\nHM: @Other\n```\nUsers can be entered as `@Username`, a raw Discord ID, or a `<@mention>`. The embed posts permanently and the leaderboard is updated instantly.',
      },
      {
        name: '`/edit_result` — Admin',
        value: 'Edit a previously posted result. Opens the same popup pre-filled with the existing data. On submit the bot **automatically adjusts the leaderboard** — users removed lose their awards, users added gain them, switches between MVP and HM are handled too. The original embed in the channel is edited in-place.',
      },
      {
        name: '`/list_results`',
        value: 'Show all saved event results for this server — event name, date, and faction names for each.',
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

  extras: {
    label: '📦 Extras',
    color: 0x1abc9c,
    fields: [
      {
        name: 'What are Extra countries?',
        value: 'An **Extra** country is any country whose name contains `(Extra)` — for example `Spain (Extra)` or `Morocco (Extra)`. They act as **overflow slots**: there for the rare case you get more players than expected, but they don\'t need to be filled for the event to proceed normally.\n\nExtras appear in the embed and the claiming dropdown exactly like any other country — players see and claim them the same way. The only difference is how the bot treats them internally.',
      },
      {
        name: 'How to add Extra countries',
        value: 'Just include `(Extra)` anywhere in the country name when creating or importing a list:\n\n**In `/create_handpick`:**\n`faction1_countries:Germany, France, Spain (Extra), Portugal (Extra)`\n\n**In `/import_handpick`:**\n```\n[Allies]\nUSA\nUK\nCanada (Extra)\nAustralia (Extra)\n```\n\nYou can also add them to a saved preset via `/edit_preset` → **Add Countries**.',
      },
      {
        name: '📬 The two DMs you get as host',
        value: '**1. All mains filled, no extras taken yet**\nWhen every non-Extra country is claimed but none of the Extra slots have been touched, the bot DMs you a list of which Extra countries are still open. This fires once — it\'s your cue that the main roster is full and you may want to open extras to latecomers.\n\n**2. Everything claimed**\nWhen every country — mains and extras — is claimed, you get a second DM confirming the list is completely full.\n\nBoth DMs fire **at most once per list**, so you won\'t get spammed.',
      },
      {
        name: 'When to use Extras',
        value: '• You\'re running a game with a fixed roster but want backup slots ready if more players show up\n• You want to open a second wave of claiming without manually adding countries mid-event\n• You want the bot to alert you the moment all guaranteed slots are filled so you can start prep while extras trickle in',
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
        value: 'Delete **all** active schedules for this server. Use `/remove_schedule` (in 🚫 Restrictions) to stop just one specific schedule.',
      },
      {
        name: '`/delete_result` · `/reset_results` — Admin',
        value: '`/delete_result` — Delete one event result via dropdown. Removes the embed from the channel and revokes all MVP/HM awards logged by that result.\n`/reset_results` — Wipe **all** event results for this server, delete their embeds, and revoke all associated awards. Asks for confirmation. Cannot be undone.',
      },
    ],
  },

};

// ─── Button rows ──────────────────────────────────────────────────────────────
const ROW1_KEYS = ['overview', 'creating', 'editing', 'presets', 'watcher'];
const ROW2_KEYS = ['restrictions', 'awards', 'majors', 'teams', 'resets'];
const ROW3_KEYS = ['extras'];

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
    new ActionRowBuilder().addComponents(ROW3_KEYS.map(btn)),
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
