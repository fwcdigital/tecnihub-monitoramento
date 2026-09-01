# Segurança e limites da Fase 1

## Fronteira de dados

O React não consulta nem modifica mais `sites`, `checks` ou `incidents` diretamente no Supabase. As operações passam pela API Express, e o cliente Supabase do backend exige `SUPABASE_SERVICE_ROLE_KEY` sem fallback para anon key.

As migrations em `supabase/migrations/` são propostas e **não são aplicadas automaticamente**. A migration `20260831_002_restrict_direct_api_access.sql` remove as policies públicas e revoga todos os privilégios diretos de `anon` e `authenticated`.

## Endpoints com autenticação administrativa

O login usa Supabase Auth e exige `app_metadata.role = "admin"`. Depois da autenticação, o backend emite uma sessão assinada em cookie `HttpOnly`. Todos os endpoints operacionais abaixo exigem essa sessão:

- `GET /api/sites`
- `POST /api/sites`
- `PATCH /api/sites/:siteId`
- `PATCH /api/sites/:siteId/active`
- `DELETE /api/sites/:siteId`
- `GET /api/incidents`
- `PATCH /api/incidents/:incidentId/resolve`
- `POST /api/check-site`
- `POST /api/check-all`

Somente `GET /api/health`, `POST /api/auth/login`, `POST /api/auth/logout` e os arquivos da SPA são públicos. CORS e a validação de origem complementam a sessão e protegem as escritas feitas pelo navegador.

## Exclusão definitiva e histórico

O schema atual usa `ON DELETE CASCADE` de `sites` para `checks` e `incidents`. Para evitar perda silenciosa:

1. desativar o monitoramento é a ação padrão e preserva tudo;
2. a exclusão exige digitar exatamente o domínio ou nome do site;
3. a API bloqueia a exclusão com HTTP 409 se existir qualquer check ou incidente;
4. sites sem histórico podem ser excluídos definitivamente.

Permitir a remoção do cadastro preservando o histórico exigirá uma migration posterior para snapshots e chaves estrangeiras anuláveis, ou autorização explícita para apagar o histórico em cascade.

## Incidentes

Incidentes exibidos no frontend vêm exclusivamente da tabela `public.incidents` pela API autenticada. Checks individuais, em lote e agendados usam o mesmo serviço central. Um incidente é aberto após três checks consecutivos `critical`/`offline` e resolvido automaticamente após dois checks consecutivos `online`. A resolução manual também é persistida pela API administrativa.

## Dados operacionais visíveis

Uptime de 30 dias usa contagens reais da tabela `checks`; tempo de resposta, histórico e gráficos usam checks persistidos. SSL, vencimento de domínio, conteúdo e tracking são mostrados como indisponíveis ou não verificados porque ainda não possuem coletores reais. Relatórios derivam apenas de sites, checks e incidentes carregados. Não existem fallbacks de demonstração ou dados operacionais em `localStorage`.
