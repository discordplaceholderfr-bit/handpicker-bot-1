const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
} = require('discord.js');
const { getKey } = require('./guildconfig');

// ─── Category definitions ─────────────────────────────────────────────────────
const CATEGORIES = {

  setup: {
    label: '⚙️ Setup',
    color: 0x5865f2,
    fields: [
      {
        name: '`/setup` — Admin',
        value: 'Interactive panel for configuring this server. Pick a setting from the dropdown, then choose a channel or role from a native picker — changes save immediately.\n\n**Settings:**\n• 📢 Log Channel — list expiry / auto-reset / reopen announcements\n• 📝 Audit Log Channel — every moderation & admin action\n• 🏆 Rankings Channel — where the live leaderboard is pinned\n• 🔔 Updates Channel — posted here whenever the bot ships a new command/feature\n• 🛡️ Host Roles — who can run Host commands (multi-select)\n• 🎖️ 3 Medal Roles — each with its own configurable MVP threshold (e.g. "Role for 5+ MVPs"), full details in **🏆 Awards**\n• 🎖️ Team Roles — 5 position-based slots for automatic team-role assignment, full details in **🎖️ Teams**',
      },
      {
        name: 'Nothing is required to work — features just skip',
        value: 'Leaving a setting unset doesn\'t break anything: no rankings channel means `/rankings` won\'t auto-pin, no medal role means that tier is never granted, and so on. Run `/setup` once per server, and admins can revisit it any time to change a setting.',
      },
    ],
  },

  overview: {
    label: '⚡ Overview',
    color: 0x5865f2,
    fields: [
      {
        name: '⚙️ Setup',
        value: 'First step on a new server — an admin runs `/setup` to configure the log channel, audit channel, rankings channel, updates channel, Host roles, medal roles, and team roles.',
      },
      {
        name: '📋 Creating',
        value: 'Build handpick lists with factions and countries — from scratch, by pasting pre-written text, or by adding factions to a live list. Players can also be pre-assigned to countries before the list posts.',
      },
      {
        name: '✏️ Editing',
        value: 'Change a live list without recreating it — drop a country or a whole faction, or edit a saved preset.',
      },
      {
        name: '💾 Presets',
        value: 'Save a list once and redeploy it any time. Presets can be previewed, edited, renamed, and deleted, and they survive bot restarts.',
      },
      {
        name: '🚫 Restrictions',
        value: 'Keep claiming clean — blacklist a player to block them from claiming in any list, then unblacklist to restore them.',
      },
      {
        name: '🏆 Awards',
        value: 'Track player performance — give and remove MVPs and Honorable Mentions, view the auto-updating leaderboard, post event results, and auto-grant up to 3 configurable MVP medal roles.',
      },
      {
        name: '👥 Players',
        value: 'Everything that affects players — how they claim and unclaim, swapping countries, removing or pre-assigning players, and Major countries locked behind approved roles.',
      },
      {
        name: '🎖️ Teams',
        value: 'Automatic Discord role assignment — when a player claims a country they get their faction\'s role, and lose it when they unclaim. Mappings can be automatic or set manually.',
      },
      {
        name: '🗑️ Deletions',
        value: 'Every delete and reset command in one place — wipe lists, presets, leaderboard entries, team mappings, and results, individually or all at once.',
      },
      {
        name: '📦 Extras',
        value: 'Overflow country slots that stay locked until every main country is claimed — then the bot DMs you to open or remove them.',
      },
      {
        name: '📝 Logging',
        value: 'Every moderation and admin action is logged automatically to a dedicated channel showing who did what.',
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
        name: '`/list`',
        value: 'Re-posts the current handpick list\'s embed as a fresh reply — handy if the original message scrolled out of view.',
      },
    ],
  },

  editing: {
    label: '✏️ Editing',
    color: 0x4752c4,
    fields: [
      {
        name: '`/remove_faction` — Admin',
        value: 'Remove an entire faction and all its countries from an active list via dropdown. If multiple lists are active it asks which list first. The embed updates automatically.',
      },
      {
        name: '`/remove_nation` — Admin',
        value: 'Remove a single country from a list. The embed updates automatically and the slot disappears — it can no longer be claimed. If the country was already claimed, that claim is wiped too.',
      },
      {
        name: '`/edit_preset` — Host',
        value: 'Edit a saved preset without deploying it — rename the title, add or remove countries, add or remove factions. Full breakdown in **💾 Presets**.',
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
        value: 'Deploy a saved preset as a new handpick list. Pick from a dropdown. Before it posts you\'re asked about pre-assigning players.\n\n**Team roles:** applied automatically based on faction position — see **🎖️ Teams** for how to configure them via `/setup`.',
      },
      {
        name: '`/edit_preset` — Host',
        value: 'Edit a saved preset without deploying it. Pick the preset then choose an action:\n• **Rename Title** — change the stored list title\n• **Add Countries** — append new countries to a faction (comma-separated). Prefix with `*` to make them Major (e.g. `*Prussia, France`)\n• **Remove Countries** — multi-select which countries to remove from a faction\n• **Add New Faction** — create a new faction with a name and countries. Prefix any country with `*` to mark it as Major\n• **Remove Faction** — delete an entire faction from the preset',
      },
      {
        name: '`/list_presets` · `/preview_preset`',
        value: '`/list_presets` — Lists every saved preset with each faction\'s countries shown in full underneath the preset name (Majors marked 🔸). Split into ◀ Prev / Next ▶ pages when long.\n\n`/preview_preset` — Pick a single preset from a dropdown to see all its factions and countries before you commit to loading it.',
      },
    ],
  },

  restrictions: {
    label: '🚫 Restrictions',
    color: 0xed4245,
    fields: [
      {
        name: '`/blacklist` — Admin',
        value: 'Blacklist a player for a set duration. While blacklisted, they **can\'t claim** countries in any handpick list across the whole server, until they\'re unblacklisted (or the duration expires).\n\nThe player is **DMed** with the reason and exactly when the blacklist expires.\n\n**Options:**\n• `user` — the player to blacklist\n• `duration` — how long: `1d`, `2h 30m`, `30m`, etc.\n• `reason` — shown in the DM and on every failed claim attempt\n\n**Example:** `/blacklist user:@Player duration:2d reason:No-show at scheduled game`',
      },
      {
        name: '`/unblacklist` — Admin',
        value: 'Lift a blacklist early — they can claim again immediately. The player is DMed that the blacklist was lifted.\n\n**Example:** `/unblacklist user:@Player`',
      },
      {
        name: '`/blacklists` — Host',
        value: 'Show every currently blacklisted player at a glance — who they are, the reason, who blacklisted them, and when each blacklist expires (sorted soonest-first). Long lists are **paginated** with ◀ Prev / Next ▶ buttons. Read-only and private to you; expired entries are cleared automatically. Use `/blacklist` and `/unblacklist` to actually change them.',
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
        value: 'Posts the leaderboard right away, publicly — ranked by score with tied players sharing a rank, plus a **Server Statistics** panel (total players, total MVPs/HMs, average score, current #1). Long leaderboards are split into ◀ Prev / Next ▶ pages.\n\nIf a rankings channel is configured (`/setup`), it also refreshes a **live, auto-updating, pinned copy** there whenever an MVP or HM is given, removed, or results are posted — you don\'t need to run `/rankings` again to keep that one current.',
      },
      {
        name: 'Logging results — Host',
        value: '**Write your results post however you want** — headers, a writeup per award, as many videos/images as you like — then **right-click it → Apps → "Log Results (read message)"**.\n\nThe bot reads the message and auto-awards anyone @mentioned under an **MVP** or **HM** heading (the first @mention per line; names before the first heading — your summary — are ignored). It updates the rankings and medal roles, saves a result record (manageable below), and the confirmation clears itself after a few seconds.\n\nIf it grabs someone by mistake, fix it with `/remove_mvp` / `/remove_hm`.',
      },
      {
        name: '`/list_results` · `/edit_result` · `/delete_result` · `/reset_results`',
        value: 'Manage logged results.\n• `/list_results` — every logged result with date and awards\n• `/edit_result` *(Admin)* — pick a result (live autocomplete) and re-enter awards; the leaderboard adjusts automatically\n• `/delete_result` *(Admin)* — delete one result and **revoke its awards**\n• `/reset_results` *(Admin)* — wipe all results and revoke their awards',
      },
      {
        name: '🎖️ MVP medal roles',
        value: 'MEDAL_SUMMARY_PLACEHOLDER',
      },
    ],
  },

  players: {
    label: '👥 Players',
    color: 0xff9900,
    fields: [
      {
        name: 'Claiming a country',
        value: 'Players claim through the posted list embed — pick a country from a faction\'s **dropdown**, and press the red **Unclaim** button to drop it. You can also use the `/claim country:<name>` command. Each player can hold one country at a time, and Major (`*`) and locked Extra slots are enforced on every claim.',
      },
      {
        name: '`/swap` — Anyone',
        value: 'Request a country swap with another player who already has a claim. The bot posts an embed tagging both players with **Accept** and **Cancel** buttons. **Both must click Accept within 2 minutes** for the swap to execute. Either side can cancel at any time.\n\n**Example:** `/swap player:@OtherPlayer`\n\nTeam roles are swapped automatically alongside the countries.',
      },
      {
        name: '`/remove_player` — Admin',
        value: 'Remove a player\'s claim from the most recent list. Two ways:\n\n**Tag directly (fastest):**\n`/remove_player user:@Player` — the bot finds their claim and removes it in one step, then strips their team role.\n\n**No user specified:**\nShows a dropdown of every claimed country — pick whichever one you want to clear.\n\nEither way the slot returns to unclaimed on the embed.',
      },
      {
        name: '`/add_preset_players` — Host',
        value: 'Bulk pre-assign players to countries using a text popup. One entry per line — paste the country name, a colon, then the player\'s Discord User ID (right-click their name → Copy ID).\n\n**Format:**\n```\nGermany: 123456789012345678\nFrance: 987654321098765432\nRussia: 111222333444555666\n```\nWorks before the list posts (during setup) and on live lists. If a country is already claimed it overwrites the old claim.',
      },
      {
        name: '⭐ How Major countries work',
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
        value: 'Configured once per server via `/setup` → **🎖️ Team Roles** — no per-list setup, no relying on roles named "Team 1/2/3". Each of the 5 slots holds a role for a **position**: Slot 1\'s role goes to whoever claims the faction in the 1st position of a list, Slot 2 to the 2nd, and so on. It automatically applies to every list you create from then on.',
      },
      {
        name: 'Position, not name',
        value: 'Position is just the order factions were added in — the 1st faction in `/create_handpick`, `/import_handpick`, or a preset\'s faction list is "position 1", etc. The role updates automatically on claim, unclaim, player removal, and swap.',
      },
      {
        name: 'Current configuration',
        value: 'TEAMS_SUMMARY_PLACEHOLDER',
      },
    ],
  },

  resets: {
    label: '🗑️ Deletions',
    color: 0xff4444,
    fields: [
      {
        name: '📋 Lists',
        value: '`/delete_list` — delete one active list (removes its claims and embed)\n`/reset_list` — wipe **all** active lists',
      },
      {
        name: '💾 Presets',
        value: '`/delete_preset` — delete one saved preset\n`/reset_presets` — delete **all** saved presets',
      },
      {
        name: '🏆 Leaderboard',
        value: '`/delete_player` — remove one player (wipes their MVPs and HMs)\n`/reset_rankings` — wipe the **entire** leaderboard',
      },
      {
        name: '🏁 Results',
        value: '`/delete_result` — delete one result (revokes its awards)\n`/reset_results` — wipe **all** results (revokes all their awards)',
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

  logging: {
    label: '📝 Logging',
    color: 0x5865f2,
    fields: [
      {
        name: 'Where everything is logged',
        value: 'LOGGING_SUMMARY_PLACEHOLDER',
      },
      {
        name: '🚫 Moderation actions',
        value: '• `/blacklist` — player, duration, and reason\n• `/unblacklist` — who lifted it',
      },
      {
        name: '🏆 Awards & Results',
        value: '• `/give_mvp` · `/give_hm` — who gave how many to whom, with new totals\n• `/remove_mvp` · `/remove_hm` — same for removals\n• **Log Results** (message reader) — MVPs/HMs logged\n• `/edit_result` — which result was edited\n• `/delete_result` · `/reset_results` — deletions with awards revoked',
      },
      {
        name: '🗑️ Edits, deletions & resets',
        value: '• `/edit_preset` — every change: renames, countries added/removed, factions added/removed\n• `/delete_preset` · `/reset_presets`\n• `/delete_list` · `/reset_list`\n• `/delete_player` · `/reset_rankings`',
      },
      {
        name: '⭐ Players',
        value: '• `/major_role` — when a role gains or loses permission to claim Major countries',
      },
    ],
  },

};

// ─── Dropdown menu ──────────────────────────────────────────────────────────
// Order shown in the dropdown + a one-line description for each option.
const MENU = [
  { key: 'overview',     desc: 'Start here — what every category covers' },
  { key: 'setup',        desc: 'Configure channels, roles & medals' },
  { key: 'creating',     desc: 'Build & import lists, add factions' },
  { key: 'editing',      desc: 'Change a live list, edit presets' },
  { key: 'presets',      desc: 'Save, load, edit reusable lists' },
  { key: 'restrictions', desc: 'Blacklist players from claiming' },
  { key: 'awards',       desc: 'MVPs, HMs, rankings & results' },
  { key: 'players',      desc: 'Claiming, swaps, majors, preset players' },
  { key: 'teams',        desc: 'Team roles by faction position (/setup)' },
  { key: 'resets',       desc: 'Delete or wipe lists, presets, results…' },
  { key: 'extras',       desc: 'Overflow (Extra) country slots' },
  { key: 'logging',      desc: 'What gets logged, and where' },
];

function buildDropdown(activeKey) {
  return [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('guide_cat')
        .setPlaceholder('📖 Pick a category…')
        .addOptions(MENU.map(({ key, desc }) => ({
          label:       CATEGORIES[key].label.slice(0, 100),
          description: desc.slice(0, 100),
          value:       key,
          default:     key === activeKey,
        })))
    ),
  ];
}

// Channels are per-guild config (/setup) now — build the sentence at render
// time instead of baking in one server's channel IDs.
function loggingSummary(guildId) {
  const auditId = getKey(guildId, 'auditChannelId');
  const logId   = getKey(guildId, 'logChannelId');
  const audit   = auditId ? `<#${auditId}>` : 'no audit channel yet — run `/setup`';
  const log     = logId   ? `<#${logId}>`   : 'no log channel yet — run `/setup`';
  return `Moderation and admin actions are logged automatically to ${audit} as embeds showing **who did it, to whom, and why** (where a reason applies). The bot's list expiry and auto-delete announcements go to ${log}.`;
}

// Medal roles + their MVP thresholds are fully configurable per guild now —
// list whatever is actually set instead of a fixed Bronze/Airman/Purple tier.
function medalSummary(guildId) {
  const tiers = [1, 2, 3]
    .map(n => ({ roleId: getKey(guildId, `medalRole${n}Id`), mvps: getKey(guildId, `medalRole${n}Mvps`) ?? [1, 5, 8][n - 1] }))
    .filter(t => t.roleId)
    .sort((a, b) => a.mvps - b.mvps);
  if (!tiers.length) {
    return 'Up to 3 medal roles can be given automatically based on MVP count — none are configured for this server yet. Set the roles and their MVP thresholds via `/setup`.';
  }
  const lines = tiers.map(t => `• <@&${t.roleId}> — ${t.mvps}+ MVPs`).join('\n');
  return `Players are automatically given a **medal role based on their MVP count** — they hold only the **highest** tier they qualify for:\n${lines}\n\nThe role updates automatically whenever MVPs change (given, removed, results posted/edited/deleted). Run **\`/sync_medals\`** *(Admin)* once to grant medals to everyone who already qualifies. Configure roles/thresholds via \`/setup\`.`;
}

// Team roles are 5 position-based slots configured per guild via /setup.
function teamsSummary(guildId) {
  const { teamRoleKey, TEAM_SLOT_COUNT } = require('./teams');
  const slots = Array.from({ length: TEAM_SLOT_COUNT }, (_, i) => ({
    position: i + 1,
    roleId: getKey(guildId, teamRoleKey(i + 1)),
  })).filter(s => s.roleId);
  if (!slots.length) {
    return 'None of the 5 Team Role slots are set up yet for this server. Configure them via `/setup` → 🎖️ Team Roles.';
  }
  const lines = slots.map(s => `• Position ${s.position} → <@&${s.roleId}>`).join('\n');
  return `${lines}\n\nConfigure or change these via \`/setup\` → 🎖️ Team Roles.`;
}

function buildEmbed(key, guildId) {
  const cat = CATEGORIES[key];
  const fields = cat.fields.map(f => {
    if (f.value === 'LOGGING_SUMMARY_PLACEHOLDER') return { ...f, value: loggingSummary(guildId) };
    if (f.value === 'MEDAL_SUMMARY_PLACEHOLDER')   return { ...f, value: medalSummary(guildId) };
    if (f.value === 'TEAMS_SUMMARY_PLACEHOLDER')   return { ...f, value: teamsSummary(guildId) };
    return f;
  });
  const footer = key === 'overview'
    ? 'Pick a category from the menu below to see full details'
    : 'Use the menu below to jump to another category';
  return new EmbedBuilder()
    .setTitle(cat.label)
    .addFields(fields)
    .setColor(cat.color)
    .setFooter({ text: footer });
}

// One shared payload builder for the slash reply, the !guide message, and selects
function buildGuide(key, guildId) {
  return { embeds: [buildEmbed(key, guildId)], components: buildDropdown(key) };
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
  // /host_guide → overview + category dropdown
  client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== 'host_guide') return;
    return interaction.reply(buildGuide('overview', interaction.guildId));
  });

  // !guide prefix command → same guide, replying without pinging
  client.on('messageCreate', async message => {
    if (message.author.bot) return;
    if (message.content.trim().toLowerCase() !== '!guide') return;
    try {
      await message.reply({ ...buildGuide('overview', message.guildId), allowedMentions: { repliedUser: false } });
    } catch (e) { console.warn('!guide failed:', e.message); }
  });

  // Category dropdown → swap the embed to the chosen category
  client.on('interactionCreate', async interaction => {
    if (!interaction.isStringSelectMenu()) return;
    if (interaction.customId !== 'guide_cat') return;
    const key = interaction.values[0];
    if (!CATEGORIES[key]) return interaction.update({ content: '❌ Unknown category.', components: [] });
    return interaction.update(buildGuide(key, interaction.guildId));
  });
}

module.exports = { setupGuide, guideCommands };
