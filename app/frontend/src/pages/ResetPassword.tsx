import React, { useState } from 'react';
import { useResetPassword } from '../api/hooks/useAuth';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';

export const ResetPassword: React.FC = () => {
  const token = new URLSearchParams(window.location.search).get('token') || '';
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);
  const [validationError, setValidationError] = useState('');

  const resetPassword = useResetPassword();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirm) {
      setValidationError('Passwords do not match');
      return;
    }
    if (newPassword.length < 8) {
      setValidationError('Password must be at least 8 characters');
      return;
    }
    setValidationError('');
    resetPassword.mutate({ token, new_password: newPassword }, {
      onSuccess: () => setDone(true),
    });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0D1117] p-4 relative overflow-hidden">
      <div className="absolute top-[-10%] left-[-10%] w-[120%] h-[120%] bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-primary/10 via-[#0D1117] to-[#0D1117] -z-10 animate-pulse-gold opacity-30"></div>

      <Card className="w-full max-w-md shadow-2xl animate-in fade-in slide-in-from-bottom-4">
        <div className="text-center mb-8">
          <div className="text-5xl mb-4">🏆</div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-primary to-amber-200 bg-clip-text text-transparent mb-2">
            Football Predictor
          </h1>
          <p className="text-textMuted text-sm">Set a new password</p>
        </div>

        {!token ? (
          <div className="text-center">
            <p className="text-danger text-sm mb-4">Invalid or missing reset token.</p>
            <a href="/login" className="text-primary hover:text-amber-400 text-sm font-medium">Back to login</a>
          </div>
        ) : done ? (
          <div className="text-center space-y-4">
            <p className="text-green-400 text-sm">Password updated successfully.</p>
            <Button className="w-full" onClick={() => { window.location.href = '/login'; }}>
              Sign In
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-textMuted mb-1">New Password</label>
              <input
                type="password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                className="w-full bg-black/30 border border-white/10 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all"
                required
                minLength={8}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-textMuted mb-1">Confirm Password</label>
              <input
                type="password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                className="w-full bg-black/30 border border-white/10 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all"
                required
              />
            </div>

            {(validationError || resetPassword.isError) && (
              <div className="text-danger text-sm text-center font-medium">
                {validationError || ((resetPassword.error as any)?.response?.data?.detail || 'Invalid or expired token')}
              </div>
            )}

            <Button type="submit" className="w-full mt-2" isLoading={resetPassword.isPending}>
              Update Password
            </Button>

            <div className="text-center">
              <a href="/login" className="text-sm text-textMuted hover:text-primary transition-colors">
                Back to login
              </a>
            </div>
          </form>
        )}
      </Card>
    </div>
  );
};
