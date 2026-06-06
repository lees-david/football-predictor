"""
FIFA group-stage tiebreaker chain.

Order of resolution:
  1. Points (3 / 1 / 0)
  2. Overall goal difference
  3. Overall goals scored
  4. Head-to-head points among the still-tied teams
  5. Head-to-head goal difference
  6. Head-to-head goals scored
  7. Wikipedia standings table (per-group page) — the authoritative resolver
     for the residual cases (fair play + FIFA ranking + drawing of lots) we
     don't compute locally.

Fair play scoring and FIFA World Ranking are not stored in the DB; instead of
approximating them we trust Wikipedia for the final ordering whenever the
local tiebreakers can't separate teams.
"""
from __future__ import annotations

import logging
import re
from typing import Iterable

import requests
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

# (season, group_code) -> ordered list of team names from Wikipedia
_WIKI_CACHE: dict[tuple[int, str], list[str]] = {}


def _empty_stats() -> dict:
    return {"pts": 0, "gd": 0, "gf": 0}


def _stats_from_subset(fixtures: Iterable, teams: set[str]) -> dict[str, dict]:
    """Build pts/GD/GF considering only fixtures whose both sides are in `teams`."""
    stats: dict[str, dict] = {t: _empty_stats() for t in teams}
    for f in fixtures:
        if f.home_team not in teams or f.away_team not in teams:
            continue
        hs, as_ = f.home_score, f.away_score
        if hs is None or as_ is None:
            continue
        if hs > as_:
            stats[f.home_team]["pts"] += 3
        elif hs == as_:
            stats[f.home_team]["pts"] += 1
            stats[f.away_team]["pts"] += 1
        else:
            stats[f.away_team]["pts"] += 3
        stats[f.home_team]["gd"] += hs - as_
        stats[f.away_team]["gd"] += as_ - hs
        stats[f.home_team]["gf"] += hs
        stats[f.away_team]["gf"] += as_
    return stats


def _fetch_wiki_group_order(season: int, group_code: str) -> list[str]:
    """Return Wikipedia's finishing order for a group, or [] on any failure."""
    key = (season, group_code.upper())
    if key in _WIKI_CACHE:
        return _WIKI_CACHE[key]

    url = f"https://en.wikipedia.org/wiki/{season}_FIFA_World_Cup_Group_{group_code.upper()}"
    try:
        r = requests.get(
            url,
            headers={"User-Agent": "FootballPredictorScraper/1.0"},
            timeout=10,
        )
        r.raise_for_status()
    except Exception as exc:
        logger.warning("Wiki tiebreaker fetch failed for %s Group %s: %s", season, group_code, exc)
        _WIKI_CACHE[key] = []
        return []

    soup = BeautifulSoup(r.text, "html.parser")
    order: list[str] = []
    for table in soup.find_all("table", class_=re.compile(r"\bwikitable\b")):
        header_text = " ".join(th.get_text(" ", strip=True) for th in table.find_all("th"))
        if "Pld" not in header_text or "Pts" not in header_text or "GD" not in header_text:
            continue
        for row in table.find_all("tr")[1:]:
            cells = row.find_all(["td", "th"])
            if len(cells) < 4:
                continue
            team_name: str | None = None
            for c in cells[:4]:
                link = c.find("a")
                if link and link.get_text(strip=True):
                    team_name = link.get_text(strip=True)
                    break
            if team_name and team_name not in order:
                order.append(team_name)
        if order:
            break

    _WIKI_CACHE[key] = order
    if not order:
        logger.warning("Wiki tiebreaker: no standings table parsed for %s Group %s", season, group_code)
    return order


def _wiki_resolve(season: int | None, group_code: str | None, tied: list[str]) -> list[str]:
    """Order tied team names by Wikipedia; fall back to alphabetical if the page is unreachable."""
    if len(tied) <= 1:
        return tied
    if not season or not group_code:
        return sorted(tied)
    order = _fetch_wiki_group_order(season, group_code)
    if not order:
        return sorted(tied)
    return sorted(tied, key=lambda t: order.index(t) if t in order else 9_999)


