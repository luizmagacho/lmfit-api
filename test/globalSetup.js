// Loop 26 — sobe um Mongo em memória ANTES de qualquer teste .e2e-spec.ts ser carregado. Deliberadamente
// JS puro (não .ts): Jest exige `require()` esse arquivo sem passar pelo pipeline de `transform`
// configurado em jest-e2e.json, então TypeScript aqui não seria compilado.
//
// `MongooseModule.forRoot(process.env.MONGODB_URI ?? …)` (src/app.module.ts) lê a env var no
// momento em que o módulo é avaliado — setar `process.env.MONGODB_URI` aqui, em globalSetup,
// garante que já está no ambiente quando os arquivos de teste (rodando em processos-filho que
// herdam o `process.env` do processo principal do Jest) importam o AppModule.
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env.test') });
const { MongoMemoryServer } = require('mongodb-memory-server');

module.exports = async () => {
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri('kivoni-e2e');
  // globalSetup e globalTeardown rodam no MESMO processo principal do Jest (não em workers), em
  // sequência — uma global aqui continua visível quando globalTeardown.js roda depois.
  global.__MONGOD__ = mongod;
};
