class QueryHistoryStore {
  constructor(db, helpers) {
    this.db = db;
    this.run = helpers.run;
    this.get = helpers.get;
    this.all = helpers.all;
  }

  async record(entry) {
    if (!entry || !entry.id || !entry.nlQuery || !entry.generatedQuery) {
      throw new Error("Invalid history payload");
    }

    const success = entry.success === undefined ? 1 : entry.success ? 1 : 0;
    const executionTime = Number.isFinite(entry.executionTime) ? entry.executionTime : null;
    const feedback = entry.feedback ? JSON.stringify(entry.feedback) : null;
    const strategy = entry.strategy || null;
    const now = Math.floor(Date.now() / 1000);

    await this.run(
      `INSERT INTO query_history
        (id, nl_query, generated_query, strategy, success, execution_time, feedback, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.id,
        entry.nlQuery,
        entry.generatedQuery,
        strategy,
        success,
        executionTime,
        feedback,
        now,
      ],
    );
  }

  async listRecent(limit = 20) {
    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(limit, 200)) : 20;
    const rows = await this.all("SELECT * FROM query_history ORDER BY created_at DESC LIMIT ?", [
      safeLimit,
    ]);
    return rows.map((row) => this._hydrateRow(row));
  }

  async updateFeedback(id, feedback, correctedQuery = null) {
    if (!id) {
      throw new Error("queryId is required to update feedback");
    }

    const payload = feedback ? JSON.stringify(feedback) : null;
    if (correctedQuery) {
      await this.run(
        `UPDATE query_history
         SET feedback = ?, generated_query = ?
         WHERE id = ?`,
        [payload, correctedQuery, id],
      );
      return;
    }

    await this.run(
      `UPDATE query_history
       SET feedback = ?
       WHERE id = ?`,
      [payload, id],
    );
  }

  _hydrateRow(row) {
    return {
      id: row.id,
      nlQuery: row.nl_query,
      generatedQuery: row.generated_query,
      strategy: row.strategy,
      success: row.success === 1,
      executionTime: row.execution_time,
      feedback: this._safeJsonParse(row.feedback),
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

module.exports = QueryHistoryStore;
