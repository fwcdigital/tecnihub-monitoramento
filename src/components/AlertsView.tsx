import React, { useState } from 'react';
import { 
  Bell, 
  Mail, 
  Webhook, 
  MessageSquare, 
  Send, 
  Smartphone, 
  ShieldCheck, 
  Sliders, 
  Check, 
  Info,
  AlertCircle,
  Save
} from 'lucide-react';
import { AlertRule, FalseAlarmConfig } from '../types';

interface AlertsViewProps {
  alertRules: AlertRule[];
  falseAlarmConfig: FalseAlarmConfig;
  onUpdateRule: (updatedRule: AlertRule) => void;
  onUpdateFalseAlarmConfig: (config: FalseAlarmConfig) => void;
  onSendTestAlert: (channel: string) => void;
}

export const AlertsView: React.FC<AlertsViewProps> = ({
  alertRules,
  falseAlarmConfig,
  onUpdateRule,
  onUpdateFalseAlarmConfig,
  onSendTestAlert
}) => {
  const [consecutiveChecks, setConsecutiveChecks] = useState(falseAlarmConfig.consecutiveChecksToAlert);
  const [recheckSecs, setRecheckSecs] = useState(falseAlarmConfig.recheckIntervalSeconds);
  const [testEmail, setTestEmail] = useState('operacao@tecnihub.com.br');
  const [testWebhook, setTestWebhook] = useState('https://discord.com/api/webhooks/tecnihub/alerts');

  const handleToggleRule = (rule: AlertRule) => {
    onUpdateRule({
      ...rule,
      enabled: !rule.enabled
    });
  };

  const handleToggleChannel = (rule: AlertRule, channel: keyof AlertRule['channels']) => {
    onUpdateRule({
      ...rule,
      channels: {
        ...rule.channels,
        [channel]: !rule.channels[channel]
      }
    });
  };

  const handleSavePolicy = () => {
    onUpdateFalseAlarmConfig({
      ...falseAlarmConfig,
      consecutiveChecksToAlert: consecutiveChecks,
      recheckIntervalSeconds: recheckSecs
    });
  };

  return (
    <div className="space-y-4 sm:space-y-5">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-1 border-b border-[#1e1e1e]">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white font-sans">
            Configuração de Alertas
          </h1>
          <p className="text-xs text-neutral-400 mt-0.5">
            Defina canais de notificação, gatilhos de severidade e política de confirmação antecipada.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => onSendTestAlert('Email & Webhook')}
            className="px-3 py-1.5 text-xs font-semibold bg-[#111111] hover:bg-[#1a1a1a] text-neutral-200 border border-[#222222] rounded transition-colors flex items-center gap-1.5"
          >
            <Send className="w-3.5 h-3.5" />
            Disparar Alerta de Teste
          </button>
        </div>
      </div>

      {/* Evitar Falsos Alertas (Policy Card - High Operational Value) */}
      <div className="p-3.5 sm:p-4 rounded bg-[#0a0a0a] border border-[#1e1e1e] space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <div className="p-2 rounded bg-[#161616] border border-[#222222] text-white shrink-0">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-xs font-bold text-white tracking-wide uppercase font-mono">
                Política Anti-Falsos Alertas (Confirmação Prévia)
              </h2>
              <p className="text-[11px] text-neutral-400 mt-0.5 leading-relaxed max-w-2xl">
                Se uma verificação falhar, o sistema efetua re-tentativas imediatas em servidores secundários antes de declarar o site oficialmente Offline e acionar os canais da equipe.
              </p>
            </div>
          </div>

          <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 uppercase font-bold shrink-0">
            Proteção Ativa
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2.5 border-t border-[#181818]">
          <div>
            <label className="block text-[11px] font-medium text-neutral-300 mb-1 font-mono">
              Verificações consecutivas com falha
            </label>
            <select
              value={consecutiveChecks}
              onChange={(e) => setConsecutiveChecks(Number(e.target.value))}
              className="w-full px-2.5 py-1.5 bg-[#000000] border border-[#222222] rounded text-xs text-white focus:outline-none focus:border-neutral-500 font-mono"
            >
              <option value={1}>1 verificação (Alerta imediato - sem tolerância)</option>
              <option value={2}>2 verificações consecutivas</option>
              <option value={3}>3 verificações consecutivas (Padrão Recomendado)</option>
              <option value={5}>5 verificações consecutivas</option>
            </select>
            <span className="text-[9px] text-neutral-500 mt-0.5 block">
              Garante que flutuações rápidas de DNS não gerem ruído operacional.
            </span>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-neutral-300 mb-1 font-mono">
              Intervalo de re-verificação rápida
            </label>
            <select
              value={recheckSecs}
              onChange={(e) => setRecheckSecs(Number(e.target.value))}
              className="w-full px-2.5 py-1.5 bg-[#000000] border border-[#222222] rounded text-xs text-white focus:outline-none focus:border-neutral-500 font-mono"
            >
              <option value={15}>15 segundos</option>
              <option value={30}>30 segundos (Recomendado)</option>
              <option value={60}>60 segundos</option>
            </select>
            <span className="text-[9px] text-neutral-500 mt-0.5 block">
              Tempo de espera entre as tentativas consecutivas de checagem.
            </span>
          </div>

          <div className="flex flex-col justify-end">
            <button
              onClick={handleSavePolicy}
              className="px-3 py-1.5 text-xs font-semibold bg-white text-black hover:bg-neutral-200 rounded transition-colors flex items-center justify-center gap-1.5 shadow-xs"
            >
              <Save className="w-3.5 h-3.5" />
              Salvar Parâmetros
            </button>
          </div>
        </div>
      </div>

      {/* Canais de Comunicação */}
      <div className="space-y-2.5">
        <h2 className="text-xs font-bold text-white tracking-tight uppercase font-mono">
          Canais de Notificação Configurados
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-2 sm:gap-2.5">
          {/* E-mail */}
          <div className="p-3 rounded bg-[#0a0a0a] border border-[#1e1e1e] flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-white">
                <Mail className="w-3.5 h-3.5 text-neutral-300" />
                <span>E-mail</span>
              </div>
              <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-400">
                Ativo
              </span>
            </div>
            <p className="text-[10px] text-neutral-400 font-mono mt-1.5 truncate">
              operacao@tecnihub.com.br
            </p>
          </div>

          {/* Webhook */}
          <div className="p-3 rounded bg-[#0a0a0a] border border-[#1e1e1e] flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-white">
                <Webhook className="w-3.5 h-3.5 text-neutral-300" />
                <span>Webhook</span>
              </div>
              <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-400">
                Ativo
              </span>
            </div>
            <p className="text-[10px] text-neutral-400 font-mono mt-1.5 truncate">
              Discord / Slack / Teams
            </p>
          </div>

          {/* WhatsApp (Futuro / Preparado) */}
          <div className="p-3 rounded bg-[#0a0a0a]/60 border border-[#1e1e1e]/60 flex flex-col justify-between opacity-70">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-neutral-300">
                <MessageSquare className="w-3.5 h-3.5 text-neutral-500" />
                <span>WhatsApp</span>
              </div>
              <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-[#161616] text-neutral-500">
                Em breve
              </span>
            </div>
            <p className="text-[10px] text-neutral-500 font-mono mt-1.5">
              Gateway Z-API
            </p>
          </div>

          {/* Telegram (Futuro / Preparado) */}
          <div className="p-3 rounded bg-[#0a0a0a]/60 border border-[#1e1e1e]/60 flex flex-col justify-between opacity-70">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-neutral-300">
                <Send className="w-3.5 h-3.5 text-neutral-500" />
                <span>Telegram Bot</span>
              </div>
              <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-[#161616] text-neutral-500">
                Em breve
              </span>
            </div>
            <p className="text-[10px] text-neutral-500 font-mono mt-1.5">
              @TecnihubBot
            </p>
          </div>

          {/* Push Mobile (Futuro / Preparado) */}
          <div className="p-3 rounded bg-[#0a0a0a]/60 border border-[#1e1e1e]/60 flex flex-col justify-between opacity-70">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-neutral-300">
                <Smartphone className="w-3.5 h-3.5 text-neutral-500" />
                <span>Push Mobile</span>
              </div>
              <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-[#161616] text-neutral-500">
                Em breve
              </span>
            </div>
            <p className="text-[10px] text-neutral-500 font-mono mt-1.5">
              Web Push / PWA
            </p>
          </div>
        </div>
      </div>

      {/* Matriz de Regras e Gatilhos de Alerta - High Density */}
      <div className="space-y-2.5">
        <h2 className="text-xs font-bold text-white tracking-tight uppercase font-mono">
          Gatilhos de Eventos e Regras
        </h2>

        <div className="rounded border border-[#1e1e1e] bg-[#0a0a0a] overflow-hidden shadow-xs">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-[#1e1e1e] bg-[#000000] text-[9px] font-mono uppercase tracking-wider text-neutral-400">
                <th className="py-2.5 px-3 font-semibold">Evento Monitorado</th>
                <th className="py-2.5 px-2.5 text-center font-semibold">E-mail</th>
                <th className="py-2.5 px-2.5 text-center font-semibold">Webhook</th>
                <th className="py-2.5 px-2.5 text-center font-semibold text-neutral-600">WhatsApp</th>
                <th className="py-2.5 px-2.5 text-center font-semibold text-neutral-600">Telegram</th>
                <th className="py-2.5 px-3 text-right font-semibold">Status da Regra</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#181818] font-sans">
              {alertRules.map((rule) => (
                <tr key={rule.id} className="hover:bg-[#121212] transition-colors">
                  <td className="py-2.5 px-3">
                    <span className="font-semibold text-white block text-xs">{rule.name}</span>
                  </td>

                  {/* E-mail toggle */}
                  <td className="py-2.5 px-2.5 text-center">
                    <input
                      type="checkbox"
                      checked={rule.channels.email}
                      onChange={() => handleToggleChannel(rule, 'email')}
                      className="rounded bg-[#000000] border-[#333333] text-white focus:ring-0 cursor-pointer"
                    />
                  </td>

                  {/* Webhook toggle */}
                  <td className="py-2.5 px-2.5 text-center">
                    <input
                      type="checkbox"
                      checked={rule.channels.webhook}
                      onChange={() => handleToggleChannel(rule, 'webhook')}
                      className="rounded bg-[#000000] border-[#333333] text-white focus:ring-0 cursor-pointer"
                    />
                  </td>

                  {/* WhatsApp (disabled) */}
                  <td className="py-2.5 px-2.5 text-center">
                    <input
                      type="checkbox"
                      disabled
                      checked={false}
                      className="rounded bg-[#161616] border-[#222222] text-neutral-700 opacity-40 cursor-not-allowed"
                    />
                  </td>

                  {/* Telegram (disabled) */}
                  <td className="py-2.5 px-2.5 text-center">
                    <input
                      type="checkbox"
                      disabled
                      checked={false}
                      className="rounded bg-[#161616] border-[#222222] text-neutral-700 opacity-40 cursor-not-allowed"
                    />
                  </td>

                  {/* Rule Master Toggle */}
                  <td className="py-2.5 px-3 text-right">
                    <button
                      onClick={() => handleToggleRule(rule)}
                      className={`px-2.5 py-0.5 text-[10px] font-mono font-medium rounded transition-colors ${
                        rule.enabled
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                          : 'bg-[#161616] text-neutral-500 border border-[#222222]'
                      }`}
                    >
                      {rule.enabled ? 'Ativado' : 'Desativado'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
