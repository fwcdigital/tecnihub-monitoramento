import React, { useState } from 'react';
import { LockKeyhole, LogIn } from 'lucide-react';
import { TecnihubLogo } from './TecnihubLogo';

interface LoginViewProps {
  onLogin: (email: string, password: string) => Promise<void>;
}

export const LoginView: React.FC<LoginViewProps> = ({ onLogin }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setIsSubmitting(true);
    try {
      await onLogin(email, password);
      setPassword('');
    } catch (caught) {
      setPassword('');
      setError(caught instanceof Error ? caught.message : 'Não foi possível entrar.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#000000] text-white flex items-center justify-center px-4 antialiased">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <TecnihubLogo size="lg" />
        </div>

        <div className="rounded border border-[#242424] bg-[#080808] shadow-2xl">
          <div className="px-5 py-4 border-b border-[#1e1e1e] flex items-center gap-2.5">
            <div className="w-8 h-8 rounded bg-[#141414] border border-[#2a2a2a] flex items-center justify-center">
              <LockKeyhole className="w-4 h-4 text-neutral-300" />
            </div>
            <div>
              <h1 className="text-sm font-semibold text-white">Acesso administrativo</h1>
              <p className="text-[10px] font-mono text-neutral-500 mt-0.5">Somente equipe Tecnihub</p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="p-5 space-y-4">
            <div>
              <label htmlFor="admin-email" className="block text-[10px] uppercase tracking-wider font-mono text-neutral-400 mb-1.5">
                E-mail
              </label>
              <input
                id="admin-email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="w-full h-9 rounded bg-[#0d0d0d] border border-[#292929] px-3 text-sm text-white outline-none focus:border-neutral-500 transition-colors"
                placeholder="voce@tecnihub.com.br"
              />
            </div>

            <div>
              <label htmlFor="admin-password" className="block text-[10px] uppercase tracking-wider font-mono text-neutral-400 mb-1.5">
                Senha
              </label>
              <input
                id="admin-password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full h-9 rounded bg-[#0d0d0d] border border-[#292929] px-3 text-sm text-white outline-none focus:border-neutral-500 transition-colors"
                placeholder="Sua senha"
              />
            </div>

            {error && (
              <div role="alert" className="rounded border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-300">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full h-9 rounded bg-white text-black hover:bg-neutral-200 disabled:opacity-60 text-xs font-semibold flex items-center justify-center gap-2 transition-colors"
            >
              <LogIn className="w-3.5 h-3.5" />
              {isSubmitting ? 'Validando acesso...' : 'Entrar'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
