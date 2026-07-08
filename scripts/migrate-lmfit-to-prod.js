#!/usr/bin/env node
/**
 * Migração dos dados LMFit para a estrutura multi-tenant.
 *
 * O que faz:
 *   1. Garante que o tenant `lmfit` existe no banco de destino com plano
 *      enterprise, branding e limites ilimitados (upsert idempotente).
 *   2. Para cada coleção com dados de negócio, carimba `tenantId` (do tenant
 *      lmfit) em todo documento que ainda não tem tenantId.
 *      - Modo in-place (padrão): SOURCE == TARGET, só faz o backfill.
 *      - Modo cópia: TARGET_URI diferente — copia docs do SOURCE para o TARGET
 *        carimbando tenantId; pula _ids que já existem no destino (idempotente).
 *   3. Relatório por coleção: total / sem tenantId / carimbados / pulados / erros.
 *
 * NUNCA deleta nada e NUNCA altera outros tenants.
 *
 * ⚠️ PADRÃO É DRY-RUN: sem a flag --apply nada é gravado.
 *
 * Uso:
 *   # 1. Dry-run contra o Atlas (só relatório, zero escrita):
 *   SOURCE_URI='mongodb+srv://...' node scripts/migrate-lmfit-to-prod.js
 *
 *   # 2. Recomendado antes do apply: snapshot/dump
 *   #    mongodump --uri="$SOURCE_URI" --out=backup-$(date +%Y%m%d)
 *
 *   # 3. Aplicar de verdade:
 *   SOURCE_URI='mongodb+srv://...' node scripts/migrate-lmfit-to-prod.js --apply
 *
 *   # Cópia entre clusters (ex.: Atlas -> outro cluster):
 *   SOURCE_URI='...' TARGET_URI='...' node scripts/migrate-lmfit-to-prod.js [--apply]
 */

const { MongoClient, ObjectId } = require('mongodb');

const SOURCE_URI = process.env.SOURCE_URI;
const TARGET_URI = process.env.TARGET_URI || SOURCE_URI;
const APPLY = process.argv.includes('--apply');

// Coleções que carregam dados de negócio por tenant. Coleções desconhecidas
// encontradas no banco são reportadas mas não tocadas.
const TENANT_COLLECTIONS = [
  'users',
  'customers',
  'suppliers',
  'products',
  'productvariants',
  'materials',
  'purchases',
  'invoices',
  'orders',
  'orderdrafts',
  'payments',
  'cashflowentries',
  'productionbatches',
  'integrations',
  'productmappings',
  'synclogs',
  'whatsappmessages',
  'whatsappsenders',
  'categories',
  'stockledgers',
  'lowstockalerts',
];

// Coleções globais/sistema que NÃO devem receber tenantId.
// refreshtokens: sessões — expiram sozinhas; usuários fazem login de novo.
const SKIP_COLLECTIONS = new Set(['tenants', 'tenantrequests', 'refreshtokens', 'system.views']);

const LMFIT_TENANT = {
  slug: 'lmfit',
  name: 'LMFit Store',
  active: true,
  plan: 'enterprise',
  featuresOverride: [],
  limits: { maxProducts: -1, maxUsers: -1 },
  branding: {
    logoUrl:
      'https://d1a9qnv764bsoo.cloudfront.net/stores/006/316/201/themes/common/logo-813858800-1750428827-d18edfd75754df23704c77cbd129bbc91750428827-1024-1024.webp?w=1400',
    faviconUrl:
      'https://d1a9qnv764bsoo.cloudfront.net/stores/006/316/201/themes/common/logo-813858800-1750428827-d18edfd75754df23704c77cbd129bbc91750428827-1024-1024.webp?w=1400',
    primaryColor: '#ff6800',
    secondaryColor: '#000000',
    darkMode: false,
  },
};

function fmt(n) {
  return String(n).padStart(7);
}

