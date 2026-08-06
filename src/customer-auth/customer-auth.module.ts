import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { MongooseModule } from '@nestjs/mongoose';
import { CustomersModule } from '../customers/customers.module';
import { OrdersModule } from '../orders/orders.module';
import { ReturnsModule } from '../returns/returns.module';
import { TenantsModule } from '../tenants/tenants.module';
import { LoyaltyModule } from '../loyalty/loyalty.module';
import { ProductsModule } from '../products/products.module';
import { ReviewsModule } from '../reviews/reviews.module';
import { MagicLinkToken, MagicLinkTokenSchema } from './schemas/magic-link-token.schema';
import {
  CustomerRefreshToken,
  CustomerRefreshTokenSchema,
} from './schemas/customer-refresh-token.schema';
import { CustomerJwtStrategy } from './customer-jwt.strategy';
import { CustomerAuthGuard } from './customer-auth.guard';
import { CustomerAuthService } from './customer-auth.service';
import { PublicCustomerAuthController } from './public-customer-auth.controller';
import { CustomerMeController } from './customer-me.controller';

@Module({
  imports: [
    ConfigModule,
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        ({
          secret: config.getOrThrow<string>('JWT_CUSTOMER_ACCESS_SECRET'),
          signOptions: {
            expiresIn: config.get<string>('JWT_CUSTOMER_ACCESS_EXPIRES') ?? '30m',
          },
        }) as import('@nestjs/jwt').JwtModuleOptions,
    }),
    MongooseModule.forFeature([
      { name: MagicLinkToken.name, schema: MagicLinkTokenSchema },
      { name: CustomerRefreshToken.name, schema: CustomerRefreshTokenSchema },
    ]),
    CustomersModule,
    OrdersModule,
    ReturnsModule,
    TenantsModule,
    LoyaltyModule,
    ProductsModule,
    ReviewsModule,
  ],
  controllers: [PublicCustomerAuthController, CustomerMeController],
  providers: [CustomerJwtStrategy, CustomerAuthGuard, CustomerAuthService],
  exports: [CustomerAuthService],
})
export class CustomerAuthModule {}
