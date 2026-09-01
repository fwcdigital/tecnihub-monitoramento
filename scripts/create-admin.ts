import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

function readHidden(prompt: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY || !process.stdin.setRawMode) {
    throw new Error('Execute este comando em um terminal interativo para proteger a senha.');
  }

  process.stdout.write(prompt);
  return new Promise((resolve, reject) => {
    let value = '';
    const stdin = process.stdin;
    const previousRawMode = stdin.isRaw;
    stdin.setEncoding('utf8');
    stdin.setRawMode(true);
    stdin.resume();

    const cleanup = () => {
      stdin.off('data', onData);
      stdin.setRawMode(Boolean(previousRawMode));
      stdin.pause();
    };

    const onData = (input: string) => {
      for (const character of input) {
        if (character === '\u0003') {
          cleanup();
          process.stdout.write('\n');
          reject(new Error('Operação cancelada.'));
          return;
        }
        if (character === '\r' || character === '\n') {
          cleanup();
          process.stdout.write('\n');
          resolve(value);
          return;
        }
        if (character === '\u007f' || character === '\b') {
          if (value.length) {
            value = value.slice(0, -1);
            process.stdout.write('\b \b');
          }
          continue;
        }
        if (character >= ' ') {
          value += character;
          process.stdout.write('*');
        }
      }
    };

    stdin.on('data', onData);
  });
}

async function main() {
  const email = String(process.argv[2] || '').trim().toLowerCase();
  if (!email || !email.includes('@')) {
    throw new Error('Uso: npm run admin:create -- administrador@tecnihub.com.br');
  }

  const supabaseUrl = process.env.SUPABASE_URL || '';
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!supabaseUrl || !serviceRoleKey || supabaseUrl.includes('your-project-id')) {
    throw new Error('Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY somente no backend.');
  }

  const password = await readHidden('Senha inicial (mínimo 12 caracteres): ');
  const confirmation = await readHidden('Confirme a senha: ');
  if (password.length < 12) throw new Error('A senha deve possuir pelo menos 12 caracteres.');
  if (password !== confirmation) throw new Error('As senhas não coincidem.');

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { role: 'admin' }
  });

  if (error || !data.user) {
    throw new Error(error?.message || 'O Supabase Auth não criou o administrador.');
  }
  console.log(`Administrador criado com segurança: ${data.user.email}`);
  console.log('A senha não foi salva pelo script. Remova-a de qualquer gerenciador temporário utilizado.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Falha ao criar administrador.');
  process.exitCode = 1;
});
