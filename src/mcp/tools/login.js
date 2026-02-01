const { z } = require("zod");

const { MCP_ENV_VARS } = require("../../core/constants");

const tool = {
  name: "login",
  description: "Authenticate with the server",
  inputSchema: z.object({
    username: z.string().describe("Username for authentication"),
    password: z.string().describe("Password for authentication"),
  }),
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
