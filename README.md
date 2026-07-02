# 🗺️ Automatic Handpicker Bot

A Discord bot for running Rise of Nations country-claiming games, with team
roles, reusable presets, event results, and a full MVP/HM leaderboard. Fully
multi-server: install it on any server and run `/setup` once to configure
that server's channels, Host role(s), and medal roles — nothing is hardcoded.

---

## 📋 Commands

### ⚙️ Setup *(Administrator)*
| Command | Description |
|---|---|
| `/setup` | Interactive panel — set the log channel, audit log channel, rankings channel, Host role(s), and the 3 configurable MVP medal roles |

### 🗺️ Handpick lists *(Host)*
| Command | Description |
|---|---|
| `/create_handpick` | Create a handpick list with a title and up to 5 factions (prefix a country with `*` for Major) |
| `/add_faction` · `/remove_faction` | Add / remove a faction on the active list |
| `/list` | Show the current handpick list |
| `/swap` | Request to swap your claimed country with another player's |
| `/add_preset_players` | Pre-assign players to countries in an active list |
| `/delete_list` | Delete one active handpick list |
| `/reset_list` | **Admin:** reset all handpick lists in this server |
| `/remove_nation` | **Admin:** remove a nation from a list entirely |
| `/remove_player` | **Admin:** remove a specific player's claim |

### 🙋 Claiming
| Command | Description |
|---|---|
| `/claim` | Claim a country from the active list (also via the dropdown/buttons) |

Lists auto-reset 3 hours after creation. When every main country is claimed
and `(Extra)` slots remain, the host gets a DM to open or remove them.

### 🚫 Blacklist *(Admin)*
| Command | Description |
|---|---|
| `/blacklist` | Block a user from claiming, with a duration and reason |
| `/unblacklist` | Remove a user from the blacklist |
| `/blacklists` | **Host/Admin:** show every blacklisted player, why, and until when (paginated) |

### 🏆 Rankings & awards *(Host)*
| Command | Description |
|---|---|
| `/give_mvp` · `/give_hm` | Award MVP / Honorable Mention(s) (amount option, max 20) |
| `/remove_mvp` · `/remove_hm` | Remove MVP / HM(s) |
| `/rankings` | Show the ranked leaderboard (pinned + auto-updating once a rankings channel is set) |
| `/sync_medals` | **Admin:** re-sync medal roles to current totals |
| `/delete_player` | **Admin:** remove a player from the leaderboard |
| `/reset_rankings` | **Admin:** wipe the entire leaderboard (irreversible) |

### 🏁 Event results
| Command | Description |
|---|---|
| `/edit_result` | **Admin:** edit a saved result and adjust leaderboard awards automatically |
| `/list_results` | Show all saved results for this server (paginated) |
| `/delete_result` | **Admin:** delete a saved result |
| `/reset_results` | **Admin:** wipe all results (irreversible) |
| `Log Results (read message)` | Right-click a results message → Apps, to record it as an event |

### 🧩 Presets
| Command | Description |
|---|---|
| `/save_preset` | Save an active handpick list as a reusable preset |
| `/load_preset` | Pick a saved preset from a dropdown and deploy it as a new list |
| `/list_presets` | Show all saved presets, with each faction's countries listed underneath (paginated) |
| `/preview_preset` | Preview a preset's countries without loading it |
| `/edit_preset` | **Host:** rename title, add/remove countries or factions |
| `/delete_preset` | Delete a saved preset |
| `/reset_presets` | **Admin:** wipe all saved presets (irreversible) |

### 👥 Teams
| Command | Description |
|---|---|
| `/setup_team` | Manually map a faction name to a team role |
| `/list_teams` | Show all faction → team role mappings |
| `/remove_team` | Remove the mapping for one faction |
| `/clear_teams` | **Admin:** remove all team mappings |

### ⭐ Majors & guide
| Command | Permission | Description |
|---|---|---|
| `/major_role` | Administrator | Toggle a role on/off the list approved to claim Major (`*`) countries |
| `/host_guide` | Everyone | Interactive how-to guide covering every category — first stop for new hosts |

## 🏅 Scoring: 1 MVP = 2 pts · 1 HM = 1 pt

---

## 🔐 Permissions model

- **Admin** = Discord's built-in Administrator permission.
- **Host** = has a role configured as a Host Role via `/setup` (admins always
  count as Host too). There's no hardcoded role ID — every server configures
  its own via the panel.
- Only administrators can run `/setup`, and destructive/reset commands are
  admin-only.

## 🌍 Multi-server / installable

Commands register globally and the bot is Guild-installable, so it can be
added to any server. **First-time setup on a new server:** an admin runs
`/setup` and configures the log channel, audit channel, rankings channel,
Host role(s), and (optionally) the 3 medal roles + their MVP thresholds —
unset channels/roles simply skip that feature instead of erroring.

## 🚀 Setup
```bash
npm install
# create .env with:
#   DISCORD_TOKEN=your-bot-token
node index.js
```

Scopes: `bot` + `applications.commands`.

### Data & deployment
- State is stored as JSON in `DATA_DIR` (defaults to `./data`), keyed per-guild
  so lists/presets/leaderboards/blacklists never cross between servers. On
  Railway, mount a volume and set `DATA_DIR` to its path so data survives
  redeploys. Writes are atomic.
- Only run **one** instance — a startup lock enforces this to avoid double-processing.
- `.env`, `data/`, and `node_modules/` are gitignored. Never commit `.env`.
