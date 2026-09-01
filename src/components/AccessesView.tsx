import React, { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  Copy, Edit3, ExternalLink, KeyRound, Loader2, LockKeyhole, Plus, Server, Trash2, UserRound, X
} from 'lucide-react';
import { Site, TechnicalCredential, TechnicalCredentialPayload, CredentialType } from '../types';
import {
  authorizeVault,
  changeCredentialPassword,
  copyCredentialPassword,
  createTechnicalCredential,
  getVaultAuthorization,
  listTechnicalCredentials,
  removeTechnicalCredential,
  updateTechnicalCredential
} from '../services/credentialService';

interface AccessesViewProps {
  sites: Site[];
  notify: (type: 'success' | 'error' | 'info' | 'warning', title: string, message?: string) => void;
}

const EMPTY_FORM: TechnicalCredentialPayload = {
  type: 'WORDPRESS', serviceName: '', provider: '', url: '', username: '', host: '', port: '', notes: '', password: ''
};

const TYPE_LABELS: Record<CredentialType, string> = {
  WORDPRESS: 'WordPress', HOSPEDAGEM: 'Hospedagem', FTP: 'FTP', SFTP: 'SFTP', OUTROS: 'Outro acesso'
};

function accessTitle(access: TechnicalCredential): string {
  return access.serviceName || access.provider || TYPE_LABELS[access.type];
}

interface ModalShellProps { title: string; onClose: () => void; children: React.ReactNode; }
const ModalShell = ({ title, onClose, children }: ModalShellProps) => (
  <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
    <div role="dialog" aria-modal="true" className="w-full max-w-xl rounded-lg border border-[#2a2a2a] bg-[#090909] shadow-2xl">
      <div className="flex items-center justify-between border-b border-[#222] px-5 py-4">
        <h2 className="text-sm font-semibold text-white">{title}</h2>
        <button type="button" onClick={onClose} className="p-1.5 text-neutral-500 hover:text-white" aria-label="Fechar">
          <X className="w-4 h-4" />
        </button>
      </div>
      {children}
    </div>
  </div>
);

interface AccessFormProps {
  initial?: TechnicalCredential;
  saving: boolean;
  onClose: () => void;
  onSave: (payload: TechnicalCredentialPayload) => Promise<void>;
}

