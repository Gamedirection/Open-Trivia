# Changelog / Roadmap

## v0.3.19
- Added include/exclude category filtering in solo Play with visible category pills.
- Added saved custom category presets that users can name, reapply, and remove from their Profile.
- Renamed the user-facing Stats navigation/page language to Profile while keeping activity summaries available.
- Added include/exclude category filtering to Share Play room creation and host/admin room settings.
- Added inline category renaming in the admin Categories section.
- Updated admin category pack import so CSV files can be uploaded directly without a zip when no images are needed.
- Added URL import support for CSV URLs and shared Google Sheets CSV exports, alongside existing GitHub/zip imports.
- Added the `custom_category_groups` database table and runtime migration for existing deployments.

## v0.3.18
- Added **Suggest a Question** and **⚠ Report** buttons to the Share Play game view, matching the feature set of solo play.
- Both actions persist across question changes - opening either panel while a round transitions keeps the modal or dropdown open on the next question.
- Report captures the question ID at the moment the dropdown is opened, so a mid-report question change still targets the correct question.
- Report dropdown supports General / Inappropriate / Incorrect types with an optional free-text description, matching the solo game report flow.
- Confirmed reports and feedback messages are shown inline in the action bar.

## v0.3.17
- Added **Share Play** - real-time multiplayer trivia powered by Socket.io with a persistent Live Room and player-created private/public rooms.
- Live Room runs continuously with auto-cycling questions and is accessible to all players without a code.
- Private rooms use a randomized 4-digit code; the first player is host, and admin transfers automatically to the highest-scoring player if the host leaves. Empty rooms auto-delete after 5 minutes.
- Public rooms are listed in the Share Play lobby sorted by player count, with a join button and live refresh.
- Full host and admin settings panels: timer (5–120 s), base correct/incorrect points, time bonus multiplier, speed-medal bonuses (🥇🥈🥉) for the first three voters, category filter, and public/private toggle.
- Admin-only Live Room settings panel (visible to admin-role users only) with the same full control surface.
- Scoring: correct = base pts + time-bonus × seconds-remaining + speed-medal bonus; incorrect = flat pts. Session score resets after 30 minutes of inactivity.
- Logged-in players' Share Play points are added to their leaderboard score and recorded in game history.
- Toggle: **Live Votes** - show per-option vote breakdown bars (off by default) or hide them.
- Toggle: **Voter Count** - show/hide the X/Y voted counter.
- Toggle: **Show players' answers** - reveal which option each player chose.
- Toggle: **Player stats** - show answered/correct counts in the scoreboard.
- Toggle: **A–F accuracy rating** - per-player accuracy badge derived from session history.
- Toggle: **Allow guess changes** - players can revise their answer before time runs out.
- Early round end: if all players vote and guess-change is off, the round ends immediately; if guess-change is on, a 5-second warning countdown fires and the round ends early unless someone changes their answer.
- Top-10 session scoreboard visible throughout the round; logged-in players see their personal score highlighted.
- Default settings match the configured admin preset: timer 15 s, correct 5 pts, incorrect 1 pt, time bonus ×0.25, gold/silver/bronze +5/+3/+1, voter count on, live vote breakdown off.

## v0.3.16
- Synced the bundled Discord bot with paginated schedule listings so large recurring-job lists fit within Discord's message limits.
- Updated the Discord bot interaction code to use current Discord.js flags-based ephemeral replies and `ClientReady` startup handling.

## v0.3.15
- Added Discord schedule run-status tracking so recurring trivia now records whether the last attempt succeeded or failed.
- Updated backend schedule bookkeeping so the next scheduled run reflects the most recent attempt instead of stale timestamps.
- Synced the bundled Discord bot with schedule hardening, bulk removal support, and dynamic version reporting improvements.

## v0.3.14
- Stabilized the gameplay timer chip so it keeps a fixed width and no longer shifts the difficulty badge as the timer updates.
- Updated Docker Compose frontend runtime defaults so the footer version now follows the deployed frontend image tag (`latest` by default, or a pinned `FRONTEND_IMAGE_TAG` when provided).
- Refined the frontend success feedback with a faster rainbow correct-answer animation, emoji star-burst particles, and smaller footer logo sizing while keeping the header logo at its original size.

## v0.3.11
- Added support for two-answer or four-answer questions across admin question creation, user suggestions, and backend validation.
- Added Discord bot question suggestions through `/suggest-question`, sending requests into the admin review queue.
- Flagged Discord-submitted review items in the admin Review Queue with a `Discord Bot` badge.
- Removed `A/B/C/D` prefixes from Discord answer buttons so they display only the answer text.

## v0.3.10
- Added dedicated Discord scoring defaults in admin scoring settings, with fixed per-difficulty values that ignore answer timing.
- Set default Discord trivia scoring to Easy `+5`, Medium `+10`, and Hard `+15`, while keeping site gameplay on the existing time-based scoring model.
- Updated Discord answer responses to include the difficulty and awarded points, such as `Correct. This Medium question was +10 points.`
- Defaulted the admin panel to open on the Review Queue tab instead of Questions.
- Updated the Discord bot to display question images when a trivia item includes one.
- Improved Discord scheduler command handling and empty-list channel messaging.

## v0.3.6
- Added public Terms of Use and Privacy Policy pages to the frontend.
- Added env/runtime-config support for deployment-specific legal operator, contact, site URL, and policy effective date values.
- Linked the new legal pages from the app footer and populated them with product-specific disclosures covering account data, Discord integrations, backups, audit logs, privacy controls, and security practices.
- Added a configurable Discord bot invite URL in the admin Data section, with an env default pointing at the Discord application authorization link.

## v0.3.5
- Increased the Discord bot default trivia timeout to 24 hours and aligned the root Docker Compose and env defaults with that behavior.
- Expired Discord trivia messages are now deleted after timeout instead of remaining in-channel.
- Incorrect Discord answers now reveal the correct answer privately to the player.
- Discord users who answer through the bot are now auto-created in Open-Trivia so their scores can be recorded without prior site login.

## v0.3.4
- Added the Discord Bot admin settings card and bot settings APIs to the deployed backend/frontend flow, including enable/disable, bot token, service URL, and public app URL controls.
- Added refreshed backend/frontend GHCR images so production deployments can pick up the Discord bot admin configuration UI.
- Trimmed blank answer slots from question payloads so web gameplay and bot sessions only show real answers.
- Updated the web game answer grid to rebalance layouts for two-answer questions such as True/False.
- Expanded the Discord bot command set with `/categories` and `/help`, plus scheduler channel targeting and richer slash-command handling.

## v0.3.3
- Added Discord SSO with OAuth login, verified-email account linking, and callback handling for both `/api/auth/discord/callback` and `/auth/discord/callback`.
- Added admin-managed Discord SSO settings in the Data tab, including an in-app setup guide and runtime enable/disable controls.
- Added Discord avatar support across the signed-in header, admin users list, and leaderboard, with Gravatar fallback preserved.
- Added persisted `discord_sso_settings` storage and Discord profile fields on users for avatar and account-link metadata.
- Added the `services/open-trivia-discord` submodule and initial Discord bot service with `/ot`, `/leaderboard`, `/otschedule`, DM play, public button-based play, and recurring trivia schedules.
- Added Discord bot backend APIs, bot settings in the admin Data tab, and server-scoped Discord leaderboard tracking.

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
