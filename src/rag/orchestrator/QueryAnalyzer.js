class QueryAnalyzer {
  analyze(prompt) {
    const lower = String(prompt || "").toLowerCase();
    const hasJoin = /\bjoin\b|\bcombine\b|\bwith\b/.test(lower);
    const hasAggregation = /\bcount\b|\bsum\b|\bavg\b|\bmin\b|\bmax\b|\bgroup by\b/.test(lower);
    const hasSubquery = /\bselect\b[\s\S]+?\bselect\b/.test(lower);
    const hasTime = /\b(last|past|today|yesterday|month|year|week)\b/.test(lower);

    let complexity = "simple";
    if (hasSubquery || (hasJoin && hasAggregation)) {
      complexity = "complex";
    } else if (hasJoin || hasAggregation || hasTime) {
      complexity = "medium";
    }

    let recommendedStrategy = "DirectSQLStrategy";
    if (complexity === "complex") {
      recommendedStrategy = "DecompositionStrategy";
    } else if (hasJoin || hasAggregation || hasTime) {
      recommendedStrategy = "RAGEnhancedStrategy";
    }

    const confidence = complexity === "simple" ? 0.75 : complexity === "medium" ? 0.6 : 0.5;

    return {
      complexity,
      hasJoins: hasJoin,
      hasAggregation,
      hasSubqueries: hasSubquery,
      hasTimeFilter: hasTime,
      recommendedStrategy,
      confidence,
    };
  }
}

module.exports = QueryAnalyzer;
