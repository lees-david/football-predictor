# World Cup Predictor ⚽

Private prediction league platform for the 2026 World Cup and beyond. Players compete in invite-only leagues by predicting exact match scores and building full tournament knockout brackets. Scores sync live from football-data.org, predictions are graded automatically, and leaderboards update in real time.

Designed for the 48-team 2026 World Cup format: 12 groups of 4 (A–L), top 2 + 8 best 3rd-place teams advance to a 32-team knockout bracket.

---

## Player Features

### Match Predictions
Submit exact scorelines for every fixture before kickoff. The scoring engine awards:
- **5 points** — exact score (e.g., predict 2–1, result 2–1)
- **3 points** — correct goal margin (e.g., predict 2–0, result 3–1)
- **2 points** — correct outcome only (home win / draw / away win)
- **0 points** — everything else

Predictions lock 15 minutes before kickoff. The match card transitions through four visual states: editable → locked → live → completed, with points awarded after grading.

### Knockout Bracket Builder
Build your full tournament pathway before the first match kicks off. The **Symmetric Wings** layout splits the 32-team bracket into left and right wings converging on the Championship card at center screen. Selecting a team auto-propagates that team into the next round's slot.

The KO bracket uses the **"Any Path" scoring model** — you earn points for correctly predicting which teams reach each round, regardless of which bracket path they took to get there:

| Milestone | Points per team |
|-----------|----------------|
| Group position (1st or 2nd) | +2 |
| Round of 32 qualification | +3 |
| Round of 16 | +5 |
| Quarterfinals | +8 |
| Semifinals | +12 |
| Perfect Champion & Runner-Up pick | +20 |
| Inverse final (correct teams, wrong winner) | +10 |
| Correct 3rd place | +8 |

### Group Standings Predictions
Predict the final order (1st–4th) for each group. Scoring: 5 points per exact position, 2 points if the team advances but you got the order wrong, +10 bonus for a perfect group sweep. Standings are resolved using FIFA tiebreaker rules: points → goal difference → goals scored → head-to-head → Wikipedia as final authority.

### Leagues & Leaderboards
Create or join private leagues via invitation tokens. League leaderboards update in real time with score breakdowns: Exact / Margin / Result / Bracket points. Historical ranking snapshots are captured after each matchday and tournament stage.

### Profile & Points History
Your Profile page shows a per-tournament points breakdown (Match / Groups / KO) and a scrollable timeline of every scoring event — which fixture or stage awarded how many points and why.

### Email Digests
Opt in to receive daily digest emails summarizing completed matches, your results, league standings, and upcoming lock deadlines. Available when your league admin enables emails and the tournament is in live email mode.

---

## Mobile Web App Client 📱

A fully optimized, mobile-first React client is served at the `/m/` subpath (compiled via the `mobile-frontend` directory and served from `static_mobile`).

### Redirection & Auto-Discovery
- **Device Detection:** The backend detects mobile User-Agents and automatically redirects them from `/` to `/m/` (only if redirection is enabled).
- **Redirection Controls:**
  - Auto-redirection is disabled by default on production to prevent disruption to existing users.
  - It can be enabled globally via `MOBILE_REDIRECT_ENABLED=true` in `.env`.
  - Alternatively, you can configure Nginx to inject the `X-Enable-Mobile-Redirect: 1` header on a specific test port (e.g. `8082`), allowing you to test mobile redirection in isolation while production remains on the desktop view.
- **Opt-Out Cookie:** Users can force-load the desktop view on a mobile device by setting the `force_desktop=1` cookie or adding the query parameter `?force_desktop=1` to the URL.

---

## Admin Features

Promote your account to admin:
```bash
docker compose exec app python core/promote_user.py <your_email>
```

The Admin panel (`/admin`) provides:

### User Management
View all users with roles, permissions, total points, and active status. Edit roles (admin / player), toggle granular permissions (`can_manage_leagues`, `can_manage_tournaments`, `can_invite_users`), activate/deactivate accounts.

### League & Tournament Management
Create/delete leagues, manage invitation tokens (generate / revoke / view pending), create tournaments with auto-bracket detection, set active/inactive status, trigger fixture sync per tournament, reset and re-scrape a tournament's fixtures.

