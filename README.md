# Open-Trivia

Created by gamedirection.net © 2026  
Discord: join.gamedirection.net  
Credits: Alex Sierputowski @ GameDirection.net

## ✅ Epic 1 — Authentication & User Management
*Focus: auth service, roles, admin console.*

- [X] Allow users to reset passwords  
    - [X] Need to connect to email server to send token to users. (Dev environments only atm)
- [X] Allows admin to reset user password  
- [X] Allow admin to see all users  
- [X] You should only be able to report/suggest when signed in as a User/Admin  
- [X] Record anonymous users on the backend, don't display their stats on the leaderboard

**Notes**
- [X] Add `isAnonymous` flag and exclude from public leaderboard queries  
- [X] Role-based access for report/suggest endpoints  
- [X] Token-based password reset flow (time-limited, one-time use)  
- [X] Audit log for admin operations (password reset, user views)

---

## ✅ Epic 2 — Leaderboard & Scoring
*Focus: score model, queries, time windows, scheduler.*

- [X] Hide admin scores from leaderboard (from player view)  
- [X] Allow category specific scores  
- [X] Allow users to filter leaderboard by category  
- [X] Allow users to see scores for the Day, Month, Year  
- [X] Allow user to reset their score  
- [X] Allow timer tied to score (faster = higher score) with min/max bounds  
- [X] Allow admin to reset leaderboard on a schedule (daily/weekly/monthly/yearly)

**Notes**
- [X] Extend score schema: `userId`, `categoryId`, `score`, `createdAt`, `isAdmin`, `isAnonymous`  
- [X] Indexes for time windows (day/month/year)  
- [X] Scheduled resets via cron/Cloud Scheduler; idempotent jobs with logs  
- [X] Score reset retains audit trail (soft delete or archival table)  
- [ ] Anti-cheat checks for timer-based scoring

**Scoring Config (env)**
- `SCORE_MIN_POINTS` (default `5`)
- `SCORE_MAX_EASY` (default `10`)
- `SCORE_MAX_MED` (default `15`)
- `SCORE_MAX_HARD` (default `20`)
- `SCORE_FAST_MS` (default `2000`)
- `SCORE_SLOW_MS` (default `20000`)
- `DIFF_MIN_ATTEMPTS` (default `25`)
- `DIFF_UP_THRESHOLD` (default `0.4`)
- `DIFF_DOWN_THRESHOLD` (default `0.8`)

---

## ✅ Epic 3 — Categories & Visibility
*Focus: category model, selection UI.*

- [X] Allow users to choose categories  
- [X] Improve category visibility (searchable dropdown + create new)  
- [X] (UI piece shared with Epic 2) Leaderboard category filter

**Notes**
- [ ] Normalize categories, enforce uniqueness via slug  
- [ ] Decide governance: admin-only creation vs. user-suggested with moderation  
- [ ] Deduping and merge paths for near-duplicates

---

## ✅ Epic 4 — User-facing Analytics & Personalization
*Focus: personal dashboard, aggregates.*

- [X] Allow users to see personal stats and data

**Notes**
- [ ] Display totals, per-category breakdown, and time-window stats  
- [ ] Reuse leaderboard aggregation logic to avoid duplication  
- [ ] Include recent activity and optional streaks

---

## ✅ Epic 5 — Content & Media Enhancements
*Focus: question editor, storage, safe embeds.*

- [ ] Allow PNG/JPEG/WebP images to be uploaded with question  
- [ ] Allow linking to video

**Notes**
- [ ] Validate MIME types, size limits, and image dimensions  
- [ ] Generate thumbnails and store URLs  
- [ ] Support oEmbed (YouTube/Vimeo) or safe link previews with sanitization

---

## ✅ Epic 6 — API & Documentation
*Focus: OpenAPI/Swagger, DX.*

- [ ] Create an Open API endpoint documentation

**Notes**
- [ ] Publish OpenAPI spec + Swagger UI  
- [ ] Document auth (security schemes), pagination, sorting, and filters  
- [ ] Provide request/response examples for leaderboard and categories

---

## ✅ Epic 7 — Data Management & Operations
*Focus: backups, exports, audit.*

- [ ] Backup button (internal)  
- [ ] Export data button (external download)

**Notes**
- [ ] Backups to secure storage, role-gated, audit-logged  
- [ ] Exports as CSV/JSON; filters by date range/category; PII redaction options

---

## ✅ Epic 8 — UX, Theme & Visual Polish
*Focus: dark mode consistency, browser quirks.*

- [ ] Dark mode does not extend edge-to-edge on Edge browser (fix)

**Notes**
- [ ] Ensure `html, body, #root` use dark background and 100% height  
- [ ] Validate scrollbar/overlay colors in Edge; test high-contrast mode  
- [ ] Add visual regression test for dark theme boundaries

---

## 🧭 Recommended Order (Dependencies)
1. [X] Epic 1 — Authentication & User Management  
2. [ ] Epic 3 — Categories & Visibility  
3. [ ] Epic 2 — Leaderboard & Scoring  
4. [ ] Epic 4 — User-facing Analytics & Personalization  
5. [ ] Epic 8 — UX, Theme & Visual Polish  
6. [ ] Epic 5 — Content & Media Enhancements  
7. [ ] Epic 6 — API & Documentation  
8. [ ] Epic 7 — Data Management & Operations

