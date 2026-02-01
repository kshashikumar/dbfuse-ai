class VectorStore {
  constructor(db, helpers) {
    this.db = db;
    this.run = helpers.run;
    this.get = helpers.get;
    this.all = helpers.all;
  }

  async upsertEmbedding(embedding) {
    if (!embedding || !embedding.id || !embedding.nodeId || !embedding.vector) {
      throw new Error("Invalid embedding payload");
    }

    const vector = this._serializeVector(embedding.vector);
    const metadata = embedding.metadata ? JSON.stringify(embedding.metadata) : null;
    const now = Math.floor(Date.now() / 1000);

    const sql = `INSERT INTO embeddings (id, node_id, vector, metadata, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        node_id = excluded.node_id,
        vector = excluded.vector,
        metadata = excluded.metadata`;

    await this.run(sql, [embedding.id, embedding.nodeId, vector, metadata, now]);
  }

  async getEmbeddingById(id) {
    const row = await this.get("SELECT * FROM embeddings WHERE id = ?", [id]);
    return row ? this._hydrateEmbedding(row) : null;
  }

  async findSimilar(queryVector, options = {}) {
    const vector = this._normalizeVector(queryVector);
    if (!vector || vector.length === 0) {
      return [];
    }

    const limit = Number.isFinite(options.limit) ? options.limit : 5;
    const minScore = Number.isFinite(options.minScore) ? options.minScore : 0;
    const filter = typeof options.filter === "function" ? options.filter : null;

    const rows = await this.all("SELECT * FROM embeddings");
    const scored = [];

    for (const row of rows) {
      const item = this._hydrateEmbedding(row);
      if (!item.vector || item.vector.length !== vector.length) {
        continue;
      }
      if (filter && !filter(item)) {
        continue;
      }
      const score = this._cosineSimilarity(vector, item.vector);
      if (score >= minScore) {
        scored.push({ ...item, score });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }

  _hydrateEmbedding(row) {
    return {
      id: row.id,
      nodeId: row.node_id,
      vector: this._parseVector(row.vector),
      metadata: this._safeJsonParse(row.metadata),
      createdAt: row.created_at,
    };
  }

  _serializeVector(vector) {
    const normalized = this._normalizeVector(vector);
    if (!normalized) {
      throw new Error("Invalid vector data");
    }
    return JSON.stringify(normalized);
  }

  _parseVector(value) {
    try {
      const parsed = JSON.parse(value);
      return this._normalizeVector(parsed);
    } catch {
      return null;
    }
  }

  _normalizeVector(value) {
    if (!Array.isArray(value)) {
      return null;
    }
    const normalized = value
      .map((entry) => Number(entry))
      .filter((entry) => Number.isFinite(entry));
    return normalized.length ? normalized : null;
  }

  _cosineSimilarity(a, b) {
    let dot = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i += 1) {
      const av = a[i];
      const bv = b[i];
      dot += av * bv;
      normA += av * av;
      normB += bv * bv;
    }

    if (!normA || !normB) {
      return 0;
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
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

module.exports = VectorStore;
