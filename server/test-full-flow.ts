import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { processSiteCheck } from './services/siteCheckService';

dotenv.config();

const url = process.env.SUPABASE_URL || '';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
if (!url || !serviceKey) {
  throw new Error('Este teste manual exige SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no backend.');
}
const supabase = createClient(url, serviceKey);

async function testFullFlow() {
  console.log('--- TESTANDO FLUXO COMPLETO SUPABASE + HTTP REAL ---');
  const siteId = process.argv[2];
  if (!siteId) {
    throw new Error('Informe o ID de um site existente: tsx server/test-full-flow.ts <site-id>');
  }

  console.log('\n1. Executando o motor central para o site informado...');
  const processed = await processSiteCheck({ siteId }, { supabase });
  console.log('✅ Check real persistido pelo motor central:', {
    checkId: processed.checkId,
    siteId: processed.siteId,
    status: processed.result.status,
    httpStatus: processed.result.httpStatus,
    incidentTransition: processed.incidentTransition
  });
  console.log('\n🎉 FLUXO VALIDADO SEM CRIAR SITE TEMPORÁRIO NEM APAGAR HISTÓRICO.');
}

testFullFlow();
