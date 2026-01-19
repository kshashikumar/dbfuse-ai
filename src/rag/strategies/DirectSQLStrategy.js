const BaseQueryStrategy = require("./BaseQueryStrategy");

class DirectSQLStrategy extends BaseQueryStrategy {
  constructor() {
    super("DirectSQLStrategy");
  }

  async execute({ llmService, dbMeta, databaseName, prompt, dbType, selectedTables }) {
    if (!llmService) {
      throw new Error("LLM service is required");
    }

    return llmService.generateSQLQuery(dbMeta, databaseName, prompt, dbType, selectedTables);
  }
}

module.exports = DirectSQLStrategy;
