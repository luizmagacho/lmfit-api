import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Customer } from '../customers/schemas/customer.schema';
import { Invoice } from '../invoices/schemas/invoice.schema';
import type { CreateOrderDto } from '../orders/dto/create-order.dto';
import { OrdersService, type OrderResponse } from '../orders/orders.service';
import { Product } from '../products/schemas/product.schema';
import { ProductVariant } from '../products/schemas/product-variant.schema';
import { Purchase } from '../purchases/schemas/purchase.schema';
import { Supplier } from '../suppliers/schemas/supplier.schema';
import { UsersService } from '../users/users.service';
import { ProductionBatch } from '../production/schemas/production-batch.schema';
import {
  DEMO_SEED_SENTINEL_NOTES,
  Customers as demoCustomers,
  Invoices as demoInvoices,
  Orders as demoOrders,
  Purchases as demoPurchases,
  Suppliers as demoSuppliers,
  type PurchaseFixture as DemoPurchaseFixture,
  type PurchaseLineFixture as DemoPurchaseLineFixture,
} from './kivoni-demo.fixtures';

@Injectable()
export class SeedService implements OnModuleInit {
  private readonly log = new Logger(SeedService.name);

  constructor(
    private readonly users: UsersService,
    private readonly config: ConfigService,
    private readonly orders: OrdersService,
    @InjectModel(Customer.name) private readonly customerModel: Model<Customer>,
    @InjectModel(Supplier.name) private readonly supplierModel: Model<Supplier>,
    @InjectModel(Purchase.name) private readonly purchaseModel: Model<Purchase>,
    @InjectModel(Invoice.name) private readonly invoiceModel: Model<Invoice>,
    @InjectModel(Product.name) private readonly productModel: Model<Product>,
    @InjectModel(ProductVariant.name)
    private readonly variantModel: Model<ProductVariant>,
    @InjectModel(ProductionBatch.name)
    private readonly batchModel: Model<ProductionBatch>,
  ) {}

  async onModuleInit(): Promise<void> {
    const email = this.config.get<string>('SEED_ADMIN_EMAIL');
    const password = this.config.get<string>('SEED_ADMIN_PASSWORD');
    const isProd = this.config.get<string>('NODE_ENV') === 'production';
    if (isProd && (!email || !password)) {
      // Em produção o admin de seed com senha padrão é um risco de segurança:
      // só semeia se as credenciais forem definidas explicitamente no ambiente.
      this.log.warn(
        'SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD ausentes em produção — seed de admin ignorado.',
      );
    } else {
      await this.users.seedAdminIfEmpty(
        email ?? 'admin@lmfit.local',
        password ?? 'ChangeMe123!',
        'Administrator',
      );
    }
    await this.users.migrateLegacyRoles();

    if (!this.isDemoSeedEnabled()) return;

    // Seed tenants and their demo data
    const tenantModel = this.supplierModel.db.model('Tenant');
    const isProduction = this.config.get<string>('NODE_ENV') === 'production';
    
    const tenantsToSeed = isProduction
      ? [
          {
            slug: 'kivoni',
            name: 'Kivoni Store',
            adminEmail: 'admin@kivoni.local',
            branding: {
              logoUrl: '/kivoni-logo.png',
              faviconUrl: '/kivoni-logo.png',
              primaryColor: '#7c3aed',
              secondaryColor: '#06b6d4',
              darkMode: false,
            }
          }
        ]
      : [
          {
            slug: 'kivoni',
            name: 'Kivoni Store',
            adminEmail: 'admin@kivoni.local',
            branding: {
              logoUrl: '/kivoni-logo.png',
              faviconUrl: '/kivoni-logo.png',
              primaryColor: '#7c3aed',
              secondaryColor: '#06b6d4',
              darkMode: false,
            }
          },
          {
            slug: 'testekivo',
            name: 'Teste Kivo',
            adminEmail: 'admin@testekivo.local',
            branding: {
              primaryColor: '#7c3aed',
              secondaryColor: '#06b6d4',
              darkMode: false,
            }
          },
          {
            slug: 'modafran',
            name: 'Moda Fran',
            adminEmail: 'admin@modafran.local',
            branding: {
              primaryColor: '#7c3aed',
              secondaryColor: '#06b6d4',
              darkMode: false,
            }
          }
        ];

    for (const item of tenantsToSeed) {
      let tenant = await tenantModel.findOne({ slug: item.slug }).exec();
      if (!tenant) {
        tenant = await tenantModel.create({
          slug: item.slug,
          name: item.name,
          active: true,
          plan: 'enterprise',
          branding: item.branding,
        });
      }

      let admin = await this.users.findByEmail(tenant._id.toString(), item.adminEmail);
      if (!admin) {
        await this.users.create(tenant._id.toString(), {
          email: item.adminEmail,
          password: 'ChangeMe123!',
          name: 'Administrator',
          role: 'admin',
        });
        admin = await this.users.findByEmail(tenant._id.toString(), item.adminEmail);
      }

      const sentinel = await this.supplierModel
        .findOne({ tenantId: tenant._id, notes: DEMO_SEED_SENTINEL_NOTES })
        .lean()
        .exec();

      if (!sentinel && admin) {
        await this.seedTenantDemo(tenant._id, admin, item.slug);
      }
    }
  }

  private isDemoSeedEnabled(): boolean {
    const v = this.config.get<string>('SEED_DEMO_DATA')?.trim().toLowerCase();
    return v === 'true' || v === '1';
  }

