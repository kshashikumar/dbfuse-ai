// db_strategies/mongodb-strategy.js
const { ERROR_MESSAGES } = require("../../core/constants");

const NoSQLStrategy = require("./base/nosql-strategy");

class MongoDBStrategy extends NoSQLStrategy {
  constructor() {
    super();
  }

  async connect(config) {
    // Placeholder for MongoDB connection logic
    // const { MongoClient } = require('mongodb');
    // this.client = new MongoClient(config.url);
    // await this.client.connect();
    // logger.info("MongoDB connection not yet implemented");
  }

  async disconnect() {
    if (this.client) {
      await this.client.close();
    }
  }

  async validateConnection() {
    // return !!this.client;
    return false;
  }

  async getCollections(dbName) {
    // return this.client.db(dbName).listCollections().toArray();
    throw new Error(ERROR_MESSAGES.NOT_IMPLEMENTED("getCollections"));
  }
}

module.exports = MongoDBStrategy;
