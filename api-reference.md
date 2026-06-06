# Football Predictor — API Reference

Complete endpoint reference for the Football Predictor REST API. All routes are prefixed `/api/v1`.

## Authentication

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/auth/register` | None | Register with invite token + email/password/display_name |
| `POST` | `/auth/login` | None | Login via OAuth2 form (`username`=email, `password`) → JWT token |

---

## Users

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/users/me` | User | Get current user profile |
| `PUT` | `/users/me/profile` | User | Update display_name, email, password (requires current_password for password change) |
| `POST` | `/users/bulk-provision` | Admin | Upload CSV of users (name, email) → creates accounts with temp passwords |
| `PUT` | `/users/{id}/permissions` | Admin | Update granular permissions (can_manage_leagues, can_invite_users) |

---

## Fixtures

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/fixtures` | User | List all fixtures (optional `?tournament_id=`) |
| `GET` | `/fixtures/{fixture_id}` | User | Get single fixture by ID |

---

## Match Predictions

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/match-predictions` | User | Submit/update score prediction for a fixture |
| `GET` | `/match-predictions` | User | List user's own predictions |

**Lock Rules (HTTP 423)**:
- Phase-level lock: If the first kickoff in a stage (group/round-of-16/etc.) has passed, the entire stage is locked.
- Individual lock: Predictions lock 15 minutes before the fixture's kickoff time.

---

## Bracket

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/bracket` | User | Submit/overwrite bracket (group picks + KO picks) for a tournament |
| `GET` | `/bracket/me` | User | Get own bracket (optional `?tournament_id=`) |
| `DELETE` | `/bracket/clear` | User | Clear bracket picks (`?tournament_id=&type=all\|group\|knockout`) |

**Lock**: Locks when the first group-stage fixture of the tournament kicks off, or at `TOURNAMENT_LOCK_AT` if no fixtures are seeded.

---

## Leagues

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/leagues` | User | List leagues (optional `?tournament_id=&joined_only=true`) |
| `POST` | `/leagues` | LeagueManager | Create a league |
| `DELETE` | `/leagues/{id}` | LeagueManager | Delete a league |
| `GET` | `/leagues/invite-details/{token}` | None | Get league name from invite token |
| `POST` | `/leagues/join` | User | Join a league via invite token |
| `POST` | `/leagues/{id}/logo` | User (owner/admin) | Upload logo image (PNG/JPG/SVG/GIF) |

---

## Rankings

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/rankings/{league_id}` | User | Get leaderboard for a league (from Redis sorted set) |
| `GET` | `/rankings/{league_id}/history` | User | Get historical ranking snapshots from DB |

---

## Tournaments

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/tournaments` | User | List active tournaments |
| `GET` | `/tournaments/{id}` | User | Get tournament by ID |
| `POST` | `/tournaments` | Admin | Create a tournament |

---

## Admin

All routes require the `admin` UserRole.

### User Management
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/admin/users` | List all users ordered by total_points descending |
| `PUT` | `/admin/users/{id}/role` | Update user role + permissions + is_active |
| `GET` | `/admin/users/{id}/details` | Get nested user details: tournaments → leagues membership |

### Tournament Management
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/admin/tournaments` | List all tournaments for administration |
| `POST` | `/admin/tournaments` | Create tournament with auto bracket detection |
| `PUT` | `/admin/tournaments/{id}` | Update tournament fields |
| `POST` | `/admin/tournaments/{id}/sync` | Trigger Wikipedia scraper fixture sync (Redis-mutex protected) |
| `POST` | `/admin/tournaments/{id}/reset` | Purge all predictions + fixtures and re-scrape from scratch |
| `GET` | `/admin/tournaments/detect-bracket` | Check if a league ID has brackets (World Cup=1, Euro=4) |

### Invitations
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/admin/invitations` | List unclaimed, non-revoked, non-expired invitations (includes legacy league tokens) |
| `POST` | `/admin/invitations` | Generate a UUID invitation token for a league |
| `DELETE` | `/admin/invitations/{token}` | Revoke an invitation (or clear legacy token) |

### Settings & Monitoring
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/admin/settings` | List key/value settings (seeds live_sync_interval if missing) |
| `PUT` | `/admin/settings` | Update site_address and live_sync_interval |
| `GET` | `/admin/api-usage` | Get current daily API calls count from Redis |
| `GET` | `/admin/test-sync` | Diagnostic: run seeder and return result + traceback |
| `POST` | `/admin/sync-fixtures` | Legacy: trigger full fixture sync (Redis-mutex protected) |

### Auth Dependencies
| Dependency | Scope |
|-----------|-------|
| `get_current_user` | Any valid JWT token from an active user |
| `get_current_admin` | User must have `role == "admin"` |
| `get_current_league_manager` | Admin OR user with `can_manage_leagues == true` |
| `get_current_inviter` | Admin OR user with `can_invite_users == true` |

---

## Common Error Responses

| Status | Meaning |
|--------|---------|
| `401` | Invalid/missing JWT token |
| `403` | Insufficient role/permissions |
| `404` | Resource not found |
| `422` | Validation error |
| `423` | Resource is locked (prediction or bracket window closed) |
| `429` | Sync already in progress (Redis mutex acquired) |