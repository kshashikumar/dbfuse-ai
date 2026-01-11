/**
 * @fileoverview Authentication and authorization constants
 * Contains auth schemes, messages, and token configurations
 */

const BASIC_AUTH_SCHEME = "Basic ";
const AUTH_REALM = "user_pages";
const BASIC_TOKEN_RESPONSE_KEY = "basicToken";
const AUTH_STATE_KEY = "authenticated";

const AUTH_MESSAGES = Object.freeze({
  MISSING_CREDENTIALS: "Username and password are required",
  INVALID_CREDENTIALS: "Invalid username or password",
  LOGOUT_SUCCESS: "Logged out successfully",
  AUTH_REQUIRED: "Authentication required!",
  TOKEN_EXPIRED: "Authentication token has expired",
  TOKEN_INVALID: "Invalid authentication token",
  SESSION_EXPIRED: "Session has expired. Please login again.",
});

module.exports = {
  BASIC_AUTH_SCHEME,
  AUTH_REALM,
  BASIC_TOKEN_RESPONSE_KEY,
  AUTH_STATE_KEY,
  AUTH_MESSAGES,
};
