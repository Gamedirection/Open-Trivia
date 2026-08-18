<img width="500" alt="image"  src="img/open-trivia-logo_OT-Logo+Mark.svg" />

# Open-Trivia

Created by [gamedirection.net](https://gamedirection.net) © 2026  
Discord: [join.gamedirection.net](https://join.gamedirection.net)  
Credits: Alex Sierputowski @ [GameDirection.net](https://gamedirection.net)

## Try it out at [Trivia.GameDirection.net](https://trivia.gamedirection.net)

## Overview
Open-Trivia is a multiplayer trivia platform with admin tooling, category management, adaptive difficulty, leaderboard scoring, and user profiles.

## Key Features
- **Share Play** - real-time multiplayer trivia with a persistent Live Room, player-created public/private rooms (4-digit codes), live vote display, speed-medal bonuses, include/exclude category filters, session scoring tied to the leaderboard, full admin/host settings controls (timer, scoring, display toggles, early-round-end logic), vote-to-kick system with 3-strike escalation (30min, 24h, permanent), mobile-responsive stacked layout, and TV mode.
- Auth with password reset, Discord SSO, admin roles, and account blocking.
- Discord bot support via the `services/open-trivia-discord` submodule for slash-command, DM, and scheduled trivia.
- Discord users can submit question suggestions directly from the bot for admin approval.
- Public Terms of Use and Privacy Policy pages with deployment-configurable operator/contact identity.
- Question answers now collapse blank slots automatically so True/False style questions render as two full-width answers instead of four sparse buttons.
- Correct answers now trigger a faster rainbow success animation with emoji star-burst effects, and players can disable gameplay animations from their profile settings.
- Leaderboards with category and timeframe filters (day/month/year).
- Leaderboard privacy options: hidden emails for guests, display names, optional censoring, optional anonymous entries, Discord avatars with Gravatar fallback.
- Timer-based scoring with configurable min/max points.
- Adaptive question difficulty based on answer accuracy.
- Profile page with activity totals, per-category breakdown, and saved custom category groups.
- Profile & privacy: display name edits, email visibility toggle, optional avatar display, Discord avatar preference when linked.
- Question images by URL or admin uploads (png/jpg/jpeg/svg/webp).
- User suggestions can include image URLs.
- Questions can use either 2 answers or 4 answers.
- Category filters: include/exclude category pills in Play, saved custom presets, and admin category renaming.
- Category packs: export selected categories as zip (CSV + images), download a pack template, and import from direct CSV uploads, zip files, GitHub, CSV URLs, or shared Google Sheets URLs.
- Data management: backups, export/import, and per-user restore.
- CSV question import/export with template.
- Admin SharePlay moderation: kick warnings with strike tracking, ban list, appeal review, per-user leaderboard clear, account deletion, and server-wide blocking.
- Helm chart for Kubernetes deployments.

## Architecture
- Frontend: React SPA.
- Backend: Node/Express + PostgreSQL.
- Discord bot: separate Node service in `services/open-trivia-discord`.
- Images: GHCR.

## Share Play - Capacity & Scaling

Share Play runs socket.io on the same Node.js process as the REST API. All room state lives in memory on one instance. These are rough estimates based on a single server.

### Concurrent player estimates

| Server | RAM / vCPU | Players | Rooms |
|---|---|---|---|
| Entry VPS ($6/mo) | 1 GB / 1 vCPU | ~200 | ~20 |
| Standard VPS ($12/mo) | 2 GB / 2 vCPU | ~800 | ~80 |
| Large VPS ($24/mo) | 4 GB / 2 vCPU | ~2 000 | ~200 |
| Dedicated ($60/mo) | 16 GB / 4 vCPU | ~8 000 | ~800 |

**What drives the limits:**
- Each WebSocket connection uses ~30–80 KB RAM. A room with 50 players broadcasting every vote update is the main CPU cost.
- Round-end scoring loops are O(votes) + N DB inserts per round - at high concurrency, DB becomes the first bottleneck.
- The live room continuously runs regardless of player count, consuming one background timer + DB write per round.

### Bottlenecks in order

1. **Node.js event loop** - round-end broadcasts block briefly. Fine up to ~500 players in a single room; above that, rounds feel sluggish.
2. **PostgreSQL** - default `max_connections = 100`. Add pgBouncer or raise the limit before 50+ concurrent rounds.
3. **Memory** - room state + socket buffers. Monitor with `docker stats`.
4. **Network** - vote broadcasts are small JSON; only an issue at thousands of concurrent voters.

### Horizontal scaling (if you need it)

Current architecture is single-instance only - room state is in memory, not shared. To scale past one server:

1. Add **`socket.io-redis`** adapter so multiple Node instances share room state via Redis pub/sub.
2. Put a **sticky-session** load balancer in front (nginx `ip_hash`, HAProxy, or Traefik `stickycookie`) so a client always hits the same instance.
3. Run backend replicas: `docker service scale open-trivia_backend=3`.
4. Add a **Redis** service to docker-compose and set `REDIS_URL` in the backend.

A single well-sized VPS handles hundreds of simultaneous players comfortably for most hobby and small-community deployments without any of the above.

---

## Quickstart (Docker Compose)
```bash
docker compose up -d
```

Frontend image/version note:
- The footer version is driven by `FRONTEND_IMAGE_TAG`.
- If you deploy `ghcr.io/gamedirection/open-trivia-frontend:latest`, set `FRONTEND_IMAGE_TAG=latest`.
- If you pin a release tag such as `v0.3.19`, set `FRONTEND_IMAGE_TAG=v0.3.19`.

### Env (Backend)
```bash
PG_HOST=db
PG_PORT=5432
PG_USER=trivia_user
PG_PASSWORD=trivia_pass
PG_DB=trivia_db
JWT_SECRET=change-me
APP_URL=http://localhost:3000
LEGAL_OPERATOR_NAME=
LEGAL_CONTACT_EMAIL=
LEGAL_LAST_UPDATED=2026-03-25
```

### Discord SSO (optional)
```bash
DISCORD_CLIENT_ID=your-discord-app-client-id
DISCORD_CLIENT_SECRET=your-discord-app-client-secret
# Optional override. Defaults to ${APP_URL}/api/auth/discord/callback
DISCORD_REDIRECT_URI=http://localhost:3000/api/auth/discord/callback
```

Set the Discord application redirect URI to the same callback URL you configure above. You can also manage these values later from the admin panel Data section, where admins can enable/disable Discord login and view the embedded setup instructions dropdown.

### Discord Bot (optional)
```bash
DISCORD_BOT_API_TOKEN=change-me-bot-token
PUBLIC_APP_URL=http://localhost:3000
FRONTEND_IMAGE_TAG=latest
DISCORD_BOT_SERVICE_URL=http://discord-bot:3000
DISCORD_BOT_INVITE_URL=https://discord.com/oauth2/authorize?client_id=1485851351366766755
BOT_DISCORD_TOKEN=your-discord-bot-token
BOT_DISCORD_CLIENT_ID=your-discord-bot-client-id
BOT_SCHEDULE_POLL_MS=15000
BOT_QUESTION_TIMEOUT_SECONDS=86400
```

The bot lives in `services/open-trivia-discord` as a submodule. Configure the bot token/client ID in `.env`, start the `discord-bot` service, then use `/trivia`, `/leaderboard`, `/schedule-trivia`, and `/suggest-question` in Discord.
The bot also supports `/categories` and `/help`. Scheduler commands can target an optional category and a Discord channel. Wrong answers reveal the correct answer privately. Discord-only players are created in Open-Trivia on first answer so they score immediately.
Discord question suggestions are flagged in the admin Review Queue with a Discord Bot badge.
The admin Data section exposes a Discord bot invite URL, defaulting to the configured application authorization link.

### Scoring Config (optional)
```bash
SCORE_MIN_POINTS=5
SCORE_MAX_EASY=10
SCORE_MAX_MED=15
SCORE_MAX_HARD=20
SCORE_FAST_MS=2000
SCORE_SLOW_MS=20000
DIFF_MIN_ATTEMPTS=25
DIFF_UP_THRESHOLD=0.4
DIFF_DOWN_THRESHOLD=0.8
```

## Admin Features
- Users: role changes, password reset, block/unblock with duration.
- Leaderboard: scheduled resets and scoring settings.
- Privacy and rate-limit settings (reports/suggestions).
- Image size limits for question images.
- Admin image uploads for questions.
- Category pack export/import (zip, GitHub, or release asset URL) + template download.
- Data section: backups/export/import plus Discord SSO and Discord bot configuration with setup guidance.
- Public legal pages: `/terms` and `/privacy`, with operator/contact details derived from the site domain unless overridden by env.

## Shared Collections
Browse community packs at `questions.trivia.gamedirection.net`.  
We recommend a public GitHub repo per collection and a README that links to other collections.  
Template repo: https://github.com/Gamedirection/Open-Trivia-Questions.git  
Security note: only import zips from sources you trust.

**Category Pack Format**
- A zip per category (or a zip containing multiple category zips).
- Each category zip includes `questions.csv` and an optional `images/` folder.
- CSV `image_url` can reference `images/filename.ext` or an external URL.

## Collections Repo Template
The questions/collections repo lives as a submodule at `docs/Open-Trivia-Questions`.
The template README content used by the collections repo is `docs/Open-Trivia-Questions/README.md`.
- Data Management: backups, export/import, restore a single user.
- Questions: CSV export/import and template download.

## Contributing Question Packs
This repo includes the collections repo as a submodule at `docs/Open-Trivia-Questions`.

To contribute questions:
1. Enter the submodule: `cd docs/Open-Trivia-Questions`
2. Create/update category packs using the template zip (`template-category.zip`) and follow the README in that repo.
3. Commit and push in the submodule repo.
4. Return to this repo, commit the updated submodule pointer, and push.

If you are cloning fresh, make sure to init/update submodules:
```bash
git submodule update --init --recursive
```

## API Documentation
OpenAPI spec is served at:
```text
/openapi.json
```
Spec file:
```text
docs/openapi.json
```

## Changelog
See `docs/CHANGELOG.md`.

## Helm (K8s)
Chart location:
```text
helm/open-trivia
```
Install:
```bash
helm install open-trivia helm/open-trivia
```
Override values:
```bash
helm install open-trivia helm/open-trivia \
  --set image.frontend.tag=v0.3.3 \
  --set image.backend.tag=v0.3.3 \
  --set backend.env.JWT_SECRET=change-me
```

## Branding (Logo)
Docker Compose:
1. Place your logo at `branding/logo.png`.
2. Uncomment `REACT_APP_BRAND_LOGO_URL` and the `volumes` block under `frontend` in `docker-compose.yml`.

Helm:
1. Create a config map from your logo file: `kubectl create configmap open-trivia-logo --from-file=logo.png`.
2. Install/upgrade with `--set branding.logo.configMap=open-trivia-logo --set branding.logo.url=/brand/logo.png`.

## Docker Swarm
Create secrets (recommended):
```bash
echo "change-me" | docker secret create jwt_secret -
echo "smtp.example.com" | docker secret create smtp_host -
echo "smtp_user" | docker secret create smtp_user -
echo "smtp_pass" | docker secret create smtp_pass -
```

Deploy:
```bash
docker stack deploy -c docker-compose.yml open-trivia
```

Scale:
```bash
docker service scale open-trivia_frontend=2
docker service scale open-trivia_backend=2
```

Note: ensure the Swarm section in `docker-compose.yml` secrets is enabled.

## Deployment Notes
- Use tagged images for reproducible deployments.
- If using `latest`, always `docker compose pull` + `docker compose up -d --force-recreate`.
- Keep `FRONTEND_IMAGE_TAG` aligned with the frontend image you deploy so the footer version matches the running package.
- For production, point `APP_URL` at the public site URL.
- PWA/service worker caching can require a hard refresh on updates.

## Production Checklist
- [ ] Confirm `JWT_SECRET` set to a strong value
- [ ] Set `APP_URL` to the public domain
- [ ] Configure SMTP (or disable)
- [ ] Enable HTTPS and HSTS on the edge proxy
- [ ] Ensure DB persistence is configured
- [ ] Set resource limits/requests (CPU/RAM) in k8s/Swarm
- [ ] Run backups and verify restore
- [ ] Confirm service worker cache invalidation on release
- [ ] Monitor logs and alerts (error rates, latency, DB size)

## License
See `LICENSE`.

## Links
- Repo: https://github.com/Gamedirection/Open-Trivia
- License: https://raw.githubusercontent.com/Gamedirection/Open-Trivia/refs/heads/main/LICENSE
- Changelog: [docs/CHANGELOG.md](docs/CHANGELOG.md)
- OpenAPI: [docs/openapi.json](docs/openapi.json)
- Helm chart: [helm/open-trivia](helm/open-trivia)
- Maintenance Checklist: [docs/Maintenance Checklist (How to)](https://github.com/Gamedirection/Open-Trivia/blob/main/docs/CHANGELOG.md#maintenance-checklist-how-to)
- Questions submodule: [docs/Open-Trivia-Questions](docs/Open-Trivia-Questions)