---

## 🧪 Sample Acceptance Criteria (Checklists)

**Auth & User Management**
- [ ] Users can request password reset; tokens expire and are single-use  
- [ ] Admin can reset a specific user’s password; action is audit-logged  
- [ ] Anonymous users stored with `isAnonymous=true`; excluded from public leaderboards  
- [ ] Report/suggest endpoints require authentication and correct role (401/403 otherwise)

**Leaderboard & Scoring**
- [ ] Leaderboard filters by category and by day/month/year windows  
- [ ] Admin scores are excluded from player view leaderboards  
- [ ] Users can reset their own scores (scoped: category or global) with confirmation  
- [ ] Scheduled resets run on time with logs and dry-run capability  
- [ ] Timer-based scoring respects configured min/max multipliers and anti-cheat rules

**Categories & Visibility**
- [ ] Searchable category dropdown available on create/play flows  
- [ ] “Create new category” path follows governance decision; duplicates prevented

**Analytics**
- [ ] Personal dashboard shows totals, time windows, and per-category breakdown  
- [ ] Stats match leaderboard aggregates for the same filters

**Content & Media**
- [ ] Image uploads accept PNG/JPEG/WebP with size/type validation; thumbnails generated  
- [ ] Video links render previews or embeds; invalid links handled gracefully

**API & Docs**
- [ ] OpenAPI published with security schemes, examples, and error models  
- [ ] Documented query parameters for category/timeframe filters and `includeAnonymous=false`

**Data & Ops**
- [ ] Backup button triggers snapshot; success/failure notifications visible  
- [ ] Export supports CSV/JSON, scoped by filters; admin-only; PII options respected

**UX/Theme**
- [ ] Dark mode renders edge-to-edge in Edge; meets WCAG AA contrast

---

## 🗂️ Optional Sprint Breakdown

**Sprint 1 — Auth Foundations**
- [ ] User + admin password reset  
- [ ] Anonymous handling  
- [ ] Gate report/suggest  
- [ ] Admin list users

**Sprint 2 — Categories & Base UI**
- [ ] Category model  
- [ ] Searchable dropdown  
- [ ] Create-new flow + validation

**Sprint 3 — Scoring Foundations**
- [ ] Category-specific scores  
- [ ] Hide admin scores  
- [ ] Day/Month/Year queries  
- [ ] User score reset

**Sprint 4 — Scheduler & Analytics**
- [ ] Scheduled leaderboard resets  
- [ ] Personal stats dashboard

**Sprint 5 — Theme & UX Polish**
- [ ] Dark mode fix (Edge)  
- [ ] Minor UI refinements

**Sprint 6 — Media Enhancements**
- [ ] Image uploads + thumbnails  
- [ ] Video linking + previews

**Sprint 7 — API & Docs**
- [ ] OpenAPI spec  
- [ ] Swagger UI + examples

**Sprint 8 — Data & Ops**
- [ ] Backup button  
- [ ] Data export + PII options

---

## ⚡ Quick Wins
- [ ] Hide admin scores (server-side filter + cache bust)  
- [ ] Dark mode edge-to-edge fix (CSS roots)  
- [ ] Leaderboard category filter (UI + query param)  
- [ ] Gate report/suggest endpoints behind auth (middleware)













---


## TODO
- [x] Fix Leaderboard
    - [x] Display Users
    - [x] Display scores
- [x] Fix Report Button
- [x] Fix Response to accurately display correct or wrong
- [x] Fix Question Request
- [x] Fix Admin Pending Question
    - [x] Add Reported questions here
    - [x] Questions in Pending Que are not live