  private async seedTenantDemo(
    tenantId: Types.ObjectId,
    admin: any,
    slug: string
  ): Promise<void> {
    /* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- demo insertMany */
    const createdBy = admin?._id ? new Types.ObjectId(admin._id) : undefined;
    const createdByStr = createdBy?.toString();

    // 1. Seed Suppliers
    const suppliers = await this.supplierModel.insertMany(
      demoSuppliers.map((s) => ({ ...s, createdBy, tenantId })),
    );
    const supplierIds = suppliers.map((d) => d._id);

    // 2. Seed Customers
    const customers = await this.customerModel.insertMany(
      demoCustomers.map((c) => ({ ...c, createdBy, tenantId })),
    );
    const customerIds = customers.map((d) => d._id);

    // 3. Seed Product & Variant
    const prodName = `Catálogo ${slug.toUpperCase()} Principal`;
    const product = await this.productModel.create({
      name: prodName,
      slug: `${slug}-catalogo-seed`,
      active: true,
      tenantId,
    });
    const variant = await this.variantModel.create({
      productId: product._id,
      sku: `${slug.toUpperCase()}-DEMO-SEED-STOCK`,
      price: 100, // cost 100 BRL to see nice totals
      quantityOnHand: 100_000,
      reorderPoint: 10,
      tenantId,
    });
    const variantIdStr = String(variant._id);

    // 4. Seed Orders
    const orderIds: Types.ObjectId[] = [];
    for (const o of demoOrders) {
      const orderPayload: CreateOrderDto = {
        customerId: String(customerIds[o.customerIndex]),
        channel: o.channel ?? 'online',
        status: o.status,
        reference: o.reference,
        notes: o.notes,
        lines: [
          {
            variantId: variantIdStr,
            quantity: 1,
            unitPrice: o.total,
          },
        ],
      };
      const created: OrderResponse = await this.orders.create(
        tenantId.toString(),
        orderPayload,
        createdByStr,
      );
      orderIds.push(new Types.ObjectId(String(created._id)));
    }

    // 5. Seed Purchases
    type PurchaseLineSeed = {
      variantId: Types.ObjectId;
      quantityOrdered: number;
      quantityReceived: number;
    };
    const purchaseRows = demoPurchases.map((p: DemoPurchaseFixture) => {
      const lines: PurchaseLineSeed[] = [];
      const rawLines: DemoPurchaseLineFixture[] = p.lines ?? [];
      for (const l of rawLines) {
        lines.push({
          variantId: variant._id,
          quantityOrdered: l.quantityOrdered,
          quantityReceived: l.quantityReceived ?? 0,
        });
      }
      return {
        supplierId: supplierIds[p.supplierIndex],
        status: p.status === 'pending' ? 'interest' : (p.status as any),
        reference: p.reference,
        total: p.total,
        notes: p.notes,
        lines,
        createdBy,
        tenantId,
      };
    });
    const purchases = await this.purchaseModel.insertMany(purchaseRows);
    const purchaseIds = purchases.map((d) => d._id);

    // 6. Seed Invoices
    await this.invoiceModel.insertMany(
      demoInvoices.map((inv) => ({
        number: inv.number,
        status: inv.status,
        amount: inv.amount,
        notes: inv.notes,
        dueDate: inv.dueDate
          ? new Date(inv.dueDate)
          : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        orderId:
          inv.orderIndex !== undefined ? orderIds[inv.orderIndex] : undefined,
        purchaseId:
          inv.purchaseIndex !== undefined
            ? purchaseIds[inv.purchaseIndex]
            : undefined,
        createdBy,
        tenantId,
      })),
    );

    // 7. Seed Production Batches
    await this.batchModel.create([
      {
        tenantId,
        name: `Lote ${slug.toUpperCase()} Legging Fitness`,
        sku: `${slug.toUpperCase()}-DEMO-SEED-STOCK`,
        batchQty: 200,
        status: 'Pronto',
        inputs: [
          {
            description: 'Tecido Suplex Poliamida',
            inputType: 'fabric',
            unit: 'kg',
            quantity: 35,
            unitPrice: 60,
            totalCost: 2100,
          },
          {
            description: 'Elástico de Cós',
            inputType: 'elastic',
            unit: 'm',
            quantity: 150,
            unitPrice: 2,
            totalCost: 300,
          }
        ],
        cuttingCost: 300,
        sewingCost: 800,
        totalInputsCost: 2400,
        totalBatchCost: 3500,
        costPerUnit: 17.5,
        suggestedPrice: 43.75,
        targetMarginPercent: 60,
        notes: 'Lote de teste inicial para validação de produção.',
        dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
      {
        tenantId,
        name: `Lote ${slug.toUpperCase()} Top Fitness Cropped`,
        sku: `${slug.toUpperCase()}-DEMO-SEED-STOCK`,
        batchQty: 150,
        status: 'Costura',
        inputs: [
          {
            description: 'Tecido Suplex Poliamida',
            inputType: 'fabric',
            unit: 'kg',
            quantity: 20,
            unitPrice: 60,
            totalCost: 1200,
          }
        ],
        cuttingCost: 200,
        sewingCost: 600,
        totalInputsCost: 1200,
        totalBatchCost: 2000,
        costPerUnit: 13.33,
        suggestedPrice: 33.33,
        targetMarginPercent: 60,
        notes: 'Fase de costura em andamento.',
        dueDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
      }
    ]);

    this.log.log(
      `Seeded ${slug.toUpperCase()} demo: ${suppliers.length} suppliers, ${customers.length} customers, ${orderIds.length} orders, ${purchases.length} purchases, ${demoInvoices.length} invoices, 2 production batches.`,
    );
    /* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
  }
}
