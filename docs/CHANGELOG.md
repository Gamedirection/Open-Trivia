# Changelog / Roadmap

## v0.3.2
- Added optional branded logo support via Docker Compose and Helm (fallback to default icon).
- Frontend now reads version from the image tag when provided.

## v0.3.1
- Moved the collections/questions repo into a submodule at `docs/Open-Trivia-Questions`.
- Updated template README location in the docs to point at the submodule.
- Added the category pack template zip to the collections repo.
- Category pack import now accepts GitHub release asset URLs in addition to repo zips.

## v0.3.0
- Privacy controls: display names, hide email toggle, admin global/default email visibility.
- Leaderboard privacy: hide emails for logged-out users, optional name censoring, optional anonymous users, optional Gravatar icons (auto-hidden when censoring).
- Admin controls for rate limits on reports/suggestions with guest and user tuning (0 disables).
- Rate limits for guest/user reports and question suggestions.
- Blocked users excluded from leaderboard.
- Question images via URL with admin-configurable size limits (png/jpg/jpeg/svg/webp).
- Admin image uploads for questions with server storage.
- User suggestions can include image URLs.
- Report reasons with optional details (general/inappropriate/incorrect).
- Category packs: export selected categories as zip (CSV + images) and import from zip or GitHub.
- Category pack template download (zip).
- Collections repo template and admin UI link for shared packs.
- Footer now includes version link to changelog.

## v0.2.0
- Admin data management: backups, export/import, per‑user restore.
- CSV question import/export + template.
- Adaptive difficulty based on answer accuracy (admin‑tunable thresholds).
- User blocking with duration (0 = forever).
- Gravatar avatars in header/leaderboard/admin.
- Personal stats dashboard with per‑category breakdown.
- Leaderboard ratios with letter grades.
- Category filters + searchable dropdowns.
- Helm chart added.
- Footer updates + credits dropdown.

## v0.1.2
- Admin scoring settings UI.
- Dynamic difficulty parameters in scoring settings.
- Leaderboard and dashboard refresh UX improvements.
- Dark mode background applied to full page.

## v0.1.1
- Rebrand to Open‑Trivia.
- Credits + Discord + site links added.
- Reset password emails updated.

## v0.1.0
- Initial gameplay, categories, admin, and leaderboard.

## Roadmap
- [ ] Anti‑cheat checks for timer‑based scoring
- [ ] Image/video support on questions
- [ ] Governance workflow for category creation
- [ ] CSV export filters and PII redaction options
- [ ] Swagger UI hosted at `/docs`

## Maintenance Checklist (How-To)
- [ ] Update Helm chart versions
  Steps:
  1. Edit `helm/open-trivia/Chart.yaml` and bump `version` and `appVersion`.
  2. Update image tags in `helm/open-trivia/values.yaml`.
  3. Verify chart renders: `helm template open-trivia helm/open-trivia`.
- [ ] Update Docker details
  Steps:
  1. Confirm `docker-compose.yml` images/ports/envs.
  2. If Swarm is used, verify the secrets section is correct and enabled.
- [ ] Update Changelog
  Steps:
  1. Append a new version section at top of `docs/CHANGELOG.md`.
  2. Summarize key changes and any breaking items.
- [ ] Update OpenAPI documentation
  Steps:
  1. Edit `docs/openapi.json` for new/changed endpoints.
  2. Verify it loads at `/openapi.json`.
  3. If Swagger UI is enabled, refresh `/docs`.
- [ ] Update GitHub repo metadata
  Steps:
  1. Review `README.md` for accuracy (tags, links, features).
  2. Update links under **Links** if paths change.
- [ ] Build and push images
  Steps:
  1. `docker compose build`
  2. Tag: `docker tag open-trivia-frontend:latest ghcr.io/gamedirection/open-trivia-frontend:vX.Y.Z`
  3. Tag: `docker tag open-trivia-backend:latest ghcr.io/gamedirection/open-trivia-backend:vX.Y.Z`
  4. Push: `docker push ghcr.io/gamedirection/open-trivia-frontend:vX.Y.Z`
  5. Push: `docker push ghcr.io/gamedirection/open-trivia-backend:vX.Y.Z`
  6. Update `latest` tags if desired and push them.
