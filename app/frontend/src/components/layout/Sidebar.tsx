import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { useMe } from '../../api/hooks/useAuth';
import { useTournamentContext } from '../../api/TournamentContext';
import { useFixtures } from '../../api/hooks/useFixtures';
import { useMyPredictions } from '../../api/hooks/usePredictions';
import { useMyBracket } from '../../api/hooks/useBracket';
import { useChecklistActiveBadge } from '../../api/hooks/useChecklistStatus';
import {
  Home,
  Calendar,
  CheckSquare,
  Target,
  Trophy,
  BarChart2,
  Settings,
  Users,
  User,
  Shield,
  Info,
  FlaskConical,
  Mail,
  TrendingUp,
  Server,
  ClipboardList,
  GitBranch,
  ShieldCheck,
  Flag,
  Database,
} from 'lucide-react';

interface NavItemDef {
  name: string;
  path: string;
  icon: React.ReactNode;
  badge?: number;
  showBadge?: boolean;
  activeMatch?: (pathname: string, search: string) => boolean;
}

export const Sidebar: React.FC = () => {
  const { data: user } = useMe();
  const { selectedTournament } = useTournamentContext();
  const location = useLocation();

  const { data: fixtures } = useFixtures(selectedTournament?.id);
  const { data: myPredictions } = useMyPredictions(selectedTournament?.id);
  const { data: myBracket } = useMyBracket(selectedTournament?.id);

  const isPlaceholderName = (name: string) => {
    const low = name.toLowerCase();
    return ['match', 'placeholder', 'winner', 'loser', 'runner', 'group'].some(x => low.includes(x));
  };

  const predictedFixtureIds = new Set((myPredictions ?? []).map(p => p.fixture_id));
  const now = Date.now();
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

  const instructionsBadge = useChecklistActiveBadge(selectedTournament?.id);

  const completedCount = (fixtures ?? []).filter(f => f.status === 'completed').length;

  const navItems: NavItemDef[] = [
    { name: 'Dashboard', path: '/', icon: <Home size={20} /> },
    { name: 'Fixtures', path: '/fixtures', icon: <Calendar size={20} />, activeMatch: (p, s) => p === '/fixtures' && !s.includes('tab=results') },
    ...(completedCount > 0 ? [{
      name: 'Results',
      path: '/fixtures?tab=results',
      icon: <CheckSquare size={20} />,
      activeMatch: (p: string, s: string) => p === '/fixtures' && s.includes('tab=results'),
    }] : []),
    { name: 'Scores', path: '/predictions', icon: <Target size={20} />, badge: scoresBadge },
    ...(selectedTournament?.has_bracket ? [
      {
        name: 'Groups',
        path: '/bracket',
        icon: <Users size={20} />,
        badge: groupsBadge,
        activeMatch: (p: string, s: string) => p === '/bracket' && !s.includes('tab=ko'),
      },
      {
        name: 'Knockout',
        path: '/bracket?tab=ko',
        icon: <GitBranch size={20} />,
        badge: koBadge,
        showBadge: selectedTournament?.has_bracket && !isPastBracketKickoff && koPicksSaved < 32,
        activeMatch: (p: string, s: string) => p === '/bracket' && s.includes('tab=ko'),
      },
    ] : []),
    { name: 'Leaderboard', path: '/leaderboard', icon: <BarChart2 size={20} /> },
    { name: 'Leagues', path: '/leagues', icon: <Users size={20} /> },
    { name: 'FIFA Ranking', path: '/fifa-rankings', icon: <Trophy size={20} /> },
    { name: 'Teams', path: '/teams', icon: <Flag size={20} /> },
    { name: 'Instructions', path: '/instructions', icon: <Info size={20} />, badge: instructionsBadge },
    { name: 'My Points', path: '/my-points', icon: <TrendingUp size={20} /> },
    { name: 'Profile', path: '/profile', icon: <User size={20} /> },
  ];

  const isAdmin = user?.role === 'admin';
  const canManageLeagues = isAdmin || !!user?.can_manage_leagues;

  const { data: maintenanceStatus } = useQuery({
    queryKey: ['admin-maintenance-status'],
    queryFn: () => apiClient.get('/maintenance/admin/status').then(r => r.data),
    enabled: isAdmin,
    refetchInterval: 60000 * 5, // Check every 5 minutes
  });

  const hasGitUpdate = maintenanceStatus?.git && !maintenanceStatus.git.up_to_date;

  const adminItems: (NavItemDef & { show: boolean })[] = [
    { name: 'Manage Users', path: '/admin/users', icon: <Shield size={20} />, show: isAdmin },
    { name: 'Tournaments', path: '/admin/tournaments', icon: <Trophy size={20} />, show: isAdmin },
    { name: 'Leagues', path: '/admin/leagues', icon: <Settings size={20} />, show: canManageLeagues },
    { name: 'Provision Users', path: '/admin/provision', icon: <Users size={20} />, show: isAdmin },
    { name: 'Simulation', path: '/admin/simulation', icon: <FlaskConical size={20} />, show: isAdmin },
    { name: 'Email', path: '/admin/email', icon: <Mail size={20} />, show: isAdmin },
    { name: 'Results Manager', path: '/admin/results', icon: <ClipboardList size={20} />, show: isAdmin },
    { name: 'Build', path: '/admin/build', icon: <Server size={20} />, show: isAdmin },
    { name: 'Audit', path: '/admin/audit', icon: <ShieldCheck size={20} />, show: isAdmin },
    { name: 'Maintenance', path: '/admin/maintenance', icon: <Shield size={20} />, show: isAdmin, badge: hasGitUpdate ? 1 : undefined },
    { name: 'Backups', path: '/admin/backups', icon: <Database size={20} />, show: isAdmin },
  ].filter(i => i.show);

  const showAdminSection = adminItems.length > 0;

  const NavItem = ({ item }: { item: NavItemDef }) => {
    const isActive = item.activeMatch
      ? item.activeMatch(location.pathname, location.search)
      : (location.pathname === item.path || (item.path !== '/' && location.pathname.startsWith(item.path.split('?')[0])));

    return (
      <NavLink
        to={item.path}
        className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 ${
          isActive
            ? 'bg-primary/10 text-primary border-l-2 border-primary'
            : 'text-textMuted hover:bg-white/5 hover:text-textMain border-l-2 border-transparent'
        }`}
      >
        {item.icon}
        <span className="font-medium flex-1">{item.name}</span>
        {(item.showBadge || !!item.badge) && (
          <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-amber-500 text-black text-xs font-bold flex items-center justify-center leading-none">
            {(item.badge ?? 0) > 99 ? '99+' : (item.badge ?? 0)}
          </span>
        )}
      </NavLink>
    );
  };

  return (
    <aside className="w-64 fixed left-0 top-16 bottom-0 glass-card rounded-none border-t-0 border-r-white/5 overflow-y-auto">
      <div className="p-4 flex flex-col gap-2">
        <div className="text-xs font-semibold text-textMuted uppercase tracking-wider mb-2 mt-4 px-4">Menu</div>
        {navItems.map((item) => (
          <NavItem key={item.path} item={item} />
        ))}

        {showAdminSection && (
          <>
            <div className="text-xs font-semibold text-textMuted uppercase tracking-wider mb-2 mt-8 px-4">Admin</div>
            {adminItems.map((item) => (
              <NavItem key={item.path} item={item} />
            ))}
          </>
        )}
      </div>
    </aside>
  );
};
