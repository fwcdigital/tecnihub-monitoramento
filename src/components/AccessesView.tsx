import React, { FormEvent, useEffect, useRef, useState } from 'react';
import {
  Copy, Edit3, ExternalLink, Eye, EyeOff, KeyRound, Loader2, LockKeyhole, Plus, Server, Trash2, UserRound, X
} from 'lucide-react';
import { Site, TechnicalCredential, TechnicalCredentialPayload } from '../types';
import {
  authorizeVault,
  changeCredentialPassword,
  copyCredentialPassword,
  createTechnicalCredential,
  getVaultAuthorization,
  listTechnicalCredentials,
  removeTechnicalCredential,
  revealCredentialPassword,
  updateTechnicalCredential
} from '../services/credentialService';
import {
  EMPTY_TECHNICAL_ACCESS,
  TECHNICAL_ACCESS_TYPE_LABELS,
  TechnicalAccessFields,
  technicalAccessTitle,
  validateTechnicalAccess
} from './TechnicalAccessFields';

interface AccessesViewProps {
  site: Site;
  notify: (type: 'success' | 'error' | 'info' | 'warning', title: string, message?: string) => void;
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
  } : { ...EMPTY_TECHNICAL_ACCESS });
  const submit = async (event: FormEvent) => { event.preventDefault(); await onSave(form); };

  return (
    <form onSubmit={submit} className="max-h-[75vh] overflow-y-auto p-5 space-y-4" autoComplete="off">
      <TechnicalAccessFields value={form} onChange={setForm} includePassword={!initial} />
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

export const SiteTechnicalAccesses: React.FC<AccessesViewProps> = ({ site, notify }) => {
  const siteId = site.id;
  const [accesses, setAccesses] = useState<TechnicalCredential[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<TechnicalCredential | null | 'new'>(null);
  const [pendingSensitive, setPendingSensitive] = useState<{ action: 'copy' | 'reveal' | 'change'; access: TechnicalCredential } | null>(null);
  const [masterPassword, setMasterPassword] = useState('');
  const [authorizing, setAuthorizing] = useState(false);
  const [passwordTarget, setPasswordTarget] = useState<TechnicalCredential | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [revealedPasswords, setRevealedPasswords] = useState<Record<string, string>>({});
  const revealTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => () => {
    revealTimers.current.forEach((timer) => clearTimeout(timer));
    revealTimers.current.clear();
  }, []);

  useEffect(() => {
    setRevealedPasswords({});
    revealTimers.current.forEach((timer) => clearTimeout(timer));
    revealTimers.current.clear();
  }, [siteId]);

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
    const validationError = validateTechnicalAccess(payload, editing === 'new');
    if (validationError) {
      notify('warning', 'Complete os dados do acesso', validationError);
      return;
    }
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

  const runSensitive = async (action: 'copy' | 'reveal' | 'change', access: TechnicalCredential) => {
    if (action === 'change') { setPasswordTarget(access); return; }
    try {
      if (action === 'copy') {
        await copyCredentialPassword(access.id);
        notify('success', 'Senha copiada', 'A senha não foi exibida nem mantida na tela.');
      } else {
        const password = await revealCredentialPassword(access.id);
        setRevealedPasswords((current) => ({ ...current, [access.id]: password }));
        const previousTimer = revealTimers.current.get(access.id);
        if (previousTimer) clearTimeout(previousTimer);
        revealTimers.current.set(access.id, setTimeout(() => {
          setRevealedPasswords((current) => {
            const next = { ...current };
            delete next[access.id];
            return next;
          });
          revealTimers.current.delete(access.id);
        }, 30_000));
      }
    } catch (error: any) {
      if (error.code === 'VAULT_AUTHORIZATION_REQUIRED') setPendingSensitive({ action, access });
      else notify('error', action === 'reveal' ? 'Não foi possível revelar a senha' : 'Não foi possível copiar a senha', error.message);
    }
  };

  const requestSensitive = async (action: 'copy' | 'reveal' | 'change', access: TechnicalCredential) => {
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

  const hideRevealedPassword = (accessId: string) => {
    const timer = revealTimers.current.get(accessId);
    if (timer) clearTimeout(timer);
    revealTimers.current.delete(accessId);
    setRevealedPasswords((current) => {
      const next = { ...current };
      delete next[accessId];
      return next;
    });
  };

  const remove = async (access: TechnicalCredential) => {
    if (!window.confirm(`Remover o acesso “${technicalAccessTitle(access)}”? A senha criptografada será removida definitivamente.`)) return;
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
            <h2 className="text-base font-semibold text-white">Acessos Técnicos</h2>
            <p className="text-xs text-neutral-500">Credenciais vinculadas somente a {site.siteName}, disponíveis para administradores autenticados.</p>
          </div>
          <button disabled={!siteId} onClick={() => setEditing('new')} className="inline-flex items-center justify-center gap-2 rounded bg-white px-3 py-2 text-xs font-semibold text-black disabled:opacity-40">
            <Plus className="w-3.5 h-3.5" /> Novo acesso
          </button>
        </div>
      </section>

      {loading ? <div className="py-16 text-center text-xs text-neutral-500"><Loader2 className="mx-auto mb-2 h-4 w-4 animate-spin" />Carregando cofre...</div> :
        accesses.length === 0 ? <div className="rounded-lg border border-dashed border-[#292929] py-16 text-center">
          <LockKeyhole className="mx-auto mb-3 h-7 w-7 text-neutral-700" />
          <p className="text-sm text-neutral-400">Nenhum acesso cadastrado para este site.</p>
        </div> : <div className="grid gap-3 xl:grid-cols-2">
          {accesses.map((access) => <article key={access.id} className="rounded-lg border border-[#222] bg-[#080808] p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="rounded border border-[#292929] bg-black p-2 text-neutral-400"><Server className="h-4 w-4" /></span>
                <div className="min-w-0"><h3 className="truncate text-sm font-semibold text-white">{technicalAccessTitle(access)}</h3><p className="text-[10px] font-mono text-neutral-500">{TECHNICAL_ACCESS_TYPE_LABELS[access.type]}</p></div>
              </div>
              <div className="flex gap-1">
                <button onClick={() => setEditing(access)} className="p-1.5 text-neutral-500 hover:text-white" title="Editar acesso"><Edit3 className="h-3.5 w-3.5" /></button>
                <button onClick={() => remove(access)} className="p-1.5 text-neutral-500 hover:text-rose-400" title="Remover acesso"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            </div>
            <dl className="mt-4 space-y-2 text-xs">
              {access.provider && <div className="flex justify-between gap-3"><dt className="text-neutral-600">Provedor</dt><dd className="truncate text-neutral-300">{access.provider}</dd></div>}
              {access.url && <div className="flex justify-between gap-3"><dt className="text-neutral-600">URL</dt><dd className="truncate text-neutral-300">{access.url}</dd></div>}
              {access.host && <div className="flex justify-between gap-3"><dt className="text-neutral-600">Host</dt><dd className="truncate text-neutral-300">{access.host}</dd></div>}
              {access.port && <div className="flex justify-between gap-3"><dt className="text-neutral-600">Porta</dt><dd className="font-mono text-neutral-300">{access.port}</dd></div>}
              <div className="flex justify-between gap-3"><dt className="text-neutral-600">Usuário</dt><dd className="truncate text-neutral-300">{access.username || 'Não informado'}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-neutral-600">Senha</dt><dd className="max-w-[70%] break-all font-mono tracking-wider text-neutral-400">{revealedPasswords[access.id] || '••••••••••••'}</dd></div>
              {access.notes && <div className="flex flex-col gap-1"><dt className="text-neutral-600">Observações</dt><dd className="whitespace-pre-wrap break-words text-neutral-300">{access.notes}</dd></div>}
            </dl>
            <div className="mt-4 flex flex-wrap gap-2 border-t border-[#1d1d1d] pt-3">
              {access.username && <button onClick={() => copyUsername(access)} className="inline-flex items-center gap-1.5 rounded border border-[#292929] px-2.5 py-1.5 text-[10px] font-semibold text-neutral-300 hover:bg-[#151515]"><UserRound className="h-3 w-3" /> Copiar usuário</button>}
              <button onClick={() => requestSensitive('copy', access)} className="inline-flex items-center gap-1.5 rounded border border-[#292929] px-2.5 py-1.5 text-[10px] font-semibold text-neutral-300 hover:bg-[#151515]"><Copy className="h-3 w-3" /> Copiar senha</button>
              {revealedPasswords[access.id]
                ? <button onClick={() => hideRevealedPassword(access.id)} className="inline-flex items-center gap-1.5 rounded border border-[#292929] px-2.5 py-1.5 text-[10px] font-semibold text-neutral-300 hover:bg-[#151515]"><EyeOff className="h-3 w-3" /> Ocultar senha</button>
                : <button onClick={() => requestSensitive('reveal', access)} className="inline-flex items-center gap-1.5 rounded border border-[#292929] px-2.5 py-1.5 text-[10px] font-semibold text-neutral-300 hover:bg-[#151515]"><Eye className="h-3 w-3" /> Revelar senha</button>}
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

      {passwordTarget && <ModalShell title={`Alterar senha — ${technicalAccessTitle(passwordTarget)}`} onClose={() => { setPasswordTarget(null); setNewPassword(''); setConfirmation(''); }}>
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
