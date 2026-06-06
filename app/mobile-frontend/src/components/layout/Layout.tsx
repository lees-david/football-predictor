import React, { useEffect, useState } from 'react';
import { Outlet, useSearchParams, NavLink, useLocation } from 'react-router-dom';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { apiClient } from '../../api/client';
import { useTournamentContext } from '../../api/TournamentContext';
import { useMe, logout } from '../../api/hooks/useAuth';
import { useFixtures } from '../../api/hooks/useFixtures';
import { useMyPredictions } from '../../api/hooks/usePredictions';
import { useMyBracket } from '../../api/hooks/useBracket';
import { useChecklistActiveBadge } from '../../api/hooks/useChecklistStatus';
import { Logo } from '../ui/Logo';
import {
  Menu,
  X,
  Home,
  Target,
  GitBranch,
  BarChart2,
  Users,
  Trophy,
  Flag,
  Info,
  TrendingUp,
  User,
  LogOut,
  Shield,
  CheckCircle2,
  AlertCircle,
  Settings,
  Mail,
  ClipboardList,
  Server,
  ShieldCheck,
  Database,
  FlaskConical,
  Calendar
} from 'lucide-react';

export const Layout: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const location = useLocation();
  const { selectedTournamentId, setSelectedTournamentId, selectedTournament, tournaments } = useTournamentContext();
  const { data: user } = useMe();
  const token = searchParams.get('token');

  // Mobile navigation drawer state
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  // Invite Modal State
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [leagueName, setLeagueName] = useState('');
  const [isJoining, setIsJoining] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [joinSuccess, setJoinSuccess] = useState(false);
  const [isAlreadyMember, setIsAlreadyMember] = useState(false);

  // Maintenance State
  const [minutesToMaintenance, setMinutesToMaintenance] = useState<number | null>(null);

  // Close drawer on route change
  useEffect(() => {
    setIsDrawerOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const checkMaintenance = async () => {
      try {
        const response = await apiClient.get('/maintenance/status');
        const { active, start_time } = response.data;
        
        if (active && window.location.pathname !== '/maintenance') {
          localStorage.removeItem('token');
          window.location.href = '/maintenance';
          return;
        }

        if (start_time) {
          const start = new Date(start_time).getTime();
          const now = new Date().getTime();
          const diffMs = start - now;
          const diffMins = Math.floor(diffMs / 60000);
          
          if (diffMins > 0 && diffMins <= 30) {
            setMinutesToMaintenance(diffMins);
          } else {
            setMinutesToMaintenance(null);
          }
        } else {
          setMinutesToMaintenance(null);
        }
      } catch (error) {
        console.error("Failed to fetch maintenance status:", error);
      }
    };

    checkMaintenance();
    const interval = setInterval(checkMaintenance, 20000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (token) {
      apiClient.get(`/leagues/invite-details/${token}`)
        .then((response) => {
          setLeagueName(response.data.league_name);
          const isReg = searchParams.get('registered') === 'true';
          if (isReg) {
            setJoinSuccess(true);
            setIsAlreadyMember(false);
          } else {
            setIsAlreadyMember(response.data.is_member || false);
          }
          setIsInviteModalOpen(true);
          setErrorMessage('');
        })
        .catch((error) => {
          console.error("Failed to fetch invite details:", error);
          setErrorMessage(error.response?.data?.detail || "This invitation link is invalid or has expired.");
          setIsInviteModalOpen(true);
        });
    }
  }, [token, searchParams]);

  // Badges calculation
  const { data: fixtures } = useFixtures(selectedTournament?.id);
  const { data: myPredictions } = useMyPredictions(selectedTournament?.id);
  const { data: myBracket } = useMyBracket(selectedTournament?.id);
  const instructionsBadge = useChecklistActiveBadge(selectedTournament?.id);

  const predictedFixtureIds = new Set((myPredictions ?? []).map(p => p.fixture_id));
  const now = Date.now();
  
  const isPlaceholderName = (name: string) => {
    const low = name.toLowerCase();
    return ['match', 'placeholder', 'winner', 'loser', 'runner', 'group'].some(x => low.includes(x));
  };

  const scoresBadge = (fixtures ?? []).filter(f => {
    if (f.status !== 'scheduled') return false;
    if (predictedFixtureIds.has(f.id)) return false;
    if (isPlaceholderName(f.home_team) || isPlaceholderName(f.away_team)) return false;
    const lockMs = new Date(f.kickoff_time).getTime() - 15 * 60000;
    return now < lockMs;
  }).length;

  const groupFixtures = (fixtures ?? []).filter((f: any) => f.stage === 'group');
  const bracketDeadlineMs = groupFixtures.length > 0
    ? Math.min(...groupFixtures.map((f: any) => new Date(f.kickoff_time).getTime()))
    : null;
  const anyGroupCompleted = groupFixtures.some((f: any) => f.status === 'completed');
  const isPastBracketKickoff = bracketDeadlineMs ? (now >= bracketDeadlineMs || anyGroupCompleted) : false;

  const groupsBadge = selectedTournament?.has_bracket && !isPastBracketKickoff
    ? ((myBracket?.group_picks?.length ?? 0) === 0 ? 1 : 0)
    : 0;

  const koPicksSaved = (myBracket?.ko_picks ?? []).length;
  const koBadge = selectedTournament?.has_bracket && !isPastBracketKickoff && koPicksSaved < 40
    ? (40 - koPicksSaved)
    : 0;

  const bracketBadgeTotal = groupsBadge + koBadge;

  const isAdmin = user?.role === 'admin';
  const canManageLeagues = isAdmin || !!user?.can_manage_leagues;

  const { data: maintenanceStatus } = useQuery({
    queryKey: ['admin-maintenance-status-mobile'],
    queryFn: () => apiClient.get('/maintenance/admin/status').then(r => r.data),
    enabled: isAdmin,
    refetchInterval: 60000 * 5,
  });

  const hasGitUpdate = maintenanceStatus?.git && !maintenanceStatus.git.up_to_date;

  const clearTokenParam = () => {
    setIsInviteModalOpen(false);
    const newParams = new URLSearchParams(searchParams);
    newParams.delete('token');
    newParams.delete('registered');
    setSearchParams(newParams);
    
    setTimeout(() => {
      setLeagueName('');
      setErrorMessage('');
      setJoinSuccess(false);
      setIsAlreadyMember(false);
    }, 300);
  };

  const handleJoin = async () => {
    if (!token) return;
    setIsJoining(true);
    setErrorMessage('');
    
    try {
      const response = await apiClient.post('/leagues/join', { invite_token: token });
      setJoinSuccess(true);
      await queryClient.invalidateQueries({ queryKey: ['leagues'] });

      if (response.data.tournament_id && response.data.tournament_id !== selectedTournamentId) {
        setSelectedTournamentId(response.data.tournament_id);
      }
    } catch (error: any) {
      console.error("Failed to join league:", error);
      setErrorMessage(error.response?.data?.detail || "Failed to join the league. Please try again.");
    } finally {
      setIsJoining(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#0D1117] text-[#F0F6FC]">
      {/* Mobile Sticky Top Header */}
      <header className="sticky top-0 z-40 w-full glass-card border-b-0 rounded-none h-16 flex items-center justify-between px-4">
        <div className="flex items-center gap-3">
          <button 
            onClick={() => setIsDrawerOpen(true)}
            className="p-1.5 text-textMuted hover:text-white rounded-lg hover:bg-white/5 active:bg-white/10 transition-colors"
          >
            <Menu size={24} />
          </button>
          <div className="flex items-center gap-1.5">
            <Logo size={24} />
            <span className="text-base font-bold bg-gradient-to-r from-[#8B5CF6] to-[#06B6D4] bg-clip-text text-transparent">
              FP
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {tournaments.length > 1 && (
            <select
              value={selectedTournamentId || ''}
              onChange={(e) => setSelectedTournamentId(parseInt(e.target.value, 10))}
              className="bg-black/40 text-xs text-white border border-white/10 rounded-lg px-2 py-1 focus:ring-1 focus:ring-primary focus:border-transparent outline-none cursor-pointer max-w-[120px] truncate"
            >
              {tournaments.map((t) => (
                <option key={t.id} value={t.id} className="bg-[#161B22] text-white">
                  {t.name}
                </option>
              ))}
            </select>
          )}

          {user && (
            <div className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-full py-1 px-2.5">
              <Trophy size={14} className="text-amber-400" />
              <span className="text-xs font-bold text-white leading-none">
                {user.total_points || 0}
              </span>
            </div>
          )}
        </div>
      </header>

      {/* Main Layout Area */}
      <div className="flex flex-1 overflow-hidden relative">
        <main className="flex-1 p-4 pb-24 overflow-y-auto">
          <div className="max-w-screen-2xl mx-auto">
            {minutesToMaintenance !== null && (
              <div className="mb-4 p-3 bg-gradient-to-r from-amber-500/20 to-yellow-600/20 border border-amber-500/30 rounded-xl flex items-center gap-2 text-amber-300 animate-pulse">
                <AlertCircle size={16} className="flex-shrink-0 text-amber-400" />
                <div className="text-xs font-semibold leading-tight">
                  Maintenance soon. You will be logged out in <strong className="text-white font-extrabold">{minutesToMaintenance}m</strong>.
                </div>
              </div>
            )}
            <Outlet />
          </div>
        </main>
      </div>

      {/* Mobile Drawer (Hamburger Menu Overlay) */}
      {isDrawerOpen && (
        <div 
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 transition-opacity"
          onClick={() => setIsDrawerOpen(false)}
        />
      )}

      <aside className={`fixed top-0 left-0 bottom-0 w-72 bg-[#161B22] border-r border-white/5 z-50 transform transition-transform duration-300 ease-in-out overflow-y-auto flex flex-col justify-between ${isDrawerOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="p-4 flex flex-col gap-2">
          {/* Drawer Header */}
          <div className="flex items-center justify-between pb-4 border-b border-white/5 mb-2">
            <div className="flex items-center gap-2">
              <Logo size={24} />
              <span className="text-lg font-bold bg-gradient-to-r from-[#8B5CF6] to-[#06B6D4] bg-clip-text text-transparent">
                Football Predictor
              </span>
            </div>
            <button 
              onClick={() => setIsDrawerOpen(false)}
              className="p-1.5 text-textMuted hover:text-white rounded-lg hover:bg-white/5 active:bg-white/10"
            >
              <X size={20} />
            </button>
          </div>

          {/* User Profile Summary */}
          {user && (
            <div className="p-3 bg-white/5 border border-white/5 rounded-xl mb-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-primary/20 text-primary flex items-center justify-center font-bold text-sm">
                  {user.display_name?.charAt(0).toUpperCase() || 'U'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white truncate leading-tight">{user.display_name}</p>
                  <p className="text-xs text-textMuted truncate">{user.email}</p>
                </div>
              </div>
              <div className="mt-2.5 pt-2.5 border-t border-white/5 flex justify-between items-center text-xs">
                <span className="text-textMuted">Role</span>
                <span className="font-semibold text-amber-400 capitalize">{user.role}</span>
              </div>
            </div>
          )}

          {/* Nav Items */}
          <div className="flex flex-col gap-1">
            <div className="text-[10px] font-bold text-textMuted uppercase tracking-wider px-3 py-1.5">Menus</div>
            
            <NavLink
              to="/fixtures"
              className={({ isActive }) => `flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all text-sm ${isActive ? 'bg-primary/10 text-primary font-semibold' : 'text-textMuted hover:text-textMain'}`}
            >
              <Calendar size={18} />
              <span className="flex-1">Fixtures & Results</span>
            </NavLink>
            
            <NavLink
              to="/leagues"
              className={({ isActive }) => `flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all text-sm ${isActive ? 'bg-primary/10 text-primary font-semibold' : 'text-textMuted hover:text-textMain'}`}
            >
              <Users size={18} />
              <span className="flex-1">Leagues</span>
            </NavLink>

            <NavLink
              to="/fifa-rankings"
              className={({ isActive }) => `flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all text-sm ${isActive ? 'bg-primary/10 text-primary font-semibold' : 'text-textMuted hover:text-textMain'}`}
            >
              <Trophy size={18} />
              <span className="flex-1">FIFA Ranking</span>
            </NavLink>

            <NavLink
              to="/teams"
              className={({ isActive }) => `flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all text-sm ${isActive ? 'bg-primary/10 text-primary font-semibold' : 'text-textMuted hover:text-textMain'}`}
            >
              <Flag size={18} />
              <span className="flex-1">Teams</span>
            </NavLink>

            <NavLink
              to="/instructions"
              className={({ isActive }) => `flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all text-sm relative ${isActive ? 'bg-primary/10 text-primary font-semibold' : 'text-textMuted hover:text-textMain'}`}
            >
              <Info size={18} />
              <span className="flex-1">Instructions</span>
              {instructionsBadge > 0 && (
                <span className="w-5 h-5 rounded-full bg-amber-500 text-black text-[10px] font-bold flex items-center justify-center">
                  {instructionsBadge}
                </span>
              )}
            </NavLink>

            <NavLink
              to="/my-points"
              className={({ isActive }) => `flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all text-sm ${isActive ? 'bg-primary/10 text-primary font-semibold' : 'text-textMuted hover:text-textMain'}`}
            >
              <TrendingUp size={18} />
              <span className="flex-1">My Points</span>
            </NavLink>

            <NavLink
              to="/profile"
              className={({ isActive }) => `flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all text-sm ${isActive ? 'bg-primary/10 text-primary font-semibold' : 'text-textMuted hover:text-textMain'}`}
            >
              <User size={18} />
              <span className="flex-1">Profile</span>
            </NavLink>
          </div>

          {/* Admin Section */}
          {(isAdmin || canManageLeagues) && (
            <div className="flex flex-col gap-1 mt-4">
              <div className="text-[10px] font-bold text-textMuted uppercase tracking-wider px-3 py-1.5">Admin tools</div>

              {isAdmin && (
                <NavLink
                  to="/admin/users"
                  className={({ isActive }) => `flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all text-sm ${isActive ? 'bg-primary/10 text-primary font-semibold' : 'text-textMuted hover:text-textMain'}`}
                >
                  <Shield size={18} />
                  <span>Manage Users</span>
                </NavLink>
              )}

              {isAdmin && (
                <NavLink
                  to="/admin/tournaments"
                  className={({ isActive }) => `flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all text-sm ${isActive ? 'bg-primary/10 text-primary font-semibold' : 'text-textMuted hover:text-textMain'}`}
                >
                  <Trophy size={18} />
                  <span>Tournaments</span>
                </NavLink>
              )}

              {canManageLeagues && (
                <NavLink
                  to="/admin/leagues"
                  className={({ isActive }) => `flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all text-sm ${isActive ? 'bg-primary/10 text-primary font-semibold' : 'text-textMuted hover:text-textMain'}`}
                >
                  <Settings size={18} />
                  <span>Leagues</span>
                </NavLink>
              )}

              {isAdmin && (
                <NavLink
                  to="/admin/provision"
                  className={({ isActive }) => `flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all text-sm ${isActive ? 'bg-primary/10 text-primary font-semibold' : 'text-textMuted hover:text-textMain'}`}
                >
                  <Users size={18} />
                  <span>Provision Users</span>
                </NavLink>
              )}

              {isAdmin && (
                <NavLink
                  to="/admin/simulation"
                  className={({ isActive }) => `flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all text-sm ${isActive ? 'bg-primary/10 text-primary font-semibold' : 'text-textMuted hover:text-textMain'}`}
                >
                  <FlaskConical size={18} />
                  <span>Simulation</span>
                </NavLink>
              )}

              {isAdmin && (
                <NavLink
                  to="/admin/email"
                  className={({ isActive }) => `flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all text-sm ${isActive ? 'bg-primary/10 text-primary font-semibold' : 'text-textMuted hover:text-textMain'}`}
                >
                  <Mail size={18} />
                  <span>Email</span>
                </NavLink>
              )}

              {isAdmin && (
                <NavLink
                  to="/admin/results"
                  className={({ isActive }) => `flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all text-sm ${isActive ? 'bg-primary/10 text-primary font-semibold' : 'text-textMuted hover:text-textMain'}`}
                >
                  <ClipboardList size={18} />
                  <span>Results Manager</span>
                </NavLink>
              )}

              {isAdmin && (
                <NavLink
                  to="/admin/build"
                  className={({ isActive }) => `flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all text-sm ${isActive ? 'bg-primary/10 text-primary font-semibold' : 'text-textMuted hover:text-textMain'}`}
                >
                  <Server size={18} />
                  <span>Build Info</span>
                </NavLink>
              )}

              {isAdmin && (
                <NavLink
                  to="/admin/audit"
                  className={({ isActive }) => `flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all text-sm ${isActive ? 'bg-primary/10 text-primary font-semibold' : 'text-textMuted hover:text-textMain'}`}
                >
                  <ShieldCheck size={18} />
                  <span>Audit Logs</span>
                </NavLink>
              )}

              {isAdmin && (
                <NavLink
                  to="/admin/maintenance"
                  className={({ isActive }) => `flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all text-sm relative ${isActive ? 'bg-primary/10 text-primary font-semibold' : 'text-textMuted hover:text-textMain'}`}
                >
                  <Shield size={18} />
                  <span className="flex-1">Maintenance</span>
                  {hasGitUpdate && (
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-500"></span>
                  )}
                </NavLink>
              )}

              {isAdmin && (
                <NavLink
                  to="/admin/backups"
                  className={({ isActive }) => `flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all text-sm ${isActive ? 'bg-primary/10 text-primary font-semibold' : 'text-textMuted hover:text-textMain'}`}
                >
                  <Database size={18} />
                  <span>Backups</span>
                </NavLink>
              )}
            </div>
          )}
        </div>

        {/* Logout at bottom */}
        <div className="p-4 border-t border-white/5">
          <button 
            onClick={logout}
            className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 text-sm font-semibold transition-all"
          >
            <LogOut size={16} />
            <span>Logout</span>
          </button>
        </div>
      </aside>

      {/* Sticky Bottom Navigation Bar */}
      <footer className="fixed bottom-0 left-0 right-0 h-16 bg-[#161B22]/90 backdrop-blur-md border-t border-white/5 z-40 flex items-center justify-around px-2">
        <NavLink 
          to="/"
          className={({ isActive }) => `flex flex-col items-center justify-center w-16 h-12 rounded-lg transition-all ${isActive ? 'text-primary' : 'text-textMuted'}`}
        >
          <Home size={20} />
          <span className="text-[10px] mt-1 font-medium">Home</span>
        </NavLink>

        <NavLink 
          to="/fixtures"
          className={({ isActive }) => `flex flex-col items-center justify-center w-16 h-12 rounded-lg transition-all ${isActive ? 'text-primary' : 'text-textMuted'}`}
        >
          <Calendar size={20} />
          <span className="text-[10px] mt-1 font-medium">Fixtures</span>
        </NavLink>

        <NavLink 
          to="/predictions"
          className={({ isActive }) => `flex flex-col items-center justify-center w-16 h-12 rounded-lg transition-all relative ${isActive ? 'text-primary' : 'text-textMuted'}`}
        >
          <Target size={20} />
          <span className="text-[10px] mt-1 font-medium">Scores</span>
          {scoresBadge > 0 && (
            <span className="absolute top-1 right-2 min-w-[16px] h-4 px-1 rounded-full bg-amber-500 text-black text-[9px] font-extrabold flex items-center justify-center">
              {scoresBadge}
            </span>
          )}
        </NavLink>

        {selectedTournament?.has_bracket && (
          <NavLink 
            to="/bracket"
            className={({ isActive }) => `flex flex-col items-center justify-center w-16 h-12 rounded-lg transition-all relative ${isActive ? 'text-primary' : 'text-textMuted'}`}
          >
            <GitBranch size={20} />
            <span className="text-[10px] mt-1 font-medium">Bracket</span>
            {bracketBadgeTotal > 0 && (
              <span className="absolute top-1 right-2 min-w-[16px] h-4 px-1 rounded-full bg-amber-500 text-black text-[9px] font-extrabold flex items-center justify-center">
                {bracketBadgeTotal}
              </span>
            )}
          </NavLink>
        )}

        <NavLink 
          to="/leaderboard"
          className={({ isActive }) => `flex flex-col items-center justify-center w-16 h-12 rounded-lg transition-all ${isActive ? 'text-primary' : 'text-textMuted'}`}
        >
          <BarChart2 size={20} />
          <span className="text-[10px] mt-1 font-medium">Rankings</span>
        </NavLink>
      </footer>

      {/* Invite Modal */}
      <Modal 
        isOpen={isInviteModalOpen} 
        onClose={clearTokenParam} 
        title={joinSuccess ? "Welcome!" : "League Invitation"}
      >
        <div className="space-y-6">
          {joinSuccess ? (
            <div className="text-center space-y-4 py-4 animate-in zoom-in-95 duration-300">
              <div className="w-16 h-16 bg-emerald-500/10 text-emerald-400 rounded-full flex items-center justify-center mx-auto border border-emerald-500/20 shadow-[0_0_15px_rgba(16,185,129,0.2)]">
                <CheckCircle2 size={36} />
              </div>
              <div>
                <h3 className="text-xl font-bold text-white">Successfully Joined!</h3>
                <p className="text-sm text-textMuted mt-1">
                  You are now a member of <strong className="text-amber-400 font-semibold">{leagueName}</strong>.
                </p>
              </div>
              <Button onClick={clearTokenParam} className="w-full mt-2">
                Let's Play
              </Button>
            </div>
          ) : errorMessage ? (
            <div className="text-center space-y-4 py-4">
              <div className="w-16 h-16 bg-red-500/10 text-red-400 rounded-full flex items-center justify-center mx-auto border border-red-500/20">
                <AlertCircle size={36} />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">Invitation Error</h3>
                <p className="text-sm text-textMuted mt-1">{errorMessage}</p>
              </div>
              <Button variant="secondary" onClick={clearTokenParam} className="w-full mt-2">
                Close
              </Button>
            </div>
          ) : isAlreadyMember ? (
            <div className="text-center space-y-4 py-4">
              <div className="w-16 h-16 bg-blue-500/10 text-blue-400 rounded-full flex items-center justify-center mx-auto border border-blue-500/20">
                <CheckCircle2 size={36} className="text-blue-400" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">Already a Member</h3>
                <p className="text-sm text-textMuted mt-1">
                  You are already a member of <strong className="text-amber-400 font-semibold">{leagueName}</strong>.
                </p>
              </div>
              <Button onClick={clearTokenParam} className="w-full mt-2">
                Close
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-4 p-4 bg-amber-500/5 border border-amber-500/20 rounded-2xl">
                <div className="w-12 h-12 bg-amber-500/10 text-amber-500 rounded-xl flex items-center justify-center flex-shrink-0">
                  <Trophy size={24} />
                </div>
                <div>
                  <span className="text-xs text-textMuted font-bold uppercase tracking-wider">Invitation Received</span>
                  <h4 className="text-base font-extrabold text-white leading-tight mt-0.5">{leagueName}</h4>
                </div>
              </div>

              <p className="text-sm text-textMuted leading-relaxed">
                You've been invited to join this prediction league. Accept the invitation to compete.
              </p>

              <div className="flex gap-3 pt-3 border-t border-white/5">
                <Button variant="secondary" onClick={clearTokenParam} disabled={isJoining} className="flex-1">
                  Decline
                </Button>
                <Button onClick={handleJoin} disabled={isJoining} className="flex-1">
                  {isJoining ? 'Joining...' : 'Accept Invite'}
                </Button>
              </div>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
};
