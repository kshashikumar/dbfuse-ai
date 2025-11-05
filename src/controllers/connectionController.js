// connectionsController.js
const path = require("path");
const { getPolicy } = require("../utils/policyUtil");
const fs = require("fs").promises;
const logger = require("../utils/logger");

exports.fs = fs;

/* --------- unchanged file IO helpers (same as you have) --------- */
const readConnectionsFromFile = async () => {
  const filePath = path.join(__dirname, "..", "config", "dbConnections.json");
  try {
    const data = await fs.readFile(filePath, "utf8");
    return JSON.parse(data).map((conn) => ({
      id: conn.id || Date.now() + Math.random(),
      username: conn.username,
      password: conn.password,
      host: conn.host,
      port: conn.port,
      dbType: conn.dbType,
      database: conn.database || "",
      socketPath: conn.socketPath || "",
      ssl: conn.ssl || false,
      connectionTimeout: conn.connectionTimeout || 60000,
      poolSize: conn.poolSize || 10,
      status: conn.status || "Available",
      createdAt: conn.createdAt || new Date().toISOString(),
      lastUsed: conn.lastUsed || null,
    }));
  } catch {
    logger.info("No connections file found, returning empty array");
    return [];
  }
};

const writeConnectionsToFile = async (connections) => {
  const filePath = path.join(__dirname, "..", "config", "dbConnections.json");
  const cleanConnections = connections.map((conn) => ({
    id: conn.id || Date.now() + Math.random(),
    username: conn.username,
    password: conn.password,
    host: conn.host,
    port: conn.port,
    dbType: conn.dbType,
    database: conn.database || "",
    socketPath: conn.socketPath || "",
    ssl: !!conn.ssl,
    connectionTimeout: conn.connectionTimeout || 60000,
    poolSize: conn.poolSize || 10,
    status: conn.status || "Available",
    createdAt: conn.createdAt || new Date().toISOString(),
    lastUsed: conn.lastUsed || null,
  }));
  await fs.writeFile(filePath, JSON.stringify(cleanConnections, null, 2), "utf8");
};

/* ---------------------- Route handlers ---------------------- */
const getConnections = async (req, res) => {
  try {
    const connections = await readConnectionsFromFile();

    const withDisplay = connections.map((c) => {
      const policy = getPolicy(c.dbType);
      const { databaseDisplay, databaseShort, extras = {} } = policy.display(c);
      return { ...c, databaseDisplay, databaseShort, ...extras };
    });
    return res.status(200).json({
      connections: withDisplay,
      count: withDisplay.length,
      retrievedAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.error("Error fetching connections:", err);
    return res.status(500).json({ error: "Error fetching connections" });
  }
};

const addConnection = async (req, res) => {
  try {
    const input = req.body;
    const policy = getPolicy(input.dbType);

    const error = policy.validateOnAdd(input);
    if (error) return res.status(400).json({ error });

    let connections = await readConnectionsFromFile();

    const normalized = policy.normalizeOnAdd(input);
    const candidate = { ...normalized, dbType: input.dbType };
    const keyNew = policy.dedupeKey(candidate);

    const exists = connections.some((conn) => {
      const p = getPolicy(conn.dbType);
      return p.dedupeKey(conn) === keyNew;
    });
    if (exists) {
      return res.status(409).json({ error: "Connection with these details already exists." });
    }

    const newId = connections.length > 0 ? Math.max(...connections.map((c) => c.id || 0)) + 1 : 1;

    const connectionToAdd = {
      id: newId,
      ...normalized,
      dbType: input.dbType,
      createdAt: new Date().toISOString(),
      lastUsed: null,
    };

    connections.push(connectionToAdd);
    await writeConnectionsToFile(connections);

    const { databaseDisplay, databaseShort, extras = {} } = policy.display(connectionToAdd);
    logger.info("Connection added:", connectionToAdd);

    return res.status(201).json({
      message: "Connection added successfully",
      connection: { ...connectionToAdd, databaseDisplay, databaseShort, ...extras },
    });
  } catch (err) {
    logger.error("Error adding connection:", err);
    return res.status(500).json({ error: "Error adding connection" });
  }
};

const editConnection = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    if (!id) return res.status(400).json({ error: "Connection ID is required for editing." });
    if (!updates || Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "No update data provided." });
    }

    const idNum = parseInt(id, 10);
    if (isNaN(idNum)) return res.status(400).json({ error: "Invalid Connection ID provided." });

    let connections = await readConnectionsFromFile();
    const idx = connections.findIndex((c) => c.id === idNum);
    if (idx === -1) return res.status(404).json({ error: "Connection not found." });

    const current = connections[idx];
    const policy = getPolicy(current.dbType);
    const normalizedUpdates = policy.normalizeOnEdit(current, updates);

    const next = {
      ...current,
      ...normalizedUpdates,
      id: current.id,
      createdAt: current.createdAt,
      lastUsed: current.lastUsed,
    };

    connections[idx] = next;
    await writeConnectionsToFile(connections);

    const { databaseDisplay, databaseShort, extras = {} } = policy.display(next);
    logger.info("Connection updated:", next);

    return res.status(200).json({
      message: "Connection updated successfully",
      connection: { ...next, databaseDisplay, databaseShort, ...extras },
    });
  } catch (err) {
    logger.error("Error editing connection:", err);
    return res.status(500).json({ error: "Error editing connection" });
  }
};

