import React from 'react';
import type { CredentialType, TechnicalCredential, TechnicalCredentialPayload } from '../types';

export const EMPTY_TECHNICAL_ACCESS: TechnicalCredentialPayload = {
  type: 'WORDPRESS', serviceName: '', provider: '', url: '', username: '', host: '', port: '', notes: '', password: ''
};

export const TECHNICAL_ACCESS_TYPE_LABELS: Record<CredentialType, string> = {
  WORDPRESS: 'WordPress', HOSPEDAGEM: 'Hospedagem', FTP: 'FTP', SFTP: 'SFTP', OUTROS: 'Outros'
};

export function technicalAccessTitle(access: TechnicalCredential | TechnicalCredentialPayload): string {
  return access.serviceName || access.provider || TECHNICAL_ACCESS_TYPE_LABELS[access.type];
}

export function validateTechnicalAccess(payload: TechnicalCredentialPayload, requirePassword = true): string | null {
  if (requirePassword && !payload.password) return 'Informe a senha do acesso.';
  if (payload.type === 'WORDPRESS' && (!payload.url || !payload.username)) return 'Informe URL e usuário do WordPress.';
  if (payload.type === 'HOSPEDAGEM' && (!payload.provider || !payload.url || !payload.username)) return 'Informe provedor, URL e usuário da hospedagem.';
  if ((payload.type === 'FTP' || payload.type === 'SFTP') && (!payload.host || !payload.port || !payload.username)) return 'Informe host, porta e usuário do acesso FTP/SFTP.';
  if (payload.type === 'OUTROS' && !payload.serviceName) return 'Informe o nome do serviço.';
  return null;
}

interface TechnicalAccessFieldsProps {
  value: TechnicalCredentialPayload;
  onChange: (value: TechnicalCredentialPayload) => void;
  includePassword: boolean;
}

export const TechnicalAccessFields: React.FC<TechnicalAccessFieldsProps> = ({ value, onChange, includePassword }) => {
  const set = (field: keyof TechnicalCredentialPayload, fieldValue: string | number) => onChange({ ...value, [field]: fieldValue });
  const inputClass = 'w-full rounded border border-[#2b2b2b] bg-black px-3 py-2 text-xs text-white outline-none focus:border-neutral-500';
  const labelClass = 'space-y-1 text-[10px] font-mono uppercase tracking-wide text-neutral-500';

  return <>
    <label className={labelClass}>Tipo
      <select value={value.type} onChange={(event) => set('type', event.target.value)} className={inputClass}>
        {Object.entries(TECHNICAL_ACCESS_TYPE_LABELS).map(([type, label]) => <option key={type} value={type}>{label}</option>)}
      </select>
    </label>

    {value.type === 'HOSPEDAGEM' && <label className={labelClass}>Provedor *
      <input value={value.provider || ''} onChange={(event) => set('provider', event.target.value)} placeholder="Hostinger, HostGator, Cloudflare..." className={inputClass} />
    </label>}
    {value.type === 'OUTROS' && <label className={labelClass}>Nome do serviço *
      <input value={value.serviceName || ''} onChange={(event) => set('serviceName', event.target.value)} className={inputClass} />
    </label>}
    {(value.type === 'WORDPRESS' || value.type === 'HOSPEDAGEM' || value.type === 'OUTROS') && <label className={labelClass}>URL {value.type !== 'OUTROS' && '*'}
      <input type="url" value={value.url || ''} onChange={(event) => set('url', event.target.value)} placeholder="https://..." className={inputClass} />
    </label>}
    {(value.type === 'FTP' || value.type === 'SFTP') && <div className="grid grid-cols-[1fr_110px] gap-3">
      <label className={labelClass}>Host *
        <input value={value.host || ''} onChange={(event) => set('host', event.target.value)} placeholder="ftp.cliente.com.br" className={inputClass} />
      </label>
      <label className={labelClass}>Porta *
        <input type="number" min="1" max="65535" value={value.port ?? ''} onChange={(event) => set('port', event.target.value)} placeholder={value.type === 'SFTP' ? '22' : '21'} className={inputClass} />
      </label>
    </div>}
    <label className={labelClass}>Usuário / e-mail {value.type !== 'OUTROS' && '*'}
      <input value={value.username || ''} onChange={(event) => set('username', event.target.value)} autoComplete="off" className={inputClass} />
    </label>
    {includePassword && <label className={labelClass}>Senha *
      <input type="password" value={value.password || ''} onChange={(event) => set('password', event.target.value)} autoComplete="new-password" className={inputClass} />
    </label>}
    {value.type === 'OUTROS' && <label className={labelClass}>Observação não sensível
      <textarea value={value.notes || ''} onChange={(event) => set('notes', event.target.value)} rows={3} placeholder="Não inclua senhas, tokens ou chaves neste campo." className={inputClass} />
    </label>}
  </>;
};
