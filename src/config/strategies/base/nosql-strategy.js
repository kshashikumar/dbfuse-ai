// nosql-strategy.js
const { ERROR_MESSAGES } = require("../../../core/constants");

const DatabaseStrategy = require("./database-strategy");

class NoSQLStrategy extends DatabaseStrategy {
  constructor() {
    super();
  }

  // Override generic structure method
  async getStructure() {
    return this.getCollections();
  }

  async getCollections(dbName) {
    throw new Error(ERROR_MESSAGES.NOT_IMPLEMENTED("getCollections"));
  }

  async getCollectionInfo(dbName, collectionName) {
    throw new Error(ERROR_MESSAGES.NOT_IMPLEMENTED("getCollectionInfo"));
  }

  // NoSQL specific query execution
  async executeQuery(query, options = {}) {
    // NoSQL might not use string queries in the same way, but we can support JSON-like queries or specific command objects
    throw new Error(ERROR_MESSAGES.NOT_IMPLEMENTED("executeQuery"));
  }
}

module.exports = NoSQLStrategy;
