# Migrations do monitoramento

As migrations são propostas versionadas e a aplicação nunca as executa automaticamente. Nenhuma migration foi aplicada durante esta implementação.

## 001 — status `critical`

Permite persistir erros HTTP 5xx como `critical`. Não remove linhas; substitui somente a constraint de `checks.status`.

## 002 — acesso somente pelo backend

Revoga acesso direto de `anon`/`authenticated` às tabelas operacionais e mantém `service_role`. Não remove dados.

## 003 — motor, estado e scheduler distribuído

Arquivo: `supabase/migrations/20260901_003_monitoring_engine.sql`.

- adiciona estado persistido por site (`last_checked_at`, `next_check_at`, contadores e `monitoring_state`);
- adiciona diagnósticos estruturados aos checks (SSL, DNS/IP, RDAP, conteúdo, WordPress e JSON técnico);
- cria cache RDAP, execuções e lease renovável do scheduler e das reservas de sites;
- cria RPCs atômicas para claim, persistência do check/transição de incidente, finalização e agregações;
- adiciona vínculo check–incidente e índice único de um incidente ativo por site;
- troca as FKs de histórico para `ON DELETE RESTRICT`, impedindo exclusão em cascata;
- implementa métricas reais de 24h, 7d, 30d e 90d e séries agregadas.

Ela não apaga histórico. Por segurança, falha antes de criar o índice único se já existirem múltiplos incidentes ativos para o mesmo site; a correção desses registros exige decisão operacional explícita, sem apagar histórico.

## 004 — alertas webhook

Arquivo: `supabase/migrations/20260901_004_alert_webhooks.sql`.

Cria configuração persistida de webhook e log de entregas com chave idempotente. Não configura nem declara e-mail funcional.

## 005 — cofre de acessos técnicos

Arquivo: `supabase/migrations/20260901_005_technical_credentials_vault.sql`.

Cria `technical_credentials` (vários acessos por site) e `credential_audit_log`.
Somente ciphertext AES-256-GCM, IV e authentication tag são persistidos como segredo.
As duas tabelas nascem com RLS habilitada, sem policies e com privilégios revogados
para `anon`/`authenticated`; apenas `service_role` do backend recebe acesso. A
migration 002 também foi revisada defensivamente para reconhecer essas e as demais
tabelas internas caso já existam quando ela for aplicada.

## 006 — outbox transacional e alertas multicanal

Arquivo: `supabase/migrations/20260902_006_transactional_alert_outbox_email.sql`.

- cria `monitoring_alert_events`, gravada na mesma transação que abre ou resolve incidente;
- cria a configuração administrativa `alert_email_configs` sem armazenar credenciais do provedor;
- generaliza `alert_deliveries` para webhook e e-mail, preservando registros existentes;
- cria fan-out idempotente, claims com `FOR UPDATE SKIP LOCKED`, leases recuperáveis e retries persistentes;
- mantém `incident_confirmed` e `recovery` como únicos eventos selecionáveis para e-mail nesta versão.

Ela não envia mensagens e não aplica credenciais. O envio só acontece quando o cron externo chama
`POST /api/internal/alerts/run` depois do deploy do backend.

## Ordem recomendada para uma janela futura

1. Criar snapshot/backup do Supabase.
2. Desabilitar temporariamente o Hostinger Cron (não existe scheduler por `setInterval` no Express).
3. Verificar se há mais de um incidente ativo por site; não apagar nem resolver automaticamente.
4. Aplicar 001, 002, 003, 004, 005 e 006, nessa ordem, em ambiente validado.
5. Configurar as variáveis de backend descritas em `.env.example`, incluindo os segredos distintos `MONITOR_CRON_SECRET` e `ALERT_CRON_SECRET` e as variáveis do Resend.
6. Publicar o código em uma ação separada e validar login, página pública, CRUD, check individual, lote, histórico e métricas.
7. Configurar o cron-job.org para `POST /api/internal/monitor/run` com `Authorization: Bearer <MONITOR_CRON_SECRET>` a cada minuto e timeout de 30 segundos.
8. Confirmar uma execução em `monitoring_runs`, atualização de `next_check_at` e ausência de checks duplicados.
9. Confirmar backup seguro e testado da chave do cofre fora do Git, Supabase e frontend.
10. Configurar um segundo cron para `POST /api/internal/alerts/run` com `ALERT_CRON_SECRET` e validar outbox, entregas e retries.

