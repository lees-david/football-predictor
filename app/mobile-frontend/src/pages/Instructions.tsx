import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '../components/ui/Card';
import { useMyLeagues } from '../api/hooks/useRankings';
import { useMyPredictions } from '../api/hooks/usePredictions';
import { useMyBracket } from '../api/hooks/useBracket';
import { useTournamentContext } from '../api/TournamentContext';
import { useFixtures } from '../api/hooks/useFixtures';
import { formatDateTime } from '../utils/timezone';
import { 
  CheckCircle2, 
  Trophy, 
  Check, 
  Info,
  Calendar,
  AlertCircle,
  ChevronDown
} from 'lucide-react';

interface ChecklistItem {
  title: string;
  desc: string;
  status: 'completed' | 'active' | 'pending' | 'missed';
  link?: string;
  deadline?: string;
}

export const Instructions: React.FC = () => {
  const { selectedTournament } = useTournamentContext();
  const { data: leagues } = useMyLeagues(selectedTournament?.id);
  const { data: predictions = [] } = useMyPredictions(selectedTournament?.id);
  const { data: fixtures = [] } = useFixtures(selectedTournament?.id);
  const { data: bracket } = useMyBracket(selectedTournament?.id);

  const [scoringExpanded, setScoringExpanded] = useState(false);
  const [remindersExpanded, setRemindersExpanded] = useState(true);

  const hasJoinedLeague = leagues && leagues.length > 0;
  const now = new Date();

  const formatDeadline = (dateStr: string | undefined) => {
    if (!dateStr) return undefined;
    return `Locks at Kickoff: ${formatDateTime(dateStr, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })}`;
  };

  // Helper to compute status per gate
  const getStageStatus = (
    stageName: string,
    prevStageName: string | null,
    fixturesList: any[],
    predictionsList: any[]
  ): { status: 'completed' | 'active' | 'pending' | 'missed'; deadline?: string } => {
    // 1. Filter stage fixtures
    const stageFixtures = fixturesList.filter(f => {
      if (stageName === 'stage_6a') return f.stage === 'third_place';
      if (stageName === 'stage_6b') return f.stage === 'final';
      if (stageName === 'stage_1') return f.stage === 'group';
      if (stageName === 'stage_2') return f.stage === 'round_32';
      if (stageName === 'stage_3') return f.stage === 'round_16';
      if (stageName === 'stage_4') return f.stage === 'quarter_final';
      if (stageName === 'stage_5') return f.stage === 'semi_final';
      return false;
    });

    if (stageFixtures.length === 0) {
      return { status: 'pending' };
    }

    // 2. Compute minimum kickoff time (blanket phase cutoff)
    const kickoffTimes = stageFixtures.map(f => new Date(f.kickoff_time).getTime());
    const firstKickoffMs = Math.min(...kickoffTimes);
    const firstKickoff = new Date(firstKickoffMs);
    const anyCompleted = stageFixtures.some(f => f.status === 'completed');
    const isPastKickoff = now.getTime() >= firstKickoffMs || anyCompleted;

    // 3. Count user predictions made
    const predictionsCount = predictionsList.filter(p => 
      stageFixtures.some(f => f.id === p.fixture_id)
    ).length;

    const allPredicted = predictionsCount === stageFixtures.length;

    // 4. Check if previous stage matches are concluded
    let isPrevStageConcluded = true;
    if (prevStageName) {
      const prevFixtures = fixturesList.filter(f => {
        if (prevStageName === 'stage_1') return f.stage === 'group';
        if (prevStageName === 'stage_2') return f.stage === 'round_32';
        if (prevStageName === 'stage_3') return f.stage === 'round_16';
        if (prevStageName === 'stage_4') return f.stage === 'quarter_final';
        if (prevStageName === 'stage_5') return f.stage === 'semi_final';
        return false;
      });
      isPrevStageConcluded = prevFixtures.length > 0 && prevFixtures.every(f => f.status === 'completed');
    }

    if (isPastKickoff && !allPredicted) {
      return { status: 'missed', deadline: formatDeadline(firstKickoff.toISOString()) };
    }
    if (isPastKickoff || allPredicted) {
      return { status: 'completed', deadline: formatDeadline(firstKickoff.toISOString()) };
    }
    if (!isPrevStageConcluded) {
      return { status: 'pending' };
    }
    return { status: 'active', deadline: formatDeadline(firstKickoff.toISOString()) };
  };

  // Bracket status: completed if user has submitted both group and KO picks
  const groupFixturesForDeadline = fixtures.filter(f => f.stage === 'group');
  const bracketDeadlineMs = groupFixturesForDeadline.length > 0
    ? Math.min(...groupFixturesForDeadline.map(f => new Date(f.kickoff_time).getTime()))
    : null;
  const bracketDeadlineStr = bracketDeadlineMs
    ? formatDeadline(new Date(bracketDeadlineMs).toISOString())
    : undefined;
  const anyGroupCompleted = fixtures.filter(f => f.stage === 'group').some(f => f.status === 'completed');
  const isPastBracketKickoff = bracketDeadlineMs ? (now.getTime() >= bracketDeadlineMs || anyGroupCompleted) : false;
  const hasGroupPicks = bracket && Array.isArray(bracket.group_picks) && bracket.group_picks.length > 0;
  const hasAllKoPicks = bracket && Array.isArray(bracket.ko_picks) && bracket.ko_picks.length >= 40;
  // Compile checklist stages
  const s1 = getStageStatus('stage_1', null, fixtures, predictions);
  const s2 = getStageStatus('stage_2', 'stage_1', fixtures, predictions);
  const s3 = getStageStatus('stage_3', 'stage_2', fixtures, predictions);
  const s4 = getStageStatus('stage_4', 'stage_3', fixtures, predictions);
  const s5 = getStageStatus('stage_5', 'stage_4', fixtures, predictions);
  const s6a = getStageStatus('stage_6a', 'stage_5', fixtures, predictions);
  const s6b = getStageStatus('stage_6b', 'stage_5', fixtures, predictions);

  const checklistItems: ChecklistItem[] = [
    {
      title: 'Create Account & Profile',
      desc: 'Set up your display name and credentials.',
      status: 'completed',
      link: '/profile',
    },
    {
      title: 'Join a League',
      desc: 'Compete against others by joining a private league via invite token.',
      status: hasJoinedLeague ? 'completed' : 'active',
      link: '/leagues',
    },
    {
      title: 'Stage 1a: Predict 72 Group Match Scorelines',
      desc: 'Predict scorelines for all 72 group stage matches before the tournament kickoff.',
      status: s1.status,
      link: '/predictions',
      deadline: s1.deadline,
    },
    {
      title: 'Stage 1b: Predict Group Standings',
      desc: 'Predict the final standings for all 12 groups before kickoff.',
      status: hasGroupPicks ? 'completed' : (isPastBracketKickoff ? 'missed' : 'active'),
      link: '/bracket',
      deadline: bracketDeadlineStr,
    },
    {
      title: 'Stage 1c: Predict Knockout Winners',
      desc: 'Build your full knockout bracket. Requires group picks to be saved first.',
      status: !hasGroupPicks ? 'pending' : (hasAllKoPicks ? 'completed' : (isPastBracketKickoff ? 'missed' : 'active')),
      link: '/bracket?tab=ko',
      deadline: bracketDeadlineStr,
    },
    {
      title: 'Stage 2: Round of 32 scorelines',
      desc: 'Submit your score predictions for the 16 Round of 32 games.',
      status: s2.status,
      link: '/predictions',
      deadline: s2.deadline,
    },
    {
      title: 'Stage 3: Round of 16 scorelines',
      desc: 'Submit your score predictions for the 8 Round of 16 games.',
      status: s3.status,
      link: '/predictions',
      deadline: s3.deadline,
    },
    {
      title: 'Stage 4: Quarterfinals scorelines',
      desc: 'Submit your score predictions for the 4 Quarterfinals games.',
      status: s4.status,
      link: '/predictions',
      deadline: s4.deadline,
    },
    {
      title: 'Stage 5: Semifinals scorelines',
      desc: s5.status === 'active' 
        ? 'The Final Four are set! Input your Semifinal score predictions before the first kickoff on July 14.'
        : 'Locked until the Quarterfinal results are final and the final four are set.',
      status: s5.status,
      link: '/predictions',
      deadline: s5.deadline,
    },
    {
      title: 'Stage 6a: 3rd Place Playoff',
      desc: s6a.status === 'active'
        ? 'The Semifinal results are in! Submit your scoreline prediction for the Bronze Final before kickoff.'
        : 'Locked until the Semifinal results are final.',
      status: s6a.status,
      link: '/predictions',
      deadline: s6a.deadline,
    },
    {
      title: 'Stage 6b: The Final',
      desc: s6b.status === 'active'
        ? 'The ultimate match is set! Submit your World Cup Final scoreline prediction before kickoff.'
        : 'Locked until the final pairing is confirmed.',
      status: s6b.status,
      link: '/predictions',
      deadline: s6b.deadline,
    }
  ];

  return (
    <div className="space-y-6 max-w-6xl mx-auto py-4">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-white/10 pb-6">
        <div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight flex items-center gap-2">
            ℹ️ Help & Instructions
          </h1>
          <p className="text-textMuted text-sm mt-1">
            Learn how to play, earn points, and climb the leaderboard.
          </p>
        </div>
        {selectedTournament && (
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-semibold">
            <Trophy size={14} />
            Selected: {selectedTournament.name}
          </div>
        )}
      </div>

      <div className="space-y-6">

        {/* Readiness Checklist */}
        <div className="space-y-6">
          <Card className="p-6">
            <div className="flex items-center gap-2 mb-6">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                <CheckCircle2 size={20} />
              </div>
              <h2 className="text-xl font-bold text-white">Your Readiness Checklist</h2>
            </div>
            
            <p className="text-sm text-textMuted mb-6">
              Below are your prediction checklist targets for the current tournament. Complete all open requirements to maximize your score:
            </p>

            <div className="space-y-4">
              {checklistItems.map((item, idx) => {
                const cardContent = (
                  <div 
                    className={`flex items-start gap-4 p-4 rounded-xl border transition-all duration-200 ${
                      item.status === 'completed'
                        ? 'bg-emerald-500/5 border-emerald-500/20 hover:border-emerald-500/40'
                        : item.status === 'active'
                        ? 'bg-amber-500/5 border-amber-500/30 hover:border-amber-500/50 shadow-md shadow-amber-500/5 animate-pulse'
                        : item.status === 'missed'
                        ? 'bg-red-500/5 border-red-500/20 hover:border-red-500/30'
                        : 'bg-black/10 border-white/5 opacity-60 saturate-[0.6]'
                    } ${item.link && item.status !== 'pending' ? 'cursor-pointer hover:bg-white/5' : ''}`}
                  >
                    <div className="mt-0.5">
                      {item.status === 'completed' ? (
                        <div className="w-5 h-5 rounded-full bg-emerald-500 text-black flex items-center justify-center shadow-[0_0_8px_rgba(16,185,129,0.3)]">
                          <Check size={12} strokeWidth={3} />
                        </div>
                      ) : item.status === 'active' ? (
                        <div className="w-5 h-5 rounded-full bg-amber-500 text-black flex items-center justify-center font-bold text-[10px] shadow-[0_0_8px_rgba(245,158,11,0.3)]">
                          !
                        </div>
                      ) : item.status === 'missed' ? (
                        <div className="w-5 h-5 rounded-full bg-red-500/20 border border-red-500/40 text-red-400 flex items-center justify-center font-bold text-[10px]">
                          ✕
                        </div>
                      ) : (
                        <div className="w-5 h-5 rounded-full border border-textMuted/30 flex items-center justify-center text-[10px] text-textMuted bg-white/5">
                          🔒
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-semibold text-white flex items-center gap-2 flex-wrap">
                        {item.title}
                        {item.status === 'completed' && (
                          <span className="text-[9px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-400 px-1.5 py-0.5 rounded">
                            Completed
                          </span>
                        )}
                        {item.status === 'active' && (
                          <span className="text-[9px] font-bold uppercase tracking-wider bg-amber-500/10 text-amber-400 px-1.5 py-0.5 rounded animate-pulse">
                            Needed
                          </span>
                        )}
                        {item.status === 'missed' && (
                          <span className="text-[9px] font-bold uppercase tracking-wider bg-red-500/10 text-red-400 px-1.5 py-0.5 rounded">
                            Missed
                          </span>
                        )}
                        {item.status === 'pending' && (
                          <span className="text-[9px] font-bold uppercase tracking-wider bg-white/5 text-textMuted px-1.5 py-0.5 rounded">
                            Locked
                          </span>
                        )}
                      </h3>
                      <p className="text-xs text-textMuted mt-1 leading-relaxed">{item.desc}</p>
                      
                      {item.deadline && (
                        <div className="mt-2.5 flex items-center gap-1.5 text-[10px] font-semibold text-primary/80">
                          <Calendar size={12} />
                          <span>{item.deadline}</span>
                        </div>
                      )}
                    </div>
                  </div>
                );

                if (item.link && item.status !== 'pending') {
                  return (
                    <Link key={idx} to={item.link} className="block hover:no-underline">
                      {cardContent}
                    </Link>
                  );
                }
                return <div key={idx}>{cardContent}</div>;
              })}
            </div>
          </Card>

          {/* Quick FAQ / Reminders */}
          <Card className="p-6 border-white/5 bg-slate-900/10">
            <button
              onClick={() => setRemindersExpanded(!remindersExpanded)}
              className="w-full flex items-center justify-between text-left focus:outline-none"
            >
              <div className="flex items-center gap-2">
                <Info size={18} className="text-blue-400" />
                <h3 className="font-bold text-white text-sm">Key Reminders</h3>
              </div>
              <ChevronDown 
                size={18} 
                className={`text-textMuted transition-transform duration-200 ${remindersExpanded ? 'rotate-180' : ''}`} 
              />
            </button>
            {remindersExpanded && (
              <ul className="space-y-3 text-xs text-textMuted mt-4 animate-fadeIn">
                <li className="flex items-start gap-2 leading-relaxed">
                  <span className="text-blue-400 font-bold mt-0.5">•</span>
                  <span><strong>Blanket Phase Locks:</strong> Predictions for each of the 6 stages lock the exact second that stage's <em>first</em> match kicks off.</span>
                </li>
                <li className="flex items-start gap-2 leading-relaxed">
                  <span className="text-blue-400 font-bold mt-0.5">•</span>
                  <span><strong>No Mid-Match Edits:</strong> Once a match locks, you cannot modify predictions. All match predictions are graded on the full-time (90-minute) score — extra time and penalties do not change the scoreline used for grading.</span>
                </li>
                <li className="flex items-start gap-2 leading-relaxed">
                  <span className="text-blue-400 font-bold mt-0.5">•</span>
                  <span><strong>League Tokens:</strong> Private leagues use distinct invitation tokens. Share tokens securely with league members.</span>
                </li>
              </ul>
            )}
          </Card>
        </div>

        {/* Scoring System */}
        <div className="space-y-6">
          <Card className="p-6">
            <button
              onClick={() => setScoringExpanded(!scoringExpanded)}
              className="w-full flex items-center justify-between text-left focus:outline-none"
            >
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                  <Trophy size={20} />
                </div>
                <h2 className="text-xl font-bold text-white">Scoring System</h2>
              </div>
              <ChevronDown 
                size={22} 
                className={`text-textMuted transition-transform duration-200 ${scoringExpanded ? 'rotate-180' : ''}`} 
              />
            </button>

            {scoringExpanded && (
              <div className="mt-6 space-y-6 animate-fadeIn">
                <p className="text-sm text-textMuted mb-4">
                  Earn points based on the accuracy of your scoreline predictions. Each match is graded on four tiers.
                </p>

                <div className="mb-6 p-3 rounded-lg bg-blue-500/5 border border-blue-500/15 text-xs text-blue-300 leading-relaxed">
                  <strong className="text-blue-200">All predictions are for the full-time (90-minute) score.</strong>{' '}
                  Extra time and penalties do not affect the Exact or Margin tiers — only the Outcome tier in knockout rounds is adjusted for progression (see below).
                </div>

                <div className="space-y-2 mb-6">
                  <div className="flex items-center gap-4 p-4 rounded-xl border bg-emerald-500/5 border-emerald-500/20">
                    <span className="text-xl w-7 text-center shrink-0">🎯</span>
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-semibold text-emerald-400">Exact score</span>
                      <p className="text-xs text-textMuted mt-0.5 leading-relaxed">Predicted exact home &amp; away goals at full time. e.g. predicted 2-1 → actual 2-1</p>
                    </div>
                    <span className="text-sm font-bold text-emerald-400 shrink-0">+5 pts</span>
                  </div>
                  <div className="flex items-center gap-4 p-4 rounded-xl border bg-blue-500/5 border-blue-500/20">
                    <span className="text-xl w-7 text-center shrink-0">📐</span>
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-semibold text-blue-400">Correct margin</span>
                      <p className="text-xs text-textMuted mt-0.5 leading-relaxed">Right goal difference at full time, wrong exact score. e.g. predicted 2-0 → actual 3-1 (both +2 at FT)</p>
                    </div>
                    <span className="text-sm font-bold text-blue-400 shrink-0">+3 pts</span>
                  </div>
                  <div className="flex items-center gap-4 p-4 rounded-xl border bg-amber-500/5 border-amber-500/20">
                    <span className="text-xl w-7 text-center shrink-0">👍</span>
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-semibold text-amber-400">Correct outcome</span>
                      <p className="text-xs text-textMuted mt-0.5 leading-relaxed">
                        Right win/draw/loss direction, wrong margin. e.g. predicted 1-0 → actual 3-0 (both a home win at FT).
                      </p>
                      <p className="text-xs text-amber-300/70 mt-1 leading-relaxed">
                        <strong className="text-amber-300">Knockout rounds only:</strong> "outcome" means which team <em>progresses</em>. If you predicted a home win (e.g. 1-0) and the game is level at full time but the home side goes through on extra time or penalties, you still earn this tier. If the away side goes through instead, you score 0.
                      </p>
                    </div>
                    <span className="text-sm font-bold text-amber-400 shrink-0">+2 pts</span>
                  </div>
                  <div className="flex items-center gap-4 p-4 rounded-xl border bg-red-500/5 border-red-500/20">
                    <span className="text-xl w-7 text-center shrink-0">❌</span>
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-semibold text-red-400">Wrong pick</span>
                      <p className="text-xs text-textMuted mt-0.5 leading-relaxed">Predicted outcome did not match the actual result.</p>
                    </div>
                    <span className="text-sm font-bold text-red-400 shrink-0">0 pts</span>
                  </div>
                </div>

                {/* Group Bracket Rules */}
                {selectedTournament?.has_bracket && (
                  <div className="mt-6 pt-6 border-t border-white/5 space-y-4">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-md bg-purple-500/10 flex items-center justify-center text-purple-400">
                        <Trophy size={14} />
                      </div>
                      <h3 className="font-bold text-white text-sm">Group Stage Bracket Predictions</h3>
                    </div>
                    <p className="text-xs text-textMuted leading-relaxed">
                      Before the tournament kicks off, predict each group's final standings (1st–4th). Points are awarded when the group stage concludes:
                    </p>
                    <div className="space-y-2 bg-black/30 p-4 rounded-xl border border-white/5 text-xs">
                      <div className="flex justify-between items-center">
                        <span className="text-white/80">Correct position (1st–4th)</span>
                        <span className="text-purple-400 font-bold">+5 pts per team</span>
                      </div>
                      <div className="flex justify-between items-center border-t border-white/5 pt-2">
                        <span className="text-white/80">Team qualifies but wrong order (both top 2)</span>
                        <span className="text-purple-400 font-bold">+2 pts per team</span>
                      </div>
                      <div className="flex justify-between items-center border-t border-white/5 pt-2">
                        <span className="text-white/80">Perfect group sweep (all 4 positions correct)</span>
                        <span className="text-purple-400 font-bold">+10 bonus</span>
                      </div>
                      <div className="flex justify-between items-center border-t border-white/10 pt-2 mt-1">
                        <span className="text-textMuted italic">Max per group (5×4 + sweep bonus)</span>
                        <span className="text-white/60 font-semibold">30 pts</span>
                      </div>
                    </div>

                    {/* KO Bracket Scoring */}
                    <div className="flex items-center gap-2 mt-4">
                      <div className="w-6 h-6 rounded-md bg-orange-500/10 flex items-center justify-center text-orange-400">
                        <Trophy size={14} />
                      </div>
                      <h3 className="font-bold text-white text-sm">Knockout Bracket Scoring</h3>
                    </div>
                    <p className="text-xs text-textMuted leading-relaxed mb-3">
                      Predict the full knockout path from the Round of 32 to the Final using an <strong className="text-white">"Any Path"</strong> model —
                      points are awarded if your predicted team reaches a round, regardless of which bracket branch they took to get there.
                    </p>
                    <div className="space-y-2 bg-black/30 p-4 rounded-xl border border-white/5 text-xs">
                      {[
                        ['Reaches Round of 32',   '+3 pts per team'],
                        ['Reaches Round of 16',   '+5 pts per team'],
                        ['Reaches Quarter-Finals', '+8 pts per team'],
                        ['Reaches Semi-Finals',    '+12 pts per team'],
                      ].map(([label, pts]) => (
                        <div key={label} className="flex justify-between items-center">
                          <span className="text-white/80">{label}</span>
                          <span className="text-orange-400 font-bold">{pts}</span>
                        </div>
                      ))}
                      <div className="border-t border-white/10 pt-2 mt-1 space-y-2">
                        <div className="text-[10px] text-white/40 uppercase tracking-wider font-bold mb-1">Finals Weekend</div>
                        {[
                          ['Correct champion AND runner-up (correct positions)', '+20 pts'],
                          ['Both finalists correct, winner/runner-up inverted',  '+10 pts'],
                          ['Correct 3rd place playoff winner',                   '+8 pts'],
                        ].map(([label, pts]) => (
                          <div key={label} className="flex justify-between items-center">
                            <span className="text-white/70">{label}</span>
                            <span className="text-amber-400 font-bold">{pts}</span>
                          </div>
                        ))}
                      </div>
                      <div className="border-t border-white/10 pt-2 mt-1 text-[10px] text-textMuted">
                        💡 Bracket picks lock at the tournament kick-off. KO round picks for later stages unlock once the previous round concludes.
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </Card>
        </div>

      </div>

      {!selectedTournament && (
        <div className="p-4 bg-danger/10 border border-danger/20 rounded-xl flex items-center gap-2 text-danger text-sm justify-center">
          <AlertCircle size={16} />
          <span>Please select a tournament from the dropdown in the navigation header to view dynamic targets.</span>
        </div>
      )}
    </div>
  );
};
