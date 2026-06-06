import React from 'react';
import { useMe, logout } from '../../api/hooks/useAuth';
import { useTournamentContext } from '../../api/TournamentContext';
import { Badge } from '../ui/Badge';
import { Link } from 'react-router-dom';
import { Logo } from '../ui/Logo';

export const Navbar: React.FC = () => {
  const { data: user } = useMe();
  const { tournaments, selectedTournamentId, setSelectedTournamentId } = useTournamentContext();

  return (
    <nav className="sticky top-0 z-40 w-full glass-card border-b-0 rounded-none h-16 flex items-center justify-between px-6">
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2">
          <Logo size={28} />
          <h1 className="text-xl font-bold bg-gradient-to-r from-[#8B5CF6] to-[#06B6D4] bg-clip-text text-transparent hidden sm:block">
            Football Predictor
          </h1>
        </div>
        
        {tournaments.length > 1 && (
          <select
            value={selectedTournamentId || ''}
            onChange={(e) => setSelectedTournamentId(parseInt(e.target.value, 10))}
            className="bg-black/40 text-xs sm:text-sm text-white border border-white/10 rounded-lg px-3 py-1.5 focus:ring-1 focus:ring-primary focus:border-transparent outline-none cursor-pointer transition-all duration-200"
          >
            {tournaments.map((t) => (
              <option key={t.id} value={t.id} className="bg-[#161B22] text-white">
                {t.name}
              </option>
            ))}
          </select>
        )}
      </div>
      
      <div className="flex items-center gap-4">
        {user && (
          <>
            <Link to="/profile" className="flex items-center gap-2.5 text-sm hover:text-primary transition-all group">
              <span className="text-textMain font-medium group-hover:text-primary transition-colors">{user.display_name}</span>
              {user.role === 'admin' && <Badge variant="admin">Admin</Badge>}
            </Link>
            <div className="w-px h-6 bg-white/10 mx-2"></div>
            <button 
              onClick={logout}
              className="text-sm text-textMuted hover:text-white transition-colors"
            >
              Logout
            </button>
          </>
        )}
      </div>
    </nav>
  );
};
