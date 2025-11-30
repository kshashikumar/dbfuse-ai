const { MCP_ENV_VARS } = require("../../core/constants");

const tool = {
  name: "login",
  description: "Authenticate with the server",
  inputSchema: {
    type: "object",
    properties: {
      username: { type: "string" },
      password: { type: "string" },
    },
    required: ["username", "password"],
  },
  handler: async (args, { setAuthenticated }) => {
    const { username, password } = args;
    if (
      username === process.env[MCP_ENV_VARS.USERNAME] &&
      password === process.env[MCP_ENV_VARS.PASSWORD]
    ) {
      setAuthenticated(true);
      return {
        content: [{ type: "text", text: "Logged in successfully" }],
      };
    }
    throw new Error("Invalid credentials");
  },
};

module.exports = tool;