O endpoint retorna `200`; quando outro lease válido já executa o ciclo, informa `overlappingRun: true` e não duplica sites. O segredo nunca deve usar prefixo `VITE_`, aparecer em URL/query string, logs, respostas ou Git.

## Metodologia de uptime

Para cada janela usa-se `checked_at` real. O denominador contém todos os checks exceto `security_blocked`, porque nesse caso não houve observação externa válida. O numerador contém respostas HTTP recebidas que não foram marcadas como falha de disponibilidade (`incident_eligible=false`); assim 401/403/429, conteúdo ausente e aviso/criticidade preventiva de SSL não contam automaticamente como downtime. HTTP 5xx, timeout, DNS sem resolução, conexão recusada e falhas equivalentes não entram no numerador. A UI mostra “histórico parcial” até existir ao menos um check anterior ao início integral da janela.

## Matriz operacional detalhada

### 001

- **SQL:** `20260831_001_checks_critical_status.sql`.
- **Impacto/risco:** troca somente a constraint; não altera linhas. Falha se houver
  status fora da enumeração.
- **Rollback:** restaurar a constraint anterior somente se nenhuma linha usar
  `critical`; registros existentes exigem decisão explícita.
- **Dependência:** tabela inicial `checks`. **Ordem:** primeira.

### 002

- **SQL:** `20260831_002_restrict_direct_api_access.sql`.
- **Impacto/risco:** bloqueia acesso direto de `anon`/`authenticated`, sem alterar
  dados. Pode indisponibilizar o painel se o backend `service_role` não estiver pronto.
- **Rollback:** restaurar temporariamente grants/policies anteriores; isso reabre a
  superfície insegura e deve ser apenas contingencial.
- **Dependência:** backend `service_role` previamente validado. **Ordem:** segunda.

### 003

- **SQL:** `20260901_003_monitoring_engine.sql`.
- **Impacto:** adiciona colunas, tabelas, funções, índices e backfills compatíveis;
  atualiza `next_check_at`, classifica checks históricos e torna FKs restritivas.
- **Risco:** falha intencionalmente se houver incidentes ativos duplicados; backfills
  devem ocorrer em janela monitorada.
- **Rollback:** preferir snapshot. Desativar RPCs sem remover histórico; não é fornecido
  rollback destrutivo de colunas/tabelas.
- **Dependências:** 001, 002, `pgcrypto`, schema inicial. **Ordem:** terceira.

### 004

- **SQL:** `20260901_004_alert_webhooks.sql`.
- **Impacto/risco:** adiciona configuração e fila de webhook. Baixo risco até existir
  configuração manual; URL continua protegida contra SSRF.
- **Rollback:** desabilitar webhook e preservar/exportar entregas. Não remover tabelas
  sem autorização porque isso apagaria o histórico.
- **Dependência:** 003 e `handle_updated_at`. **Ordem:** quarta.

### 005

- **SQL:** `20260901_005_technical_credentials_vault.sql`.
- **Impacto/risco:** adiciona cofre e auditoria. Perder a chave de criptografia torna
  credenciais potencialmente irrecuperáveis; chave incorreta não altera registros.
- **Rollback:** desabilitar API/UI e preservar tabelas. Remoção exige exportação
  criptografada, backup e autorização explícita.
- **Dependências:** 003, `CREDENTIALS_ENCRYPTION_KEY` e hash da senha mestre.
  **Ordem:** quinta.

### 006

- **SQL:** `20260902_006_transactional_alert_outbox_email.sql`.
- **Impacto:** adiciona outbox e configuração de e-mail e evolui a fila existente sem apagar webhooks ou entregas.
- **Risco:** o código novo depende das tabelas/RPCs novos; aplicar a migration antes de publicar o backend.
- **Rollback:** desativar o cron de alertas e os canais; preservar outbox e histórico. Não remover colunas/tabelas sem backup e autorização.
- **Dependências:** 003, 004 e `handle_updated_at`. **Ordem:** sexta.

## Índices e limites de escala

A migration 003 prepara índices por `site_id`, `checked_at`, `status`,
`next_check_at`, incidente ativo, início de execução e expiração do lock. Claims usam
`FOR UPDATE SKIP LOCKED`, limite máximo de 500 e concorrência de aplicação máxima 5;
o overview é limitado a 1000 sites. A migration 005 indexa credenciais por site e
auditoria por site, administrador e timestamp. Histórico e incidentes usam paginação
com limite máximo 100; acessos normais são limitados a 200 por site.
