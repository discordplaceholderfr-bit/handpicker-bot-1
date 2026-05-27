# 🗺️ Automatic Handpicker Bot

A Discord bot for running country-claiming games with a full MVP/HM leaderboard system.

---

## 📋 Full Command List

### 🗺️ Handpick Management *(Manage Messages)*
| Command | Description |
|---|---|
| `/create_handpick` | Create a new handpick list with title and factions |
| `/create_claims` | Create a handpick list with simplified syntax |
| `/add_faction` | Add a faction to the handpick list |
| `/remove_faction` | Remove a faction from the handpick list |
| `/list` | Show the current handpick list |

### 🙋 Claiming
| Command | Description |
|---|---|
| `/claim country:` | Claim a country from the active list |
| `/force_remove country:` | Host/Admin: Force-remove a claim from a country |
| `/remove_handpick user:` | Major/Host: Remove a user's claim |

### 🏆 Rankings & Awards *(Manage Messages)*
| Command | Description |
|---|---|
| `/give_mvp user: [amount:]` | Give MVP award(s) to a user |
| `/give_hm user: [amount:]` | Give Honorable Mention(s) to a user |
| `/remove_mvp user: [amount:]` | Remove MVP(s) from a user |
| `/remove_hm user: [amount:]` | Remove HM(s) from a user |
| `/rankings` | Show the full ranked leaderboard |

### ⚙️ Admin
| Command | Permission | Description |
|---|---|---|
| `/major_role role:` | Administrator | Toggle a role on/off the Major list |
| `/global_reset` | Bot Owner | Reset ALL handpick lists across every server |
| `/help` | Everyone | Show all available commands |

## 🏅 Scoring: 1 MVP = 2 pts · 1 HM = 1 pt

## 🚀 Setup
```bash
npm install
cp .env.example .env   # add your DISCORD_TOKEN
node index.js
```

Bot scopes needed: `bot` + `applications.commands`
Bot permissions: Send Messages, Embed Links, Read Message History
