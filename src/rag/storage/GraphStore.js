class GraphStore {
  constructor(db, helpers) {
    this.db = db;
    this.run = helpers.run;
    this.get = helpers.get;
    this.all = helpers.all;
  }

  async upsertNode(node) {
    if (!node || !node.id || !node.type || !node.name) {
      throw new Error("Invalid node payload");
    }

    const metadata = node.metadata ? JSON.stringify(node.metadata) : null;
    const now = Math.floor(Date.now() / 1000);

    const sql = `INSERT INTO nodes (id, type, name, metadata, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        type = excluded.type,
        name = excluded.name,
        metadata = excluded.metadata,
        updated_at = excluded.updated_at`;

    await this.run(sql, [node.id, node.type, node.name, metadata, now, now]);
  }

  async getNodeById(id) {
    const row = await this.get("SELECT * FROM nodes WHERE id = ?", [id]);
    return row ? this._hydrateNode(row) : null;
  }

  async getNodesByType(type) {
    const rows = await this.all("SELECT * FROM nodes WHERE type = ?", [type]);
    return rows.map((row) => this._hydrateNode(row));
  }

  async upsertEdge(edge) {
    if (!edge || !edge.id || !edge.sourceId || !edge.targetId || !edge.relationship) {
      throw new Error("Invalid edge payload");
    }

    const metadata = edge.metadata ? JSON.stringify(edge.metadata) : null;
    const weight = typeof edge.weight === "number" ? edge.weight : 1.0;
    const now = Math.floor(Date.now() / 1000);

    const sql = `INSERT INTO edges (id, source_id, target_id, relationship, metadata, weight, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        source_id = excluded.source_id,
        target_id = excluded.target_id,
        relationship = excluded.relationship,
        metadata = excluded.metadata,
        weight = excluded.weight`;

    await this.run(sql, [
      edge.id,
      edge.sourceId,
      edge.targetId,
      edge.relationship,
      metadata,
      weight,
      now,
    ]);
  }

  async getEdgesForNode(nodeId) {
    const rows = await this.all("SELECT * FROM edges WHERE source_id = ? OR target_id = ?", [
      nodeId,
      nodeId,
    ]);
    return rows.map((row) => this._hydrateEdge(row));
  }

  _hydrateNode(row) {
    return {
      id: row.id,
      type: row.type,
      name: row.name,
      metadata: this._safeJsonParse(row.metadata),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  _hydrateEdge(row) {
    return {
      id: row.id,
      sourceId: row.source_id,
      targetId: row.target_id,
      relationship: row.relationship,
      metadata: this._safeJsonParse(row.metadata),
      weight: row.weight,
      createdAt: row.created_at,
    };
  }

  _safeJsonParse(value) {
    if (!value) {
      return null;
    }
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
}

module.exports = GraphStore;
