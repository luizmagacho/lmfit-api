import * as fs from 'fs';

const filePath = 'src/production/production.service.ts';
let code = fs.readFileSync(filePath, 'utf8');

// Add import
code = code.replace(/import { skipFromPage } from '\.\.\/common\/dto\/pagination-query\.dto';/, 
`import { skipFromPage } from '../common/dto/pagination-query.dto';\nimport { ProductVariant } from '../products/schemas/product-variant.schema';`);

// Update constructor
code = code.replace(/constructor\(\n    @InjectModel\(ProductionBatch\.name\)\n    private readonly model: Model<ProductionBatch>,\n  \) \{\}/, 
`constructor(
    @InjectModel(ProductionBatch.name)
    private readonly model: Model<ProductionBatch>,
    @InjectModel(ProductVariant.name)
    private readonly variantModel: Model<ProductVariant>,
  ) {}`);

// Add adjustStock method
const adjustStockFn = `
  private async adjustStock(doc: ProductionBatch, multiplier: number) {
    if (!doc.sku || !doc.batchQty) return;
    const qty = doc.batchQty * multiplier;
    if (qty === 0) return;
    await this.variantModel.updateOne(
      { sku: doc.sku },
      { $inc: { quantityOnHand: qty } }
    ).exec();
  }
`;

// Insert adjustStock before computeCosts
code = code.replace(/private computeCosts/, adjustStockFn + '\n  private computeCosts');

// Update create()
code = code.replace(/return this\.model\.create\(\{([\s\S]*?)\}\);/, `const doc = await this.model.create({$1});
    if (doc.status === 'Concluído' || doc.status === 'Pronto') {
      await this.adjustStock(doc as any, 1);
    }
    return doc;`);

// Update update()
code = code.replace(/const doc = await this\.model\n      \.findByIdAndUpdate\(id, payload, \{ new: true \}\)\n      \.lean\(\)\n      \.exec\(\);\n    if \(\!doc\) throw new NotFoundException\(\);\n    return doc;/, 
`const oldDoc = await this.model.findById(id).lean().exec();
    if (!oldDoc) throw new NotFoundException('Lote de produção não encontrado');
    if (oldDoc.status === 'Concluído' || oldDoc.status === 'Pronto') {
      await this.adjustStock(oldDoc as any, -1);
    }

    const doc = await this.model.findByIdAndUpdate(id, payload, { new: true }).lean().exec();
    if (!doc) throw new NotFoundException();

    if (doc.status === 'Concluído' || doc.status === 'Pronto') {
      await this.adjustStock(doc as any, 1);
    }
    return doc;`);

// Update remove()
code = code.replace(/const res = await this\.model\.findByIdAndDelete\(id\)\.exec\(\);/,
`const oldDoc = await this.model.findById(id).lean().exec();
    if (oldDoc && (oldDoc.status === 'Concluído' || oldDoc.status === 'Pronto')) {
      await this.adjustStock(oldDoc as any, -1);
    }
    const res = await this.model.findByIdAndDelete(id).exec();`);

fs.writeFileSync(filePath, code);
