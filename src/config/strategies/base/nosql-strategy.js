// nosql-strategy.js
const { ERROR_MESSAGES } = require("../../../core/constants");

const DatabaseStrategy = require("./database-strategy");

class NoSQLStrategy extends DatabaseStrategy {
  constructor() {
    super();
  }

  async getCollections(_dbName) {
    throw new Error(ERROR_MESSAGES.NOT_IMPLEMENTED("getCollections"));
  }

  async getCollectionInfo(_dbName, _collectionName) {
    throw new Error(ERROR_MESSAGES.NOT_IMPLEMENTED("getCollectionInfo"));
  }

  // NoSQL specific query execution
  async executeQuery(query, options = {}) {
    return super.executeQuery(query, options);
  }
}

module.exports = NoSQLStrategy;
