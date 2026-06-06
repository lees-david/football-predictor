export interface FifaRankingInfo {
  rank: number;
  points?: number;
}

// Comprehensive database of international teams and their official/realistic FIFA rankings.
// Values can be looked up by normalized (lowercase, trimmed) country names.
export const FIFA_RANKINGS_DB: Record<string, FifaRankingInfo> = {
  "argentina": { rank: 1, points: 1860 },
  "france": { rank: 2, points: 1840 },
  "spain": { rank: 3, points: 1830 },
  "england": { rank: 4, points: 1810 },
  "brazil": { rank: 5, points: 1780 },
  "belgium": { rank: 6, points: 1762 },
  "portugal": { rank: 7, points: 1753 },
  "netherlands": { rank: 8, points: 1748 },
  "italy": { rank: 9, points: 1729 },
  "colombia": { rank: 10, points: 1724 },
  "germany": { rank: 11, points: 1702 },
  "croatia": { rank: 12, points: 1690 },
  "morocco": { rank: 13, points: 1681 },
  "uruguay": { rank: 14, points: 1675 },
  "japan": { rank: 15, points: 1645 },
  "switzerland": { rank: 16, points: 1638 },
  "senegal": { rank: 17, points: 1629 },
  "united states": { rank: 18, points: 1625 },
  "usa": { rank: 18, points: 1625 },
  "mexico": { rank: 19, points: 1618 },
  "iran": { rank: 20, points: 1611 },
  "denmark": { rank: 21, points: 1604 },
  "austria": { rank: 22, points: 1598 },
  "korea republic": { rank: 23, points: 1589 },
  "south korea": { rank: 23, points: 1589 },
  "australia": { rank: 24, points: 1572 },
  "ukraine": { rank: 25, points: 1558 },
  "turkey": { rank: 26, points: 1551 },
  "ecuador": { rank: 27, points: 1545 },
  "sweden": { rank: 28, points: 1538 },
  "wales": { rank: 29, points: 1530 },
  "egypt": { rank: 30, points: 1526 },
  "hungary": { rank: 31, points: 1518 },
  "canada": { rank: 32, points: 1515 },
  "poland": { rank: 33, points: 1506 },
  "serbia": { rank: 34, points: 1502 },
  "algeria": { rank: 35, points: 1498 },
  "cameroon": { rank: 36, points: 1491 },
  "peru": { rank: 37, points: 1484 },
  "slovakia": { rank: 38, points: 1480 },
  "romania": { rank: 39, points: 1474 },
  "czechia": { rank: 40, points: 1470 },
  "czech republic": { rank: 40, points: 1470 },
  "tunisia": { rank: 41, points: 1468 },
  "nigeria": { rank: 42, points: 1461 },
  "chile": { rank: 43, points: 1455 },
  "scotland": { rank: 44, points: 1449 },
  "costa rica": { rank: 45, points: 1445 },
  "greece": { rank: 46, points: 1441 },
  "cote d'ivoire": { rank: 47, points: 1438 },
  "ivory coast": { rank: 47, points: 1438 },
  "norway": { rank: 48, points: 1431 },
  "albania": { rank: 49, points: 1420 },
  "georgia": { rank: 50, points: 1415 },
  "slovenia": { rank: 51, points: 1410 },
  "iraq": { rank: 55, points: 1395 },
  "saudi arabia": { rank: 56, points: 1391 },
  "qatar": { rank: 58, points: 1378 },
  "panama": { rank: 60, points: 1365 },
  "venezuela": { rank: 62, points: 1350 },
  "finland": { rank: 64, points: 1342 },
  "paraguay": { rank: 66, points: 1330 },
  "republic of ireland": { rank: 68, points: 1320 },
  "ireland": { rank: 68, points: 1320 },
  "south africa": { rank: 70, points: 1315 },
  "honduras": { rank: 75, points: 1290 },
  "bolivia": { rank: 80, points: 1270 },
  "new zealand": { rank: 94, points: 1210 },
  "jamaica": { rank: 59, points: 1370 },
};

// Normalize names (lowercase, trim, strip punctuation/dashes, match alias keys)
export function getFifaRanking(teamName: string | null | undefined): FifaRankingInfo | null {
  if (!teamName) return null;
  const cleanName = teamName.toLowerCase().trim();
  
  // Direct check
  if (FIFA_RANKINGS_DB[cleanName]) {
    return FIFA_RANKINGS_DB[cleanName];
  }

  // Fallback checks (e.g., matching partial names or stripping punctuation/accents)
  const normKey = cleanName
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (FIFA_RANKINGS_DB[normKey]) {
    return FIFA_RANKINGS_DB[normKey];
  }

  // Fuzzy match if name starts/ends with a key or vice versa
  for (const [key, value] of Object.entries(FIFA_RANKINGS_DB)) {
    if (normKey.includes(key) || key.includes(normKey)) {
      return value;
    }
  }

  // Placeholder generation for test groups/placeholder teams like "A1", "B2"
  const placeholderMatch = cleanName.match(/^([a-l])([1-4])$/i);
  if (placeholderMatch) {
    const groupChar = placeholderMatch[1].toUpperCase();
    const groupNum = parseInt(placeholderMatch[2], 10);
    // Give placeholder groups a pseudo-rank based on their letter/number sequence
    const offset = (groupChar.charCodeAt(0) - 65) * 4 + groupNum;
    return {
      rank: 48 + offset,
      points: 1400 - offset * 10
    };
  }

  return null;
}
