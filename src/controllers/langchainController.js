const { getAIModel } = require("../models/model");
const logger = require("../utils/logger");
const connectionManager = require("../config/connection-manager-singleton");

const argv = require("minimist")(process.argv.slice(2));

const initializeLLM = () => {
  const aiModel = (argv.model || process.env.AI_MODEL || "gpt-4").toLowerCase();
  const apiKey = argv.apikey || process.env.AI_API_KEY || null;
  return getAIModel(aiModel, apiKey);
};

const {
  compressSchemaForPrompt,
  buildTableCatalog,
  buildSchemaDSL,
} = require("../utils/schemaCompressor");

const BUDGET_CHARS = 4000;

async function selectRelevantTables(llm, dbType, catalog, userPrompt) {
  // Ask the LLM to select relevant tables using the global catalog; return strict JSON
  const selectorSystem = `You are a planner for SQL generation on ${dbType}. Your job is ONLY to choose which tables are relevant for the user's request.
Return STRICT JSON with the schema: {"tables":["table1","table2",...]} and nothing else. Do not include explanations.`;
  const selectorUser = `Tables catalog (names only): ${catalog.join(", ")}
User request: ${userPrompt}
Respond with only JSON: {"tables":[...]} (names must come from the catalog).`;

  try {
    const sel = await llm.call([
      { role: "system", content: selectorSystem },
      { role: "user", content: selectorUser },
    ]);
    const text = (sel?.text || "").trim();
    // Attempt to parse strict JSON; fallback to best-effort
    let jsonText = text;
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end !== -1) {
      jsonText = text.substring(start, end + 1);
    }
    const parsed = JSON.parse(jsonText);
    const arr = Array.isArray(parsed?.tables) ? parsed.tables : [];
    return arr.filter((t) => catalog.includes(t));
  } catch (e) {
    // Fallback: basic heuristic from user prompt
    const p = String(userPrompt || "").toLowerCase();
    const guessed = catalog.filter((t) => p.includes(String(t).toLowerCase()));
    return guessed.length ? guessed : catalog.slice(0, Math.min(12, catalog.length));
  }
}

