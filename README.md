# 🗺️ Automatic Handpicker Bot

A Discord bot for running country-claiming games with teams, presets, poll-triggered
schedules, event results, and a full MVP/HM leaderboard. Built for a single server.

---

## 📋 Commands

### 🗺️ Handpick lists *(Host)*
| Command | Description |
|---|---|
| `/create_handpick` | Create a handpick list with a title and factions |
| `/import_handpick` | Create a list by pasting raw text (auto-parsed) |
| `/add_faction` · `/remove_faction` | Add / remove a faction on the active list |
| `/list` | Show the current handpick list |
| `/list_expiry` | Set how long the active list stays open |
| `/swap` | Swap two players' claimed countries |
| `/delete_list` · `/reset_list` | Delete one list / reset all lists in this server |

### 🙋 Claiming
| Command | Description |
|---|---|
| `/claim` | Claim a country from the active list (also via the dropdown/buttons) |
| `/remove_nation` | Host: remove a claim from a country |
| `/remove_player` | Host: remove a specific player's claim |

### 🏆 Rankings & awards *(Host)*
| Command | Description |
|---|---|
| `/give_mvp` · `/give_hm` | Award MVP / Honorable Mention(s) |
| `/remove_mvp` · `/remove_hm` | Remove MVP / HM(s) |
| `/rankings` | Show the ranked leaderboard |
| `/sync_medals` | Re-sync medal roles to current totals |
| `/reset_rankings` | Wipe the leaderboard |

### 🏁 Event results
| Command | Description |
|---|---|
| `/edit_result` · `/delete_result` | Edit / delete a saved result |
| `/list_results` · `/summary` | List results / show a summary |
| `/reset_results` | Wipe all results |
| `Log Results` (right-click message) | Turn a results message into a recorded event |

### 🧩 Presets
| Command | Description |
|---|---|
| `/save_preset` · `/edit_preset` · `/delete_preset` | Manage presets |
| `/load_preset` · `/preview_preset` · `/list_presets` | Use / preview / list presets |
| `/add_preset_players` | Attach default players to a preset |
| `/reset_presets` | Delete all presets |

### 👥 Teams
| Command | Description |
|---|---|
| `/setup_team` · `/remove_team` · `/clear_teams` | Configure faction→role team mappings |
| `/list_teams` | Show team mappings |

### ⏰ Schedules / poll watcher *(Host/Admin)*
| Command | Description |
|---|---|
| `/setup_schedule` | Post a reaction embed that fires a handpick list at a vote threshold |
| `/delay_schedule` · `/remove_schedule` · `/reset_schedule` | Adjust / remove schedules |
| `/list_schedules` · `/ping_event` | List schedules / ping the event role |

### ⚙️ Admin
| Command | Permission | Description |
|---|---|---|
| `/major_role` | Administrator | Toggle a role on/off the Major (`*`) list |
| `/blacklist` · `/unblacklist` | Admin/Host | Block / unblock a user from claiming |
| `/host_guide` | Host | Interactive how-to guide |

## 🏅 Scoring: 1 MVP = 2 pts · 1 HM = 1 pt

## 🚀 Setup
```bash
npm install
# create .env with:
#   DISCORD_TOKEN=your-bot-token
node index.js
```

Scopes: `bot` + `applications.commands`.

### Data & deployment
- State is stored as JSON in `DATA_DIR` (defaults to `./data`). On Railway, mount a
  volume and set `DATA_DIR` to its path so data survives redeploys. Writes are atomic.
- Only run **one** instance — a startup lock enforces this to avoid double-processing.
- `.env`, `data/`, and `node_modules/` are gitignored. Never commit `.env`.
