// Shared list pagination helper.
//
// Discord caps an embed description at 4096 chars (and ~6000 across the whole
// embed). Any list that grows without bound — rankings, results, presets… —
// will eventually blow that limit and make the embed invalid. These helpers
// split pre-rendered text "blocks" into pages that always fit, and build the
// ◀ Prev / Next ▶ navigation row.
//
// Usage: a command's payload builder renders its rows into `blocks`, calls
// paginate() + pageButtons(), and registers a button handler that matches
// `${idBase}__<page>` and re-renders the requested page via interaction.update.
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

// Split blocks into pages by a character budget AND a max count, so no single
// page can exceed the description limit. Deterministic from the input, so a page
// index in a button customId always maps to the same content.
function paginate(blocks, { maxChars = 3800, maxPer = 10 } = {}) {
  const pages = [];
  let cur = [], len = 0;
  for (const b of blocks) {
    const add = b.length + 2; // joined with "\n\n"
    if (cur.length && (len + add > maxChars || cur.length >= maxPer)) {
      pages.push(cur); cur = []; len = 0;
    }
    cur.push(b);
    len += add;
  }
  if (cur.length) pages.push(cur);
  return pages.length ? pages : [[]];
}

// Prev/Next row for page navigation, or null when there's only one page.
// `idBase` must be unique per command; its button handler matches `idBase__<page>`.
function pageButtons(idBase, page, totalPages) {
  if (totalPages <= 1) return null;
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${idBase}__${page - 1}`).setLabel('◀ Prev').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
    new ButtonBuilder().setCustomId(`${idBase}__${page + 1}`).setLabel('Next ▶').setStyle(ButtonStyle.Secondary).setDisabled(page >= totalPages - 1),
  );
}

module.exports = { paginate, pageButtons };
