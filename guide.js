const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

// ─── Category definitions ─────────────────────────────────────────────────────
const CATEGORIES = {

  // ── Section 1 ──────────────────────────────────────────────────────────────

  overview: {
    label: '⚡ Overview',
    color: 0x5865f2,
    fields: [
      {
        name: '📋 Creating',
        value: 'Build handpick lists with factions and countries — from scratch, by pasting pre-written text, or by adding factions to a live list. Players can also be pre-assigned to countries before the list posts.',
      },
      {
        name: '✏️ Editing',
        value: 'Change a live list without recreating it — remove a player\'s claim, drop a country or a whole faction, or let two players swap countries with mutual confirmation.',
      },
      {
        name: '💾 Presets',
        value: 'Save a list once and redeploy it any time. Presets can be previewed, edited, renamed, and deleted, and they survive bot restarts.',
      },
      {
        name: '📊 Schedule',
        value: 'Hands-free event setup — the bot posts a reaction embed, counts votes, and automatically fires a preset list once enough players react. Schedules can be delayed, listed, and removed.',
      },
      {
        name: '🚫 Restrictions',
        value: 'Keep the vote count and claims clean — exclude individual votes from a schedule, undo exclusions, and temporarily blacklist players from claiming in any list.',
      },
      {
        name: '🏆 Awards',
        value: 'Track player performance — give and remove MVPs and Honorable Mentions, view the auto-updating leaderboard, and post event results that log awards automatically.',
      },
      {
        name: '⭐ Majors',
        value: 'Lock important countries behind approved roles. Countries marked as Major can only be claimed by players holding one of the roles you approve.',
      },
      {
        name: '🎖️ Teams',
        value: 'Automatic Discord role assignment — when a player claims a country they get their faction\'s role, and lose it when they unclaim. Mappings can be automatic or set manually.',
      },
      {
        name: '🗑️ Resets',
        value: 'Cleanup commands — delete or wipe lists, presets, leaderboard entries, team mappings, schedules, and results, individually or all at once.',
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
        name: 'Extra countries',
        value: 'Add `(Extra)` to any country name (e.g. `Spain (Extra)`) to make it an overflow slot. Extras are **locked until every main country is claimed** — then the bot DMs you asking whether to open them (announced in the channel) or remove them from the list.\n\nFull details in **Section 2 → 📦 Extras**.',
      },
      {
        name: '`/import_handpick` — Host',
        value: 'Import a list by pasting formatted text into a popup instead of typing every country as a command option. Best used when you already have the list written out somewhere.\n\n**Format:**\n```\n[Faction Name]\n*Prussia\nCountry 2\n\n[Another Faction]\nCountry 3\n```\nPrefix any country with `*` to mark it as Major — it displays as 🔸 in the embed and requires an approved Major role to claim.\nAdd `(Extra)` to a country name (e.g. `Spain (Extra)`) to make it an overflow slot — locked until all main countries are claimed and you open extras.',
      },
      {
        name: '`/add_faction` — Host',
        value: 'Add a new faction to an already active list. Provide the name and a comma-separated country list. Maximum 5 factions per list.\n\n**Example:**\n`/add_faction name:Comintern countries:*USSR, China, Mongolia`\n\nPrefix any country with `*` to mark it as Major — it shows as 🔸 in the embed and requires an approved Major role to claim.\nAdd `(Extra)` to a country name (e.g. `Spain (Extra)`) to make it an overflow slot — locked until all main countries are claimed and you open extras.',
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
      {
        name: '`/edit_preset` — Host',
        value: 'Edit a saved preset without deploying it — rename the title, add or remove countries, add or remove factions. Full breakdown in **💾 Presets**.',
      },
      {
        name: '`/delay_schedule` — Admin',
        value: 'Add extra minutes to an active schedule\'s countdown or deadline without recreating it. Full breakdown in **📊 Schedule**.',
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
        value: 'Posts a reaction embed in the channel. Players react ✅ to vote — when reactions hit the threshold the bot posts the selected preset as a handpick list. The bot reacts ✅ first as a visual cue (its reaction doesn\'t count toward the threshold).\n\n**All options are optional except `title`:**\n• `title` — event name shown in the embed *(required)*\n• `threshold` — ✅ reactions needed to fire *(default: 13)*\n• `delay` — minutes to wait after threshold before posting *(default: 5)*\n• `post_channel` — channel to post the list in *(default: this channel)*\n• `expire_in` — minutes before the schedule auto-removes if threshold not reached *(default: 30)*\n• `list_expiry` — minutes before the posted list locks for new claims *(default: 15)*\n• `ping_event` — ping the Event Ping role when the list fires\n• `slides` — link to your slides (shown in the embed)\n\n**Example:**\n`/setup_schedule title:Siege of Vienna threshold:20 delay:5 list_expiry:30 ping_event:true`',
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
        value: 'Posts the full server leaderboard ranked by score. Tied players share the same rank number. Includes a **Server Statistics** panel at the top:\n• Total players with at least one award\n• Total MVPs and HMs ever given\n• Average score across all ranked players\n• Current #1 player\n\nThe rankings embed auto-updates whenever an MVP or HM is given, removed, or results are posted.',
      },
      {
        name: '`/delete_player` — Host',
        value: 'Remove a specific player entirely from the leaderboard via dropdown — wipes all their MVPs and HMs in one go.\n\n**Use case:** A player left the server, was added by mistake, or needs a full reset.',
      },
      {
        name: '`/post_results` — Host',
        value: 'Post an event results embed and automatically log MVPs and HMs to the leaderboard in one step. Up to 2 factions, each with 1 MVP slot and up to 3 HM slots — tag players directly using Discord\'s @mention selector.\n\n**Options:** `event_name` *(required)*, `faction1_name` *(required)*, `faction1_mvp`, `faction1_hm1/2/3`, `faction2_name`, `faction2_mvp`, `faction2_hm1/2/3`, `summary`.',
      },
      {
        name: '`/edit_result` — Admin',
        value: 'Edit a previously posted result. The `result_name` box shows a **live list of saved results (most recent first)** as you type — just click the one you want. Every other option is optional: leave the faction options blank to keep the current factions and awards, or fill them in to replace them. The bot **automatically adjusts the leaderboard** and edits the original embed in-place.',
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
        name: '`/major_role` — Admin',
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
        value: 'Delete **all** active schedules for this server. Use `/remove_schedule` (in 🚫 Restrictions) to stop just one specific schedule.',
      },
      {
        name: '`/delete_result` · `/reset_results` — Admin',
        value: '`/delete_result` — Delete one event result via dropdown. Removes the embed from the channel and revokes all MVP/HM awards logged by that result.\n`/reset_results` — Wipe **all** event results for this server, delete their embeds, and revoke all associated awards. Asks for confirmation. Cannot be undone.',
      },
    ],
  },

  // ── Section 2 ──────────────────────────────────────────────────────────────

  s2overview: {
    label: '⚡ Overview',
    color: 0x1abc9c,
    fields: [
      {
        name: '📦 Extras',
        value: 'Overflow country slots that stay locked until every main country is claimed. The bot then DMs the host to either open them for claiming (announced in the channel) or remove them from the list.',
      },
    ],
  },

  extras: {
    label: '📦 Extras',
    color: 0x1abc9c,
    fields: [
      {
        name: 'What are Extra countries?',
        value: 'An **Extra** country is any country whose name contains `(Extra)` — for example `Spain (Extra)` or `Morocco (Extra)`. They act as **overflow slots**: there for the rare case you get more players than expected, but they don\'t need to be filled for the event to proceed normally.\n\nExtras appear in the embed and the claiming dropdown like any other country, but they are **locked until every main (non-Extra) country is claimed AND you open them** via the DM the bot sends you. Anyone who tries to claim one early is told it\'s still locked.',
      },
      {
        name: 'How to add Extra countries',
        value: 'Just include `(Extra)` anywhere in the country name when creating or importing a list:\n\n**In `/create_handpick`:**\n`faction1_countries:Germany, France, Spain (Extra), Portugal (Extra)`\n\n**In `/import_handpick`:**\n```\n[Allies]\nUSA\nUK\nCanada (Extra)\nAustralia (Extra)\n```\n\nYou can also add them to a saved preset via `/edit_preset` → **Add Countries**.',
      },
      {
        name: '📬 The DMs you get as host',
        value: '**1. All mains filled — Open Extras?**\nWhen every non-Extra country is claimed, the bot DMs you the list of waiting Extra slots with two buttons:\n• 📦 **Open Extras** — extras become claimable and the bot announces it in the list\'s channel\n• 🗑️ **Remove Extras** — extras are deleted from the list and the channel is told the list is mains-only\n\n**2. Everything claimed**\nWhen every country — mains and extras — is claimed, you get a second DM confirming the list is completely full.\n\nBoth DMs fire **at most once per list**, so you won\'t get spammed.',
      },
      {
        name: 'When to use Extras',
        value: '• You\'re running a game with a fixed roster but want backup slots ready if more players show up\n• You want to open a second wave of claiming without manually adding countries mid-event\n• You want the bot to alert you the moment all guaranteed slots are filled so you can start prep while extras trickle in',
      },
    ],
  },

};

// ─── Section layouts ──────────────────────────────────────────────────────────
const S1_ROW1 = ['overview', 'creating', 'editing', 'presets', 'watcher'];
const S1_ROW2 = ['restrictions', 'awards', 'majors', 'teams', 'resets'];
const S2_KEYS = ['s2overview', 'extras'];

// Top-level: two section buttons
function buildSectionPicker() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('guide_section__1').setLabel('Section 1').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('guide_section__2').setLabel('Section 2').setStyle(ButtonStyle.Success),
    ),
  ];
}

