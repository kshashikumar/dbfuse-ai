class SuggestionStrategy {
  generate({ analysis, context, selectedTables }) {
    const suggestions = [];
    const tableNames = this._unique(
      selectedTables && selectedTables.length
        ? selectedTables
        : (context?.tables || []).map((entry) => entry.name).filter(Boolean),
    );

    for (const table of tableNames.slice(0, 3)) {
      suggestions.push(`Show all records from ${table}.`);
      suggestions.push(`Count records in ${table}.`);
    }

    const relationships = Array.isArray(context?.relationships) ? context.relationships : [];
    if (relationships.length) {
      const rel = relationships[0];
      if (rel?.from && rel?.to) {
        suggestions.push(`Show ${rel.from} with related ${rel.to} records.`);
      }
    }

    if (analysis?.hasTimeFilter && tableNames.length) {
      suggestions.push(`Show recent records from ${tableNames[0]}.`);
    }

    return this._unique(suggestions).slice(0, 6);
  }

  _unique(values) {
    return Array.from(new Set(values.filter(Boolean)));
  }
}

module.exports = SuggestionStrategy;
