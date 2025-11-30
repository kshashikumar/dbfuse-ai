// sql-strategy.js
const { ERROR_MESSAGES } = require("../../../core/constants");

const DatabaseStrategy = require("./database-strategy");

class SQLStrategy extends DatabaseStrategy {
  constructor() {
    super();
  }

  // Common implementation for SQL databases
  async getStructure() {
    if (!this.currentDatabase) {
      // If no current database is set/tracked, we might need to rely on the connection's default
      // But usually switchDatabase sets this.currentDatabase
    }
    // Return tables as the default structure
    return this.getTables(this.currentDatabase);
  }

  // Abstract methods specific to SQL
  async getTables(dbName) {
    throw new Error(ERROR_MESSAGES.NOT_IMPLEMENTED("getTables"));
  }

  async getViews(dbName) {
    throw new Error(ERROR_MESSAGES.NOT_IMPLEMENTED("getViews"));
  }

  async getProcedures(dbName) {
    throw new Error(ERROR_MESSAGES.NOT_IMPLEMENTED("getProcedures"));
  }

  async getFunctions(dbName) {
    throw new Error(ERROR_MESSAGES.NOT_IMPLEMENTED("getFunctions"));
  }
}

module.exports = SQLStrategy;
