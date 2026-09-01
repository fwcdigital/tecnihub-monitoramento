import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const url = process.env.SUPABASE_URL || '';
const anonKey = process.env.SUPABASE_ANON_KEY || '';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

console.log('--- TESTANDO CONEXÃO DETALHADA COM O SUPABASE ---');
console.log('URL:', url);

async function testWithKey(label: string, key: string) {
  if (!key) {
    console.log(`\n${label}: não configurada.`);
    return;
  }
  console.log(`\nTestando com ${label}:`);
  const client = createClient(url, key);
  
  const resSites = await client.from('sites').select('*').limit(1);
  console.log('Status tabela sites:', resSites.error ? resSites.error.message : '✅ Sucesso! Total retornado: ' + resSites.data?.length);

  const resChecks = await client.from('checks').select('*').limit(1);
  console.log('Status tabela checks:', resChecks.error ? resChecks.error.message : '✅ Sucesso! Total retornado: ' + resChecks.data?.length);

  const resIncidents = await client.from('incidents').select('*').limit(1);
  console.log('Status tabela incidents:', resIncidents.error ? resIncidents.error.message : '✅ Sucesso! Total retornado: ' + resIncidents.data?.length);
}

async function run() {
  await testWithKey('ANON KEY', anonKey);
  if (serviceRoleKey && serviceRoleKey !== anonKey) {
    await testWithKey('SERVICE ROLE KEY', serviceRoleKey);
  }
}

run();
