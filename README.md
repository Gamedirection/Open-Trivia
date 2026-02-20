# Open-Trivia

Created by [gamedirection.net](https://gamedirection.net) © 2026  
Discord: [join.gamedirection.net](https://join.gamedirection.net)  
Credits: Alex Sierputowski @ [GameDirection.net](https://gamedirection.net)

## Overview
Open-Trivia is a multiplayer trivia platform with admin tooling, category management, adaptive difficulty, leaderboard scoring, and user analytics.

## Key Features
- Auth with password reset, admin roles, and account blocking.
- Leaderboards with category and timeframe filters (day/month/year).
- Leaderboard privacy options: hidden emails for guests, display names, optional censoring, optional anonymous entries.
- Timer-based scoring with configurable min/max points.
- Adaptive question difficulty based on answer accuracy.
- User dashboard with stats and per-category breakdown.
- Profile & privacy: display name edits, email visibility toggle, optional Gravatar icons.
- Question images by URL (png/jpg/jpeg/svg/webp).
- Data management: backups, export/import, and per-user restore.
- CSV question import/export with template.
- Helm chart for Kubernetes deployments.

## Architecture
- Frontend: React SPA.
- Backend: Node/Express + PostgreSQL.
- Images: GHCR.

## Quickstart (Docker Compose)
```bash
docker compose up -d
```

### Env (Backend)
```bash
PG_HOST=db
PG_PORT=5432
PG_USER=trivia_user
PG_PASSWORD=trivia_pass
PG_DB=trivia_db
JWT_SECRET=change-me
APP_URL=http://localhost:3000
```

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
- Data Management: backups, export/import, restore a single user.
- Questions: CSV export/import and template download.

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
  --set image.frontend.tag=v0.2.1 \
  --set image.backend.tag=v0.2.1 \
  --set backend.env.JWT_SECRET=change-me
```

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
