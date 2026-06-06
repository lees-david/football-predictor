import { Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/layout/Layout';
import { AuthGuard } from './components/layout/AuthGuard';
import { ErrorBoundary } from './components/layout/ErrorBoundary';

import { Login } from './pages/Login';
import { ResetPassword } from './pages/ResetPassword';
import { MaintenanceScreen } from './pages/MaintenanceScreen';
import { Dashboard } from './pages/Dashboard';
import { Fixtures } from './pages/Fixtures';
import { MatchPredictions } from './pages/MatchPredictions';
import { BracketBuilder } from './pages/BracketBuilder';
import { Leaderboard } from './pages/Leaderboard';
import { Instructions } from './pages/Instructions';
import { Profile } from './pages/Profile';
import { MyPoints } from './pages/MyPoints';
import { Leagues } from './pages/Leagues';
import { FifaRankings } from './pages/FifaRankings';
import { Teams } from './pages/Teams';
import { LeagueCreate } from './pages/Admin/LeagueCreate';
import { UserProvision } from './pages/Admin/UserProvision';
import { UserManagement } from './pages/Admin/UserManagement';
import { ManageTournaments } from './pages/Admin/ManageTournaments';
import { Simulation } from './pages/Admin/Simulation';
import { EmailManagement } from './pages/Admin/EmailManagement';
import { BuildInfo } from './pages/Admin/BuildInfo';
import { ResultsManager } from './pages/Admin/ResultsManager';
import { AuditPage } from './pages/Admin/AuditPage';
import { MaintenanceAdmin } from './pages/Admin/MaintenanceAdmin';
import { BackupsAdmin } from './pages/Admin/BackupsAdmin';

function App() {
  return (
    <ErrorBoundary>
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/maintenance" element={<MaintenanceScreen />} />
      
      <Route element={<AuthGuard><Layout /></AuthGuard>}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/fixtures" element={<Fixtures />} />
        <Route path="/predictions" element={<MatchPredictions />} />
        <Route path="/bracket" element={<BracketBuilder />} />
        <Route path="/leaderboard" element={<Leaderboard />} />
        <Route path="/leagues" element={<Leagues />} />
        <Route path="/instructions" element={<Instructions />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/my-points" element={<MyPoints />} />
        <Route path="/fifa-rankings" element={<FifaRankings />} />
        <Route path="/teams" element={<Teams />} />
      </Route>

      <Route element={<AuthGuard requireLeagueManager><Layout /></AuthGuard>}>
        <Route path="/admin/leagues" element={<LeagueCreate />} />
      </Route>

      <Route element={<AuthGuard requireAdmin><Layout /></AuthGuard>}>
        <Route path="/admin/provision" element={<UserProvision />} />
        <Route path="/admin/users" element={<UserManagement />} />
        <Route path="/admin/tournaments" element={<ManageTournaments />} />
        <Route path="/admin/simulation" element={<Simulation />} />
        <Route path="/admin/email" element={<EmailManagement />} />
        <Route path="/admin/build" element={<BuildInfo />} />
        <Route path="/admin/results" element={<ResultsManager />} />
        <Route path="/admin/audit" element={<AuditPage />} />
        <Route path="/admin/maintenance" element={<MaintenanceAdmin />} />
        <Route path="/admin/backups" element={<BackupsAdmin />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </ErrorBoundary>
  );
}

export default App;
