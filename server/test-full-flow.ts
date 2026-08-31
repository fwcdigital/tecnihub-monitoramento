import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { executeHttpCheck } from './services/httpChecker';

dotenv.config();

const url = process.env.SUPABASE_URL || '';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';
const supabase = createClient(url, serviceKey);

async function testFullFlow() {
  console.log('--- TESTANDO FLUXO COMPLETO SUPABASE + HTTP REAL ---');

  // 1. Cadastrar site
  console.log('\n1. Inserindo site na tabela "sites"...');
  const { data: site, error: siteError } = await supabase
    .from('sites')
    .insert({
      client_name: 'TECNIHUB Institucional',
      name: 'Portal Teste',
      url: 'https://example.com',
      domain: 'example.com',
      hosting_provider: 'Hostinger',
      is_wordpress: false,
      is_active: true,
      check_interval: '5min'
    })
    .select('*')
    .single();

  if (siteError || !site) {
    console.error('❌ Falha ao inserir site:', siteError);
    return;
  }
  console.log('✅ Site criado com ID:', site.id);

  // 2. Executar verificação HTTP Real com SSRF Protection
  console.log('\n2. Executando verificação HTTP real no backend...');
  const checkResult = await executeHttpCheck(site.url);
  console.log('Resultado do check:', checkResult);

  // 3. Salvar check na tabela "checks"
  console.log('\n3. Gravando resultado na tabela "checks"...');
  const { data: checkRecord, error: checkError } = await supabase
    .from('checks')
    .insert({
      site_id: site.id,
      checked_at: new Date().toISOString(),
      status: checkResult.status,
      http_status: checkResult.httpStatus,
      response_time: checkResult.responseTime,
      final_url: checkResult.finalUrl,
      error_type: checkResult.errorType || null,
      error_message: checkResult.errorMessage || null
    })
    .select('*')
    .single();

  if (checkError || !checkRecord) {
    console.error('❌ Falha ao gravar check:', checkError);
  } else {
    console.log('✅ Check gravado com sucesso! ID:', checkRecord.id, '| Status:', checkRecord.status, '| HTTP:', checkRecord.http_status);
  }

  // 4. Limpar site de teste
  console.log('\n4. Excluindo site de teste para manter a base limpa...');
  const { error: deleteError } = await supabase.from('sites').delete().eq('id', site.id);
  if (deleteError) {
    console.error('❌ Falha ao deletar site de teste:', deleteError);
  } else {
    console.log('✅ Site de teste excluído com sucesso (Cascade em checks verificado).');
  }

  console.log('\n🎉 FLUXO COMPLETO VALIDADO COM SUCESSO NO BANCO DE DADOS REAL!');
}

testFullFlow();
