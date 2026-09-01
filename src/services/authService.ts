export interface AdminUser {
  id: string;
  email: string;
}

export class AuthApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string
  ) {
    super(message);
  }
}

async function authRequest(path: string, init?: RequestInit): Promise<{ user: AdminUser }> {
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {})
    }
  });
  const payload = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new AuthApiError(
      payload.error || 'Não foi possível validar a sessão administrativa.',
      response.status,
      payload.code
    );
  }
  return payload as { user: AdminUser };
}

export async function getAdminSession(): Promise<AdminUser | null> {
  try {
    const response = await authRequest('/api/auth/session');
    return response.user;
  } catch (error) {
    if (error instanceof AuthApiError && error.status === 401) return null;
    throw error;
  }
}

export async function loginAdmin(email: string, password: string): Promise<AdminUser> {
  const response = await authRequest('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password })
  });
  return response.user;
}

export async function logoutAdmin(): Promise<void> {
  await authRequest('/api/auth/logout', { method: 'POST', body: '{}' });
}
