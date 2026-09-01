import { hashMasterPassword } from '../server/services/credentialsVault';

function readHidden(prompt: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY || !process.stdin.setRawMode) {
    throw new Error('Execute este comando em um terminal interativo para proteger a senha mestre.');
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
          cleanup(); process.stdout.write('\n'); reject(new Error('Operação cancelada.')); return;
        }
        if (character === '\r' || character === '\n') {
          cleanup(); process.stdout.write('\n'); resolve(value); return;
        }
        if (character === '\u007f' || character === '\b') {
          if (value.length) { value = value.slice(0, -1); process.stdout.write('\b \b'); }
        } else if (character >= ' ') {
          value += character; process.stdout.write('*');
        }
      }
    };
    stdin.on('data', onData);
  });
}

async function main() {
  const password = await readHidden('Nova senha mestre do cofre (mínimo 12 caracteres): ');
  const confirmation = await readHidden('Confirme a senha mestre: ');
  if (password !== confirmation) throw new Error('As senhas não coincidem.');
  const hash = await hashMasterPassword(password);
  console.log('\nCopie somente o hash abaixo para CREDENTIALS_MASTER_PASSWORD_HASH no backend:');
  console.log(hash);
  console.log('\nA senha mestre não foi salva. Guarde-a em um gerenciador seguro e limpe o histórico do terminal se necessário.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Falha ao configurar a senha mestre.');
  process.exitCode = 1;
});
