const databaseService = require("../../services/DatabaseService");
const { connectionManager } = require("../../config");
const logger = require("../../utils/logger");
const SchemaAdapter = require("./SchemaAdapter");

const SUPPORTED_TYPES = new Set(["mysql2", "pg", "sqlite3", "mssql", "oracledb"]);

class SqlSchemaAdapter extends SchemaAdapter {
  supports(dbType) {
    return SUPPORTED_TYPES.has(String(dbType || "").toLowerCase());
  }

  async extract({ connectionId, dbName, dbType } = {}) {
    if (!connectionId) {
      throw new Error("connectionId is required for schema extraction");
    }

    const connectionInfo = connectionManager.getConnectionInfo(connectionId) || {};
    const resolvedType = dbType || connectionInfo.dbType || connectionInfo?.config?.dbType || null;

    const tablesResult = await databaseService.getTables(connectionId, dbName);
    const tableNames = this._normalizeTableNames(tablesResult?.tables || []);
    const database =
      tablesResult?.database ||
      dbName ||
      connectionInfo.currentDatabase ||
      connectionInfo?.config?.database ||
      "default";

    if (!tableNames.length) {
      logger.warn("Schema extraction returned no tables", { connectionId, database });
      return { database, dbType: resolvedType, tables: [] };
    }

    const details = await databaseService.getMultipleTablesInfo(connectionId, tableNames, dbName);

    const tables = (details?.tables || []).map((table) => this._normalizeTable(table));

    return {
      database,
      dbType: resolvedType,
      tables,
    };
  }

  _normalizeTableNames(tables) {
    const names = tables
      .map((table) => {
        if (typeof table === "string") {
          return table;
        }
        return table?.name || table?.table_name || table?.tableName || table?.TABLE_NAME || null;
      })
      .filter((name) => typeof name === "string" && name.trim().length > 0);

    return Array.from(new Set(names));
  }

  _normalizeTable(raw) {
    const tableName =
      raw?.table_name || raw?.tableName || raw?.name || raw?.TABLE_NAME || raw?.table;

    const columns = Array.isArray(raw?.columns)
      ? raw.columns.map((column) => this._normalizeColumn(column))
      : [];

    const indexes = Array.isArray(raw?.indexes)
      ? raw.indexes.map((index) => this._normalizeIndex(index))
      : [];

    const foreignKeys = Array.isArray(raw?.foreign_keys)
      ? raw.foreign_keys.map((key) => this._normalizeForeignKey(key))
      : Array.isArray(raw?.foreignKeys)
        ? raw.foreignKeys.map((key) => this._normalizeForeignKey(key))
        : [];

    return {
      name: tableName,
      columns,
      indexes,
      foreignKeys,
      metadata: {
        dbName: raw?.db_name || raw?.dbName || null,
      },
    };
  }

  _normalizeColumn(column) {
    return {
      name: column?.column_name || column?.columnName || column?.name || null,
      dataType: column?.data_type || column?.dataType || column?.type || null,
      isNullable:
        column?.is_nullable === undefined ? column?.isNullable : Boolean(column?.is_nullable),
      defaultValue:
        column?.default_value === undefined ? column?.defaultValue : column?.default_value,
      isPrimaryKey:
        column?.is_primary_key === undefined
          ? column?.isPrimaryKey
          : Boolean(column?.is_primary_key),
      length: column?.length ?? null,
      precision: column?.precision ?? null,
      scale: column?.scale ?? null,
      raw: column,
    };
  }

  _normalizeIndex(index) {
    return {
      name: index?.index_name || index?.name || null,
      column: index?.column_name || index?.column || null,
      isUnique: index?.is_unique === undefined ? Boolean(index?.unique) : Boolean(index?.is_unique),
      raw: index,
    };
  }

  _normalizeForeignKey(key) {
    return {
      name: key?.fk_name || key?.name || null,
      column: key?.column_name || key?.column || null,
      referencedTable: key?.referenced_table || key?.referencedTable || null,
      referencedColumn: key?.referenced_column || key?.referencedColumn || null,
      referencedSchema: key?.referenced_schema || key?.referencedSchema || null,
      raw: key,
    };
  }
}

module.exports = SqlSchemaAdapter;
