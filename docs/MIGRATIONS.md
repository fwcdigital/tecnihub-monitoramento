# Migrations do MVP

As migrations são propostas versionadas. A aplicação não as executa automaticamente.

## 001 — status `critical` em checks

Arquivo: `supabase/migrations/20260831_001_checks_critical_status.sql`.

- Finalidade: permitir que erros HTTP 5xx sejam persistidos como `critical`.
- Impacto: substitui apenas a constraint de domínio do campo `checks.status`; não altera nem remove linhas.
- Dependência: tabela `public.checks` criada pelo `schema.sql`.
- Risco: lock curto de DDL na tabela; a migration falha se existirem valores fora de `online`, `warning`, `critical` e `offline`.
- Verificação posterior: executar um check controlado que resulte em 5xx e confirmar a persistência de `critical`.

## 002 — bloqueio de acesso direto

Arquivo: `supabase/migrations/20260831_002_restrict_direct_api_access.sql`.

- Finalidade: remover policies e privilégios diretos de `anon`/`authenticated` nas tabelas operacionais.
- Impacto: o frontend ou qualquer cliente usando anon key deixa de consultar/gravar `sites`, `checks` e `incidents`; `service_role` permanece com acesso.
- Dependências: backend publicado e validado com `SUPABASE_SERVICE_ROLE_KEY`; autenticação administrativa funcional.
- Risco: aplicar antes de validar o backend pode indisponibilizar a área administrativa. Não remove dados.
- Verificação posterior: service role deve continuar acessando as três tabelas; anon e authenticated devem receber negação/resultado vazio conforme o cliente.

## Ordem exata de aplicação

1. Fazer snapshot/backup operacional do projeto Supabase e confirmar que não há migration em execução.
2. Manter `MONITORING_SCHEDULER_ENABLED=false` durante a janela.
3. Aplicar a migration 001.
4. Configurar as variáveis do backend, incluindo `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `ADMIN_SESSION_SECRET`, `ALLOWED_ORIGINS`, `TRUST_PROXY=1` quando houver exatamente um proxy confiável e o agendador ainda em `false`.
5. Criar ou confirmar um administrador com `app_metadata.role = "admin"` pelo procedimento manual documentado.
6. Publicar o código do MVP (fora desta tarefa) ainda com o agendador desabilitado.
7. Validar login, sessão, listagem, CRUD não destrutivo e um check controlado pelo backend.
8. Aplicar a migration 002.
9. Revalidar login, sessão, listagem de sites/incidentes, check individual e check em lote; confirmar que `anon`/`authenticated` não acessam as tabelas e que `service_role` continua acessando.
10. Habilitar `MONITORING_SCHEDULER_ENABLED=true` e reiniciar uma única instância da aplicação.
11. Confirmar um ciclo devido, o respeito a `check_interval` e a ausência de checks duplicados.

Rollback emergencial da 002 deve restaurar temporariamente os grants/policies anteriores somente se a API com service role falhar. Isso reabre a superfície insegura e não deve ser mantido.
