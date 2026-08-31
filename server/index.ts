import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { executeHttpCheck } from './services/httpChecker';
import { getServerSupabase } from './supabase';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Log de requisições simples
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    console.log(`[${req.method}] ${req.originalUrl} - ${res.statusCode} (${Date.now() - start}ms)`);
  });
  next();
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'tecnihub-monitor-backend',
    timestamp: new Date().toISOString(),
    supabaseConnected: Boolean(getServerSupabase())
  });
});

/**
 * POST /api/check-site
 * Executa verificação HTTP real com medição e proteção SSRF no backend.
 */
app.post('/api/check-site', async (req, res) => {
  try {
    const { siteId, url } = req.body;

    let targetUrl = url;
    const supabase = getServerSupabase();

    // Se a URL não foi enviada diretamente mas o siteId sim, busca no Supabase
    if (!targetUrl && siteId && supabase) {
      const { data: siteRecord, error } = await supabase
        .from('sites')
        .select('id, url, name, is_active')
        .eq('id', siteId)
        .single();

      if (error || !siteRecord) {
        return res.status(404).json({
          error: 'Site não encontrado no banco de dados para verificação.'
        });
      }
      targetUrl = siteRecord.url;
    }

    if (!targetUrl) {
      return res.status(400).json({
        error: 'URL do site ou siteId é obrigatório para realizar a verificação.'
      });
    }

    console.log(`[HTTP Check] Iniciando verificação para: ${targetUrl} (Site ID: ${siteId || 'avulso'})`);

    // Executa a requisição real no backend
    const checkResult = await executeHttpCheck(targetUrl);
    const checkedAt = new Date().toISOString();

    let savedCheckId: string | undefined;

    // Se o Supabase estiver disponível e tivermos o siteId, salva na tabela checks
    if (supabase && siteId) {
      try {
        const { data: insertedCheck, error: insertError } = await supabase
          .from('checks')
          .insert({
            site_id: siteId,
            checked_at: checkedAt,
            status: checkResult.status,
            http_status: checkResult.httpStatus,
            response_time: checkResult.responseTime,
            final_url: checkResult.finalUrl,
            error_type: checkResult.errorType || null,
            error_message: checkResult.errorMessage || null
          })
          .select('id')
          .single();

        if (insertError) {
          console.warn('[HTTP Check] Aviso ao gravar na tabela checks:', insertError.message);
        } else if (insertedCheck) {
          savedCheckId = insertedCheck.id;
        }

        // Se o site ficou offline, verifica se deve registrar incidente
        if (checkResult.status === 'offline') {
          // Checa se já existe incidente ativo
          const { data: activeInc } = await supabase
            .from('incidents')
            .select('id')
            .eq('site_id', siteId)
            .eq('status', 'active')
            .limit(1);

          if (!activeInc || activeInc.length === 0) {
            await supabase.from('incidents').insert({
              site_id: siteId,
              type: checkResult.httpStatus ? `HTTP ${checkResult.httpStatus}` : (checkResult.errorType || 'Site fora do ar'),
              severity: 'critical',
              title: `Instabilidade detectada: ${checkResult.resultMessage}`,
              description: `A verificação automática registrou status offline para a URL ${targetUrl}. Resposta: ${checkResult.errorMessage || checkResult.resultMessage}`,
              started_at: checkedAt,
              status: 'active'
            });
          }
        } else if (checkResult.status === 'online') {
          // Se voltou a ficar online, resolve incidentes ativos
          await supabase
            .from('incidents')
            .update({
              status: 'resolved',
              resolved_at: checkedAt
            })
            .eq('site_id', siteId)
            .eq('status', 'active');
        }

      } catch (dbErr: any) {
        console.warn('[HTTP Check] Erro na persistência do Supabase:', dbErr.message);
      }
    }

    return res.json({
      success: true,
      siteId,
      checkedAt,
      checkId: savedCheckId,
      result: checkResult
    });

  } catch (err: any) {
    console.error('[HTTP Check Error]', err);
    return res.status(500).json({
      error: 'Erro interno ao executar a verificação HTTP.',
      details: err.message
    });
  }
});

/**
 * POST /api/check-all
 * Executa verificação em lote para todos os sites ativos.
 */
app.post('/api/check-all', async (req, res) => {
  try {
    const supabase = getServerSupabase();
    let sitesToCheck: Array<{ id: string; url: string; name: string }> = [];

    if (supabase) {
      const { data, error } = await supabase
        .from('sites')
        .select('id, url, name, is_active')
        .eq('is_active', true);

      if (!error && data) {
        sitesToCheck = data;
      }
    }

    // Se foi passado sites no body
    if (req.body.sites && Array.isArray(req.body.sites)) {
      sitesToCheck = req.body.sites;
    }

    if (sitesToCheck.length === 0) {
      return res.json({
        success: true,
        message: 'Nenhum site ativo para verificar.',
        results: []
      });
    }

    // Executa em paralelo (com limite)
    const results = await Promise.all(
      sitesToCheck.map(async (s) => {
        const checkResult = await executeHttpCheck(s.url);
        const checkedAt = new Date().toISOString();

        if (supabase && s.id) {
          try {
            await supabase.from('checks').insert({
              site_id: s.id,
              checked_at: checkedAt,
              status: checkResult.status,
              http_status: checkResult.httpStatus,
              response_time: checkResult.responseTime,
              final_url: checkResult.finalUrl,
              error_type: checkResult.errorType || null,
              error_message: checkResult.errorMessage || null
            });
          } catch {}
        }

        return {
          siteId: s.id,
          name: s.name,
          url: s.url,
          checkedAt,
          result: checkResult
        };
      })
    );

    return res.json({
      success: true,
      totalChecked: results.length,
      results
    });

  } catch (err: any) {
    console.error('[Check All Error]', err);
    return res.status(500).json({
      error: 'Erro ao executar varredura em lote.',
      details: err.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`========================================================`);
  console.log(`  TECNIHUB MONITORAMENTO - BACKEND HTTP REAL`);
  console.log(`  Servidor rodando em: http://localhost:${PORT}`);
  console.log(`  Anti-SSRF Ativo | Timeout Padrão: 10s`);
  console.log(`========================================================`);
});
