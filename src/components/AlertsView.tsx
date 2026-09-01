import React from 'react';
import { Bell, Mail, Webhook, ShieldCheck, Info } from 'lucide-react';

export const AlertsView: React.FC = () => {
  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="pb-1 border-b border-[#1e1e1e]">
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white font-sans">Alertas & Canais</h1>
        <p className="text-xs text-neutral-400 mt-0.5">Estado real das regras de confirmação e integrações de notificação.</p>
      </div>

      <div className="p-3.5 sm:p-4 rounded bg-[#0a0a0a] border border-[#1e1e1e] space-y-3">
        <div className="flex items-start gap-2.5">
          <div className="p-2 rounded bg-[#161616] border border-[#222222] text-white shrink-0"><ShieldCheck className="w-4 h-4" /></div>
          <div>
            <h2 className="text-xs font-bold text-white tracking-wide uppercase font-mono">Política anti-falso-positivo</h2>
            <p className="text-[11px] text-neutral-400 mt-0.5 leading-relaxed">
              Um incidente é aberto após 3 checks consecutivos críticos/offline e é resolvido automaticamente após 2 checks consecutivos online. Os contadores usam somente checks reais persistidos no Supabase.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2 border-t border-[#181818]">
          <div className="p-2.5 rounded bg-black border border-[#1e1e1e]">
            <span className="text-[9px] uppercase font-mono text-neutral-500 block">Confirmação de falha</span>
            <span className="text-xs font-mono font-bold text-white">3 checks consecutivos</span>
          </div>
          <div className="p-2.5 rounded bg-black border border-[#1e1e1e]">
            <span className="text-[9px] uppercase font-mono text-neutral-500 block">Confirmação de recuperação</span>
            <span className="text-xs font-mono font-bold text-white">2 checks consecutivos</span>
          </div>
        </div>
      </div>

      <div className="space-y-2.5">
        <h2 className="text-xs font-bold text-white tracking-tight uppercase font-mono">Canais de notificação</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
          {[{ name: 'E-mail', icon: Mail }, { name: 'Webhook', icon: Webhook }].map(({ name, icon: Icon }) => (
            <div key={name} className="p-3 rounded bg-[#0a0a0a] border border-[#1e1e1e]">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-white"><Icon className="w-3.5 h-3.5 text-neutral-400" />{name}</div>
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[#161616] text-neutral-400 border border-[#222222]">Não configurado</span>
              </div>
              <p className="text-[10px] text-neutral-500 font-mono mt-1.5">Nenhuma integração real está configurada neste MVP.</p>
            </div>
          ))}
        </div>
      </div>

      <div className="p-3 rounded bg-[#0a0a0a] border border-[#1e1e1e] flex items-start gap-2.5">
        <Info className="w-4 h-4 text-neutral-400 shrink-0 mt-0.5" />
        <div>
          <div className="flex items-center gap-1.5 text-xs font-semibold text-neutral-200"><Bell className="w-3.5 h-3.5" />Entrega de alertas indisponível</div>
          <p className="text-[11px] text-neutral-500 mt-0.5">Os incidentes são registrados e exibidos, mas o sistema não afirma ter enviado e-mail, webhook ou mensagem enquanto não houver um provedor real configurado.</p>
        </div>
      </div>
    </div>
  );
};
