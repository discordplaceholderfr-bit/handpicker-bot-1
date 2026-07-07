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
  {
    id: 3,
    title: 'Fixed: /rankings now actually shows the leaderboard',
    notes: [
      '`/rankings` used to just say "already pinned in #channel" (or error if no channel was set) without ever showing the standings themselves.',
      'It now always replies with the leaderboard directly. If a rankings channel is configured, it also keeps the live pinned copy there up to date — same as before.',
    ],
  },
  {
    id: 4,
    title: '/rankings is now posted publicly',
    notes: [
      '`/rankings` replies were private (only you could see them) — now the leaderboard it posts is visible to everyone in the channel, like other award commands.',
    ],
  },
  {
    id: 5,
    title: 'Cleaned up /rankings output',
    notes: [
      'Removed the extra "Also kept live in #channel..." note line — `/rankings` now just posts the leaderboard itself.',
    ],
  },
];
