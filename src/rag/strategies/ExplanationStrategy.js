class ExplanationStrategy {
  generate({ analysis, context, selectedTables, dbType, dbName }) {
    const tableNames = this._unique(
      selectedTables && selectedTables.length
        ? selectedTables
        : (context?.tables || []).map((entry) => entry.name).filter(Boolean),
    );

    const parts = [];
    if (tableNames.length) {
      parts.push(`Using ${dbType || "database"} tables: ${tableNames.join(", ")}.`);
    }

    if (analysis?.complexity) {
      parts.push(`Query complexity classified as ${analysis.complexity}.`);
    }

    const relationships = Array.isArray(context?.relationships) ? context.relationships : [];
    if (relationships.length) {
      const formatted = relationships
        .slice(0, 2)
        .map((rel) => this._formatRelationship(rel))
        .filter(Boolean);
      if (formatted.length) {
        parts.push(`Key relationships: ${formatted.join("; ")}.`);
      }
    }

    if (dbName) {
      parts.push(`Target database: ${dbName}.`);
    }

    if (!parts.length) {
      return "Generated SQL based on available schema context.";
    }

    return parts.join(" ");
  }

  _formatRelationship(rel) {
    if (!rel || !rel.from || !rel.to) {
      return null;
    }
    const column = rel?.metadata?.column;
    const referencedColumn = rel?.metadata?.referencedColumn;
    if (column && referencedColumn) {
      return `${rel.from}.${column} -> ${rel.to}.${referencedColumn}`;
    }
    return `${rel.from} -> ${rel.to}`;
  }

  _unique(values) {
    return Array.from(new Set(values.filter(Boolean)));
  }
}

module.exports = ExplanationStrategy;
