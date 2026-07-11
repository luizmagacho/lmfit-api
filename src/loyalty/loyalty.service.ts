import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Customer } from '../customers/schemas/customer.schema';
import { Tenant } from '../tenants/schemas/tenant.schema';

@Injectable()
export class LoyaltyService {
  constructor(
    @InjectModel(Customer.name) private readonly customerModel: Model<Customer>,
    @InjectModel(Tenant.name) private readonly tenantModel: Model<Tenant>,
  ) {}

  /** Credita pontos ao completar um pedido. Silenciosamente ignora se o tenant não habilitou fidelidade. */
  async creditForOrder(tenantId: string, customerId: Types.ObjectId, orderTotal: number): Promise<void> {
    const tenant = await this.tenantModel.findById(tenantId).lean().exec();
    if (!tenant?.loyalty?.enabled) return;
    const points = Math.floor(orderTotal * (tenant.loyalty.pointsPerBRL ?? 1));
    if (points <= 0) return;
    await this.customerModel
      .findOneAndUpdate(
        { _id: customerId, tenantId: new Types.ObjectId(tenantId) },
        { $inc: { loyaltyPoints: points } },
      )
      .exec();
  }

  /** Converte pontos em crédito de loja. Atômico — evita resgate duplo em corrida. */
  async redeem(tenantId: string, customerId: string, points: number) {
    if (!Types.ObjectId.isValid(customerId)) throw new NotFoundException();
    const tenant = await this.tenantModel.findById(tenantId).lean().exec();
    if (!tenant?.loyalty?.enabled) {
      throw new BadRequestException('Fidelidade não está habilitada para este tenant');
    }
    const creditValue = points * (tenant.loyalty.redeemValuePerPoint ?? 0.01);
    const updated = await this.customerModel
      .findOneAndUpdate(
        {
          _id: customerId,
          tenantId: new Types.ObjectId(tenantId),
          loyaltyPoints: { $gte: points },
        },
        { $inc: { loyaltyPoints: -points, storeCreditBalance: creditValue } },
        { new: true },
      )
      .exec();
    if (!updated) {
      const exists = await this.customerModel
        .findOne({ _id: customerId, tenantId: new Types.ObjectId(tenantId) })
        .lean()
        .exec();
      if (!exists) throw new NotFoundException();
      throw new BadRequestException('Saldo de pontos insuficiente para o resgate');
    }
    return updated;
  }
}
