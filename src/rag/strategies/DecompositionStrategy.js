const BaseQueryStrategy = require("./BaseQueryStrategy");

class DecompositionStrategy extends BaseQueryStrategy {
  constructor() {
    super("DecompositionStrategy");
  }

  async execute({ llmService, dbMeta, databaseName, prompt, dbType, selectedTables }) {
    if (!llmService) {
      throw new Error("LLM service is required");
    }

    const augmentedPrompt = `${prompt}\n\nBreak the problem into steps internally, but output only the final SQL.`;

    return llmService.generateSQLQuery(
      dbMeta,
      databaseName,
      augmentedPrompt,
      dbType,
      selectedTables,
    );
  }
}

module.exports = DecompositionStrategy;
