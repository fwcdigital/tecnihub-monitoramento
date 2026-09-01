# Cofre de acessos técnicos

## Arquitetura e limites

O cofre existe somente em `/admin` e todas as rotas ficam depois da validação da
sessão administrativa. Cada site pode ter vários acessos dos tipos WordPress,
hospedagem, FTP, SFTP e outros. O frontend nunca consulta o Supabase diretamente.

Senhas são criptografadas no backend com AES-256-GCM. Cada gravação usa IV aleatório
de 96 bits e persiste somente ciphertext, IV, authentication tag, algoritmo e versão.
Listagens normais retornam apenas a máscara `••••••••••••`; colunas criptográficas
não fazem parte do `select` normal nem das respostas públicas.

`CREDENTIALS_ENCRYPTION_KEY` é exclusiva do cofre e deve representar 32 bytes. Ela
não pode reutilizar `ADMIN_SESSION_SECRET`, usar prefixo `VITE_`, ficar no Git,
frontend ou banco Supabase. Se essa chave for perdida, as credenciais existentes
podem se tornar definitivamente irrecuperáveis.

## Configuração manual

1. Gere uma chave fora do Git e salve-a no gerenciador seguro de segredos do backend:

   ```powershell
   node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
   ```

2. Execute `npm run vault:setup` em terminal interativo. Digite e confirme a senha
   mestre. O script mostra somente um hash `scrypt-v1`; configure esse resultado em
   `CREDENTIALS_MASTER_PASSWORD_HASH`. A senha mestre não é salva pelo script.
3. Configure `CREDENTIALS_ENCRYPTION_KEY` e o hash apenas no backend.
4. Faça backup seguro e testado da chave de criptografia fora do Git, Supabase e
   frontend. Controle acesso e rotação pelo processo operacional da organização.
5. Em janela separada, com snapshot do banco, aplique a migration 005. Esta
   implementação não executou migration alguma.

## Operações sensíveis

“Copiar senha” e “Alterar senha” exigem senha mestre. Após validação, o backend emite
um cookie `HttpOnly`, `SameSite=Strict`, `Secure` em produção, restrito a `/api` e
válido por cinco minutos. A autorização é vinculada ao administrador e não usa
`localStorage`. Tentativas de autorização e cópia possuem rate limit em memória.

A senha copiada é recebida apenas na resposta daquela operação, escrita diretamente
na Clipboard API e nunca colocada em estado React ou renderizada no DOM. O sistema
operacional e o navegador não oferecem uma limpeza confiável e universal do clipboard;
portanto o usuário deve substituí-lo/limpá-lo depois do uso. O sistema não promete
limpeza automática como garantia de segurança.

## Auditoria

A tabela `credential_audit_log` registra administrador, site quando aplicável, ação,
resultado e timestamp para criação, edição, cópia, troca de senha, remoção e falhas
relevantes de autorização. Senhas, plaintext descriptografado, chave de criptografia
e senha mestre nunca entram no log de auditoria ou nos logs da aplicação.

## Checklist de produção

- guardar e testar backup de `CREDENTIALS_ENCRYPTION_KEY` fora do Git, Supabase e frontend;
- guardar a senha mestre em gerenciador seguro, separada da chave de criptografia;
- confirmar que nenhuma variável do cofre usa prefixo `VITE_`;
- confirmar cookies `Secure` e HTTPS;
- aplicar a migration 005 apenas após snapshot e validação do backend;
- validar RLS/revogações para `anon` e `authenticated`;
- revisar alertas de rate limit e auditoria sem registrar conteúdo sensível;
- orientar administradores a limpar/substituir o clipboard depois de usar uma senha.
