import * as fs from 'fs';

const filePath = 'src/purchases/purchases.service.ts';
let code = fs.readFileSync(filePath, 'utf8');

// Add adjustStock method
const adjustStockFn = `
  private async adjustStock(doc: Purchase, multiplier: number) {
    if (!doc.lines?.length) return;
    for (const line of doc.lines) {
      const qty = (line.quantityReceived || 0) * multiplier;
      if (qty === 0) continue;
      if (line.variantId) {
        await this.variantModel.updateOne(
          { _id: line.variantId },
          { $inc: { quantityOnHand: qty } }
        ).exec();
      } else if (line.materialId) {
        await this.materialModel.updateOne(
          { _id: line.materialId },
          { $inc: { quantityOnHand: qty } }
        ).exec();
      }
    }
  }
`;

// Insert adjustStock before update()
code = code.replace(/async update\(/, adjustStockFn + '\  async update(');

// Update create()
code = code.replace(/return this\.model\.create\(\{([\s\S]*?)\}\);/, `const doc = await this.model.create({$1});
    if (doc.status === 'received') {
      await this.adjustStock(doc, 1);
    }
    return doc;`);

// Update update()
code = code.replace(/const doc = await this\.model\n      \.findByIdAndUpdate\(id, payload, \{ new: true \}\)\n      \.lean\(\)\n      \.exec\(\);\n    if \(\!doc\) throw new NotFoundException\(\);\n    return doc;/, 
`const oldDoc = await this.model.findById(id).lean().exec();
    if (!oldDoc) throw new NotFoundException();
    if (oldDoc.status === 'received') {
      await this.adjustStock(oldDoc as any, -1);
    }
    
    const doc = await this.model.findByIdAndUpdate(id, payload, { new: true }).lean().exec();
    if (!doc) throw new NotFoundException();
    
    if (doc.status === 'received') {
      await this.adjustStock(doc as any, 1);
    }
    return doc;`);

// Update remove()
code = code.replace(/const res = await this\.model\.findByIdAndDelete\(id\)\.exec\(\);/,
`const oldDoc = await this.model.findById(id).lean().exec();
    if (oldDoc && oldDoc.status === 'received') {
      await this.adjustStock(oldDoc as any, -1);
    }
    const res = await this.model.findByIdAndDelete(id).exec();`);

fs.writeFileSync(filePath, code);
