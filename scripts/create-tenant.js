const mongoose = require('mongoose');
const argon2 = require('argon2');

async function run() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/lmfit';
  await mongoose.connect(uri);

  const slug = process.argv[2];
  const name = process.argv[3];
  const email = process.argv[4] || `admin@${slug}.local`;
  const password = process.argv[5] || 'ChangeMe123!';

  if (!slug || !name) {
    console.log('Uso: node scripts/create-tenant.js <slug> <nome_da_loja> [email_admin] [senha_admin]');
    process.exit(1);
  }

  try {
    const slugLower = slug.toLowerCase();
    
    const db = mongoose.connection.db;
    const tenantsCol = db.collection('tenants');
    const usersCol = db.collection('users');

    const existingTenant = await tenantsCol.findOne({ slug: slugLower });
    if (existingTenant) {
      console.log(`Erro: Tenant com o slug '${slugLower}' já existe!`);
      process.exit(1);
    }

    console.log(`Criando loja '${name}' (${slugLower})...`);
    
    // 1. Create Tenant
    const tenantId = new mongoose.Types.ObjectId();
    await tenantsCol.insertOne({
      _id: tenantId,
      slug: slugLower,
      name,
      active: true,
      branding: {
        primaryColor: '#7c3aed',
        secondaryColor: '#06b6d4',
        darkMode: false
      },
      plan: 'pro',
      featuresOverride: [],
      limits: {
        maxProducts: -1,
        maxUsers: 10
      },
      createdAt: new Date(),
      updatedAt: new Date()
    });

    // 2. Create Admin User
    const userId = new mongoose.Types.ObjectId();
    const passwordHash = await argon2.hash(password);
    await usersCol.insertOne({
      _id: userId,
      tenantId,
      email: email.toLowerCase(),
      passwordHash,
      name: `Admin ${name}`,
      role: 'admin',
      createdAt: new Date(),
      updatedAt: new Date()
    });

    // 3. Link owner
    await tenantsCol.updateOne(
      { _id: tenantId },
      { $set: { ownerUserId: userId } }
    );

    console.log(`\n🎉 Loja de teste criada com sucesso!`);
    console.log(`-----------------------------------`);
    console.log(`Slug: ${slugLower}`);
    console.log(`Nome: ${name}`);
    console.log(`E-mail do Admin: ${email}`);
    console.log(`Senha do Admin: ${password}`);
    console.log(`-----------------------------------`);
    console.log(`Para acessar, faça login local em http://localhost:3001/login`);
    
  } catch (error) {
    console.error('Erro ao criar loja:', error);
  } finally {
    await mongoose.disconnect();
  }
}

run();
