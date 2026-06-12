import { join } from 'path';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AlertsModule } from './alerts/alerts.module';
import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { CatalogModule } from './catalog/catalog.module';
import { ExcelModule } from './common/excel/excel.module';
import { CustomersModule } from './customers/customers.module';
import { InvoicesModule } from './invoices/invoices.module';
import { JwtRegisteredModule } from './jwt/jwt-registered.module';
import { NotificationsModule } from './notifications/notifications.module';
import { OrderDraftsModule } from './order-drafts/order-drafts.module';
import { OrdersModule } from './orders/orders.module';
import { ProductsModule } from './products/products.module';
import { PurchasesModule } from './purchases/purchases.module';
import { ReportsModule } from './reports/reports.module';
import { SeedModule } from './seed/seed.module';
import { SuppliersModule } from './suppliers/suppliers.module';
import { UsersModule } from './users/users.module';
import { WhatsappModule } from './whatsapp/whatsapp.module';
import { CashflowModule } from './cashflow/cashflow.module';
import { ProductionModule } from './production/production.module';
import { MaterialsModule } from './materials/materials.module';
import { BillingModule } from './billing/billing.module';
import { TenantSubscriptionGuard } from './common/guards/tenant-subscription.guard';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'uploads'),
      serveRoot: '/uploads',
      serveStaticOptions: { index: false },
    }),
    ThrottlerModule.forRoot([
      { name: 'default', ttl: 60_000, limit: 120 },
    ]),
    MongooseModule.forRoot(process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/lmfit'),
    ExcelModule,
    JwtRegisteredModule,
    NotificationsModule,
    UsersModule,
    SeedModule,
    AuthModule,
    CustomersModule,
    SuppliersModule,
    OrdersModule,
    PurchasesModule,
    InvoicesModule,
    ProductsModule,
    AlertsModule,
    ReportsModule,
    CatalogModule,
    OrderDraftsModule,
    WhatsappModule,
    CashflowModule,
    ProductionModule,
    MaterialsModule,
    BillingModule,
  ],
  controllers: [AppController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: TenantSubscriptionGuard,
    },
  ],
})
export class AppModule {}
