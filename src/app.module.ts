import { join } from 'path';
import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ThrottlerModule } from '@nestjs/throttler';
import { SentryGlobalFilter, SentryModule } from '@sentry/nestjs/setup';
import { AlertsModule } from './alerts/alerts.module';
import { AppController } from './app.controller';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { CatalogModule } from './catalog/catalog.module';
import { ChatModule } from './chat/chat.module';
import { ExcelModule } from './common/excel/excel.module';
import { FiscalModule } from './fiscal/fiscal.module';
import { CustomersModule } from './customers/customers.module';
import { CustomerAuthModule } from './customer-auth/customer-auth.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { LeadsModule } from './leads/leads.module';
import { LoyaltyModule } from './loyalty/loyalty.module';
import { InvoicesModule } from './invoices/invoices.module';
import { JwtRegisteredModule } from './jwt/jwt-registered.module';
import { LocationsModule } from './locations/locations.module';
import { NotificationsModule } from './notifications/notifications.module';
import { EncryptionModule } from './common/encryption.module';
import { OrderDraftsModule } from './order-drafts/order-drafts.module';
import { OrdersModule } from './orders/orders.module';
import { ProductsModule } from './products/products.module';
import { PurchasesModule } from './purchases/purchases.module';
import { PromotionsModule } from './promotions/promotions.module';
import { InfluencersModule } from './influencers/influencers.module';
import { ReportsModule } from './reports/reports.module';
import { ReturnsModule } from './returns/returns.module';
import { ReviewsModule } from './reviews/reviews.module';
import { SeedModule } from './seed/seed.module';
import { SuppliersModule } from './suppliers/suppliers.module';
import { UsersModule } from './users/users.module';
import { WhatsappModule } from './whatsapp/whatsapp.module';
import { CashflowModule } from './cashflow/cashflow.module';
import { ProductionModule } from './production/production.module';
import { MaterialsModule } from './materials/materials.module';
import { BillingModule } from './billing/billing.module';
import { TenantsModule } from './tenants/tenants.module';
import { TenantSubscriptionGuard } from './common/guards/tenant-subscription.guard';
import { TenantThrottlerGuard } from './common/guards/tenant-throttler.guard';
import { TenantMiddleware } from './common/middleware/tenant.middleware';
import { SentryContextInterceptor } from './common/interceptors/sentry-context.interceptor';

@Module({
  imports: [
    SentryModule.forRoot(),
    ConfigModule.forRoot({ isGlobal: true }),
    EventEmitterModule.forRoot(),
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
    AuditModule,
    ExcelModule,
    JwtRegisteredModule,
    NotificationsModule,
    EncryptionModule,
    UsersModule,
    SeedModule,
    AuthModule,
    CustomersModule,
    CustomerAuthModule,
    SuppliersModule,
    OrdersModule,
    ReturnsModule,
    ReviewsModule,
    PromotionsModule,
    InfluencersModule,
    PurchasesModule,
    InvoicesModule,
    ProductsModule,
    LocationsModule,
    AlertsModule,
    ReportsModule,
    FiscalModule,
    CatalogModule,
    ChatModule,
    OrderDraftsModule,
    WhatsappModule,
    CashflowModule,
    ProductionModule,
    MaterialsModule,
    BillingModule,
    TenantsModule,
    IntegrationsModule,
    LeadsModule,
    LoyaltyModule,
  ],
  controllers: [AppController],
  providers: [
    {
      provide: APP_FILTER,
      useClass: SentryGlobalFilter,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: SentryContextInterceptor,
    },
    {
      provide: APP_GUARD,
      useClass: TenantThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: TenantSubscriptionGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(TenantMiddleware)
      .forRoutes('*');
  }
}
