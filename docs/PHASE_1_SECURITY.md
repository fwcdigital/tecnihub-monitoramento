# Segurança e limites da Fase 1

## Fronteira de dados

O React não consulta nem modifica mais `sites`, `checks` ou `incidents` diretamente no Supabase. As operações passam pela API Express, e o cliente Supabase do backend exige `SUPABASE_SERVICE_ROLE_KEY` sem fallback para anon key.

As migrations em `supabase/migrations/` são propostas e **não são aplicadas automaticamente**. A migration `20260831_002_restrict_direct_api_access.sql` remove as policies públicas e revoga todos os privilégios diretos de `anon` e `authenticated`.

## Endpoints com autenticação administrativa

O login usa Supabase Auth e exige `app_metadata.role = "admin"`. Depois da autenticação, o backend emite uma sessão assinada em cookie `HttpOnly`. Todos os endpoints operacionais abaixo exigem essa sessão:

- `GET /api/sites`
- `GET /api/sites/:siteId/checks`
- `GET /api/sites/:siteId/metrics`
- `POST /api/sites`
- `PATCH /api/sites/:siteId`
- `PATCH /api/sites/:siteId/active`
- `DELETE /api/sites/:siteId`
- `GET /api/incidents`
- `PATCH /api/incidents/:incidentId/resolve`
- `POST /api/check-site`
- `POST /api/check-all`
- `GET /api/alerts/config`
- `PUT /api/alerts/webhook`

`GET /api/public/status` é público e sanitizado. `POST /api/internal/monitor/run` é exclusivo do cron e protegido por segredo backend. Login/logout, health e arquivos da SPA também são públicos. CORS e a validação de origem complementam a sessão e protegem as escritas feitas pelo navegador.

## Exclusão definitiva e histórico

A migration 003 prepara `ON DELETE RESTRICT` de `sites` para `checks` e `incidents`.
Até sua aplicação controlada, a API continua sendo a barreira obrigatória contra perda
silenciosa:

1. desativar o monitoramento é a ação padrão e preserva tudo;
2. a exclusão exige digitar exatamente o domínio ou nome do site;
3. a API bloqueia a exclusão com HTTP 409 se existir qualquer check ou incidente;
4. sites sem histórico podem ser excluídos definitivamente.

Permitir a remoção do cadastro preservando o histórico exigirá uma migration posterior
para snapshots e chaves estrangeiras anuláveis. Apagar histórico em cascade não faz
parte do MVP.

## Incidentes

Incidentes exibidos no frontend vêm exclusivamente da tabela `public.incidents` pela API autenticada. Checks individuais, em lote e via cron usam o mesmo serviço central e a mesma RPC atômica. Um incidente de downtime é aberto após três falhas de disponibilidade consecutivas e resolvido automaticamente após dois checks `online`. Warning, inclusive 401/403/429, e `security_blocked` interrompem a sequência e não abrem downtime.

## Dados operacionais visíveis

Uptime de 24h/7d/30d/90d, latência, histórico, gráficos e relatórios usam checks persistidos e agregações do banco. SSL/TLS, DNS/IP, conteúdo, evidências de tags e WordPress são coletados no motor; domínio usa RDAP com cache. Ausência de dados é exibida como indisponível ou histórico parcial. Não existem fallbacks operacionais de demonstração nem dados em `localStorage`.
