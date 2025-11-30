const logger = require("../utils/logger");
const {
  AUTH_MESSAGES,
  BASIC_AUTH_SCHEME,
  BASIC_TOKEN_RESPONSE_KEY,
  AUTH_STATE_KEY,
  ENCODING,
} = require("../core/constants");

function _decodeCredentials(header) {
  try {
    const base64Part = header.trim().replace(/^Basic\s+/i, "");
    const clean = base64Part.replace(/^Basic\s+/i, "");

    const decoded = Buffer.from(clean, ENCODING.BASE64).toString(ENCODING.ASCII);
    const [username, password] = decoded.split(":");
    return [username, password];
  } catch (err) {
    // avoid logging raw header; just log error
    logger.warn("Failed to decode basic auth credentials");
    return [];
  }
}

function basicToken(username, password) {
  return `${BASIC_AUTH_SCHEME}${Buffer.from(`${username}:${password}`, ENCODING.UTF8).toString(
    ENCODING.BASE64,
  )}`;
}

const login = async (req, res) => {
  const username = req.body.username;
  const password = req.body.password;

  // Basic validation
  if (!username || !password) {
    logger.warn("Missing username or password in login request");
    return res.status(400).json({ error: AUTH_MESSAGES.MISSING_CREDENTIALS });
  }

  if (!process.env.DBFUSE_USERNAME || !process.env.DBFUSE_PASSWORD) {
    logger.info("No auth env set; allowing login without validation");
    return res.status(200).json({ [BASIC_TOKEN_RESPONSE_KEY]: basicToken(username, username) }); // Dummy token
  }

  if (username === process.env.DBFUSE_USERNAME && password === process.env.DBFUSE_PASSWORD) {
    return res.status(200).json({ [BASIC_TOKEN_RESPONSE_KEY]: basicToken(username, password) });
  }

  // Invalid credentials
  logger.warn("Invalid credentials provided");
  return res.status(401).json({ error: AUTH_MESSAGES.INVALID_CREDENTIALS });
};

const logout = async (req, res) => {
  return res.status(200).json({ message: AUTH_MESSAGES.LOGOUT_SUCCESS });
};

const isAuthenticated = async (req, res) => {
  if (!process.env.DBFUSE_USERNAME || !process.env.DBFUSE_PASSWORD) {
    logger.info("No auth env set; returning authenticated without validation");
    return res.status(200).json({ [AUTH_STATE_KEY]: true });
  }

  const [username, password] = _decodeCredentials(req.headers.authorization || "");
  // Do not log raw credentials
  if (username === process.env.DBFUSE_USERNAME && password === process.env.DBFUSE_PASSWORD) {
    logger.debug("User is authenticated");
    return res.status(200).json({ [AUTH_STATE_KEY]: true });
  }
  return res.status(401).json({ [AUTH_STATE_KEY]: false });
};

module.exports = {
  login,
  logout,
  isAuthenticated,
  _decodeCredentials,
};