const deleteConnection = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) return res.status(400).json({ error: "Connection ID is required for deletion." });

    const idNum = parseInt(id, 10);
    if (isNaN(idNum)) return res.status(400).json({ error: "Invalid Connection ID provided." });

    let connections = await readConnectionsFromFile();
    const initialLength = connections.length;

    logger.debug("Initial connections length:", initialLength);
    connections = connections.filter((c) => c.id !== idNum);
    logger.debug("Connections after filter:", connections.length);

    if (connections.length === initialLength) {
      return res.status(404).json({ error: "Connection not found." });
    }

    await writeConnectionsToFile(connections);

    logger.info("Connection deleted with ID:", id);
    return res.status(200).json({
      message: "Connection deleted successfully",
      deletedId: idNum,
      deletedAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.error("Error deleting connection:", err);
    return res.status(500).json({ error: "Error deleting connection" });
  }
};

const saveConnections = async (req, res) => {
  try {
    const list = req.body.connections;
    if (!list || !Array.isArray(list)) {
      return res
        .status(400)
        .json({ error: "Invalid data provided. Expected an array of connections." });
    }

    const normalized = list
      .map((conn) => {
        const policy = getPolicy(conn.dbType);
        const error = policy.validateOnAdd({ ...conn, databasePath: conn.databasePath });
        if (error) throw new Error(error);
        return policy.normalizeOnSave({ ...conn });
      })
      .map((conn, i) => ({
        id: list[i].id || Date.now() + Math.random(),
        createdAt: list[i].createdAt || new Date().toISOString(),
        lastUsed: list[i].lastUsed ?? null,
        status: list[i].status || "Available",
        ...conn,
      }));

    await writeConnectionsToFile(normalized);

    logger.info("Connections saved to file.");
    return res.status(200).json({
      message: "Connections saved successfully",
      count: normalized.length,
      savedAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.error("Error saving connections to file:", err);
    return res.status(500).json({ error: "Error saving connections" });
  }
};

const testConnection = async (req, res) => {
  try {
    const { id } = req.params;
    const idNum = parseInt(id, 10);
    if (isNaN(idNum)) return res.status(400).json({ error: "Invalid Connection ID provided." });

    const connections = await readConnectionsFromFile();
    const connection = connections.find((c) => c.id === idNum);
    if (!connection) return res.status(404).json({ error: "Connection not found." });

    connection.lastUsed = new Date().toISOString();
    await writeConnectionsToFile(connections);

    const policy = getPolicy(connection.dbType);
    const { databaseDisplay, databaseShort, extras = {} } = policy.display(connection);

    return res.status(200).json({
      message: "Connection test initiated",
      connection: {
        id: connection.id,
        host: connection.host,
        port: connection.port,
        dbType: connection.dbType,
        database: connection.database,
        databaseDisplay,
        databaseShort,
        ...extras,
      },
      testedAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.error("Error testing connection:", err);
    return res.status(500).json({ error: "Error testing connection" });
  }
};

module.exports = {
  getConnections,
  addConnection,
  editConnection,
  deleteConnection,
  saveConnections,
  testConnection,
};