- [x] Fix Categories adding (admins can't manage categories)
- [x] Better randomization
- [ ] Allow users to choose categories
- [ ] Allow users to see personal stats and data
- [ ] Allow users to reset passwords
- [ ] Improve Category visibility. (dropdown + create a new)
- [ ] Hide admin scores from leaderboard (from player view)
- [ ] Allow category specific scores
- [ ] Allow user to reset their score
- [ ] Darkmode does not extend edge to edge on edge browser? (darkmode doesn't seem to be properly dark)
- [ ] Allow admin to reset leaderboard on a schedual (once a day, once a week, once a month, once a year)
- [ ] Allow users to filter leaderboard by categorey
- [ ] Allow users to see scores for the Day, Month, Year
- [ ] Create an Open API endpoint documentation.
- [ ] Allow admin to see all users
- [ ] Allows admin to reset user password
- [ ] Backup button (internal)
- [ ] Export data button (external download)
- [ ] Allow png/jpeg/wepb images to be uploaded with question
- [ ] Allow linking to video
- [ ] Allow timer, tied to score (faster higher score) (min/max)
- [ ] You should only be able to report/suggest when signed in as a User/Admin
- [ ] record annynmous users on the backend, don't display their stats on the leaderboard.


--- Template stuff

## Getting started

To make it easy for you to get started with GitLab, here's a list of recommended next steps.

Already a pro? Just edit this README.md and make it your own. Want to make it easy? [Use the template at the bottom](#editing-this-readme)!

## Add your files

- [ ] [Create](https://docs.gitlab.com/ee/user/project/repository/web_editor.html#create-a-file) or [upload](https://docs.gitlab.com/ee/user/project/repository/web_editor.html#upload-a-file) files
- [ ] [Add files using the command line](https://docs.gitlab.com/topics/git/add_files/#add-files-to-a-git-repository) or push an existing Git repository with the following command:

```
cd existing_repo
git remote add origin https://gitlab.myctms.it/asierputowski/trivia-app.git
git branch -M main
git push -uf origin main
```

## Integrate with your tools

- [ ] [Set up project integrations](https://gitlab.myctms.it/asierputowski/trivia-app/-/settings/integrations)

## Collaborate with your team

- [ ] [Invite team members and collaborators](https://docs.gitlab.com/ee/user/project/members/)
- [ ] [Create a new merge request](https://docs.gitlab.com/ee/user/project/merge_requests/creating_merge_requests.html)
- [ ] [Automatically close issues from merge requests](https://docs.gitlab.com/ee/user/project/issues/managing_issues.html#closing-issues-automatically)
- [ ] [Enable merge request approvals](https://docs.gitlab.com/ee/user/project/merge_requests/approvals/)
- [ ] [Set auto-merge](https://docs.gitlab.com/user/project/merge_requests/auto_merge/)

## Test and Deploy

Use the built-in continuous integration in GitLab.

- [ ] [Get started with GitLab CI/CD](https://docs.gitlab.com/ee/ci/quick_start/)
- [ ] [Analyze your code for known vulnerabilities with Static Application Security Testing (SAST)](https://docs.gitlab.com/ee/user/application_security/sast/)
- [ ] [Deploy to Kubernetes, Amazon EC2, or Amazon ECS using Auto Deploy](https://docs.gitlab.com/ee/topics/autodevops/requirements.html)
- [ ] [Use pull-based deployments for improved Kubernetes management](https://docs.gitlab.com/ee/user/clusters/agent/)
- [ ] [Set up protected environments](https://docs.gitlab.com/ee/ci/environments/protected_environments.html)

***

# Editing this README

When you're ready to make this README your own, just edit this file and use the handy template below (or feel free to structure it however you want - this is just a starting point!). Thanks to [makeareadme.com](https://www.makeareadme.com/) for this template.

## Suggestions for a good README

Every project is different, so consider which of these sections apply to yours. The sections used in the template are suggestions for most open source projects. Also keep in mind that while a README can be too long and detailed, too long is better than too short. If you think your README is too long, consider utilizing another form of documentation rather than cutting out information.

## Name
Choose a self-explaining name for your project.

## Description
Let people know what your project can do specifically. Provide context and add a link to any reference visitors might be unfamiliar with. A list of Features or a Background subsection can also be added here. If there are alternatives to your project, this is a good place to list differentiating factors.

## Badges
On some READMEs, you may see small images that convey metadata, such as whether or not all the tests are passing for the project. You can use Shields to add some to your README. Many services also have instructions for adding a badge.

## Visuals
Depending on what you are making, it can be a good idea to include screenshots or even a video (you'll frequently see GIFs rather than actual videos). Tools like ttygif can help, but check out Asciinema for a more sophisticated method.

## Installation
Within a particular ecosystem, there may be a common way of installing things, such as using Yarn, NuGet, or Homebrew. However, consider the possibility that whoever is reading your README is a novice and would like more guidance. Listing specific steps helps remove ambiguity and gets people to using your project as quickly as possible. If it only runs in a specific context like a particular programming language version or operating system or has dependencies that have to be installed manually, also add a Requirements subsection.

## Usage
Use examples liberally, and show the expected output if you can. It's helpful to have inline the smallest example of usage that you can demonstrate, while providing links to more sophisticated examples if they are too long to reasonably include in the README.

## Support
Tell people where they can go to for help. It can be any combination of an issue tracker, a chat room, an email address, etc.

## Roadmap
If you have ideas for releases in the future, it is a good idea to list them in the README.

## Contributing
State if you are open to contributions and what your requirements are for accepting them.

For people who want to make changes to your project, it's helpful to have some documentation on how to get started. Perhaps there is a script that they should run or some environment variables that they need to set. Make these steps explicit. These instructions could also be useful to your future self.

You can also document commands to lint the code or run tests. These steps help to ensure high code quality and reduce the likelihood that the changes inadvertently break something. Having instructions for running tests is especially helpful if it requires external setup, such as starting a Selenium server for testing in a browser.

## Authors and acknowledgment
Alexander Sierputowski

## License
For open source projects, say how it is licensed.

## Project status
If you have run out of energy or time for your project, put a note at the top of the README saying that development has slowed down or stopped completely. Someone may choose to fork your project or volunteer to step in as a maintainer or owner, allowing your project to keep going. You can also make an explicit request for maintainers.

