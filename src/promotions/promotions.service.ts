import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { skipFromPage } from '../common/dto/pagination-query.dto';
import { CreatePromotionDto } from './dto/create-promotion.dto';
import { UpdatePromotionDto } from './dto/update-promotion.dto';
import { Promotion } from './schemas/promotion.schema';

@Injectable()
export class PromotionsService {
  constructor(
    @InjectModel(Promotion.name) private readonly model: Model<Promotion>,
  ) {}

  async create(tenantId: string, dto: CreatePromotionDto, createdBy?: string) {
    const code = dto.code.trim().toUpperCase();
    const exists = await this.model
      .findOne({ tenantId: new Types.ObjectId(tenantId), code })
      .lean()
      .exec();
    if (exists) throw new BadRequestException(`Já existe um cupom com o código ${code}`);
    // `influencerId` chega como string do form (o ResourceList do admin manda "" pra "sem
    // influenciador") — string vazia quebraria o cast automático do Mongoose pra ObjectId.
    const influencerId = dto.influencerId?.trim();
    return this.model.create({
      ...dto,
      code,
      tenantId: new Types.ObjectId(tenantId),
      createdBy: createdBy ? new Types.ObjectId(createdBy) : undefined,
      influencerId: influencerId ? new Types.ObjectId(influencerId) : undefined,
    });
  }

  async findAll(tenantId: string, page: number, limit: number) {
    const skip = skipFromPage(page, limit);
    const filter = { tenantId: new Types.ObjectId(tenantId) };
    const [items, total] = await Promise.all([
      this.model.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean().exec(),
      this.model.countDocuments(filter).exec(),
    ]);
    return { items, total, page, limit };
  }

  async findOne(tenantId: string, id: string) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException();
    const doc = await this.model
      .findOne({ _id: id, tenantId: new Types.ObjectId(tenantId) })
      .lean()
      .exec();
    if (!doc) throw new NotFoundException();
    return doc;
  }

  async update(tenantId: string, id: string, dto: UpdatePromotionDto) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException();
    const patch: Record<string, unknown> = { ...dto };
    if (dto.code) patch.code = dto.code.trim().toUpperCase();

    // `$set: {influencerId: undefined}` NÃO remove o campo no MongoDB — precisa de `$unset`
    // explícito quando o admin escolhe "— Nenhum —" (string vazia) pra desvincular o cupom.
    const updateOps: Record<string, unknown> = { $set: patch };
    if (dto.influencerId !== undefined) {
      const trimmed = dto.influencerId.trim();
      delete patch.influencerId;
      if (trimmed) {
        patch.influencerId = new Types.ObjectId(trimmed);
      } else {
        updateOps.$unset = { influencerId: '' };
      }
    }

    const doc = await this.model
      .findOneAndUpdate({ _id: id, tenantId: new Types.ObjectId(tenantId) }, updateOps, { new: true })
      .exec();
    if (!doc) throw new NotFoundException();
    return doc;
  }

  /** Recusa excluir um cupom que já teve uso (`usedCount > 0`) — protege o histórico do relatório
   *  de vendas por influenciador (Loop Influencer-C). Desativar (`active:false`) via `update()`
   *  continua disponível normalmente. */
  async remove(tenantId: string, id: string) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException();
    const promo = await this.model
      .findOne({ _id: id, tenantId: new Types.ObjectId(tenantId) })
      .lean()
      .exec();
    if (!promo) throw new NotFoundException();
    if (promo.usedCount > 0) {
      throw new BadRequestException(
        'Este cupom já foi usado em vendas — desative em vez de excluir, pra não perder o histórico do relatório.',
      );
    }
    const res = await this.model
      .findOneAndDelete({ _id: id, tenantId: new Types.ObjectId(tenantId) })
      .exec();
    if (!res) throw new NotFoundException();
    return { deleted: true };
  }

  /**
   * Valida o cupom contra o subtotal do carrinho e retorna o desconto calculado.
   * Nunca confia em desconto vindo do client — sempre recalcula aqui a partir
   * da regra cadastrada (mesma disciplina do preço de atacado em order-drafts).
   */
  async validateAndComputeDiscount(
    tenantId: string,
    code: string,
    subtotal: number,
  ): Promise<{ promotion: Promotion & { _id: Types.ObjectId }; discountAmount: number }> {
    const normalized = code.trim().toUpperCase();
    const promo = await this.model
      .findOne({ tenantId: new Types.ObjectId(tenantId), code: normalized })
      .exec();
    if (!promo) throw new BadRequestException(`Cupom ${normalized} não encontrado`);
    if (!promo.active) throw new BadRequestException(`Cupom ${normalized} está inativo`);

    const now = new Date();
    if (promo.validFrom && now < promo.validFrom) {
      throw new BadRequestException(`Cupom ${normalized} ainda não é válido`);
    }
    if (promo.validUntil && now > promo.validUntil) {
      throw new BadRequestException(`Cupom ${normalized} expirou`);
    }
    if (promo.maxUses !== undefined && promo.usedCount >= promo.maxUses) {
      throw new BadRequestException(`Cupom ${normalized} atingiu o limite de usos`);
    }
    if (promo.minSubtotal !== undefined && subtotal < promo.minSubtotal) {
      throw new BadRequestException(
        `Cupom ${normalized} exige subtotal mínimo de R$ ${promo.minSubtotal.toFixed(2)}`,
      );
    }

    const discountAmount =
      promo.type === 'percent' ? (subtotal * promo.value) / 100 : Math.min(promo.value, subtotal);

    return {
      promotion: promo.toObject() as Promotion & { _id: Types.ObjectId },
      discountAmount: Math.round(discountAmount * 100) / 100,
    };
  }

  /**
   * Confirma o uso do cupom de forma atômica — chamar só no submit final, nunca em
   * patch de carrinho. Guarda contra corrida: dois submits concorrentes no último
   * uso disponível não podem ambos passar (mesmo padrão do decremento de estoque).
   */
  async redeem(tenantId: string, code: string): Promise<void> {
    const normalized = code.trim().toUpperCase();
    const updated = await this.model
      .findOneAndUpdate(
        {
          tenantId: new Types.ObjectId(tenantId),
          code: normalized,
          active: true,
          $or: [
            { maxUses: { $exists: false } },
            { maxUses: null },
            { $expr: { $lt: ['$usedCount', '$maxUses'] } },
          ],
        },
        { $inc: { usedCount: 1 } },
      )
      .exec();
    if (!updated) {
      throw new BadRequestException(
        `Cupom ${normalized} não pôde ser confirmado (limite de uso atingido ou cupom desativado)`,
      );
    }
  }
}
