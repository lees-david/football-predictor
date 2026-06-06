import React, { useState } from 'react';
import { useLogin, useRegister, useForgotPassword } from '../api/hooks/useAuth';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Logo } from '../components/ui/Logo';

export const Login: React.FC = () => {
  const [isLogin, setIsLogin] = useState(
    !new URLSearchParams(window.location.search).get('invite') &&
    !new URLSearchParams(window.location.search).get('token')
  );
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [teamName, setTeamName] = useState('');
  const [inviteToken, setInviteToken] = useState(
    new URLSearchParams(window.location.search).get('invite') ||
    new URLSearchParams(window.location.search).get('token') ||
    ''
  );
  
  const [showForgot, setShowForgot] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotSent, setForgotSent] = useState(false);
  const [emailOptIn, setEmailOptIn] = useState(false);

  const login = useLogin();
  const register = useRegister();
  const forgotPassword = useForgotPassword();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const urlParams = new URLSearchParams(window.location.search);
    const currentToken = urlParams.get('token') || urlParams.get('invite') || inviteToken;

    const redirectHome = () => {
      if (currentToken) {
        if (!isLogin) {
          window.location.href = `/?token=${currentToken}&registered=true`;
        } else {
          window.location.href = `/?token=${currentToken}`;
        }
      } else {
        window.location.href = '/';
      }
    };

    if (isLogin) {
      const params = new URLSearchParams();
      params.append('username', email);
      params.append('password', password);
      login.mutate(params, {
        onSuccess: redirectHome
      });
    } else {
      register.mutate({ email, password, display_name: displayName, team_name: teamName, invite_token: inviteToken, email_opt_in: emailOptIn }, {
        onSuccess: redirectHome
      });
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#070A13] p-4 relative overflow-hidden">
      {/* Neon Background Glow Blobs */}
      <div className="absolute top-[-20%] left-[-20%] w-[600px] h-[600px] bg-[#8B5CF6]/10 rounded-full blur-[140px] pointer-events-none -z-10 animate-pulse" style={{ animationDuration: '8s' }}></div>
      <div className="absolute bottom-[-20%] right-[-20%] w-[600px] h-[600px] bg-[#06B6D4]/10 rounded-full blur-[140px] pointer-events-none -z-10 animate-pulse" style={{ animationDuration: '10s' }}></div>
      
      <Card className="w-full max-w-md shadow-[0_0_50px_-12px_rgba(139,92,246,0.2)] border border-[#8B5CF6]/20 bg-[#0E1322]/90 backdrop-blur-xl animate-in fade-in slide-in-from-bottom-4 relative before:absolute before:inset-0 before:rounded-xl before:p-[1px] before:bg-gradient-to-r before:from-[#8B5CF6]/40 before:to-[#06B6D4]/40 before:-z-10">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <Logo size={60} />
          </div>
          <h1 className="text-3xl font-extrabold bg-gradient-to-r from-[#8B5CF6] to-[#06B6D4] bg-clip-text text-transparent mb-2 tracking-tight">
            Football Predictor
          </h1>
          <p className="text-textMuted text-sm">
            {isLogin ? 'Sign in to make your predictions' : 'Create an account to join the action'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {!isLogin && (
            <>
              <div>
                <label className="block text-sm font-medium text-textMuted mb-1">Your Name</label>
                <input
                  type="text"
                  value={displayName}
                  onChange={e => setDisplayName(e.target.value)}
                  className="w-full bg-[#070A13]/60 border border-white/10 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-[#06B6D4] focus:border-transparent focus:shadow-[0_0_15px_rgba(6,182,212,0.15)] outline-none transition-all"
                  placeholder="Your real name"
                  required={!isLogin}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-textMuted mb-1">Team Name</label>
                <input
                  type="text"
                  value={teamName}
                  onChange={e => setTeamName(e.target.value)}
                  className="w-full bg-[#070A13]/60 border border-white/10 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-[#06B6D4] focus:border-transparent focus:shadow-[0_0_15px_rgba(6,182,212,0.15)] outline-none transition-all"
                  placeholder="Your team's nickname"
                  required={!isLogin}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-textMuted mb-1">League Invite Token</label>
                <input 
                  type="text" 
                  value={inviteToken}
                  onChange={e => setInviteToken(e.target.value)}
                  className="w-full bg-[#070A13]/60 border border-white/10 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-[#06B6D4] focus:border-transparent focus:shadow-[0_0_15px_rgba(6,182,212,0.15)] outline-none transition-all"
                  placeholder="Ask a league manager for a token"
                  required={!isLogin}
                />
              </div>
            </>
          )}
          
          <div>
            <label className="block text-sm font-medium text-textMuted mb-1">Email</label>
            <input 
              type="email" 
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full bg-[#070A13]/60 border border-white/10 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-[#06B6D4] focus:border-transparent focus:shadow-[0_0_15px_rgba(6,182,212,0.15)] outline-none transition-all"
              required
            />
          </div>
          
          <div>
            <div className="flex justify-between items-center mb-1">
              <label className="block text-sm font-medium text-textMuted">Password</label>
              {isLogin && (
                <button
                  type="button"
                  onClick={() => { setShowForgot(true); setForgotSent(false); setForgotEmail(''); }}
                  className="text-xs text-[#06B6D4] hover:text-[#8B5CF6] transition-colors"
                >
                  Forgot password?
                </button>
              )}
            </div>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full bg-[#070A13]/60 border border-white/10 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-[#06B6D4] focus:border-transparent focus:shadow-[0_0_15px_rgba(6,182,212,0.15)] outline-none transition-all"
              required
            />
          </div>

          {!isLogin && (
            <div className="space-y-4 pt-2">
              <label className="flex items-start gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={emailOptIn}
                  onChange={e => setEmailOptIn(e.target.checked)}
                  className="mt-1 rounded bg-[#070A13]/60 border border-white/10 text-[#06B6D4] focus:ring-[#06B6D4] transition-colors"
                />
                <span className="text-xs text-textMuted leading-snug group-hover:text-white transition-colors">
                  I want to receive tournament updates, daily digests, and leaderboard alerts via email. (Opt-in; you can unsubscribe at any time in your profile).
                </span>
              </label>

              <div className="p-3 bg-[#161B22]/50 border border-white/5 rounded-lg text-[11px] text-textMuted/60 leading-relaxed">
                🛡️ <strong>GDPR Notice:</strong> We only process your data (name, team name, email) to run this predictor league and facilitate secure access. Email is used for essential notifications (such as password resets) and opt-in communications. You can permanently delete your account at any time in your profile.
              </div>
            </div>
          )}

          {(login.isError || register.isError) && (
            <div className="text-danger text-sm text-center font-medium">
              {isLogin 
                ? 'Invalid credentials' 
                : ((register.error as any)?.response?.data?.detail || 'Error creating account')}
            </div>
          )}

          <Button 
            type="submit" 
            className="w-full mt-6 bg-gradient-to-r from-[#8B5CF6] to-[#06B6D4] hover:from-[#7C3AED] hover:to-[#0891B2] text-white border-0 shadow-lg shadow-[#8B5CF6]/20 transition-all duration-300" 
            isLoading={login.isPending || register.isPending}
          >
            {isLogin ? 'Sign In' : 'Sign Up'}
          </Button>
        </form>

        <div className="mt-6 text-center text-sm text-textMuted">
          {isLogin ? "Don't have an account? " : "Already have an account? "}
          <button
            type="button"
            onClick={() => setIsLogin(!isLogin)}
            className="text-[#06B6D4] hover:text-[#8B5CF6] font-medium transition-colors"
          >
            {isLogin ? 'Register' : 'Sign In'}
          </button>
        </div>
      </Card>

      {showForgot && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-[#161B22] border border-white/10 rounded-xl p-6 w-full max-w-sm shadow-2xl">
            <h2 className="text-lg font-semibold text-white mb-2">Reset Password</h2>
            {forgotSent ? (
              <>
                <p className="text-textMuted text-sm mb-4">
                  If that email is registered, a reset link has been sent. Check your inbox.
                </p>
                <Button className="w-full" onClick={() => setShowForgot(false)}>Done</Button>
              </>
            ) : (
              <>
                <p className="text-textMuted text-sm mb-4">
                  Enter your email and we'll send you a reset link.
                </p>
                <form
                  onSubmit={async e => {
                    e.preventDefault();
                    await forgotPassword.mutateAsync(forgotEmail);
                    setForgotSent(true);
                  }}
                  className="space-y-4"
                >
                  <input
                    type="email"
                    value={forgotEmail}
                    onChange={e => setForgotEmail(e.target.value)}
                    className="w-full bg-[#070A13]/60 border border-white/10 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-[#06B6D4] focus:border-transparent focus:shadow-[0_0_15px_rgba(6,182,212,0.15)] outline-none transition-all"
                    placeholder="your@email.com"
                    required
                  />
                  <div className="flex gap-3">
                    <Button type="button" variant="secondary" className="flex-1" onClick={() => setShowForgot(false)}>
                      Cancel
                    </Button>
                    <Button type="submit" className="flex-1" isLoading={forgotPassword.isPending}>
                      Send Link
                    </Button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
