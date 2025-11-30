const MySQLStrategy = require("./strategies/mysql-strategy");
const PostgreSQLStrategy = require("./strategies/postgresql-strategy");
const SQLiteStrategy = require("./strategies/sqlite-strategy");
const MSSQLStrategy = require("./strategies/mssql-strategy");
const OracleStrategy = require("./strategies/oracle-strategy");
const MongoDBStrategy = require("./strategies/mongodb-strategy");
const RedisStrategy = require("./strategies/redis-strategy");

const strategyMap = Object.freeze({
  mysql2: MySQLStrategy,
  pg: PostgreSQLStrategy,
  sqlite3: SQLiteStrategy,
  mssql: MSSQLStrategy,
  oracledb: OracleStrategy,
  mongodb: MongoDBStrategy,
  redis: RedisStrategy,
});

function getStrategyClass(dbType) {
  const Strategy = strategyMap[dbType];
  if (!Strategy) {
    const supported = Object.keys(strategyMap).join(", ");
    throw new Error(`Unsupported database type: ${dbType}. Supported types: ${supported}`);
  }
  return Strategy;
}

function createStrategy(dbType) {
  const Strategy = getStrategyClass(dbType);
  return new Strategy();
}

module.exports = {
  createStrategy,
  getStrategyClass,
  supportedDbTypes: Object.freeze(Object.keys(strategyMap)),
};
