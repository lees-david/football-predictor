import React, { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useMe } from '../../api/hooks/useAuth';

interface AuthGuardProps {
  children: React.ReactNode;
  requireAdmin?: boolean;
  requireLeagueManager?: boolean;
}

export const AuthGuard: React.FC<AuthGuardProps> = ({ children, requireAdmin = false, requireLeagueManager = false }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { data: user, isLoading, isError } = useMe();

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      navigate(`/login${location.search}`, { state: { from: location }, replace: true });
    }
  }, [navigate, location]);

  useEffect(() => {
    if (isError) {
      navigate(`/login${location.search}`, { state: { from: location }, replace: true });
    }
  }, [isError, navigate, location]);

  if (isLoading) {
    return <div className="flex h-screen items-center justify-center"><div className="animate-pulse-gold h-12 w-12 rounded-full"></div></div>;
  }

  if (!user) return null;

  if (requireAdmin && user.role !== 'admin') {
    navigate('/', { replace: true });
    return null;
  }

  if (requireLeagueManager && user.role !== 'admin' && !user.can_manage_leagues) {
    navigate('/', { replace: true });
    return null;
  }

  return <>{children}</>;
};