### User Provisioning
Bulk-import users via CSV (email, display_name, password) into a league. Each row is processed independently — a duplicate email only skips that row without aborting the entire batch.

### Database Backups & Data Portability
Manage system-level PostgreSQL database backups and prediction dataset portability from the **Backups** panel (`/admin/backups`):
- **Automated Scheduling** — Enable automated database backups at a preferred UTC time (e.g. `03:00`) with a configurable retention threshold (e.g. `7` days). Old backups are automatically pruned by a Celery background worker.
- **Manual Backups** — Trigger manual PostgreSQL binary backups (`pg_dump -Fc`) on-demand with real-time file size and creation timestamps.
- **Destructive Restore** — Restore database state from a backup file (purges the existing database schema and executes `pg_restore` with safety guards). Requires typing `RESTORE` to prevent accidental execution.
- **Prediction Import/Export** — Export all user match predictions and group/KO bracket picks for a tournament as a single structured JSON file mapped by unique user emails and stable fixture external IDs. Import files back into the database to restore or migrate predictions, with statistics on imported rows and skipped elements.

---

## Simulation Mode

Before the real tournament starts, admins can mock-play the entire competition using the **Simulation** page (`/admin/simulate`):

1. **Complete individual fixtures** — set home/away scores, mark completed. Auto-dispatches match grading, group standings grading, and KO bracket grading.
2. **Bulk-complete a group** — set all 6 fixtures in a group to finished with a single click.
3. **Advance a KO stage** — after completing a round, click "Advance" to auto-populate the next round's fixtures based on knockout winners.
4. **Complete a KO stage** — finish all matches in a stage with randomized realistic scores.
5. **Reset fixtures** — reverse awarded points, clear scores, reopen for re-simulation.

Simulation runs in `email_mode=simulation` by default — no real emails are sent, and all sends are logged as `simulated`. Switch a tournament to `email_mode=live` when the real tournament begins.

---

## Results Manager

When the football-data.org API provides wrong data or misses a result, admins manually correct it via the **Results Manager** (`/admin/results`):

- **Set a fixture result** — enter home/away scores (and AET scores for KO matches). If the fixture was already completed, previously awarded points are automatically reversed before re-grading. No double-counting.
- **Edit KO team names** — if the API populates the wrong team for a knockout slot, correct the home/away team names. Points are reversed, teams updated, grading re-dispatched.
- **Post-match day verification** — after each matchday, spot-check the Results Manager against official scores. Any correction triggers full re-grading for that fixture + its group/stage.

---

## Audit System

The **Audit Page** (`/admin/audit`) runs integrity checks across all scoring data. Run it after fixing a bug, after a sync failure, or periodically:

### What it detects
- **Score mismatches** — predictions where `points_awarded` doesn't match what the scoring engine would award today
- **Grading orphans** — completed fixtures with ungraded predictions (`points_awarded=0`, `is_locked=false`)
- **Total points drift** — users whose `total_points` doesn't match the sum of their ledger entries
- **Double grading** — duplicate ledger entries for the same user + source
- **Fixture-ledger mismatch** — the sum of `match_predictions.points_awarded` for a fixture doesn't match the sum of `user_points_ledger` for that fixture
- **Null-score completed** — fixtures marked `completed` but missing home/away scores (data corruption)
- **KO/Group grading coverage** — which stages have been graded (via Redis idempotency guards)

### Regrading
When an audit reveals issues, use the force-regrade endpoints:
```
POST /admin/audit/regrade/group/{group_code}?tournament_id=1
POST /admin/audit/regrade/ko?tournament_id=1&stage=round_16
```
These delete the Redis idempotency guard and re-run grading from scratch.

---

## Email Management