const AccessForm = ({ initial, saving, onClose, onSave }: AccessFormProps) => {
  const [form, setForm] = useState<TechnicalCredentialPayload>(() => initial ? {
    type: initial.type,
    serviceName: initial.serviceName || '', provider: initial.provider || '', url: initial.url || '',
    username: initial.username || '', host: initial.host || '', port: initial.port || '', notes: initial.notes || ''
  } : { ...EMPTY_FORM });
  const set = (field: keyof TechnicalCredentialPayload, value: string | number) => setForm((current) => ({ ...current, [field]: value }));
  const submit = async (event: FormEvent) => { event.preventDefault(); await onSave(form); };
  const inputClass = 'w-full rounded border border-[#2b2b2b] bg-black px-3 py-2 text-xs text-white outline-none focus:border-neutral-500';
  const labelClass = 'space-y-1 text-[10px] font-mono uppercase tracking-wide text-neutral-500';

  return (
    <form onSubmit={submit} className="max-h-[75vh] overflow-y-auto p-5 space-y-4" autoComplete="off">
      <label className={labelClass}>Tipo
        <select value={form.type} onChange={(event) => set('type', event.target.value)} className={inputClass}>
          {Object.entries(TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>

      {form.type === 'HOSPEDAGEM' && <label className={labelClass}>Provedor *
        <input required value={form.provider || ''} onChange={(event) => set('provider', event.target.value)} placeholder="Hostinger, HostGator, Cloudflare..." className={inputClass} />
      </label>}
      {form.type === 'OUTROS' && <label className={labelClass}>Nome do serviço *
        <input required value={form.serviceName || ''} onChange={(event) => set('serviceName', event.target.value)} className={inputClass} />
      </label>}
      {(form.type === 'WORDPRESS' || form.type === 'HOSPEDAGEM' || form.type === 'OUTROS') && <label className={labelClass}>URL {form.type !== 'OUTROS' && '*'}
        <input required={form.type !== 'OUTROS'} type="url" value={form.url || ''} onChange={(event) => set('url', event.target.value)} placeholder="https://..." className={inputClass} />
      </label>}
      {(form.type === 'FTP' || form.type === 'SFTP') && <div className="grid grid-cols-[1fr_110px] gap-3">
        <label className={labelClass}>Host *
          <input required value={form.host || ''} onChange={(event) => set('host', event.target.value)} placeholder="ftp.cliente.com.br" className={inputClass} />
        </label>
        <label className={labelClass}>Porta *
          <input required type="number" min="1" max="65535" value={form.port ?? ''} onChange={(event) => set('port', event.target.value)} placeholder={form.type === 'SFTP' ? '22' : '21'} className={inputClass} />
        </label>
      </div>}
      <label className={labelClass}>Usuário / e-mail {form.type !== 'OUTROS' && '*'}
        <input required={form.type !== 'OUTROS'} value={form.username || ''} onChange={(event) => set('username', event.target.value)} autoComplete="off" className={inputClass} />
      </label>
      {!initial && <label className={labelClass}>Senha *
        <input required type="password" value={form.password || ''} onChange={(event) => set('password', event.target.value)} autoComplete="new-password" className={inputClass} />
      </label>}
      {form.type === 'OUTROS' && <label className={labelClass}>Observação não sensível
        <textarea value={form.notes || ''} onChange={(event) => set('notes', event.target.value)} rows={3} placeholder="Não inclua senhas, tokens ou chaves neste campo." className={inputClass} />
      </label>}
      <p className="text-[10px] text-neutral-600">A senha é enviada somente ao backend e armazenada com criptografia autenticada. Ela não será exibida após salvar.</p>
      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={onClose} className="px-3 py-2 text-xs text-neutral-400 hover:text-white">Cancelar</button>
        <button disabled={saving} className="inline-flex items-center gap-2 rounded bg-white px-4 py-2 text-xs font-semibold text-black disabled:opacity-50">
          {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} {initial ? 'Salvar alterações' : 'Cadastrar acesso'}
        </button>
      </div>
    </form>
  );
};

export const AccessesView: React.FC<AccessesViewProps> = ({ sites, notify }) => {
  const [siteId, setSiteId] = useState(sites[0]?.id || '');
  const [accesses, setAccesses] = useState<TechnicalCredential[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<TechnicalCredential | null | 'new'>(null);
  const [pendingSensitive, setPendingSensitive] = useState<{ action: 'copy' | 'change'; access: TechnicalCredential } | null>(null);
  const [masterPassword, setMasterPassword] = useState('');
  const [authorizing, setAuthorizing] = useState(false);
  const [passwordTarget, setPasswordTarget] = useState<TechnicalCredential | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const selectedSite = useMemo(() => sites.find((site) => site.id === siteId), [siteId, sites]);

  useEffect(() => {
    if (!siteId && sites[0]) setSiteId(sites[0].id);
  }, [siteId, sites]);

  useEffect(() => {
    if (!siteId) { setAccesses([]); return; }
    let active = true;
    setLoading(true);
    listTechnicalCredentials(siteId)
      .then((rows) => { if (active) setAccesses(rows); })
      .catch((error) => { if (active) notify('error', 'Falha ao carregar acessos', error.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [notify, siteId]);

  const save = async (payload: TechnicalCredentialPayload) => {
    if (!siteId) return;
    setSaving(true);
    try {
      const saved = editing === 'new'
        ? await createTechnicalCredential(siteId, payload)
        : await updateTechnicalCredential((editing as TechnicalCredential).id, payload);
      setAccesses((current) => editing === 'new' ? [saved, ...current] : current.map((item) => item.id === saved.id ? saved : item));
      setEditing(null);
      notify('success', editing === 'new' ? 'Acesso cadastrado' : 'Acesso atualizado', 'O segredo permanece protegido no backend.');
    } catch (error: any) {
      notify('error', 'Não foi possível salvar o acesso', error.message);
    } finally { setSaving(false); }
  };

  const runSensitive = async (action: 'copy' | 'change', access: TechnicalCredential) => {
    if (action === 'change') { setPasswordTarget(access); return; }
    try {
      await copyCredentialPassword(access.id);
      notify('success', 'Senha copiada', 'A senha não foi exibida nem mantida na tela.');
    } catch (error: any) {
      if (error.code === 'VAULT_AUTHORIZATION_REQUIRED') setPendingSensitive({ action, access });
      else notify('error', 'Não foi possível copiar a senha', error.message);
    }
  };

  const requestSensitive = async (action: 'copy' | 'change', access: TechnicalCredential) => {
    try {
      const session = await getVaultAuthorization();
      if (session.authorized) return runSensitive(action, access);
    } catch { /* Authorization dialog remains the safe fallback. */ }
    setPendingSensitive({ action, access });
  };

  const submitMasterPassword = async (event: FormEvent) => {
    event.preventDefault();
    if (!pendingSensitive) return;
    setAuthorizing(true);
    try {
      await authorizeVault(masterPassword);
      const operation = pendingSensitive;
      setMasterPassword('');
      setPendingSensitive(null);
      await runSensitive(operation.action, operation.access);
    } catch (error: any) {
      setMasterPassword('');
      notify('error', 'Cofre não autorizado', error.message);
    } finally { setAuthorizing(false); }
  };

  const changePassword = async (event: FormEvent) => {
    event.preventDefault();
    if (!passwordTarget) return;
    setSaving(true);
    try {
      const updated = await changeCredentialPassword(passwordTarget.id, newPassword, confirmation);
      setAccesses((current) => current.map((item) => item.id === updated.id ? updated : item));
      setPasswordTarget(null); setNewPassword(''); setConfirmation('');
      notify('success', 'Senha alterada', 'A nova senha foi criptografada e substituiu a anterior.');
    } catch (error: any) {
      setNewPassword(''); setConfirmation('');
      if (error.code === 'VAULT_AUTHORIZATION_REQUIRED') {
        const target = passwordTarget;
        setPasswordTarget(null);
        setPendingSensitive({ action: 'change', access: target });
      } else notify('error', 'Não foi possível alterar a senha', error.message);
    } finally { setSaving(false); }
  };

  const remove = async (access: TechnicalCredential) => {
    if (!window.confirm(`Remover o acesso “${accessTitle(access)}”? A senha criptografada será removida definitivamente.`)) return;
    try {
      await removeTechnicalCredential(access.id);
      setAccesses((current) => current.filter((item) => item.id !== access.id));
      notify('info', 'Acesso removido', 'A ação foi registrada na auditoria administrativa.');
    } catch (error: any) { notify('error', 'Não foi possível remover o acesso', error.message); }
  };

  const copyUsername = async (access: TechnicalCredential) => {
    if (!access.username) return;
    try { await navigator.clipboard.writeText(access.username); notify('success', 'Usuário copiado'); }
    catch { notify('error', 'Não foi possível copiar o usuário'); }
  };

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-[#202020] bg-[#080808] p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <p className="text-[10px] font-mono uppercase tracking-widest text-neutral-500">Cofre administrativo</p>
            <h2 className="text-base font-semibold text-white">Acessos técnicos</h2>
            <p className="text-xs text-neutral-500">Credenciais vinculadas a cada site, disponíveis somente para administradores autenticados.</p>
          </div>
          <button disabled={!siteId} onClick={() => setEditing('new')} className="inline-flex items-center justify-center gap-2 rounded bg-white px-3 py-2 text-xs font-semibold text-black disabled:opacity-40">
            <Plus className="w-3.5 h-3.5" /> Novo acesso
          </button>
        </div>
        <label className="mt-4 block max-w-md space-y-1 text-[10px] font-mono uppercase tracking-wide text-neutral-500">Site / cliente
          <select value={siteId} onChange={(event) => setSiteId(event.target.value)} className="w-full rounded border border-[#2b2b2b] bg-black px-3 py-2 text-xs normal-case text-white outline-none">
            {sites.length === 0 && <option value="">Nenhum site cadastrado</option>}
            {sites.map((site) => <option key={site.id} value={site.id}>{site.client} — {site.siteName} ({site.domain})</option>)}
          </select>
        </label>
      </section>

      {loading ? <div className="py-16 text-center text-xs text-neutral-500"><Loader2 className="mx-auto mb-2 h-4 w-4 animate-spin" />Carregando cofre...</div> :
        accesses.length === 0 ? <div className="rounded-lg border border-dashed border-[#292929] py-16 text-center">
          <LockKeyhole className="mx-auto mb-3 h-7 w-7 text-neutral-700" />
          <p className="text-sm text-neutral-400">Nenhum acesso cadastrado para {selectedSite?.siteName || 'este site'}.</p>
        </div> : <div className="grid gap-3 xl:grid-cols-2">
          {accesses.map((access) => <article key={access.id} className="rounded-lg border border-[#222] bg-[#080808] p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="rounded border border-[#292929] bg-black p-2 text-neutral-400"><Server className="h-4 w-4" /></span>
                <div className="min-w-0"><h3 className="truncate text-sm font-semibold text-white">{accessTitle(access)}</h3><p className="text-[10px] font-mono text-neutral-500">{TYPE_LABELS[access.type]}</p></div>
              </div>
              <div className="flex gap-1">
                <button onClick={() => setEditing(access)} className="p-1.5 text-neutral-500 hover:text-white" title="Editar acesso"><Edit3 className="h-3.5 w-3.5" /></button>
                <button onClick={() => remove(access)} className="p-1.5 text-neutral-500 hover:text-rose-400" title="Remover acesso"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            </div>
            <dl className="mt-4 space-y-2 text-xs">
              {(access.url || access.host) && <div className="flex justify-between gap-3"><dt className="text-neutral-600">Destino</dt><dd className="truncate text-neutral-300">{access.url || `${access.protocol?.toLowerCase()}://${access.host}:${access.port}`}</dd></div>}
              <div className="flex justify-between gap-3"><dt className="text-neutral-600">Usuário</dt><dd className="truncate text-neutral-300">{access.username || 'Não informado'}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-neutral-600">Senha</dt><dd className="font-mono tracking-wider text-neutral-400">{access.password}</dd></div>
            </dl>
            <div className="mt-4 flex flex-wrap gap-2 border-t border-[#1d1d1d] pt-3">
              {access.username && <button onClick={() => copyUsername(access)} className="inline-flex items-center gap-1.5 rounded border border-[#292929] px-2.5 py-1.5 text-[10px] font-semibold text-neutral-300 hover:bg-[#151515]"><UserRound className="h-3 w-3" /> Copiar usuário</button>}
              <button onClick={() => requestSensitive('copy', access)} className="inline-flex items-center gap-1.5 rounded border border-[#292929] px-2.5 py-1.5 text-[10px] font-semibold text-neutral-300 hover:bg-[#151515]"><Copy className="h-3 w-3" /> Copiar senha</button>
              <button onClick={() => requestSensitive('change', access)} className="inline-flex items-center gap-1.5 rounded border border-[#292929] px-2.5 py-1.5 text-[10px] font-semibold text-neutral-300 hover:bg-[#151515]"><KeyRound className="h-3 w-3" /> Alterar senha</button>
              {access.url && <a href={access.url} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 text-[10px] text-neutral-500 hover:text-white">Abrir painel <ExternalLink className="h-3 w-3" /></a>}
            </div>
          </article>)}
        </div>}

      {editing && <ModalShell title={editing === 'new' ? 'Cadastrar acesso técnico' : 'Editar acesso técnico'} onClose={() => setEditing(null)}>
        <AccessForm initial={editing === 'new' ? undefined : editing} saving={saving} onClose={() => setEditing(null)} onSave={save} />
      </ModalShell>}

      {pendingSensitive && <ModalShell title="Autorizar cofre" onClose={() => { setPendingSensitive(null); setMasterPassword(''); }}>
        <form onSubmit={submitMasterPassword} className="p-5 space-y-4">
          <p className="text-xs text-neutral-400">Informe a senha mestre. A autorização privilegiada ficará ativa no backend por até cinco minutos.</p>
          <input autoFocus required type="password" value={masterPassword} onChange={(event) => setMasterPassword(event.target.value)} autoComplete="current-password" className="w-full rounded border border-[#2b2b2b] bg-black px-3 py-2 text-xs text-white outline-none focus:border-neutral-500" />
          <div className="flex justify-end gap-2"><button type="button" onClick={() => { setPendingSensitive(null); setMasterPassword(''); }} className="px-3 py-2 text-xs text-neutral-400">Cancelar</button><button disabled={authorizing} className="rounded bg-white px-4 py-2 text-xs font-semibold text-black disabled:opacity-50">Autorizar</button></div>
        </form>
      </ModalShell>}

      {passwordTarget && <ModalShell title={`Alterar senha — ${accessTitle(passwordTarget)}`} onClose={() => { setPasswordTarget(null); setNewPassword(''); setConfirmation(''); }}>
        <form onSubmit={changePassword} className="p-5 space-y-4" autoComplete="off">
          <p className="text-xs text-neutral-400">A senha anterior não será revelada. A nova senha substituirá o segredo criptografado atual.</p>
          <input required type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="Nova senha" autoComplete="new-password" className="w-full rounded border border-[#2b2b2b] bg-black px-3 py-2 text-xs text-white outline-none" />
          <input required type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="Confirmar nova senha" autoComplete="new-password" className="w-full rounded border border-[#2b2b2b] bg-black px-3 py-2 text-xs text-white outline-none" />
          <div className="flex justify-end gap-2"><button type="button" onClick={() => setPasswordTarget(null)} className="px-3 py-2 text-xs text-neutral-400">Cancelar</button><button disabled={saving} className="rounded bg-white px-4 py-2 text-xs font-semibold text-black disabled:opacity-50">Alterar senha</button></div>
        </form>
      </ModalShell>}
    </div>
  );
};
