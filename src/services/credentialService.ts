import { TechnicalCredential, TechnicalCredentialPayload } from '../types';

export class VaultApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly code?: string) {
    super(message);
  }
}

async function vaultRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) }
  });
  const payload = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && payload.code !== 'INVALID_MASTER_PASSWORD') {
      window.dispatchEvent(new Event('tecnihub:session-expired'));
    }
    throw new VaultApiError(payload.error || `Falha na API (HTTP ${response.status})`, response.status, payload.code);
  }
  return payload as T;
}

export async function listTechnicalCredentials(siteId: string): Promise<TechnicalCredential[]> {
  const response = await vaultRequest<{ accesses: TechnicalCredential[] }>(`/api/sites/${encodeURIComponent(siteId)}/accesses`);
  return response.accesses;
}

export async function createTechnicalCredential(siteId: string, payload: TechnicalCredentialPayload): Promise<TechnicalCredential> {
  const response = await vaultRequest<{ access: TechnicalCredential }>(`/api/sites/${encodeURIComponent(siteId)}/accesses`, {
    method: 'POST', body: JSON.stringify(payload)
  });
  return response.access;
}

export async function updateTechnicalCredential(id: string, payload: TechnicalCredentialPayload): Promise<TechnicalCredential> {
  const { password: _password, ...metadata } = payload;
  const response = await vaultRequest<{ access: TechnicalCredential }>(`/api/accesses/${encodeURIComponent(id)}`, {
    method: 'PATCH', body: JSON.stringify(metadata)
  });
  return response.access;
}

export async function removeTechnicalCredential(id: string): Promise<void> {
  await vaultRequest(`/api/accesses/${encodeURIComponent(id)}`, { method: 'DELETE', body: '{}' });
}

export async function getVaultAuthorization(): Promise<{ authorized: boolean; expiresAt: string | null }> {
  return vaultRequest('/api/vault/session');
}

export async function authorizeVault(masterPassword: string): Promise<{ authorized: boolean; expiresAt: string }> {
  return vaultRequest('/api/vault/authorize', { method: 'POST', body: JSON.stringify({ masterPassword }) });
}

export async function revealCredentialPassword(id: string): Promise<string> {
  const response = await vaultRequest<{ password: string }>(`/api/accesses/${encodeURIComponent(id)}/copy-password`, {
    method: 'POST', body: '{}'
  });
  return response.password;
}

export async function copyCredentialPassword(id: string): Promise<void> {
  const transientSecret = await revealCredentialPassword(id);
  try {
    await navigator.clipboard.writeText(transientSecret);
  } finally {
    // The secret is never stored in React state or rendered in the DOM. JavaScript
    // strings cannot be reliably zeroed, so the reference is allowed to leave scope.
  }
}

export async function changeCredentialPassword(id: string, newPassword: string, confirmation: string): Promise<TechnicalCredential> {
  const response = await vaultRequest<{ access: TechnicalCredential }>(`/api/accesses/${encodeURIComponent(id)}/password`, {
    method: 'PUT', body: JSON.stringify({ newPassword, confirmation })
  });
  return response.access;
}