async function main() {
  if (!SOURCE_URI) {
    console.error('Defina SOURCE_URI (connection string do banco de origem).');
    console.error("Ex.: SOURCE_URI='mongodb+srv://user:pass@cluster/db' node scripts/migrate-lmfit-to-prod.js");
    process.exit(1);
  }

  const mode = SOURCE_URI === TARGET_URI ? 'in-place (backfill)' : 'cópia entre clusters';
  console.log(`\n=== Migração LMFit — modo ${mode} — ${APPLY ? '⚠️  APPLY (vai gravar!)' : 'DRY-RUN (nada será gravado)'} ===\n`);

  const sourceClient = new MongoClient(SOURCE_URI);
  await sourceClient.connect();
  const source = sourceClient.db();
  console.log(`Origem : ${source.databaseName}`);

  let targetClient = sourceClient;
  let target = source;
  if (TARGET_URI !== SOURCE_URI) {
    targetClient = new MongoClient(TARGET_URI);
    await targetClient.connect();
    target = targetClient.db();
  }
  console.log(`Destino: ${target.databaseName}\n`);

  // ── 1. Tenant lmfit no destino ────────────────────────────────────────────
  const tenantsCol = target.collection('tenants');
  let tenant = await tenantsCol.findOne({ slug: 'lmfit' });
  if (tenant) {
    console.log(`Tenant lmfit já existe (_id=${tenant._id}, plan=${tenant.plan}).`);
    if (tenant.plan !== 'enterprise' || tenant.active !== true) {
      if (APPLY) {
        await tenantsCol.updateOne(
          { _id: tenant._id },
          { $set: { plan: 'enterprise', active: true, 'limits.maxProducts': -1, 'limits.maxUsers': -1, updatedAt: new Date() } },
        );
        console.log('  → plano atualizado para enterprise + ativo.');
      } else {
        console.log('  → DRY-RUN: atualizaria plano para enterprise + ativo.');
      }
    }
  } else {
    if (APPLY) {
      const now = new Date();
      const res = await tenantsCol.insertOne({ ...LMFIT_TENANT, createdAt: now, updatedAt: now });
      tenant = await tenantsCol.findOne({ _id: res.insertedId });
      console.log(`Tenant lmfit criado (_id=${tenant._id}, plan=enterprise).`);
    } else {
      console.log('DRY-RUN: criaria o tenant lmfit (plan=enterprise).');
      // Para o dry-run seguir com contagens, usa um id fictício.
      tenant = { _id: new ObjectId('000000000000000000000000') };
    }
  }
  const tenantId = tenant._id;

  // ── 2. Coleções ───────────────────────────────────────────────────────────
  const sourceCollections = (await source.listCollections().toArray())
    .map((c) => c.name)
    .filter((n) => !n.startsWith('system.'));

  const unknown = sourceCollections.filter(
    (n) => !TENANT_COLLECTIONS.includes(n) && !SKIP_COLLECTIONS.has(n),
  );

  const crossCluster = TARGET_URI !== SOURCE_URI;
  console.log(`\n${'Coleção'.padEnd(24)} ${fmt('total')} ${fmt('sem tid')} ${fmt(APPLY ? 'gravado' : 'gravaria')} ${fmt('pulado')} ${fmt('erro')}`);
  console.log('─'.repeat(24 + 4 * 8 + 8));

  const summary = [];
  for (const name of TENANT_COLLECTIONS) {
    if (!sourceCollections.includes(name)) continue;
    const src = source.collection(name);
    const total = await src.countDocuments();
    const missing = await src.countDocuments({ tenantId: { $exists: false } });
    let written = 0;
    let skipped = 0;
    let errors = 0;

    if (crossCluster) {
      // Copia TODOS os docs (com e sem tenantId; os sem recebem o do lmfit)
      const dst = target.collection(name);
      const cursor = src.find({});
      for await (const doc of cursor) {
        const withTenant = doc.tenantId ? doc : { ...doc, tenantId };
        if (!APPLY) {
          written++;
          continue;
        }
        try {
          await dst.insertOne(withTenant);
          written++;
        } catch (e) {
          if (e.code === 11000) skipped++; // _id já existe no destino
          else {
            errors++;
            if (errors <= 3) console.error(`  [${name}] erro: ${e.message}`);
          }
        }
      }
    } else if (missing > 0) {
      if (APPLY) {
        try {
          const res = await src.updateMany(
            { tenantId: { $exists: false } },
            { $set: { tenantId } },
          );
          written = res.modifiedCount;
        } catch (e) {
          errors++;
          console.error(`  [${name}] erro: ${e.message}`);
        }
      } else {
        written = missing; // "gravaria"
      }
    }

    console.log(`${name.padEnd(24)} ${fmt(total)} ${fmt(missing)} ${fmt(written)} ${fmt(skipped)} ${fmt(errors)}`);
    summary.push({ name, total, missing, written, skipped, errors });
  }

  if (unknown.length) {
    console.log(`\n⚠ Coleções não mapeadas (NÃO tocadas): ${unknown.join(', ')}`);
    console.log('  Se alguma tiver dados por tenant, adicione em TENANT_COLLECTIONS e rode de novo.');
  }

  const totalErrors = summary.reduce((s, r) => s + r.errors, 0);
  const totalWritten = summary.reduce((s, r) => s + r.written, 0);
  console.log(`\n${APPLY ? 'Gravados' : 'Seriam gravados'}: ${totalWritten} doc(s) · Erros: ${totalErrors}`);
  if (!APPLY) {
    console.log('\nNada foi alterado (dry-run). Para aplicar:');
    console.log('  1. Faça um snapshot/mongodump do banco;');
    console.log('  2. Rode novamente com --apply.');
  }

  await sourceClient.close();
  if (targetClient !== sourceClient) await targetClient.close();
  process.exit(totalErrors ? 1 : 0);
}

main().catch((e) => {
  console.error('Erro fatal:', e);
  process.exit(1);
});
