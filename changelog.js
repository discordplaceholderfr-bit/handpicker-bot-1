// Changelog announced to each guild's configured Updates Channel (/setup →
// 🔔 Updates Channel). Add a new entry here whenever a command or feature
// ships, then bump "version" in package.json to match — updateannouncer.js
// posts the entry once, on the first boot after the version changes.
module.exports = [
  {
    version: '2.1.0',
    title: 'New: Update Announcements',
    notes: [
      'Added a 🔔 Updates Channel option in `/setup` — the bot now posts here whenever a new command or feature ships.',
    ],
  },
  {
    version: '2.2.0',
    title: 'Team Roles moved into /setup',
    notes: [
      '`/setup_team`, `/list_teams`, `/remove_team`, and `/clear_teams` have been removed.',
      'Team roles are now configured once via `/setup` → 🎖️ Team Roles: 5 slots, each assigned to a **position** (1st faction in a list, 2nd, etc.) instead of a faction name — set it once and it applies to every list automatically.',
    ],
  },
];
