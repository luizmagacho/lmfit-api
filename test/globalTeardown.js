// Loop 26 — companion of globalSetup.js. Plain JS for the same require()-without-transform reason.
module.exports = async () => {
  if (global.__MONGOD__) {
    await global.__MONGOD__.stop();
  }
};
