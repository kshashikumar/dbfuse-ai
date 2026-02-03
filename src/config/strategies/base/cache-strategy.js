// cache-strategy.js
const { ERROR_MESSAGES } = require("../../../core/constants");

const DatabaseStrategy = require("./database-strategy");

class CacheStrategy extends DatabaseStrategy {
  constructor() {
    super();
  }

  async getKeys(_pattern) {
    throw new Error(ERROR_MESSAGES.NOT_IMPLEMENTED("getKeys"));
  }
}

module.exports = CacheStrategy;
