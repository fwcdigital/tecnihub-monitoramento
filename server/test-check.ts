import { validateUrlForSSRF } from './services/ssrfProtection';
import { executeHttpCheck } from './services/httpChecker';

async function runTests() {
  console.log('--- INICIANDO TESTES DO MOTOR DE MONITORAMENTO HTTP E SSRF ---');

  // Teste 1: SSRF - Localhost
  console.log('\n[Teste 1] SSRF com localhost:');
  const ssrfLocalhost = await validateUrlForSSRF('http://localhost:3000');
  console.log('Resultado:', ssrfLocalhost);
  if (!ssrfLocalhost.valid && ssrfLocalhost.error?.includes('segurança')) {
    console.log('✅ PASSOU: Localhost bloqueado com sucesso.');
  } else {
    console.error('❌ FALHOU: Localhost não foi bloqueado.');
  }

  // Teste 2: SSRF - IP Privado 192.168.1.1
  console.log('\n[Teste 2] SSRF com IP privado 192.168.1.1:');
  const ssrfPrivateIp = await validateUrlForSSRF('http://192.168.1.1');
  console.log('Resultado:', ssrfPrivateIp);
  if (!ssrfPrivateIp.valid) {
    console.log('✅ PASSOU: IP privado bloqueado com sucesso.');
  } else {
    console.error('❌ FALHOU: IP privado não foi bloqueado.');
  }

  // Teste 3: SSRF - Metadata Endpoint 169.254.169.254
  console.log('\n[Teste 3] SSRF com Link-Local / Cloud Metadata:');
  const ssrfMetadata = await validateUrlForSSRF('http://169.254.169.254/latest/meta-data/');
  console.log('Resultado:', ssrfMetadata);
  if (!ssrfMetadata.valid) {
    console.log('✅ PASSOU: Cloud metadata bloqueado com sucesso.');
  } else {
    console.error('❌ FALHOU: Metadata não foi bloqueado.');
  }

  // Teste 4: SSRF - Protocolo inválido (ex: file:// / ftp://)
  console.log('\n[Teste 4] SSRF com protocolo inválido ftp://:');
  const ssrfFtp = await validateUrlForSSRF('ftp://example.com');
  console.log('Resultado:', ssrfFtp);
  if (!ssrfFtp.valid) {
    console.log('✅ PASSOU: Protocolo inválido rejeitado com sucesso.');
  } else {
    console.error('❌ FALHOU: Protocolo ftp:// foi aceito indevidamente.');
  }

  // Teste 5: Requisição HTTP Real para site público
  console.log('\n[Teste 5] Requisição HTTP Real para https://example.com:');
  const checkResult = await executeHttpCheck('https://example.com');
  console.log('Resultado:', checkResult);
  if (checkResult.status === 'online' && checkResult.httpStatus === 200 && checkResult.responseTime > 0) {
    console.log(`✅ PASSOU: Site verificado com sucesso! Status: ${checkResult.status} | HTTP: ${checkResult.httpStatus} | Tempo: ${checkResult.responseTime}ms`);
  } else {
    console.error('❌ FALHOU:', checkResult);
  }

  console.log('\n--- TODOS OS TESTES CONCLUÍDOS ---');
}

runTests().catch(console.error);
