import React, { useState } from 'react';
import { 
  Settings, 
  RefreshCw, 
  Shield, 
  Server, 
  Sliders, 
  Check, 
  Zap, 
  RotateCcw, 
  Upload,
  Layers,
  FileCode,
  Info
} from 'lucide-react';
import { TecnihubLogo } from './TecnihubLogo';

interface SettingsViewProps {
  onSimulateOutage: () => void;
  onSimulateSlowdown: () => void;
  onRestoreAllHealthy: () => void;
  onResetToDefaults: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  onSimulateOutage,
  onSimulateSlowdown,
  onRestoreAllHealthy,
  onResetToDefaults
}) => {
  const [refreshInterval, setRefreshInterval] = useState('30');
  const [defaultTimeout, setDefaultTimeout] = useState('15');
  const [agencyName, setAgencyName] = useState('TECNIHUB Agência Digital');
  const [opsEmail, setOpsEmail] = useState('operacao@tecnihub.com.br');
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  return (
    <div className="space-y-4 sm:space-y-5">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-1 border-b border-[#1e1e1e]">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white font-sans">
            Configurações do Sistema
          </h1>
          <p className="text-xs text-neutral-400 mt-0.5">
            Ajustes internos operacionais, parâmetros de verificação e identidade da TECNIHUB.
          </p>
        </div>

        <button
          onClick={handleSave}
          className="px-3 py-1.5 text-xs font-semibold bg-white text-black hover:bg-neutral-200 rounded transition-colors flex items-center gap-1.5 shadow-xs"
        >
          {saved ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Settings className="w-3.5 h-3.5" />}
          {saved ? 'Configurações Salvas' : 'Salvar Alterações'}
        </button>
      </div>

      {/* Identidade Visual & Logo */}
      <div className="p-3.5 sm:p-4 rounded bg-[#0a0a0a] border border-[#1e1e1e] space-y-3">
        <div>
          <h2 className="text-xs font-bold text-white tracking-tight uppercase font-mono">
            Identidade Visual da Agência
          </h2>
          <p className="text-[11px] text-neutral-400 mt-0.5">
            Logomarca e apresentação no menu e relatórios operacionais.
          </p>
        </div>

        <div className="p-3 rounded bg-[#000000] border border-[#1e1e1e] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded bg-[#0a0a0a] border border-[#1e1e1e] flex items-center justify-center">
              <TecnihubLogo size="sm" />
            </div>
            <div>
              <p className="text-xs font-semibold text-white font-mono">Emblema Oficial TECNIHUB (Vetor Ativo)</p>
              <p className="text-[10px] text-neutral-400 mt-0.5">
                Projetado em alta resolução no padrão estético minimalista preto e branco.
              </p>
            </div>
          </div>

          <label className="px-2.5 py-1 rounded bg-[#161616] hover:bg-[#222222] text-neutral-200 text-xs font-medium border border-[#222222] cursor-pointer transition-colors flex items-center gap-1.5">
            <Upload className="w-3.5 h-3.5" />
            Substituir Arquivo da Logo
            <input type="file" accept="image/*" className="hidden" />
          </label>
        </div>
      </div>

      {/* Parâmetros Globais de Monitoramento */}
      <div className="p-3.5 sm:p-4 rounded bg-[#0a0a0a] border border-[#1e1e1e] space-y-3">
        <div>
          <h2 className="text-xs font-bold text-white tracking-tight uppercase font-mono">
            Parâmetros do Motor de Verificação
          </h2>
          <p className="text-[11px] text-neutral-400 mt-0.5">
            Intervalos de atualização e thresholds de timeout para a esteira de monitoramento.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] font-medium text-neutral-300 mb-1 font-mono">
              Auto-refresh do Dashboard em Tempo Real
            </label>
            <select
              value={refreshInterval}
              onChange={(e) => setRefreshInterval(e.target.value)}
              className="w-full px-2.5 py-1.5 bg-[#000000] border border-[#222222] rounded text-xs text-white focus:outline-none focus:border-neutral-500 font-mono"
            >
              <option value="15">A cada 15 segundos</option>
              <option value="30">A cada 30 segundos (Recomendado)</option>
              <option value="60">A cada 60 segundos</option>
              <option value="120">A cada 2 minutos</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-neutral-300 mb-1 font-mono">
              Timeout padrão de requisição HTTP
            </label>
            <select
              value={defaultTimeout}
              onChange={(e) => setDefaultTimeout(e.target.value)}
              className="w-full px-2.5 py-1.5 bg-[#000000] border border-[#222222] rounded text-xs text-white focus:outline-none focus:border-neutral-500 font-mono"
            >
              <option value="10">10 segundos</option>
              <option value="15">15 segundos (Padrão)</option>
              <option value="30">30 segundos</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
          <div>
            <label className="block text-[11px] font-medium text-neutral-300 mb-1 font-mono">
              Nome da Agência / Time
            </label>
            <input
              type="text"
              value={agencyName}
              onChange={(e) => setAgencyName(e.target.value)}
              className="w-full px-2.5 py-1.5 bg-[#000000] border border-[#222222] rounded text-xs text-white focus:outline-none focus:border-neutral-500 font-mono"
            />
          </div>

          <div>
            <label className="block text-[11px] font-medium text-neutral-300 mb-1 font-mono">
              E-mail Operacional Central
            </label>
            <input
              type="email"
              value={opsEmail}
              onChange={(e) => setOpsEmail(e.target.value)}
              className="w-full px-2.5 py-1.5 bg-[#000000] border border-[#222222] rounded text-xs text-white focus:outline-none focus:border-neutral-500 font-mono"
            />
          </div>
        </div>
      </div>

      {/* Laboratório de Testes Operacionais (Simulador de Estados) */}
      <div className="p-3.5 sm:p-4 rounded bg-[#0a0a0a] border border-[#1e1e1e] space-y-3">
        <div>
          <div className="flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5 text-amber-400" />
            <h2 className="text-xs font-bold text-white tracking-tight uppercase font-mono">
              Laboratório de Simulação de Estados Operacionais
            </h2>
          </div>
          <p className="text-[11px] text-neutral-400 mt-0.5 leading-relaxed">
            Permite à equipe testar como a interface reage visualmente a diferentes cenários críticos (queda de site, degradação de performance ou restauração total).
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-2.5 pt-1">
          <button
            onClick={onSimulateOutage}
            className="p-3 rounded bg-rose-950/20 border border-rose-900/40 hover:border-rose-700 text-left transition-colors group cursor-pointer"
          >
            <span className="text-xs font-bold text-rose-400 block group-hover:text-rose-300 font-mono">
              Simular Queda (503)
            </span>
            <span className="text-[10px] text-neutral-400 mt-0.5 block">
              Altera status para offline com destaque crítico.
            </span>
          </button>

          <button
            onClick={onSimulateSlowdown}
            className="p-3 rounded bg-amber-950/20 border border-amber-900/40 hover:border-amber-700 text-left transition-colors group cursor-pointer"
          >
            <span className="text-xs font-bold text-amber-400 block group-hover:text-amber-300 font-mono">
              Simular Degradação (&gt; 5s)
            </span>
            <span className="text-[10px] text-neutral-400 mt-0.5 block">
              Gera alerta amarelo de latência excessiva.
            </span>
          </button>

          <button
            onClick={onRestoreAllHealthy}
            className="p-3 rounded bg-emerald-950/20 border border-emerald-900/40 hover:border-emerald-700 text-left transition-colors group cursor-pointer"
          >
            <span className="text-xs font-bold text-emerald-400 block group-hover:text-emerald-300 font-mono">
              Restaurar Saudável
            </span>
            <span className="text-[10px] text-neutral-400 mt-0.5 block">
              Coloca todos os sites com status verde online.
            </span>
          </button>

          <button
            onClick={onResetToDefaults}
            className="p-3 rounded bg-[#000000] border border-[#1e1e1e] hover:border-[#333333] text-left transition-colors group cursor-pointer"
          >
            <span className="text-xs font-bold text-neutral-300 block group-hover:text-white font-mono">
              Resetar Base Fictícia
            </span>
            <span className="text-[10px] text-neutral-500 mt-0.5 block">
              Restaura a lista inicial de 15 sites e incidentes.
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
