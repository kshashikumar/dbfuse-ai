/**
 * @fileoverview Authentication controller
 * Handles login, logout, and authentication verification
 */

const BaseController = require("./base/BaseController");
const logger = require("../utils/logger");
const {
  decodeCredentials,
  encodeCredentials,
  verifyCredentials,
  isAuthRequired,
  sanitizeUsername,
  validateTokenFormat,
} = require("../utils/authUtil");
const {
  AUTH_MESSAGES,
  BASIC_TOKEN_RESPONSE_KEY,
  AUTH_STATE_KEY,
  HTTP_STATUS,
} = require("../core/constants");

class AuthController extends BaseController {
  /**
   * Handle user login
   */
  async login(req, res) {
    try {
      const { username, password } = req.body;

      // Validate required fields
      const validation = this.validateRequired(req.body, ["username", "password"]);
      if (!validation.valid) {
        logger.warn("Login attempt with missing credentials");
        return this.sendError(res, AUTH_MESSAGES.MISSING_CREDENTIALS, HTTP_STATUS.BAD_REQUEST);
      }

      // Sanitize username
      const sanitizedUsername = sanitizeUsername(username);

      // If no auth configured, allow with dummy token
      if (!isAuthRequired()) {
        logger.info("No auth configured; allowing login without validation");
        return this.sendSuccess(res, {
          [BASIC_TOKEN_RESPONSE_KEY]: encodeCredentials(sanitizedUsername, sanitizedUsername),
          message: "Login successful",
        });
      }

      // Verify credentials
      if (verifyCredentials(sanitizedUsername, password)) {
        logger.info("User authenticated successfully:", sanitizedUsername);
        return this.sendSuccess(res, {
          [BASIC_TOKEN_RESPONSE_KEY]: encodeCredentials(sanitizedUsername, password),
          message: "Login successful",
        });
      }

      // Invalid credentials
      logger.warn("Invalid login attempt for user:", sanitizedUsername);
      return this.sendError(res, AUTH_MESSAGES.INVALID_CREDENTIALS, HTTP_STATUS.UNAUTHORIZED);
    } catch (error) {
      this.handleError(res, error, "login");
    }
  }

  /**
   * Handle user logout
   */
  async logout(req, res) {
    try {
      logger.info("User logged out");
      return this.sendSuccess(res, {
        message: AUTH_MESSAGES.LOGOUT_SUCCESS,
      });
    } catch (error) {
      this.handleError(res, error, "logout");
    }
  }

  /**
   * Check if user is authenticated
   */
  async isAuthenticated(req, res) {
    try {
      // If no auth required, always return authenticated
      if (!isAuthRequired()) {
        logger.debug("No auth required; returning authenticated");
        return this.sendSuccess(res, { [AUTH_STATE_KEY]: true });
      }

      // Validate token format
      const authHeader = req.headers.authorization || "";
      if (!validateTokenFormat(authHeader)) {
        logger.debug("Invalid token format");
        return this.sendSuccess(res, { [AUTH_STATE_KEY]: false }, HTTP_STATUS.UNAUTHORIZED);
      }

      // Decode and verify credentials
      const [username, password] = decodeCredentials(authHeader);

      if (verifyCredentials(username, password)) {
        logger.debug("User is authenticated:", username);
        return this.sendSuccess(res, { [AUTH_STATE_KEY]: true });
      }

      logger.debug("Authentication verification failed");
      return this.sendSuccess(res, { [AUTH_STATE_KEY]: false }, HTTP_STATUS.UNAUTHORIZED);
    } catch (error) {
      this.handleError(res, error, "isAuthenticated");
    }
  }
}

// Export controller instance with bound methods
const controller = new AuthController();

module.exports = {
  login: controller.login.bind(controller),
  logout: controller.logout.bind(controller),
  isAuthenticated: controller.isAuthenticated.bind(controller),
  // Export for testing
  _controller: controller,
};
