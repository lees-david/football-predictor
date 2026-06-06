# Football Predictor — Schema Reference

Entity-Relationship map and field reference for all database models.

---

## Entity Relationship Diagram

```
Tournament
├── Fixture (1:N)            — 104 matches per tournament
│   └── MatchPrediction (1:N) — per-user, per-fixture
│       └── User (N:1)
│
├── League (1:N)             — private competition pools
│   ├── LeagueMember (1:N)   — join table linking User ↔ League
│   │   └── User (N:1)
│   └── HistoricalRanking (1:N) — periodic rank snapshots
│       └── User (N:1)
│
├── BracketPrediction (1:N)  — one-per-user-per-tournament
│   ├── BracketGroupPick (1:N) — 32 rows (8 groups × 4 positions)
│   └── BracketKoPick (1:N)    — per round, per slot (up to 16 KO slots)
│
User
├── Invitation (N:1, created_by)
├── Invitation (N:1, claimed_by)
├── MatchPrediction (1:N)
├── BracketPrediction (1:N)
├── LeagueMember (1:N)
└── HistoricalRanking (1:N)

Setting (standalone key/value table, no FK relationships)
```

---

## Core Tables

### users
| Column | Type | Notes |
|--------|------|-------|
| `id` | `Integer` | PK |
| `email` | `String(320)` | UNIQUE, INDEXED |
| `hashed_password` | `String(255)` | bcrypt hash |
| `display_name` | `String(100)` | Shown on leaderboards |
| `role` | `Enum(user_role)` | `admin` or `player` |
| `total_points` | `Integer` | Aggregated from graded predictions |
| `current_rank` | `Integer?` | Nullable rank position |
| `is_active` | `Boolean` | Can login if true |
| `can_manage_leagues` | `Boolean` | Granular permission |
| `can_manage_tournaments` | `Boolean` | Granular permission |
| `can_invite_users` | `Boolean` | Granular permission |
| `created_at` | `DateTime(tz)` | `server_default=now()` |
| `updated_at` | `DateTime(tz)` | Auto-updated |

---

### tournaments
| Column | Type | Notes |
|--------|------|-------|
| `id` | `Integer` | PK |
| `name` | `String(120)` | e.g. "World Cup 2026" |
| `is_active` | `Boolean` | Visible to users |
| `has_bracket` | `Boolean` | Does this tournament have a bracket? |
| `api_league_id` | `Integer?` | API-Football league ID (1=World Cup, 4=Euro) |
| `api_season` | `Integer?` | Season year (e.g. 2026) |
| `created_at` | `DateTime(tz)` | `server_default=now()` |

---

