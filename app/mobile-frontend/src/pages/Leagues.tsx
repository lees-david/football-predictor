import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMyLeagues, useJoinLeague, useLeaveLeague } from '../api/hooks/useRankings';
import { useTournamentContext } from '../api/TournamentContext';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { 
  Trophy, 
  Users, 
  Plus, 
  ArrowRight, 
  CheckCircle2, 
  AlertCircle 
} from 'lucide-react';

export const Leagues: React.FC = () => {
  const { selectedTournamentId, selectedTournament, setSelectedTournamentId } = useTournamentContext();
  const leaguesQuery = useMyLeagues(selectedTournamentId);
  const { data: leagues = [], isLoading } = leaguesQuery;
  const joinLeagueMutation = useJoinLeague();
  const leaveLeagueMutation = useLeaveLeague();
  const navigate = useNavigate();

  const [inviteToken, setInviteToken] = useState('');
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleJoinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSuccessMessage(null);
    setErrorMessage(null);
    if (!inviteToken.trim()) return;

    joinLeagueMutation.mutate(inviteToken.trim(), {
      onSuccess: (data: any) => {
        setSuccessMessage(`Successfully joined "${data.league_name || 'league'}"!`);
        setInviteToken('');
        if (data.tournament_id && data.tournament_id !== selectedTournamentId) {
          setSelectedTournamentId(data.tournament_id);
        } else {
          // If already in the correct tournament view, manually refetch to show the new league instantly
          leaguesQuery.refetch();
        }
      },
      onError: (err: any) => {
        setErrorMessage(err.response?.data?.detail || 'Failed to join league. Please verify invite token.');
      }
    });
  };

  const handleLeaveLeague = async (leagueId: number, name: string) => {
    setSuccessMessage(null);
    setErrorMessage(null);

    if (leagues.length <= 1) {
      navigate('/profile?action=delete-account');
      return;
    }

    if (window.confirm(`Are you sure you want to leave "${name}"?`)) {
      try {
        await leaveLeagueMutation.mutateAsync(leagueId);
        setSuccessMessage(`Successfully left "${name}".`);
      } catch (err: any) {
        setErrorMessage(err.response?.data?.detail || 'Failed to leave league.');
      }
    }
  };


  return (
    <div className="max-w-6xl mx-auto space-y-8 py-4 animate-fadeIn">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-white/10 pb-6">
        <div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight flex items-center gap-2">
            👥 Private Leagues
          </h1>
          <p className="text-textMuted text-sm mt-1">
            Compete against friends, family, and colleagues in private prediction groups.
          </p>
        </div>
        {selectedTournament && (
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-semibold">
            <Trophy size={14} />
            {selectedTournament.name}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
        {/* Joined Leagues List */}
        <div className="lg:col-span-2 space-y-6">
          <Card 
            title={
              <span className="flex items-center gap-2 text-primary">
                <Trophy size={18} /> My Active Leagues
                <Badge variant="player" className="ml-2 font-mono">
                  {leagues.length}
                </Badge>
              </span>
            }
          >
            {isLoading ? (
              <div className="flex justify-center py-12">
                <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-primary"></div>
              </div>
            ) : leagues.length === 0 ? (
              <div className="text-center py-16 border-2 border-dashed border-white/5 rounded-2xl">
                <Users className="mx-auto text-white/10 mb-3" size={44} />
                <p className="text-sm text-textMuted font-medium mb-1">Not in any private leagues yet.</p>
                <p className="text-xs text-textMuted/60">Enter an invite token on the right to compete against your friends!</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {leagues.map((league) => (
                  <div 
                    key={league.id} 
                    className="p-4 rounded-xl border border-white/5 bg-black/35 hover:border-white/15 hover:shadow-md hover:shadow-black/20 transition-all duration-200 flex flex-col justify-between"
                  >
                    <div className="space-y-4">
                      {/* Logo + Name */}
                      <div className="flex items-center gap-3">
                        {league.logo_url ? (
                          <img 
                            src={league.logo_url} 
                            alt={`${league.name} logo`} 
                            className="w-12 h-12 rounded-lg object-contain bg-white/5 border border-white/10 p-0.5"
                          />
                        ) : (
                          <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-primary/10 to-amber-500/10 border border-primary/20 flex items-center justify-center text-primary text-xl font-bold font-mono">
                            {league.name.charAt(0).toUpperCase()}
                          </div>
                        )}
                        <div className="min-w-0">
                          <h4 className="font-bold text-textMain text-sm truncate">{league.name}</h4>
                          <span className="text-[10px] text-textMuted font-semibold uppercase bg-white/5 px-2 py-0.5 rounded-full inline-block mt-1">
                            {league.member_count ?? 1} Members
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="border-t border-white/5 pt-3 mt-4 flex justify-between items-center text-xs">
                      {league.my_rank !== undefined && (
                        <span className="text-textMuted flex-grow">
                          Your Rank: <strong className="text-primary font-bold">#{league.my_rank}</strong>
                        </span>
                      )}
                      <div className="flex items-center gap-3.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleLeaveLeague(league.id, league.name)}
                          className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-danger hover:text-red-400 transition-colors cursor-pointer"
                        >
                          Leave
                        </button>
                        <Link
                          to={`/leaderboard?leagueId=${league.id}`}
                          className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-primary hover:text-amber-400 transition-colors group"
                        >
                          Standings
                          <ArrowRight size={12} className="group-hover:translate-x-0.5 transition-transform" />
                        </Link>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* Join Private League Widget */}
        <div className="lg:col-span-1">
          <Card title={<span className="flex items-center gap-2 text-primary"><Plus size={18} /> Join a League</span>}>
            <form onSubmit={handleJoinSubmit} className="space-y-4">
              {successMessage && (
                <div className="p-3.5 bg-success/15 border border-success/30 rounded-xl text-success text-xs flex items-center gap-2 animate-in zoom-in-95">
                  <CheckCircle2 size={16} className="shrink-0" />
                  <span>{successMessage}</span>
                </div>
              )}
              {errorMessage && (
                <div className="p-3.5 bg-danger/15 border border-danger/30 rounded-xl text-danger text-xs flex items-center gap-2 animate-in zoom-in-95">
                  <AlertCircle size={16} className="shrink-0" />
                  <span>{errorMessage}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-textMuted mb-2 uppercase tracking-wider">Invite Token</label>
                <input
                  type="text"
                  value={inviteToken}
                  onChange={(e) => setInviteToken(e.target.value)}
                  className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2.5 text-white focus:ring-1 focus:ring-primary outline-none text-sm font-mono placeholder:font-sans placeholder:text-xs"
                  placeholder="e.g. inv-sOM3T0kEnStrInG"
                  required
                />
              </div>

              <Button 
                type="submit" 
                isLoading={joinLeagueMutation.isPending} 
                className="w-full"
              >
                Join League
              </Button>
            </form>
          </Card>
        </div>
      </div>
    </div>
  );
};
