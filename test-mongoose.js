const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  inputs: [{
    description: { type: String, required: true, trim: true }
  }]
});
const Model = mongoose.model('Test', schema);
const doc = new Model({ inputs: [{ description: "" }] });
const err = doc.validateSync();
console.log(err ? err.message : "Success");