### fixtures
| Column | Type | Notes |
|--------|------|-------|
| `id` | `Integer` | PK |
| `tournament_id` | `FK → tournaments.id` | Required |
| `external_id` | `String(64)?` | API-Football match ID, nullable (scraper doesn't set it) |
| `stage` | `Enum(fixture_stage)` | `group`, `round_16`, `quarter_final`, `semi_final`, `third_place`, `final` |
| `group_code` | `String(2)?` | `"A"`–`"L"`, NULL for KO stages |
| `matchday` | `SmallInt?` | 1-3 for group stage |
| `home_team` | `String(80)` | Team name |
| `home_logo` | `String(255)?` | URL to team flag/logo |
| `away_team` | `String(80)` | Team name |
| `away_logo` | `String(255)?` | URL to team flag/logo |
| `kickoff_time` | `DateTime(tz)` | INDEXED |
| `home_score` | `SmallInt?` | NULL until match completes |
| `away_score` | `SmallInt?` | NULL until match completes |
| `status` | `Enum(fixture_status)` | `scheduled`, `live`, `completed`, `postponed` — INDEXED |
| `bracket_slot` | `String(20)?` | e.g. `"W49"`, `"R16-A"` |
| `venue` | `String(150)?` | Stadium name + city |
| `updated_at` | `DateTime(tz)` | Auto-updated on change |

---

### match_predictions
| Column | Type | Notes |
|--------|------|-------|
| `id` | `Integer` | PK |
| `user_id` | `FK → users.id` | INDEXED |
| `fixture_id` | `FK → fixtures.id` | INDEXED |
| `predicted_home` | `SmallInt` | ≥ 0 (CHECK constraint) |
| `predicted_away` | `SmallInt` | ≥ 0 (CHECK constraint) |
| `points_awarded` | `SmallInt` | 0/2/3/5, computed when fixture completes |
| `is_locked` | `Boolean` | True if submitted within 15 min of kickoff |
| `submitted_at` | `DateTime(tz)` | `server_default=now()` |
| `updated_at` | `DateTime(tz)` | Auto-updated |

**Unique constraint**: `(user_id, fixture_id)`

---

### bracket_predictions
| Column | Type | Notes |
|--------|------|-------|
| `id` | `Integer` | PK |
| `user_id` | `FK → users.id` | INDEXED |
| `tournament_id` | `FK → tournaments.id` | |
| `is_locked` | `Boolean` | Toggled globally at tournament start |
| `total_points` | `Integer` | Sum of group + KO points |
| `submitted_at` | `DateTime(tz)` | |
| `updated_at` | `DateTime(tz)` | Auto-updated |

**Unique constraint**: `(user_id, tournament_id)`

---

### bracket_group_picks
One row per (user, group, position). 4 rows per group = 32 rows per bracket.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `Integer` | PK |
| `bracket_id` | `FK → bracket_predictions.id` | CASCADE delete |
| `group_code` | `String(1)` | `"A"`–`"H"` |
| `position` | `SmallInt` | 1–4 (1st = group winner) |
| `predicted_team` | `String(80)` | Team name |

**Unique constraint**: `(bracket_id, group_code, position)`

---

### bracket_ko_picks
One row per (user, KO round, slot). Up to 16 slots per bracket.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `Integer` | PK |
| `bracket_id` | `FK → bracket_predictions.id` | CASCADE delete |
| `round` | `Enum(ko_round)` | `round_16`, `quarter_final`, `semi_final`, `final`, `champion` |
| `slot` | `String(10)` | e.g. `"R16-1"`, `"QF-2"` |
| `predicted_team` | `String(80)` | Team name |

**Unique constraint**: `(bracket_id, round, slot)`

---

### leagues
| Column | Type | Notes |
|--------|------|-------|
| `id` | `Integer` | PK |
| `name` | `String(120)` | League display name |
| `invite_token` | `String(16)` | Legacy token (`secrets.token_urlsafe(12)`) — UNIQUE |
| `created_by` | `FK → users.id` | League creator |
| `tournament_id` | `FK → tournaments.id` | Each league is scoped to one tournament |
| `is_active` | `Boolean` | Default true |
| `logo_url` | `String(255)?` | Path to custom logo (e.g. `/uploads/leagues/...`) |
| `created_at` | `DateTime(tz)` | |

---

### league_members
| Column | Type | Notes |
|--------|------|-------|
| `id` | `Integer` | PK |
| `user_id` | `FK → users.id` | INDEXED |
| `league_id` | `FK → leagues.id` | INDEXED |
| `joined_at` | `DateTime(tz)` | |

**Unique constraint**: `(user_id, league_id)`

---

### invitations
UUID-based invitation system (replaces legacy `League.invite_token`).

| Column | Type | Notes |
|--------|------|-------|
| `id` | `Integer` | PK |
| `token` | `String(64)` | Format `inv-{token_urlsafe(24)}` — UNIQUE, INDEXED |
| `league_id` | `FK → leagues.id` | CASCADE delete |
| `created_by` | `FK → users.id` | Admin who created it |
| `claimed_by` | `FK → users.id?` | NULL until a user claims it |
| `created_at` | `DateTime(tz)` | |
| `claimed_at` | `DateTime(tz)?` | Timestamp when claimed |
| `expires_at` | `DateTime(tz)?` | Optional expiration |
| `is_revoked` | `Boolean` | Default false |

---

### historical_rankings
Periodic snapshots of leaderboard state, taken after each matchday or phase.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `Integer` | PK |
| `user_id` | `FK → users.id` | |
| `league_id` | `FK → leagues.id` | |
| `matchday_id` | `String(30)?` | Labels: `"GS-D1"`, `"GS-D2"`, `"GS-D3"`, `"R16"`, `"QF"`, `"SF"`, `"F"` |
| `points_at_time` | `Integer` | Points at snapshot time |
| `rank_at_time` | `SmallInt` | 1-indexed rank |
| `recorded_at` | `DateTime(tz)` | INDEXED |

**Composite index**: `(user_id, league_id, recorded_at)`

---

### settings
Simple key/value configuration store.

| Column | Type | Notes |
|--------|------|-------|
| `key` | `String(100)` | PK — e.g. `"site_address"`, `"live_sync_interval"` |
| `value` | `String(255)` | Configuration value |

---

## Enum Types

### fixture_stage
`group`, `round_32`, `round_16`, `quarter_final`, `semi_final`, `third_place`, `final`

### fixture_status
`scheduled`, `live`, `completed`, `postponed`

### user_role
`admin`, `player`

### ko_round
`round_16`, `quarter_final`, `semi_final`, `final`, `champion`

---

## Key Constraints & Indexes

| Table | Constraint | Type |
|-------|-----------|------|
| `match_predictions` | `(user_id, fixture_id)` | UNIQUE |
| `match_predictions` | `predicted_home >= 0` | CHECK |
| `match_predictions` | `predicted_away >= 0` | CHECK |
| `bracket_predictions` | `(user_id, tournament_id)` | UNIQUE |
| `bracket_group_picks` | `(bracket_id, group_code, position)` | UNIQUE |
| `bracket_ko_picks` | `(bracket_id, round, slot)` | UNIQUE |
| `league_members` | `(user_id, league_id)` | UNIQUE |
| `historical_rankings` | `(user_id, league_id, recorded_at)` | INDEX |
| `fixtures` | `kickoff_time` | INDEX |
| `fixtures` | `status` | INDEX |
| `invitations` | `token` | UNIQUE, INDEX |