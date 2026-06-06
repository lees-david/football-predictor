import { useMemo } from 'react';
import { useMyLeagues } from './useRankings';
import { useFixtures } from './useFixtures';
import { useMyPredictions } from './usePredictions';
import { useMyBracket } from './useBracket';

export const useChecklistActiveBadge = (tournamentId?: number | null) => {
  const { data: leagues } = useMyLeagues(tournamentId);
  const { data: predictions = [] } = useMyPredictions(tournamentId);
  const { data: fixtures = [] } = useFixtures(tournamentId);
  const { data: bracket } = useMyBracket(tournamentId);

  return useMemo(() => {
    if (!tournamentId) return 0;
    const now = Date.now();
    const predictedIds = new Set((predictions as any[]).map((p: any) => p.fixture_id));
    let count = 0;

    // Bracket deadline (locks at first group kickoff)
    const groupFixtures = (fixtures as any[]).filter((f: any) => f.stage === 'group');
    const bracketDeadlineMs = groupFixtures.length > 0
      ? Math.min(...groupFixtures.map((f: any) => new Date(f.kickoff_time).getTime()))
      : null;
    const anyGroupCompleted = groupFixtures.some((f: any) => f.status === 'completed');
    const isPastBracketKickoff = bracketDeadlineMs ? (now >= bracketDeadlineMs || anyGroupCompleted) : false;
    const hasGroupPicks = (bracket as any)?.group_picks?.length > 0;
    const koPicksSaved = ((bracket as any)?.ko_picks ?? []).length;
    const hasAllKoPicks = koPicksSaved >= 40;

    // Stage group helper: is this stage active (open, unpredicted, prev stage done)?
    const isStageActive = (stageName: string, prevStageName: string | null): boolean => {
      const stageFixtures = (fixtures as any[]).filter((f: any) => {
        if (stageName === 'stage_1') return f.stage === 'group';
        if (stageName === 'stage_2') return f.stage === 'round_32';
        if (stageName === 'stage_3') return f.stage === 'round_16';
        if (stageName === 'stage_4') return f.stage === 'quarter_final';
        if (stageName === 'stage_5') return f.stage === 'semi_final';
        if (stageName === 'stage_6') return f.stage === 'third_place' || f.stage === 'final';
        return false;
      });
      if (stageFixtures.length === 0) return false;

      const firstKickoffMs = Math.min(...stageFixtures.map((f: any) => new Date(f.kickoff_time).getTime()));
      const anyCompleted = stageFixtures.some((f: any) => f.status === 'completed');
      if (now >= firstKickoffMs || anyCompleted) return false; // locked — either done or missed

      const allPredicted = stageFixtures.every((f: any) => predictedIds.has(f.id));
      if (allPredicted) return false;

      if (prevStageName) {
        const prevFixtures = (fixtures as any[]).filter((f: any) => {
          if (prevStageName === 'stage_1') return f.stage === 'group';
          if (prevStageName === 'stage_2') return f.stage === 'round_32';
          if (prevStageName === 'stage_3') return f.stage === 'round_16';
          if (prevStageName === 'stage_4') return f.stage === 'quarter_final';
          if (prevStageName === 'stage_5') return f.stage === 'semi_final';
          return false;
        });
        if (prevFixtures.length > 0 && !prevFixtures.every((f: any) => f.status === 'completed')) return false;
      }

      return true;
    };

    // Stage 1a: predict group scorelines
    if (isStageActive('stage_1', null)) count++;
    // Stage 1b: predict group standings (independent of 1a completion)
    if (!isPastBracketKickoff && !hasGroupPicks) count++;
    // Stage 1c: predict KO bracket (counted independently — always show until done)
    if (!isPastBracketKickoff && !hasAllKoPicks) count++;
    if (isStageActive('stage_2', 'stage_1')) count++;
    if (isStageActive('stage_3', 'stage_2')) count++;
    if (isStageActive('stage_4', 'stage_3')) count++;
    if (isStageActive('stage_5', 'stage_4')) count++;
    if (isStageActive('stage_6', 'stage_5')) count++;

    return count;
  }, [tournamentId, leagues, predictions, fixtures, bracket]);
};
