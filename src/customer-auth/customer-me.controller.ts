import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { CustomerAuthGuard } from './customer-auth.guard';
import { CurrentCustomer } from './current-customer.decorator';
import { CustomerAuthService } from './customer-auth.service';
import { CustomersService } from '../customers/customers.service';
import { OrdersService } from '../orders/orders.service';
import { ReturnsService } from '../returns/returns.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { ProductsService } from '../products/products.service';
import { ReviewsService } from '../reviews/reviews.service';
import { UpdateCustomerProfileDto } from './dto/update-customer-profile.dto';
import { RequestEmailChangeDto } from './dto/request-email-change.dto';
import { CreateAddressDto, UpdateAddressDto } from './dto/address.dto';
import { CustomerReturnRequestDto } from '../returns/dto/create-return.dto';
import { RedeemPointsDto } from '../loyalty/dto/redeem-points.dto';
import { WishlistItemDto } from './dto/wishlist-item.dto';
import { CreateReviewDto } from '../reviews/dto/create-review.dto';
import type { CustomerJwtPayload } from './customer-jwt.payload';

@ApiTags('me')
@ApiBearerAuth()
@UseGuards(CustomerAuthGuard)
@Controller('me')
export class CustomerMeController {
  constructor(
    private readonly customerAuth: CustomerAuthService,
    private readonly customers: CustomersService,
    private readonly orders: OrdersService,
    private readonly returns: ReturnsService,
    private readonly loyalty: LoyaltyService,
    private readonly products: ProductsService,
    private readonly reviews: ReviewsService,
  ) {}

  @Get('profile')
  profile(@CurrentCustomer() customer: CustomerJwtPayload, @TenantId() tenantId: string) {
    return this.customerAuth.me(tenantId, customer.sub);
  }

  @Patch('profile')
  updateProfile(
    @Body() dto: UpdateCustomerProfileDto,
    @CurrentCustomer() customer: CustomerJwtPayload,
    @TenantId() tenantId: string,
  ) {
    return this.customers.update(tenantId, customer.sub, dto);
  }

  // Mesmo limite de `request-link` (Loop 10) — dispara e-mail real, mesmo alvo de abuso.
  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  @Post('email-change/request')
  requestEmailChange(
    @Body() dto: RequestEmailChangeDto,
    @CurrentCustomer() customer: CustomerJwtPayload,
    @TenantId() tenantId: string,
  ) {
    return this.customerAuth.requestEmailChange(tenantId, customer.sub, dto.newEmail, dto.redirectBase);
  }

  @Get('orders')
  orders_(
    @Query() q: PaginationQueryDto,
    @CurrentCustomer() customer: CustomerJwtPayload,
    @TenantId() tenantId: string,
  ) {
    return this.orders.findAllForCustomer(tenantId, customer.sub, q.page, q.limit);
  }

  @Get('addresses')
  listAddresses(@CurrentCustomer() customer: CustomerJwtPayload, @TenantId() tenantId: string) {
    return this.customers.listAddresses(tenantId, customer.sub);
  }

  @Post('addresses')
  addAddress(
    @Body() dto: CreateAddressDto,
    @CurrentCustomer() customer: CustomerJwtPayload,
    @TenantId() tenantId: string,
  ) {
    return this.customers.addAddress(tenantId, customer.sub, dto);
  }

  @Patch('addresses/:addressId')
  updateAddress(
    @Param('addressId') addressId: string,
    @Body() dto: UpdateAddressDto,
    @CurrentCustomer() customer: CustomerJwtPayload,
    @TenantId() tenantId: string,
  ) {
    return this.customers.updateAddress(tenantId, customer.sub, addressId, dto);
  }

  @Delete('addresses/:addressId')
  removeAddress(
    @Param('addressId') addressId: string,
    @CurrentCustomer() customer: CustomerJwtPayload,
    @TenantId() tenantId: string,
  ) {
    return this.customers.removeAddress(tenantId, customer.sub, addressId);
  }

  @Post('returns')
  requestReturn(
    @Body() dto: CustomerReturnRequestDto,
    @CurrentCustomer() customer: CustomerJwtPayload,
    @TenantId() tenantId: string,
  ) {
    return this.returns.requestFromCustomer(tenantId, customer.sub, dto.orderId, dto);
  }

  @Get('returns')
  listReturns(@CurrentCustomer() customer: CustomerJwtPayload, @TenantId() tenantId: string) {
    return this.returns.findAllForCustomer(tenantId, customer.sub);
  }

  @Post('loyalty/redeem')
  redeemLoyalty(
    @Body() dto: RedeemPointsDto,
    @CurrentCustomer() customer: CustomerJwtPayload,
    @TenantId() tenantId: string,
  ) {
    return this.loyalty.redeem(tenantId, customer.sub, dto.points);
  }

  @Get('wishlist')
  async getWishlist(@CurrentCustomer() customer: CustomerJwtPayload, @TenantId() tenantId: string) {
    const ids = await this.customers.getWishlistProductIds(tenantId, customer.sub);
    return { items: await this.products.getPublicProductsByIds(tenantId, ids) };
  }

  @Post('wishlist')
  async addToWishlist(
    @Body() dto: WishlistItemDto,
    @CurrentCustomer() customer: CustomerJwtPayload,
    @TenantId() tenantId: string,
  ) {
    const ids = await this.customers.addToWishlist(tenantId, customer.sub, dto.productId);
    return { items: await this.products.getPublicProductsByIds(tenantId, ids) };
  }

  @Delete('wishlist/:productId')
  async removeFromWishlist(
    @Param('productId') productId: string,
    @CurrentCustomer() customer: CustomerJwtPayload,
    @TenantId() tenantId: string,
  ) {
    const ids = await this.customers.removeFromWishlist(tenantId, customer.sub, productId);
    return { items: await this.products.getPublicProductsByIds(tenantId, ids) };
  }

  @Post('reviews')
  createReview(
    @Body() dto: CreateReviewDto,
    @CurrentCustomer() customer: CustomerJwtPayload,
    @TenantId() tenantId: string,
  ) {
    return this.reviews.createFromCustomer(tenantId, customer.sub, dto);
  }

  @Get('reviews')
  listOwnReviews(@CurrentCustomer() customer: CustomerJwtPayload, @TenantId() tenantId: string) {
    return this.reviews.listOwnForCustomer(tenantId, customer.sub);
  }
}
