// Changelog announced to each guild's configured Updates Channel (/setup →
// 🔔 Updates Channel). Add a new entry here with the next integer `id`
// whenever a command or feature ships — no version bump required, and no
// entry is ever skipped even if several ship between deploys.
// updateannouncer.js posts each not-yet-announced entry once, as its own
// message, tracked via `lastAnnouncedId` (see data/botstate.json).
module.exports = [
  {
    id: 1,
    version: '2.1.0',
    title: 'New: Update Announcements',
    notes: [
      'Added a 🔔 Updates Channel option in `/setup` — the bot now posts here whenever a new command or feature ships.',
    ],
  },
  {
    id: 2,
    version: '2.2.0',
    title: 'Team Roles moved into /setup',
    notes: [
      '`/setup_team`, `/list_teams`, `/remove_team`, and `/clear_teams` have been removed.',
      'Team roles are now configured once via `/setup` → 🎖️ Team Roles: 5 slots, each assigned to a **position** (1st faction in a list, 2nd, etc.) instead of a faction name — set it once and it applies to every list automatically.',
    ],
  },
];
