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
];
