// sql-strategy.js
const { ERROR_MESSAGES } = require("../../../core/constants");

const DatabaseStrategy = require("./database-strategy");

class SQLStrategy extends DatabaseStrategy {
  constructor() {
    super();
  }

  // Abstract methods specific to SQL
  async getTables(_dbName) {
    throw new Error(ERROR_MESSAGES.NOT_IMPLEMENTED("getTables"));
  }

  async getViews(_dbName) {
    throw new Error(ERROR_MESSAGES.NOT_IMPLEMENTED("getViews"));
  }

  async getProcedures(_dbName) {
    throw new Error(ERROR_MESSAGES.NOT_IMPLEMENTED("getProcedures"));
  }
}

module.exports = SQLStrategy;
