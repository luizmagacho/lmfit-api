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
import {
  DEMO_SEED_SENTINEL_NOTES,
  Customers as demoCustomers,
  Invoices as demoInvoices,
  Orders as demoOrders,
  Purchases as demoPurchases,
  Suppliers as demoSuppliers,
  type PurchaseFixture as DemoPurchaseFixture,
  type PurchaseLineFixture as DemoPurchaseLineFixture,
} from './lmfit-demo.fixtures';

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
  ) {}

  async onModuleInit(): Promise<void> {
    const email =
      this.config.get<string>('SEED_ADMIN_EMAIL') ?? 'admin@lmfit.local';
    const password =
      this.config.get<string>('SEED_ADMIN_PASSWORD') ?? 'ChangeMe123!';
    await this.users.seedAdminIfEmpty(email, password, 'Administrator');
    await this.users.migrateLegacyRoles();
    const count = await this.users.count(undefined);
    if (count === 1) {
      this.log.log(
        `Seeded admin user ${email} (change password in production).`,
      );
    }

    if (!this.isDemoSeedEnabled()) return;

    const sentinel = await this.supplierModel
      .findOne({ notes: DEMO_SEED_SENTINEL_NOTES })
      .lean()
      .exec();
    if (sentinel) return;

    await this.seedLmfitDemo(email);
  }

  private isDemoSeedEnabled(): boolean {
    const v = this.config.get<string>('SEED_DEMO_DATA')?.trim().toLowerCase();
    return v === 'true' || v === '1';
  }

  private async seedLmfitDemo(adminEmail: string): Promise<void> {
    /* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- demo insertMany */
    const admin = await this.users.findByEmail(undefined, adminEmail);
    const createdBy = admin?._id ? new Types.ObjectId(admin._id) : undefined;
    const createdByStr = createdBy?.toString();
    const tenantId = admin?.tenantId;

    if (!tenantId) {
      this.log.warn('Could not resolve seed tenantId. Skipping demo data seed.');
      return;
    }

    const suppliers = await this.supplierModel.insertMany(
      demoSuppliers.map((s) => ({ ...s, createdBy, tenantId })),
    );
    const supplierIds = suppliers.map((d) => d._id);

    const customers = await this.customerModel.insertMany(
      demoCustomers.map((c) => ({ ...c, createdBy, tenantId })),
    );
    const customerIds = customers.map((d) => d._id);

    const product = await this.productModel.create({
      name: 'Catálogo LMFIT Principal',
      slug: 'lmfit-catalogo-seed',
      active: true,
      tenantId,
    });
    const variant = await this.variantModel.create({
      productId: product._id,
      sku: 'LMFIT-DEMO-SEED-STOCK',
      price: 1,
      quantityOnHand: 100_000,
      reorderPoint: 0,
      tenantId,
    });
    const variantIdStr = String(variant._id);

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
        status: p.status,
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

    this.log.log(
      `Seeded LMFIT demo: ${suppliers.length} suppliers, ${customers.length} customers, ${orderIds.length} orders, ${purchases.length} purchases, ${demoInvoices.length} invoices.`,
    );
    /* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
  }
}
