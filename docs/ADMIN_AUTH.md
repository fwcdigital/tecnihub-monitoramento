# Autenticação administrativa

## Arquitetura escolhida

O Supabase Auth armazena e valida as credenciais. A senha é processada apenas no
backend e nunca é devolvida ao navegador. Após o login, o backend emite uma sessão
assinada por HMAC em cookie `HttpOnly`, `SameSite=Strict`, `Secure` em produção e
com duração máxima configurável (8 horas por padrão).

O usuário precisa estar ativo e possuir `app_metadata.role = "admin"`. A sessão é
revalidada no Supabase Auth em cada chamada administrativa, permitindo bloquear um
usuário sem esperar o cookie expirar. A data de criação e o último login são mantidos
pelo próprio Supabase Auth.

O frontend não recebe JWT do Supabase, `service_role`, segredo da sessão ou senha.
Todas as APIs administrativas, inclusive histórico e alertas, exigem sessão. Permanecem
públicos somente `GET /api/health`, `GET /api/public/status`, login/logout e a SPA.
`POST /api/internal/monitor/run` não usa sessão de navegador: exige o segredo exclusivo
do cron em `Authorization: Bearer`. A área administrativa fica em `/admin`.

O health público retorna somente `status`, nome do serviço e timestamp, sem sites ou
telemetria. Ele possui limite de 120 consultas por minuto por IP. Headers defensivos
são aplicados pelo Helmet, incluindo CSP, proteção contra framing e HSTS em produção.

## Variáveis somente do backend

- `SUPABASE_URL`: URL do projeto Supabase.
- `SUPABASE_SERVICE_ROLE_KEY`: acesso do servidor ao banco e à Admin API do Auth.
- `SUPABASE_ANON_KEY`: usada no servidor somente para `signInWithPassword`.
- `ADMIN_SESSION_SECRET`: segredo aleatório de no mínimo 32 bytes.
- `MONITOR_CRON_SECRET`: segredo diferente, aleatório e exclusivo do Hostinger Cron.
- `CREDENTIALS_ENCRYPTION_KEY`: chave exclusiva de 32 bytes para AES-256-GCM do cofre.
- `CREDENTIALS_MASTER_PASSWORD_HASH`: hash gerado por `npm run vault:setup`, nunca a senha em plaintext.
- `ADMIN_SESSION_TTL_SECONDS`: entre 300 e 86400; padrão 28800 (8 horas).
- `ALLOWED_ORIGINS`: origens web adicionais confiáveis.
- `TRUST_PROXY`: `1` apenas atrás de exatamente um proxy reverso confiável.
- `NODE_ENV`: `production` na hospedagem para exigir cookie `Secure`.

Nenhuma dessas variáveis deve usar o prefixo `VITE_`. Para gerar o segredo:

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

## Primeiro administrador

1. Configure as variáveis de backend localmente, sem enviá-las ao Git.
2. Execute em um terminal interativo:

   ```powershell
   npm run admin:create -- administrador@tecnihub.com.br
   ```

3. Digite uma senha inicial de pelo menos 12 caracteres. O terminal exibe apenas
   asteriscos, o script não registra a senha e cria o usuário já confirmado com a
   marca administrativa no `app_metadata`.

O script é intencionalmente manual. Ele não foi executado durante a implementação.
Para inativar um administrador, aplique banimento no usuário pelo painel do Supabase
Auth. Um usuário banido perde acesso na próxima requisição autenticada.

## Migration 002 — revisão e ordem segura

O SQL base continua adequado e foi revisado de forma defensiva para também habilitar
RLS, revogar `anon`/`authenticated` e conceder `service_role` nas tabelas internas das
migrations 003–005 quando elas já existirem no ambiente:

```sql
DROP POLICY IF EXISTS "Permitir select total em sites" ON public.sites;
DROP POLICY IF EXISTS "Permitir insert em sites" ON public.sites;
DROP POLICY IF EXISTS "Permitir update em sites" ON public.sites;
DROP POLICY IF EXISTS "Permitir delete em sites" ON public.sites;

DROP POLICY IF EXISTS "Permitir select total em checks" ON public.checks;
DROP POLICY IF EXISTS "Permitir insert em checks" ON public.checks;
DROP POLICY IF EXISTS "Permitir update em checks" ON public.checks;
DROP POLICY IF EXISTS "Permitir delete em checks" ON public.checks;

DROP POLICY IF EXISTS "Permitir select total em incidents" ON public.incidents;
DROP POLICY IF EXISTS "Permitir insert em incidents" ON public.incidents;
DROP POLICY IF EXISTS "Permitir update em incidents" ON public.incidents;
DROP POLICY IF EXISTS "Permitir delete em incidents" ON public.incidents;

REVOKE ALL ON TABLE public.sites FROM anon, authenticated;
REVOKE ALL ON TABLE public.checks FROM anon, authenticated;
REVOKE ALL ON TABLE public.incidents FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;

GRANT ALL ON TABLE public.sites TO service_role;
GRANT ALL ON TABLE public.checks TO service_role;
GRANT ALL ON TABLE public.incidents TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;
```

O Supabase Auth é um serviço separado das tabelas `public`; revogar privilégios de
`anon` e `authenticated` nessas tabelas não impede o login. A chave anon é usada
somente pelo backend no endpoint do Auth, enquanto toda consulta administrativa ao
banco usa `service_role`.

Ordem segura:

1. Aplicar a migration 001, que permite o status `critical`.
2. Configurar todas as novas variáveis no backend.
3. Criar o primeiro administrador pelo script manual.
4. Publicar a aplicação e validar login, sessão e CRUD pelo backend.
5. Aplicar a migration 002 somente após essa validação.
6. Revalidar login, listagem, criação, edição, check e logout.

Impacto da 002: chaves `anon`/`authenticated` perdem todo acesso direto às tabelas
internas existentes, incluindo `sites`, `checks`, `incidents`, configurações, cofre e
auditoria. Risco principal: indisponibilidade administrativa se ela for
aplicada antes de o backend com `service_role` estar funcionando. Rollback emergencial:
restaurar apenas os grants/policies anteriores do schema versionado; isso reabre a
superfície insegura e deve ser temporário. A migration não remove dados.

## Limites desta etapa

O rate limit é mantido na memória do processo. Ele atende à proteção básica em uma
instância; múltiplas instâncias exigirão um limitador compartilhado ou proteção no
proxy/WAF. MFA, recuperação pública, SSO e contas de clientes permanecem fora do escopo.
