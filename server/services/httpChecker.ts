import { validateUrlForSSRF } from './ssrfProtection';

export interface CheckExecutionResult {
  status: 'online' | 'warning' | 'offline';
  httpStatus: number | null;
  responseTime: number; // em milissegundos
  finalUrl: string;
  errorType?: string;
  errorMessage?: string;
  resultMessage: string;
}

const DEFAULT_TIMEOUT_MS = 10000; // 10 segundos
const MAX_REDIRECTS = 5;

/**
 * Executa uma verificação HTTP segura e precisa a partir do backend.
 */
export async function executeHttpCheck(targetUrl: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<CheckExecutionResult> {
  let currentUrl = targetUrl.trim();
  if (!/^https?:\/\//i.test(currentUrl)) {
    currentUrl = 'https://' + currentUrl;
  }

  let redirectCount = 0;
  const startTime = process.hrtime.bigint();

  while (redirectCount <= MAX_REDIRECTS) {
    // 1. Validação de SSRF antes de disparar a requisição
    const ssrfCheck = await validateUrlForSSRF(currentUrl);
    if (!ssrfCheck.valid) {
      const endTime = process.hrtime.bigint();
      const durationMs = Number(endTime - startTime) / 1_000_000;
      return {
        status: 'offline',
        httpStatus: null,
        responseTime: Math.round(durationMs),
        finalUrl: currentUrl,
        errorType: 'SSRF_BLOCKED',
        errorMessage: ssrfCheck.error,
        resultMessage: `Bloqueado por segurança: ${ssrfCheck.error}`
      };
    }

    // 2. Criação do AbortController para timeout
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      // Dispara requisição HTTP com redirect manual para validar cada salto contra SSRF
      const response = await fetch(currentUrl, {
        method: 'GET',
        signal: controller.signal,
        redirect: 'manual',
        headers: {
          'User-Agent': 'TecnihubMonitoring/1.0 (+https://tecnihub.com.br)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8'
        }
      });

      clearTimeout(timer);

      // Tratamento de Redirecionamentos (301, 302, 303, 307, 308)
      if (response.status >= 300 && response.status < 400) {
        const locationHeader = response.headers.get('location');
        if (locationHeader) {
          redirectCount++;
          if (redirectCount > MAX_REDIRECTS) {
            const endTime = process.hrtime.bigint();
            const durationMs = Number(endTime - startTime) / 1_000_000;
            return {
              status: 'warning',
              httpStatus: response.status,
              responseTime: Math.round(durationMs),
              finalUrl: currentUrl,
              errorType: 'TOO_MANY_REDIRECTS',
              errorMessage: `Excesso de redirecionamentos (mais de ${MAX_REDIRECTS} saltos).`,
              resultMessage: `Atenção: Excesso de redirecionamentos (HTTP ${response.status})`
            };
          }

          // Resolve URL relativa se necessário
          currentUrl = new URL(locationHeader, currentUrl).toString();
          continue; // Efetua o próximo salto
        }
      }

      const endTime = process.hrtime.bigint();
      const durationMs = Number(endTime - startTime) / 1_000_000;
      const roundedMs = Math.round(durationMs);

      const httpCode = response.status;

      // Classificação do Status
      if (httpCode >= 200 && httpCode < 300) {
        return {
          status: 'online',
          httpStatus: httpCode,
          responseTime: roundedMs,
          finalUrl: currentUrl,
          resultMessage: `Servidor respondendo normalmente (HTTP ${httpCode} em ${roundedMs}ms)`
        };
      }

      if (httpCode >= 400 && httpCode < 500) {
        return {
          status: 'warning',
          httpStatus: httpCode,
          responseTime: roundedMs,
          finalUrl: currentUrl,
          errorType: `HTTP_${httpCode}`,
          errorMessage: `Cliente retornou código HTTP ${httpCode}`,
          resultMessage: `Atenção: Servidor retornou HTTP ${httpCode}`
        };
      }

      if (httpCode >= 500 && httpCode < 600) {
        return {
          status: 'offline',
          httpStatus: httpCode,
          responseTime: roundedMs,
          finalUrl: currentUrl,
          errorType: `HTTP_${httpCode}`,
          errorMessage: `Falha interna no servidor remoto (HTTP ${httpCode})`,
          resultMessage: `CRÍTICO: Servidor indisponível (HTTP ${httpCode})`
        };
      }

      // Outros códigos HTTP
      return {
        status: 'warning',
        httpStatus: httpCode,
        responseTime: roundedMs,
        finalUrl: currentUrl,
        resultMessage: `Status HTTP ${httpCode} recebido em ${roundedMs}ms`
      };

    } catch (err: any) {
      clearTimeout(timer);
      const endTime = process.hrtime.bigint();
      const durationMs = Number(endTime - startTime) / 1_000_000;
      const roundedMs = Math.round(durationMs);

      if (err.name === 'AbortError') {
        return {
          status: 'offline',
          httpStatus: null,
          responseTime: roundedMs,
          finalUrl: currentUrl,
          errorType: 'TIMEOUT',
          errorMessage: `Tempo limite de ${timeoutMs / 1000}s excedido sem resposta do servidor.`,
          resultMessage: `CRÍTICO: Timeout de requisição (${timeoutMs / 1000}s)`
        };
      }

      return {
        status: 'offline',
        httpStatus: null,
        responseTime: roundedMs,
        finalUrl: currentUrl,
        errorType: err.code || 'CONNECTION_ERROR',
        errorMessage: err.message || 'Falha ao conectar no host remoto',
        resultMessage: `CRÍTICO: Conexão impossível (${err.code || err.message || 'Erro de rede'})`
      };
    }
  }

  const endTime = process.hrtime.bigint();
  return {
    status: 'warning',
    httpStatus: null,
    responseTime: Math.round(Number(endTime - startTime) / 1_000_000),
    finalUrl: currentUrl,
    errorType: 'UNKNOWN',
    resultMessage: 'Loop ou condição inesperada de verificação'
  };
}
