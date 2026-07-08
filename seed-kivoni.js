const { MongoClient, ObjectId } = require('mongodb');
require('dotenv').config();

async function run() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/kivoni';
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db();
    
    const tenantId = new ObjectId('6a285e5fc18fde8e8710301a'); // kivoni tenant

    console.log("Seeding data for Kivoni...");

    await db.collection('suppliers').deleteMany({ tenantId, tags: 'esportes' });
    await db.collection('categories').deleteMany({ tenantId, slug: { $in: ['camisas-nacionais', 'camisas-internacionais', 'retro', 'selecoes'] } });
    await db.collection('products').deleteMany({ tenantId, tags: 'futebol' });
    await db.collection('productvariants').deleteMany({ tenantId, sku: { $regex: /^FUT-/ } });
    await db.collection('customers').deleteMany({ tenantId, phone: { $regex: /^1199999999/ } });

    // 1. Suppliers
    const suppliersData = [
      { _id: new ObjectId(), tenantId, name: 'Nike', status: 'active', tags: ['fornecedor', 'esportes'], createdAt: new Date(), updatedAt: new Date() },
      { _id: new ObjectId(), tenantId, name: 'Adidas', status: 'active', tags: ['fornecedor', 'esportes'], createdAt: new Date(), updatedAt: new Date() },
      { _id: new ObjectId(), tenantId, name: 'Puma', status: 'active', tags: ['fornecedor', 'esportes'], createdAt: new Date(), updatedAt: new Date() },
      { _id: new ObjectId(), tenantId, name: 'Umbro', status: 'active', tags: ['fornecedor', 'esportes'], createdAt: new Date(), updatedAt: new Date() }
    ];
    await db.collection('suppliers').insertMany(suppliersData);

    // 2. Categories
    const categoriesData = [
      { _id: new ObjectId(), tenantId, name: 'Camisas Nacionais', slug: 'camisas-nacionais', active: true, createdAt: new Date(), updatedAt: new Date() },
      { _id: new ObjectId(), tenantId, name: 'Camisas Internacionais', slug: 'camisas-internacionais', active: true, createdAt: new Date(), updatedAt: new Date() },
      { _id: new ObjectId(), tenantId, name: 'Retrô', slug: 'retro', active: true, createdAt: new Date(), updatedAt: new Date() },
      { _id: new ObjectId(), tenantId, name: 'Seleções', slug: 'selecoes', active: true, createdAt: new Date(), updatedAt: new Date() }
    ];
    await db.collection('categories').insertMany(categoriesData);

    // 3. Products
    const productsBase = [
      { name: 'Camisa Flamengo I 2024', cat: categoriesData[0]._id, sup: suppliersData[1]._id },
      { name: 'Camisa Real Madrid I 2024', cat: categoriesData[1]._id, sup: suppliersData[1]._id },
      { name: 'Camisa Seleção Brasileira I 2024', cat: categoriesData[3]._id, sup: suppliersData[0]._id },
      { name: 'Camisa Milan Retrô 2007', cat: categoriesData[2]._id, sup: suppliersData[1]._id },
      { name: 'Camisa Palmeiras I 2024', cat: categoriesData[0]._id, sup: suppliersData[2]._id },
      { name: 'Camisa Manchester City I 2024', cat: categoriesData[1]._id, sup: suppliersData[2]._id },
      { name: 'Camisa Fluminense I 2024', cat: categoriesData[0]._id, sup: suppliersData[3]._id },
      { name: 'Camisa Barcelona I 2024', cat: categoriesData[1]._id, sup: suppliersData[0]._id },
      { name: 'Camisa São Paulo I 2024', cat: categoriesData[0]._id, sup: suppliersData[2]._id },
      { name: 'Camisa Seleção Argentina I 2024', cat: categoriesData[3]._id, sup: suppliersData[1]._id }
    ];

    const products = [];
    const variants = [];
    const sizes = ['P', 'M', 'G', 'GG'];

    for (let i = 0; i < productsBase.length; i++) {
      const p = productsBase[i];
      const prodId = new ObjectId();
      const slug = p.name.toLowerCase().replace(/ /g, '-').normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const shortCode = p.name.split(' ').map(w => w[0]).join('').toUpperCase() + Math.floor(Math.random()*1000);
      
      products.push({
        _id: prodId,
        tenantId,
        name: p.name,
        slug: slug,
        categoryId: p.cat,
        supplierId: p.sup,
        status: 'active',
        active: true,
        visibility: 'both',
        description: `A ${p.name} é perfeita para mostrar seu amor pelo time! Tecido respirável e tecnologia avançada.`,
        tags: ['futebol', 'camisa'],
        createdAt: new Date(),
        updatedAt: new Date()
      });

      sizes.forEach(size => {
        variants.push({
          _id: new ObjectId(),
          tenantId,
          productId: prodId,
          sku: `FUT-${shortCode}-${size}`,
          color: 'Padrão',
          size: size,
          cost: 90,
          price: 299.9,
          wholesalePrice: 180,
          minimumWholesaleQuantity: 5,
          stock: Math.floor(Math.random() * 40) + 5,
          active: true,
          createdAt: new Date(),
          updatedAt: new Date()
        });
      });
    }

    await db.collection('products').insertMany(products);
    await db.collection('productvariants').insertMany(variants);

    // 5. Customers
    const customersData = [
      { _id: new ObjectId(), tenantId, name: 'Luiz Fernando', phone: '11999999991', customerType: 'retail', createdAt: new Date(), updatedAt: new Date() },
      { _id: new ObjectId(), tenantId, name: 'João Silva', phone: '11999999992', customerType: 'retail', createdAt: new Date(), updatedAt: new Date() },
      { _id: new ObjectId(), tenantId, name: 'Maria Souza', phone: '11999999993', customerType: 'wholesale', createdAt: new Date(), updatedAt: new Date() },
      { _id: new ObjectId(), tenantId, name: 'Carlos Eduardo', phone: '11999999994', customerType: 'retail', createdAt: new Date(), updatedAt: new Date() },
      { _id: new ObjectId(), tenantId, name: 'Ana Oliveira', phone: '11999999995', customerType: 'retail', createdAt: new Date(), updatedAt: new Date() }
    ];
    await db.collection('customers').insertMany(customersData);

    // 6. Orders
    const orders = [];
    const statuses = ['completed', 'completed', 'completed', 'shipped', 'open'];
    
    for (let i = 0; i < 15; i++) {
      const orderVariants = [];
      const numLines = Math.floor(Math.random() * 3) + 1;
      let total = 0;
      
      for (let j = 0; j < numLines; j++) {
        const v = variants[Math.floor(Math.random() * variants.length)];
        const qty = Math.floor(Math.random() * 2) + 1;
        orderVariants.push({
          variantId: v._id,
          quantity: qty,
          unitPrice: v.price
        });
        total += qty * v.price;
      }

      const cust = customersData[Math.floor(Math.random() * customersData.length)];
      const stat = statuses[Math.floor(Math.random() * statuses.length)];

      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - Math.floor(Math.random() * 30));

      orders.push({
        _id: new ObjectId(),
        tenantId,
        customerId: cust._id,
        channel: 'online',
        status: stat,
        total: total,
        totalCost: orderVariants.reduce((sum, line) => sum + (line.quantity * 90), 0),
        lines: orderVariants,
        createdAt: pastDate,
        updatedAt: pastDate
      });
    }

    await db.collection('orders').insertMany(orders);

    console.log("ALL DONE!");

  } catch (err) {
    console.error(err);
  } finally {
    await client.close();
  }
}
run().catch(console.error);