def _resolve_h2h(tied: list[str], fixtures: list, group_code: str | None, season: int | None) -> list[str]:
    """Resolve a still-tied subset by H2H sub-table; Wikipedia is the final fallback."""
    h2h = _stats_from_subset(fixtures, set(tied))
    ranked = sorted(
        tied,
        key=lambda t: (h2h[t]["pts"], h2h[t]["gd"], h2h[t]["gf"]),
        reverse=True,
    )
    out: list[str] = []
    i = 0
    while i < len(ranked):
        j = i + 1
        key_i = (h2h[ranked[i]]["pts"], h2h[ranked[i]]["gd"], h2h[ranked[i]]["gf"])
        while j < len(ranked):
            key_j = (h2h[ranked[j]]["pts"], h2h[ranked[j]]["gd"], h2h[ranked[j]]["gf"])
            if key_i != key_j:
                break
            j += 1
        sub = ranked[i:j]
        if len(sub) == 1:
            out.append(sub[0])
        else:
            out.extend(_wiki_resolve(season, group_code, sub))
        i = j
    return out


def rank_teams_in_group(
    team_stats: dict[str, dict],
    fixtures: Iterable,
    group_code: str | None,
    season: int | None,
) -> list[str]:
    """
    Return the four teams of a group ordered best-to-worst using the full FIFA chain.
    `team_stats` must already contain overall pts/gd/gf computed from all 6 group fixtures.
    `fixtures` is the full list of group fixtures (used to compute H2H sub-tables).
    """
    fixtures = list(fixtures)
    primary = sorted(
        team_stats,
        key=lambda t: (team_stats[t]["pts"], team_stats[t]["gd"], team_stats[t]["gf"]),
        reverse=True,
    )
    out: list[str] = []
    i = 0
    while i < len(primary):
        j = i + 1
        key_i = (team_stats[primary[i]]["pts"], team_stats[primary[i]]["gd"], team_stats[primary[i]]["gf"])
        while j < len(primary):
            key_j = (team_stats[primary[j]]["pts"], team_stats[primary[j]]["gd"], team_stats[primary[j]]["gf"])
            if key_i != key_j:
                break
            j += 1
        tied = primary[i:j]
        if len(tied) == 1:
            out.append(tied[0])
        else:
            out.extend(_resolve_h2h(tied, fixtures, group_code, season))
        i = j
    return out


def rank_third_place_teams(
    candidates: list[tuple[str, str, dict]],
    season: int | None,
) -> list[str]:
    """
    Rank the 12 third-place finishers across all groups.
    `candidates`: list of (group_code, team_name, stats) where stats has pts/gd/gf.
    H2H is meaningless here (these teams haven't played each other), so we apply
    pts/GD/GF then defer to Wikipedia per-group pages — and finally alphabetical.
    """
    primary = sorted(
        candidates,
        key=lambda x: (x[2]["pts"], x[2]["gd"], x[2]["gf"]),
        reverse=True,
    )
    out: list[str] = []
    i = 0
    while i < len(primary):
        j = i + 1
        sa = primary[i][2]
        key_i = (sa["pts"], sa["gd"], sa["gf"])
        while j < len(primary):
            sb = primary[j][2]
            key_j = (sb["pts"], sb["gd"], sb["gf"])
            if key_i != key_j:
                break
            j += 1
        sub = primary[i:j]
        if len(sub) == 1:
            out.append(sub[0][1])
        else:
            # No single Wikipedia table ranks all 3rd-place teams together —
            # use deterministic alphabetical ordering. Real-world resolution
            # (fair play / FIFA ranking) is rare and would require manual override.
            out.extend(team for _, team, _ in sorted(sub, key=lambda x: x[1]))
        i = j
    return out