const generateSQLQuery = async (dbMeta, databaseName, prompt, llm, dbType) => {
  const selectedDatabase = dbMeta.find((db) => db.name === databaseName);
  if (!selectedDatabase) {
    throw new Error(`Database "${databaseName}" not found.`);
  }

  // Extract table name from the prompt, if specified
  const promptMatch = prompt.match(/for (\w+) table/i);
  const requestedTable = promptMatch ? promptMatch[1] : null;

  let systemPrompt;

  if (requestedTable) {
    // Handle prompts targeting a specific table
    const selectedTable = selectedDatabase.tables.find((table) => table.name === requestedTable);

    if (!selectedTable) {
      throw new Error(`Table "${requestedTable}" does not exist in database "${databaseName}".`);
    }

    // Build compact column display with type/size if present
    const tableColumns = selectedTable.columns
      .map((col) => {
        const name = col.column_name;
        const type = col.data_type ? String(col.data_type).toUpperCase() : undefined;
        const len = col.length ?? col.data_length ?? null;
        const prec = col.precision ?? null;
        const scale = col.scale ?? null;
        let typeStr = type || "";
        if (prec != null && scale != null) typeStr += `(${prec},${scale})`;
        else if (len != null) typeStr += `(${len})`;
        const flags = [];
        if (col.is_primary_key) flags.push("PK");
        if (col.is_nullable === false) flags.push("NN");
        const flagStr = flags.length ? ` [${flags.join(",")}]` : "";
        return typeStr ? `${name} ${typeStr}${flagStr}` : `${name}${flagStr}`;
      })
      .join(", ");

    systemPrompt = `
You are an AI expert in generating ${dbType} SQL queries. You must generate a single-line SQL query based on the user's request, using the provided schema. Follow these rules strictly:
- Output only the SQL query as plain text, with no explanations, comments, quotes, or additional text.
- Ensure the query is valid for ${dbType}, using correct syntax (e.g., no double quotes for identifiers unless required by ${dbType}).
- Use table aliases for joins and subqueries to avoid ambiguity.
- Avoid duplicate column names by using unique aliases with AS.
- Handle joins, subqueries, conditional logic, nulls, and aggregation as needed.
- Ensure the query can be used as a subquery for paginated results, with uniquely named columns.
- Do not include line breaks or formatting; the query must be a single line.

Database Schema:
Database Type: ${dbType}
Database: ${databaseName}
Table: ${requestedTable}
Columns: ${tableColumns}

Example:
Database: test
Table: employees
Columns: id, name, age, position
Prompt: Select all employees whose age is greater than 30
Output: SELECT id AS emp_id, name AS emp_name, age, position FROM employees WHERE age > 30

User Request: ${prompt}
Output only the SQL query.
`;
  } else {
    // Multi-table or general prompts: two-phase selection then compact DSL
    const catalog = buildTableCatalog([selectedDatabase]);
    const selectedTables = await selectRelevantTables(llm, dbType, catalog, prompt);

    // Filter dbMeta to selected tables only
    const filteredDb = {
      name: selectedDatabase.name,
      tables: (selectedDatabase.tables || []).filter((t) => selectedTables.includes(t.name)),
    };

    // Build DSL with tier 2; if exceeds budget, fall back to tier 1
    let schemaDSL = buildSchemaDSL([filteredDb], selectedTables, 2);
    if (schemaDSL.length > BUDGET_CHARS) {
      schemaDSL = buildSchemaDSL([filteredDb], selectedTables, 1);
    }
    const catalogLine = `Tables: ${catalog.join(", ")}`;

    systemPrompt = `
You are an AI expert in generating ${dbType} SQL queries. You must generate a single-line SQL query based on the user's request, using the provided schema. Follow these rules strictly:
- Output only the SQL query as plain text, with no explanations, comments, quotes, or additional text.
- Ensure the query is valid for ${dbType}, using correct syntax (e.g., no double quotes for identifiers unless required by ${dbType}).
- Use table aliases for joins and subqueries to avoid ambiguity.
- Avoid duplicate column names by using unique aliases with AS.
- Handle joins, subqueries, conditional logic, nulls, and aggregation as needed.
- Ensure the query can be used as a subquery for paginated results, with uniquely named columns.
- Do not include line breaks or formatting; the query must be a single line.
- Only use tables and columns from the provided catalog and schema DSL. Do not invent tables or columns. If something seems missing, prefer simpler queries using available columns.

Database Schema:
Database Type: ${dbType}
Database: ${databaseName}
${catalogLine}
Schema DSL:
${schemaDSL}

Example DSL and usage:
Tables: employees, departments
T employees: id INT [PK], name VARCHAR(100) [NN], dept_id INT
T departments: dept_id INT [PK], dept_name VARCHAR(100) [NN]
Example user request: Join employees and departments to get employee names and department names
Example output: SELECT e.id AS emp_id, e.name AS emp_name, d.dept_name AS dept_name FROM employees e JOIN departments d ON e.dept_id = d.dept_id

User Request: ${prompt}
Output only the SQL query.
`;
  }

  // Call the LLM with the system prompt
  const result = await llm.call([
    { role: "system", content: systemPrompt },
    { role: "user", content: prompt },
  ]);

  // Clean the output to ensure it's a single-line SQL query
  const cleanedQuery = result.text
    .trim()
    .replace(/^["']|["']$/g, "") // Remove surrounding quotes
    .replace(/\s+/g, " ") // Replace multiple spaces/newlines with a single space
    .replace(/;{2,}/g, ";") // Ensure only one semicolon
    .replace(/[\r\n]+/g, ""); // Remove any line breaks

  if (!cleanedQuery) {
    throw new Error("Generated query is empty or invalid.");
  }

  return cleanedQuery;
};

const executePrompt = async (req, res) => {
  try {
    const { databaseName: bodyDbName, prompt } = req.body;
    const dbType = req.headers["x-db-type"] || req.headers["X-DB-Type"];
    const connectionId = req.headers["x-connection-id"] || req.headers["X-Connection-Id"];

    if (!prompt) {
      return res.status(400).json({ error: "Prompt is required" });
    }
    if (!dbType) {
      return res
        .status(400)
        .json({ error: "Database type (x-db-type) must be specified in headers" });
    }
    if (!connectionId) {
      return res.status(400).json({ error: "x-connection-id header is required" });
    }

    const llm = initializeLLM();

    // Resolve strategy and current database
    logger.debug("Fetching connection for ID:", connectionId);
    const strategy = connectionManager.getConnection(connectionId);
    logger.debug("Strategy for connection:", strategy ? "found" : "not found");
    const info = connectionManager.getConnectionInfo(connectionId);
    logger.debug("Connection info:", info);
    const currentDb = bodyDbName || info?.currentDatabase || info?.config?.database;
    if (!currentDb) {
      return res.status(400).json({ error: "Unable to determine target database" });
    }

    // Build full catalog (names only) server-side
    let catalog = [];
    try {
      catalog = await strategy.getTables(currentDb);
    } catch (e) {
      return res
        .status(500)
        .json({ error: `Failed to fetch tables for ${currentDb}: ${e.message}` });
    }

    // Detect specific table request
    const promptMatch = prompt.match(/for (\w+) table/i);
    const requestedTable = promptMatch ? promptMatch[1] : null;

    let dbMeta;
    if (requestedTable && catalog.includes(requestedTable)) {
      // Single-table: fetch its columns only
      const tableInfo = await strategy.getTableInfo(currentDb, requestedTable);
      dbMeta = [
        {
          name: currentDb,
          tables: [
            {
              name: requestedTable,
              columns: (tableInfo.columns || []).map((c) => ({
                column_name: c.column_name,
                data_type: c.data_type,
                is_nullable: c.is_nullable,
                default_value: c.default_value,
                extra: c.extra,
                is_primary_key: c.is_primary_key,
                length: c.length ?? c.data_length ?? null,
                precision: c.precision ?? null,
                scale: c.scale ?? null,
              })),
            },
          ],
        },
      ];
    } else {
      // Multi-table: phase A selection, then fetch selected table schemas
      const selectedTables = await selectRelevantTables(llm, dbType, catalog, prompt);
      const safeSelection =
        selectedTables && selectedTables.length
          ? selectedTables
          : catalog.slice(0, Math.min(12, catalog.length));

      // Fetch columns for selected tables
      const multiInfo = await strategy.getMultipleTablesInfo(currentDb, safeSelection);
      const infoByName = new Map(multiInfo.map((ti) => [ti.table_name, ti]));

      // Build dbMeta with global catalog, but only selected tables carry columns
      const tables = catalog.map((name) => {
        if (infoByName.has(name)) {
          const ti = infoByName.get(name);
          return {
            name,
            columns: (ti.columns || []).map((c) => ({
              column_name: c.column_name,
              data_type: c.data_type,
              is_nullable: c.is_nullable,
              default_value: c.default_value,
              extra: c.extra,
              is_primary_key: c.is_primary_key,
              length: c.length ?? c.data_length ?? null,
              precision: c.precision ?? null,
              scale: c.scale ?? null,
            })),
          };
        }
        return { name, columns: [] };
      });

      dbMeta = [
        {
          name: currentDb,
          tables,
        },
      ];
    }

    // Generate the SQL query using compact, server-fetched schema
    const query = await generateSQLQuery(dbMeta, currentDb, prompt, llm, dbType);

    res.status(200).json({ query });
  } catch (err) {
    logger.error("Error generating query:", err.message);
    res.status(500).json({ error: err.message });
  }
};

module.exports = {
  executePrompt,
};
