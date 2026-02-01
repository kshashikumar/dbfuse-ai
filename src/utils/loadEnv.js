const dotenv = require("dotenv");

const loadEnv = (options = {}) => dotenv.config({ override: true, ...options });

module.exports = { loadEnv };
