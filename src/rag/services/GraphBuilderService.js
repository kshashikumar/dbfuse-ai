const storageManager = require("../storage/StorageManager");

class GraphBuilderService {
  async buildGraph(schema) {
    if (!schema || !schema.tables) {
      throw new Error("Schema is required to build graph");
    }

    await storageManager.initialize();
    const graphStore = storageManager.getGraphStore();

    const databaseName = schema.database || schema.dbName || "default";
    const dbNodeId = this._makeId("database", databaseName);

    await graphStore.upsertNode({
      id: dbNodeId,
      type: "database",
      name: databaseName,
      metadata: { dbType: schema.dbType || null },
    });

    const tableIds = new Map();

    for (const table of schema.tables) {
      if (!table?.name) {
        continue;
      }
      const tableId = this._makeId("table", databaseName, table.name);
      tableIds.set(table.name, tableId);

      await graphStore.upsertNode({
        id: tableId,
        type: "table",
        name: table.name,
        metadata: { database: databaseName },
      });

      await graphStore.upsertEdge({
        id: this._makeEdgeId("HAS_TABLE", dbNodeId, tableId),
        sourceId: dbNodeId,
        targetId: tableId,
        relationship: "HAS_TABLE",
      });

      await this._storeColumns(graphStore, databaseName, tableId, table);
      await this._storeIndexes(graphStore, databaseName, tableId, table);
    }

    for (const table of schema.tables) {
      if (!table?.name || !Array.isArray(table?.foreignKeys)) {
        continue;
      }
      const sourceTableId = tableIds.get(table.name);
      if (!sourceTableId) {
        continue;
      }
      await this._storeForeignKeys(graphStore, databaseName, table, sourceTableId, tableIds);
    }
  }

  async _storeColumns(graphStore, databaseName, tableId, table) {
    if (!Array.isArray(table?.columns)) {
      return;
    }

    for (const column of table.columns) {
      if (!column?.name) {
        continue;
      }
      const columnId = this._makeId("column", databaseName, table.name, column.name);
      await graphStore.upsertNode({
        id: columnId,
        type: "column",
        name: column.name,
        metadata: {
          table: table.name,
          dataType: column.dataType || null,
          isNullable: column.isNullable ?? null,
          defaultValue: column.defaultValue ?? null,
          isPrimaryKey: column.isPrimaryKey ?? null,
          length: column.length ?? null,
          precision: column.precision ?? null,
          scale: column.scale ?? null,
        },
      });

      await graphStore.upsertEdge({
        id: this._makeEdgeId("HAS_COLUMN", tableId, columnId),
        sourceId: tableId,
        targetId: columnId,
        relationship: "HAS_COLUMN",
      });
    }
  }

  async _storeIndexes(graphStore, databaseName, tableId, table) {
    if (!Array.isArray(table?.indexes)) {
      return;
    }

    for (const index of table.indexes) {
      if (!index?.name) {
        continue;
      }
      const indexId = this._makeId("index", databaseName, table.name, index.name);
      await graphStore.upsertNode({
        id: indexId,
        type: "index",
        name: index.name,
        metadata: {
          table: table.name,
          column: index.column || null,
          isUnique: index.isUnique ?? null,
        },
      });

      await graphStore.upsertEdge({
        id: this._makeEdgeId("HAS_INDEX", tableId, indexId),
        sourceId: tableId,
        targetId: indexId,
        relationship: "HAS_INDEX",
      });
    }
  }

  async _storeForeignKeys(graphStore, databaseName, table, sourceTableId, tableIds) {
    for (const fk of table.foreignKeys) {
      if (!fk?.referencedTable) {
        continue;
      }

      let targetTableId = tableIds.get(fk.referencedTable);
      if (!targetTableId) {
        targetTableId = this._makeId("table", databaseName, fk.referencedTable);
        await graphStore.upsertNode({
          id: targetTableId,
          type: "table",
          name: fk.referencedTable,
          metadata: { database: databaseName, placeholder: true },
        });
        tableIds.set(fk.referencedTable, targetTableId);
      }

      await graphStore.upsertEdge({
        id: this._makeEdgeId("REFERENCES", sourceTableId, targetTableId, fk.column),
        sourceId: sourceTableId,
        targetId: targetTableId,
        relationship: "REFERENCES",
        metadata: {
          column: fk.column || null,
          referencedColumn: fk.referencedColumn || null,
          fkName: fk.name || null,
          referencedSchema: fk.referencedSchema || null,
        },
      });
    }
  }

  _makeId(...parts) {
    return parts
      .map((part) => encodeURIComponent(String(part || "").trim()))
      .filter((part) => part.length > 0)
      .join("|");
  }

  _makeEdgeId(type, sourceId, targetId, suffix = "") {
    const base = `${type}:${sourceId}->${targetId}`;
    if (!suffix) {
      return base;
    }
    return `${base}:${encodeURIComponent(String(suffix))}`;
  }
}

module.exports = GraphBuilderService;
