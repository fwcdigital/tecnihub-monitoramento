import React from 'react';
import { Settings, Shield, Server, Info } from 'lucide-react';
import { TecnihubLogo } from './TecnihubLogo';

export const SettingsView: React.FC = () => {
  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="pb-1 border-b border-[#1e1e1e]">
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white font-sans">Configurações do Sistema</h1>
        <p className="text-xs text-neutral-400 mt-0.5">Configuração efetiva do MVP e recursos disponíveis.</p>
      </div>

      <div className="p-3.5 sm:p-4 rounded bg-[#0a0a0a] border border-[#1e1e1e] space-y-3">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded bg-black border border-[#1e1e1e]"><TecnihubLogo size="sm" /></div>
          <div>
            <h2 className="text-xs font-bold text-white uppercase font-mono">TECNIHUB Monitoramento</h2>
            <p className="text-[11px] text-neutral-400 mt-0.5">Identidade embarcada na aplicação.</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="p-3.5 rounded bg-[#0a0a0a] border border-[#1e1e1e] space-y-2.5">
          <div className="flex items-center gap-1.5"><Server className="w-4 h-4 text-neutral-400" /><h2 className="text-xs font-bold text-white uppercase font-mono">Motor HTTP</h2></div>
          <ul className="space-y-1.5 text-[11px] text-neutral-400">
            <li>Disponibilidade, status HTTP, redirects e tempo de resposta: ativos.</li>
            <li>SSL, vencimento de domínio, conteúdo e tracking: indisponíveis no coletor atual.</li>
            <li>Intervalo por site: executado pelo agendador quando habilitado no servidor.</li>
          </ul>
        </div>

        <div className="p-3.5 rounded bg-[#0a0a0a] border border-[#1e1e1e] space-y-2.5">
          <div className="flex items-center gap-1.5"><Shield className="w-4 h-4 text-neutral-400" /><h2 className="text-xs font-bold text-white uppercase font-mono">Administração</h2></div>
          <ul className="space-y-1.5 text-[11px] text-neutral-400">
            <li>Autenticação: Supabase Auth com sessão backend.</li>
            <li>Banco: acesso da aplicação somente por service role.</li>
            <li>Parâmetros sensíveis: gerenciados por variáveis de ambiente no servidor.</li>
          </ul>
        </div>
      </div>

      <div className="p-3 rounded bg-[#0a0a0a] border border-[#1e1e1e] flex items-start gap-2.5">
        <Info className="w-4 h-4 text-neutral-400 shrink-0 mt-0.5" />
        <div>
          <div className="flex items-center gap-1.5 text-xs font-semibold text-neutral-200"><Settings className="w-3.5 h-3.5" />Sem configurações locais simuladas</div>
          <p className="text-[11px] text-neutral-500 mt-0.5">Esta tela é somente informativa. Nenhuma alteração é anunciada como salva sem persistência real no backend.</p>
        </div>
      </div>
    </div>
  );
};