// Section 1: 2 rows of 5 category buttons + back row
function buildSection1Rows(activeKey) {
  function btn(key) {
    const cat    = CATEGORIES[key];
    const active = key === activeKey;
    const style  = key === 'resets'
      ? (active ? ButtonStyle.Success : ButtonStyle.Danger)
      : (active ? ButtonStyle.Success : ButtonStyle.Primary);
    return new ButtonBuilder()
      .setCustomId(`guide_s1__${key}`)
      .setLabel(cat.label)
      .setStyle(style)
      .setDisabled(active);
  }
  return [
    new ActionRowBuilder().addComponents(S1_ROW1.map(btn)),
    new ActionRowBuilder().addComponents(S1_ROW2.map(btn)),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('guide_sections').setLabel('← Sections').setStyle(ButtonStyle.Secondary),
    ),
  ];
}

// Section 2: category buttons + back in one row
function buildSection2Rows(activeKey) {
  function btn(key) {
    const cat    = CATEGORIES[key];
    const active = key === activeKey;
    return new ButtonBuilder()
      .setCustomId(`guide_s2__${key}`)
      .setLabel(cat.label)
      .setStyle(active ? ButtonStyle.Success : ButtonStyle.Primary)
      .setDisabled(active);
  }
  return [
    new ActionRowBuilder().addComponents(
      ...S2_KEYS.map(btn),
      new ButtonBuilder().setCustomId('guide_sections').setLabel('← Sections').setStyle(ButtonStyle.Secondary),
    ),
  ];
}

