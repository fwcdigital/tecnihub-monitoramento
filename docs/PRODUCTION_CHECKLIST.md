# Checklist manual de produção

Nenhuma ação deste documento foi executada automaticamente durante o desenvolvimento.

## 1. Supabase Auth

1. Abra o projeto no Supabase Dashboard.
2. Acesse **Authentication → Configuration → General Configuration**.
3. Desabilite **Allow new users to sign up**. Com isso, somente usuários já
   existentes poderão entrar.
4. Confirme que **Allow anonymous sign-ins** permanece desabilitado.
5. Crie administradores exclusivamente pelo mecanismo backend:
   `npm run admin:create -- administrador@dominio.example`.
6. Confirme `app_metadata.role = "admin"` e que a conta está ativa.
7. Antes do deploy, rotacione a senha administrativa que foi usada em testes
   anteriores. Não tente recuperá-la ou imprimi-la; defina uma senha nova diretamente
   pelo fluxo administrativo seguro do Supabase.

Referência oficial: <https://supabase.com/docs/guides/auth/general-configuration>.

## 2. Variáveis somente do backend

Configurar, sem prefixo `VITE_`:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ADMIN_SESSION_SECRET`
- `ADMIN_SESSION_TTL_SECONDS`
- `ALLOWED_ORIGINS`
- `TRUST_PROXY`
- `MONITOR_CRON_SECRET`
- `CREDENTIALS_ENCRYPTION_KEY`
- `CREDENTIALS_MASTER_PASSWORD_HASH`
- `MONITOR_CRON_BATCH_SIZE` (padrão 5)
- `MONITOR_CRON_CONCURRENCY` (padrão 5)

Não há variável de e-mail: SMTP/provedor não foi implementado. O webhook é
configurado pela área administrativa depois que a migration 004 estiver aplicada.

## 3. Cron externo

No cron-job.org (ou agendador equivalente), configure:

- frequência: a cada minuto;
- método: `POST`;
- endpoint: `https://<DOMINIO-DO-MONITOR>/api/internal/monitor/run`;
- autenticação: `Authorization: Bearer <MONITOR_CRON_SECRET>`;
- timeout: 30 segundos.

Comando exato, somente com placeholders:

```sh
curl --fail --silent --show-error --max-time 30 --request POST --header 'Authorization: Bearer <MONITOR_CRON_SECRET>' 'https://<DOMINIO-DO-MONITOR>/api/internal/monitor/run'
```

Teste o comando manualmente após o deploy e inspecione o histórico no cron-job.org.
O retorno `200` traz o lote processado; `overlappingRun: true` indica que outra
execução possui o lease e não é falha. Nunca coloque o valor real do segredo no Git ou em URL.

Cada chamada processa no máximo `MONITOR_CRON_BATCH_SIZE` sites. A continuidade
depende somente de `next_check_at`, claims persistidos no Supabase e chamadas futuras do cron.

## 4. Cofre

1. Gere `CREDENTIALS_ENCRYPTION_KEY` de 32 bytes fora do Git.
2. Execute `npm run vault:setup` e configure somente o hash exibido em
   `CREDENTIALS_MASTER_PASSWORD_HASH`.
3. Guarde a senha mestre em gerenciador seguro.
4. Faça backup testado da chave de criptografia fora do Git, Supabase e frontend.
   Perder a chave pode tornar todas as credenciais irrecuperáveis.

## 5. Banco e publicação

1. Criar snapshot/backup do Supabase.
2. Pausar o cron.
3. Aplicar migrations 001, 002, 003, 004 e 005, nessa ordem.
4. Não executar `schema.sql` inteiro sobre o banco existente.
5. Publicar o backend com HTTPS e validar health, login, CRUD, check, histórico,
   métricas, página pública, alertas e cofre.
6. Ativar e observar o cron.
7. Confirmar que `anon`/`authenticated` não acessam tabelas internas.
