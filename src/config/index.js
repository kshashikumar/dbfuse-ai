const ConnectionManager = require("./connection-manager");
const connectionStore = require("./connection-store");
const databaseContext = require("./database-context");
const { createStrategy } = require("./create-strategy");

const connectionManager = new ConnectionManager();

module.exports = {
  ConnectionManager,
  connectionManager,
  connectionStore,
  databaseContext,
  createStrategy,
};
