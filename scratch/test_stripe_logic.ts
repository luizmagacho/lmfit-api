import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Tenant } from '../src/tenants/schemas/tenant.schema';

async function bootstrap() {
  console.log('🔄 Iniciando teste de suspensão do Stripe...');
  
  const app = await NestFactory.create(AppModule);
  await app.listen(4001);
  console.log('✅ Servidor de teste rodando na porta 4001');

  const tenantModel = app.get<Model<Tenant>>(getModelToken(Tenant.name));
  
  let tenant = await tenantModel.findOne().exec();
  if (!tenant) {
    tenant = await tenantModel.create({
      name: 'Loja de Teste',
      slug: 'loja-teste',
      stripeSubscriptionStatus: 'active',
      plan: 'free'
    });
  }

  const tenantId = tenant._id.toString();
  console.log(`\n👨‍💼 Usando Tenant ID: ${tenantId}`);

  // Teste 1: Assinatura Ativa
  console.log('\n--- 🟢 TESTE 1: Assinatura Ativa ---');
  await tenantModel.findByIdAndUpdate(tenantId, { stripeSubscriptionStatus: 'active', plan: 'pro' });
  try {
    const res = await fetch(`http://localhost:4001/reports/sales-today`, {
      headers: { 'x-tenant-id': tenantId }
    });
    console.log(`[SUCESSO] Status HTTP: ${res.status} (Acesso Permitido)`);
  } catch (err: any) {
    console.log(`[ERRO] ${err.message}`);
  }

  // Teste 2: Inadimplente
  console.log('\n--- 🔴 TESTE 2: Assinatura Atrasada (past_due) ---');
  await tenantModel.findByIdAndUpdate(tenantId, { stripeSubscriptionStatus: 'past_due' });
  try {
    const res = await fetch(`http://localhost:4001/reports/sales-today`, {
      headers: { 'x-tenant-id': tenantId }
    });
    const body = await res.json();
    console.log(`[SUCESSO BLOQUEIO] Status HTTP: ${res.status} - ${body.message}`);
  } catch (err: any) {
    console.log(`[ERRO] ${err.message}`);
  }

  // Teste 3: Rota Pública/Exceção (mesmo inadimplente)
  console.log('\n--- 🔵 TESTE 3: Rota Pública (Meu Plano) mesmo inadimplente ---');
  try {
    const res = await fetch(`http://localhost:4001/billing/my-plan`, {
      headers: { 'x-tenant-id': tenantId }
    });
    console.log(`[SUCESSO] Status HTTP: ${res.status} (Acesso Permitido à tela Meu Plano)`);
  } catch (err: any) {
    console.log(`[ERRO] ${err.message}`);
  }

  await app.close();
  console.log('\n✅ Teste finalizado e servidor encerrado.');
}

bootstrap().catch(console.error);
