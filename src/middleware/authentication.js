const authController = require("../controllers/authController");
require("dotenv").config();
const logger = require("../utils/logger");
const { ROUTES_WITH_AUTH_BYPASS } = require("../core/app");
const { HEADERS, AUTH_MESSAGES, AUTH_REALM, BASIC_AUTH_SCHEME } = require("../core/constants");

function authentication(req, res, next) {
  logger.debug("Request path:", req.path);

  if (req.method === "OPTIONS") {
    return next(); // Skip auth for OPTIONS
  }

  if (!process.env.DBFUSE_USERNAME || !process.env.DBFUSE_PASSWORD) {
    return next();
  }

  if (ROUTES_WITH_AUTH_BYPASS.some((route) => req.path.startsWith(route))) {
    return next(); // Skip authentication for auth routes
  }

  const authHeader = req.headers[HEADERS.AUTHORIZATION];
  if (!authHeader || !authHeader.startsWith(BASIC_AUTH_SCHEME)) {
    res.set(HEADERS.WWW_AUTHENTICATE, `${BASIC_AUTH_SCHEME.trim()} realm="${AUTH_REALM}"`);
    return res.status(401).send(AUTH_MESSAGES.AUTH_REQUIRED);
  }

  const [username, password] = authController._decodeCredentials(authHeader);
  if (username === process.env.DBFUSE_USERNAME && password === process.env.DBFUSE_PASSWORD) {
    return next();
  } else {
    res.set(HEADERS.WWW_AUTHENTICATE, `${BASIC_AUTH_SCHEME.trim()} realm="${AUTH_REALM}"`);
    return res.status(401).send(AUTH_MESSAGES.AUTH_REQUIRED);
  }
}

module.exports = {
  authentication,
};
