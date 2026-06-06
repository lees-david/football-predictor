const R32_PLACEHOLDERS: Record<string, string> = {
  "R32 Home Placeholder 1": "Runner-up Group A",
  "R32 Away Placeholder 1": "Runner-up Group B",
  "R32 Home Placeholder 2": "Winner Group C",
  "R32 Away Placeholder 2": "Runner-up Group F",
  "R32 Home Placeholder 3": "Winner Group E",
  "R32 Away Placeholder 3": "3rd Group A/B/C/D/F",
  "R32 Home Placeholder 4": "Winner Group F",
  "R32 Away Placeholder 4": "Runner-up Group C",
  "R32 Home Placeholder 5": "Runner-up Group E",
  "R32 Away Placeholder 5": "Runner-up Group I",
  "R32 Home Placeholder 6": "Winner Group I",
  "R32 Away Placeholder 6": "3rd Group C/D/F/G/H",
  "R32 Home Placeholder 7": "Winner Group A",
  "R32 Away Placeholder 7": "3rd Group C/E/F/H/I",
  "R32 Home Placeholder 8": "Winner Group L",
  "R32 Away Placeholder 8": "3rd Group E/H/I/J/K",
  "R32 Home Placeholder 9": "Winner Group G",
  "R32 Away Placeholder 9": "3rd Group A/E/H/I/J",
  "R32 Home Placeholder 10": "Winner Group D",
  "R32 Away Placeholder 10": "3rd Group B/E/F/I/J",
  "R32 Home Placeholder 11": "Winner Group H",
  "R32 Away Placeholder 11": "Runner-up Group J",
  "R32 Home Placeholder 12": "Runner-up Group K",
  "R32 Away Placeholder 12": "Runner-up Group L",
  "R32 Home Placeholder 13": "Winner Group B",
  "R32 Away Placeholder 13": "3rd Group E/F/G/I/J",
  "R32 Home Placeholder 14": "Runner-up Group D",
  "R32 Away Placeholder 14": "Runner-up Group G",
  "R32 Home Placeholder 15": "Winner Group J",
  "R32 Away Placeholder 15": "Runner-up Group H",
  "R32 Home Placeholder 16": "Winner Group K",
  "R32 Away Placeholder 16": "3rd Group D/E/I/J/L",
};

const R16_PLACEHOLDERS: Record<string, string> = {
  "R16 Home Placeholder 1": "Winner Match 73",
  "R16 Away Placeholder 1": "Winner Match 75",
  "R16 Home Placeholder 2": "Winner Match 74",
  "R16 Away Placeholder 2": "Winner Match 77",
  "R16 Home Placeholder 3": "Winner Match 76",
  "R16 Away Placeholder 3": "Winner Match 78",
  "R16 Home Placeholder 4": "Winner Match 79",
  "R16 Away Placeholder 4": "Winner Match 80",
  "R16 Home Placeholder 5": "Winner Match 83",
  "R16 Away Placeholder 5": "Winner Match 84",
  "R16 Home Placeholder 6": "Winner Match 81",
  "R16 Away Placeholder 6": "Winner Match 82",
  "R16 Home Placeholder 7": "Winner Match 86",
  "R16 Away Placeholder 7": "Winner Match 88",
  "R16 Home Placeholder 8": "Winner Match 85",
  "R16 Away Placeholder 8": "Winner Match 87",
};

const QF_PLACEHOLDERS: Record<string, string> = {
  "Quarter-finals Home Placeholder 1": "Winner Match 89",
  "Quarter-finals Away Placeholder 1": "Winner Match 90",
  "Quarter-finals Home Placeholder 2": "Winner Match 91",
  "Quarter-finals Away Placeholder 2": "Winner Match 92",
  "Quarter-finals Home Placeholder 3": "Winner Match 93",
  "Quarter-finals Away Placeholder 3": "Winner Match 94",
  "Quarter-finals Home Placeholder 4": "Winner Match 95",
  "Quarter-finals Away Placeholder 4": "Winner Match 96",
  "QF Home Placeholder 1": "Winner Match 89",
  "QF Away Placeholder 1": "Winner Match 90",
  "QF Home Placeholder 2": "Winner Match 91",
  "QF Away Placeholder 2": "Winner Match 92",
  "QF Home Placeholder 3": "Winner Match 93",
  "QF Away Placeholder 3": "Winner Match 94",
  "QF Home Placeholder 4": "Winner Match 95",
  "QF Away Placeholder 4": "Winner Match 96",
};

const SF_PLACEHOLDERS: Record<string, string> = {
  "Semi-finals Home Placeholder 1": "Winner Quarterfinal 1",
  "Semi-finals Away Placeholder 1": "Winner Quarterfinal 2",
  "Semi-finals Home Placeholder 2": "Winner Quarterfinal 3",
  "Semi-finals Away Placeholder 2": "Winner Quarterfinal 4",
  "SF Home Placeholder 1": "Winner Quarterfinal 1",
  "SF Away Placeholder 1": "Winner Quarterfinal 2",
  "SF Home Placeholder 2": "Winner Quarterfinal 3",
  "SF Away Placeholder 2": "Winner Quarterfinal 4",
};

const TP_PLACEHOLDERS: Record<string, string> = {
  "Third Place Play-off Home Placeholder": "Loser Match 101",
  "Third Place Play-off Away Placeholder": "Loser Match 102",
  "Third Place Playoff Home Placeholder": "Loser Match 101",
  "Third Place Playoff Away Placeholder": "Loser Match 102",
  "3rd Place Play-off Home Placeholder": "Loser Match 101",
  "3rd Place Play-off Away Placeholder": "Loser Match 102",
};

const FINAL_PLACEHOLDERS: Record<string, string> = {
  "Final Home Placeholder": "Winner Match 101",
  "Final Away Placeholder": "Winner Match 102",
};

export function cleanTeamName(name: string | null | undefined): string {
  if (!name) return '—';
  
  const clean = 
    R32_PLACEHOLDERS[name] ||
    R16_PLACEHOLDERS[name] ||
    QF_PLACEHOLDERS[name] ||
    SF_PLACEHOLDERS[name] ||
    TP_PLACEHOLDERS[name] ||
    FINAL_PLACEHOLDERS[name];
    
  return clean || name;
}
