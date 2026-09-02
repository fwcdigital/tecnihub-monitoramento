import type { DbCheck, Site, SiteStatus } from '../types';

export const SITE_STATUS_LABELS: Record<SiteStatus, string> = {
  online: 'Online',
  warning: 'Atenção necessária',
  critical: 'Falha crítica',
  offline: 'Offline',
  security_blocked: 'Verificação bloqueada por segurança',
  paused: 'Monitoramento pausado',
  unknown: 'Status ainda não confirmado'
};

export function siteStatusLabel(status: SiteStatus): string {
  return SITE_STATUS_LABELS[status];
}

export function diagnosticTypeLabel(errorType?: string | null, status?: DbCheck['status'], httpStatus?: number | null): string {
  const code = String(errorType || '').toUpperCase();

  if (code === 'EPROTO' || code === 'TLS_ERROR' || code.startsWith('ERR_TLS_') || code.startsWith('ERR_SSL_')
    || code.includes('CERT_') || code.includes('CERTIFICATE') || code.includes('SELF_SIGNED')) {
    return 'Falha na conexão HTTPS/SSL';
  }
  if (code === 'UNKNOWN') return 'Falha na verificação';
  if (code === 'TIMEOUT' || code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT') return 'Tempo limite excedido';
  if (code === 'CONNECTION_REFUSED' || code === 'ECONNREFUSED') return 'Conexão recusada pelo servidor';
  if (code === 'ECONNRESET' || code === 'EPIPE') return 'Conexão interrompida';
  if (code.startsWith('DNS_') || code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'Falha na resolução DNS';
  if (code.startsWith('SSRF_')) return 'Verificação bloqueada por segurança';
  if (code === 'INVALID_URL' || code === 'UNSUPPORTED_PROTOCOL') return 'Endereço inválido para verificação';
  if (code === 'TOO_MANY_REDIRECTS') return 'Excesso de redirecionamentos';
  if (code === 'EXPECTED_CONTENT_MISSING') return 'Conteúdo esperado não encontrado';
  if (code === 'EXPECTED_TRACKING_TAG_MISSING') return 'Tag configurada não encontrada';
  if (code === 'SSL_EXPIRED') return 'Certificado SSL expirado';
  if (code === 'SSL_EXPIRING' || code === 'SSL_EXPIRING_CRITICAL') return 'Certificado SSL próximo do vencimento';
  if (/^HTTP_\d{3}$/.test(code)) {
    const value = code.slice(5);
    return code.startsWith('HTTP_5') ? `Falha do serviço (HTTP ${value})` : `Resposta HTTP requer atenção (${value})`;
  }
  if (httpStatus !== null && httpStatus !== undefined && httpStatus >= 500) return `Falha do serviço (HTTP ${httpStatus})`;
  if (status === 'offline') return 'Falha na conexão';
  if (status === 'critical') return 'Falha crítica na verificação';
  if (status === 'security_blocked') return 'Verificação bloqueada por segurança';
  if (httpStatus === null || httpStatus === undefined) return 'Falha na verificação';
  if (status === 'warning') return 'Verificação concluída com alerta';
  return code ? 'Falha na verificação' : 'Verificação concluída';
}

export function diagnosticSummary(check: DbCheck): string {
  if (check.error_type) return diagnosticTypeLabel(check.error_type, check.status, check.http_status);
  const result = check.result_message || '';
  const containsTechnicalCode = /\b(?:E[A-Z0-9_]{2,}|ERR_[A-Z0-9_]+|UNKNOWN|CONNECTION_ERROR|TLS_ERROR|DNS_[A-Z_]+|SSRF_[A-Z_]+|HTTP_\d{3})\b/.test(result);
  if (result && !containsTechnicalCode) return result.replace(/^(?:OFFLINE|CRÍTICO|ATENÇÃO):\s*/i, '');
  return diagnosticTypeLabel(null, check.status, check.http_status);
}

export function missingHttpLabel(status: DbCheck['status'], errorType?: string | null): string {
  if (status === 'security_blocked') return 'Não aplicável';
  if (status === 'offline') return diagnosticTypeLabel(errorType, status, null);
  if (status === 'critical') return diagnosticTypeLabel(errorType, status, null);
  return 'Falha na verificação';
}

export function responseTimeUnavailableLabel(site: Site): string {
  if (!site.monitorResponseTime) return 'Não configurado';
  if (site.status === 'unknown') return 'Ainda não verificado';
  if (site.status === 'offline' || site.status === 'critical') return 'Indisponível';
  if (site.status === 'security_blocked') return 'Não aplicável';
  return 'Falha na verificação';
}

export function sslUnavailableLabel(site: Site): string {
  if (!site.monitorSsl) return 'Não configurado';
  if (site.ssl?.applicable === false) return 'Não aplicável';
  if (site.status === 'unknown') return 'Ainda não verificado';
  return 'Falha na verificação';
}

export function domainUnavailableLabel(site: Site): string {
  if (!site.monitorDomain) return 'Não configurado';
  if (site.status === 'unknown') return 'Ainda não verificado';
  return 'Falha na verificação';
}
