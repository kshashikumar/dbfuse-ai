// cache-strategy.js
const { ERROR_MESSAGES } = require("../../../core/constants");

const DatabaseStrategy = require("./database-strategy");

class CacheStrategy extends DatabaseStrategy {
  constructor() {
    super();
  }

  // Override generic structure method
  async getStructure() {
    // For cache, structure might be keys or namespaces
    return this.getKeys("*");
  }

  async getKeys(pattern) {
    throw new Error(ERROR_MESSAGES.NOT_IMPLEMENTED("getKeys"));
  }

  // Cache specific operations
  async get(key) {
    throw new Error(ERROR_MESSAGES.NOT_IMPLEMENTED("get"));
  }

  async set(key, value, options = {}) {
    throw new Error(ERROR_MESSAGES.NOT_IMPLEMENTED("set"));
  }

  async delete(key) {
    throw new Error(ERROR_MESSAGES.NOT_IMPLEMENTED("delete"));
  }
}

module.exports = CacheStrategy;