The platform uses [Resend](https://resend.com) for transactional and marketing emails. Configure everything from **Email Management** (`/admin/email`):

### Setup
1. Get a Resend API key and set `TRANS_EMAIL_API_KEY` in `.env`
2. Set `SITE_URL` to your public domain (used in email links)
3. Optionally set `RESEND_WEBHOOK_SECRET` to receive delivery/bounce events

### Configuration
- **Tournament email mode**: `simulation` (all sends logged, none dispatched) or `live` (real sends via Resend)
- **Email types per tournament**: toggle `welcome`, `round_summary`, `daily_digest` on/off per tournament
- **League emails enabled**: per-league toggle — only members of emails-enabled leagues receive marketing emails
- **User opt-in**: each user can opt in/out of each email type from their Profile page

### Templates
Edit Jinja2 HTML templates for each email type from the admin panel. Available context variables: `user_name`, `tournament_name`, `site_url`, `matches[]`, `leagues[]`, `upcoming_fixtures[]`, `next_round_name`, `next_round_lock_time`.

### Sending
- **View logs** — every email (simulated or live) is logged with status (`queued` / `sent` / `failed` / `bounced`), subject, body, and timestamp
- **Resend queued** — click "Send Now" on any `queued` log entry to dispatch it for real
- **Broadcast** — preview recipients matching league/opt-in filters, then send a custom subject + HTML body to all of them at once
- **Test send** — send a preview of any email type to yourself with dummy context data
- **Send estimates** — see projected total sends per email type across the tournament (rounds × users for round_summary, match-days × users for daily_digest)

### Webhook (delivery tracking)
Resend POSTs delivery events to `POST /api/v1/email/webhook`. The webhook verifies Svix signatures (if `RESEND_WEBHOOK_SECRET` is set) and updates `email_log.status` for `delivered` / `bounced` / `delivery_delayed` events. Set your Resend webhook URL to `https://<your-domain>/api/v1/email/webhook`.

---

## Live Score Syncing (football-data.org API)

### Prerequisites
1. Register at [football-data.org](https://www.football-data.org) and get a free API key
2. Set `FOOTBALL_DATA_API_KEY=<your-key>` in `.env`
3. If the key is missing or invalid, the poller logs an error and skips — no crashes

**Free tier limits**: 10 requests/minute. The poller uses 1 request per competition per poll cycle (fetches all 104 World Cup fixtures in a single call), so even at a 5-minute poll interval you're well within budget. Scores on the free tier are delayed (not real-time), so polling faster than 5 minutes buys nothing.

### How it works
- **`poll_live_fixtures`** — runs every minute via Celery beat, self-guards with a configurable Redis interval (default 5 minutes). Fetches all completed fixtures for each active tournament, compares against a pre-poll snapshot, and dispatches grading for any newly-completed fixtures (match grading → group standings grading → KO stage grading).
- **`daily_fixture_sync`** — runs at 06:00 UTC. Full sync for all active tournaments, also dispatches grading.
- **Admin manual sync** — `POST /admin/tournaments/{id}/sync` triggers an on-demand sync with Redis mutex lock (prevents double-click launches).

### Configuring the sync interval
From the Admin Settings panel, set `live_sync_interval` (in minutes, default 5). This controls how often the live poller actually calls the API — the Celery task fires every minute but skips if the interval hasn't elapsed.

---

## Environment Variables

Create a `.env` file (copy from `.env.example`):

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | **Yes** | PostgreSQL connection string (e.g., `postgresql://user:pass@db:5432/worldcup`) |
| `REDIS_URL` | **Yes** | Redis connection string (e.g., `redis://redis:6379/0`) |
| `SECRET_KEY` | **Yes** | JWT signing key, min 32 chars. Generate with `openssl rand -hex 32` |
| `TRANS_EMAIL_API_KEY` | **Yes** | Resend API key for sending emails |
| `FOOTBALL_DATA_API_KEY` | No | football-data.org v4 API key. Empty = live sync disabled |
| `RESEND_WEBHOOK_SECRET` | No | Svix signing secret for Resend webhook verification |
| `CORS_ALLOWED_ORIGINS` | No | Comma-separated frontend origins (e.g., `https://app.example.com`). Empty = all cross-origin requests blocked |
| `SITE_URL` | No | Public URL used in email links (default: `http://localhost:8083`) |
| `TOURNAMENT_LOCK_AT` | No | Override bracket lock time as ISO timestamp. Empty = derived from earliest group fixture kickoff |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | No | JWT token lifetime in minutes (default: 10080 = 1 week) |
| `MAX_DIGEST_EMAILS_PER_DAY` | No | Daily cap on digest emails (default: 100) |
| `MOBILE_REDIRECT_ENABLED` | No | Enable auto-redirect of mobile User-Agents from `/` to `/m/` (default: `false`) |
| `DEBUG` | No | Enable debug mode (default: `false`) |

---

## Quick Start

### Prerequisites
- Docker & Docker Compose
- A Resend account (for email) and optionally a football-data.org account (for live scores)

### Setup
```bash
git clone <repo-url>
cd worldcup-predictor

# Create and configure environment
cp .env.example .env
# Edit .env — at minimum set DATABASE_URL, REDIS_URL, SECRET_KEY, TRANS_EMAIL_API_KEY

# Start all services
docker compose up --build
```

The application will automatically:
- Run all Alembic migrations
- Start FastAPI (port 8080, mapped to 8084 on host), PostgreSQL 16, Redis 7, and Celery worker + beat scheduler
- Serve the React frontend from the same container

Access the web interface at **`http://localhost:8084`**.

### First Steps
1. Promote yourself to admin: `docker compose exec app python core/promote_user.py <your_email>`
2. Create a tournament via Admin → Manage Tournaments
3. Sync fixtures: click "Sync" on the tournament row (requires `FOOTBALL_DATA_API_KEY`)
4. Create a league via Admin → League Manager
5. Generate invitations and share with players
6. Configure email: set tournament `email_mode` to `live`, enable email types, verify templates
7. Before matchday 1: use Simulation mode to test the scoring pipeline
8. During the tournament: monitor the Audit page for integrity, correct results via Results Manager as needed

---

## Maintenance Mode

The platform includes a scheduled maintenance lockout system for seamless server updates:

### Database Settings
Controlled via the `settings` table:
- `maintenance:enabled` — manual force toggle (`true`/`false`)
- `maintenance:start_time` / `maintenance:end_time` — ISO-8601 UTC window
- `maintenance:message` — custom downtime message shown to users
- `maintenance:auto_enabled` — enable daily auto-update checks
- `maintenance:preferred_time` — preferred daily check time (e.g., `03:00`)

### How it works
1. A countdown banner appears for non-admin users when a start time is scheduled
2. When active (cached in Redis with 15-second DB sync), all non-admin requests return `503 Service Unavailable`
3. The frontend detects `503` responses, logs out the user, and redirects to the maintenance screen
4. Admins are exempt and can monitor active user counts via the Maintenance Admin panel

### Host-Side Auto-Pull
`check_and_deploy.sh` runs on the host via cron (e.g., every 5 minutes): fetches remote commits, pushes hashes to the DB for the admin panel, schedules downtime at the preferred time if `auto_enabled`, then executes `git pull` + migrations + service restart within the window.

---

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript 5, Vite 5, Tailwind CSS 3, TanStack React Query 5, Recharts 2, Lucide Icons |
| Backend | Python 3.12, FastAPI 0.115, SQLAlchemy 2.0 (async), Alembic (16 migrations), Pydantic 2 |
| Database | PostgreSQL 16 (via asyncpg) |
| Cache | Redis 7 (sorted sets for leaderboards, rate-limit counters, idempotency guards, user heartbeats) |
| Task Queue | Celery 5.4 with Redis broker + Celery Beat (daily sync, live poller, digest, points recalculation) |
| Email | Resend API + Svix webhooks for delivery tracking |
| Live Scores | football-data.org v4 API (competition-wide single-request polling) |
| Scoring | Custom "Any Path" KO bracket engine, FIFA group tiebreaker chain with Wikipedia fallback |
| CI/CD | Forgejo |

---

## Development & Testing

### Running tests
```bash
cd app
pytest
```
15 test files covering: auth flows, scoring engine, KO bracket grading, group tiebreakers, leaderboard operations, CSV provisioning, bracket schema validation, prediction locking, football-data result parsing, maintenance mode, request middleware, and targeted reset logic.

### Frontend typechecking
- **Desktop client:**
  ```bash
  cd app/frontend
  npx tsc --noEmit
  ```
- **Mobile client:**
  ```bash
  cd app/mobile-frontend
  npx tsc --noEmit
  ```

---

## Documentation

- **[scoring.md](scoring.md)** — Complete scoring rules for match predictions, group brackets, and KO brackets
- **[project-review.md](project-review.md)** — Codebase audit findings and design decisions
- **[open-tasks.md](open-tasks.md)** — Implementation pipeline with phase tracking
- **[schema.md](schema.md)** — Database schema reference
- **[api-reference.md](api-reference.md)** — API endpoint reference

---

## License

MIT