// ─── Embeds ───────────────────────────────────────────────────────────────────
const SECTION_PICKER_EMBED = new EmbedBuilder()
  .setTitle('📖 Host Guide')
  .setDescription('Choose a section below.')
  .addFields(
    { name: 'Section 1', value: '⚡ Overview · 📋 Creating · ✏️ Editing · 💾 Presets · 📊 Schedule · 🚫 Restrictions · 🏆 Awards · ⭐ Majors · 🎖️ Teams · 🗑️ Resets' },
    { name: 'Section 2', value: '⚡ Overview · 📦 Extras' },
  )
  .setColor(0x5865f2)
  .setFooter({ text: 'Click a section button to get started' });

function buildEmbed(key) {
  const cat = CATEGORIES[key];
  const isOverview = key === 'overview' || key === 's2overview';
  const footer = isOverview
    ? 'Click a category button below to see full details'
    : 'Active button is greyed out · use ← Sections to go back';
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
    .setDescription('Open the host guide — command reference and game mechanics')
    .toJSON(),
];

// ─── Setup ────────────────────────────────────────────────────────────────────
function setupGuide(client) {
  // /host_guide → section picker
  client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== 'host_guide') return;
    return interaction.reply({ embeds: [SECTION_PICKER_EMBED], components: buildSectionPicker() });
  });

  client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;
    const { customId } = interaction;

    // Back to section picker
    if (customId === 'guide_sections') {
      return interaction.update({ embeds: [SECTION_PICKER_EMBED], components: buildSectionPicker() });
    }

    // Section 1 landing
    if (customId === 'guide_section__1') {
      return interaction.update({ embeds: [buildEmbed('overview')], components: buildSection1Rows('overview') });
    }

    // Section 2 landing
    if (customId === 'guide_section__2') {
      return interaction.update({ embeds: [buildEmbed('s2overview')], components: buildSection2Rows('s2overview') });
    }

    // Section 1 category button
    if (customId.startsWith('guide_s1__')) {
      const key = customId.replace('guide_s1__', '');
      if (!CATEGORIES[key]) return interaction.update({ content: '❌ Unknown category.', components: [] });
      return interaction.update({ embeds: [buildEmbed(key)], components: buildSection1Rows(key) });
    }

    // Section 2 category button
    if (customId.startsWith('guide_s2__')) {
      const key = customId.replace('guide_s2__', '');
      if (!CATEGORIES[key]) return interaction.update({ content: '❌ Unknown category.', components: [] });
      return interaction.update({ embeds: [buildEmbed(key)], components: buildSection2Rows(key) });
    }
  });
}

module.exports = { setupGuide, guideCommands };
