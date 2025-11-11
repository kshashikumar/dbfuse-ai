#!/usr/bin/env node
const path = require("path");
const fs = require("fs");
const readline = require("readline");
const { execSync } = require("child_process");

const nodemon = require("nodemon");
const argv = require("minimist")(process.argv.slice(2));
const chalk = require("chalk");

const MIN_NODE_VERSION = 16;
const MIN_NPM_VERSION = 8;
const [majorVersion] = process.versions.node.split(".").map(Number);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const defaultPort = 5000;
const isVerbose = !!(argv.verbose || argv.v); // default quiet; enable details with --verbose/-v

// Modern AI models with updated pricing and availability
const supportedModels = {
  gemini: {
    models: ["gemini-2.5-flash", "gemini-2.5-pro"],
    note: "Free tier available",
    description: "Google's latest AI models",
  },
  openai: {
    models: ["gpt-5", "gpt-5-mini", "gpt-5-nano", "gpt-4.1", "gpt-4o"],
    note: "Paid",
    description: "OpenAI's ChatGPT models",
  },
  anthropic: {
    models: [
      "claude-opus-4-1",
      "claude-opus-4",
      "claude-sonnet-4",
      "claude-3-7-sonnet",
      "claude-3-5-haiku",
    ],
    note: "Paid (Haiku most affordable)",
    description: "Anthropic's Claude models",
  },
  mistral: {
    models: ["mistral-medium-2508", "mistral-large-2411", "mistral-small-2407", "codestral-2508"],
    note: "Paid",
    description: "Mistral AI's models",
  },
  cohere: {
    models: [
      "command-a-03-2025",
      "command-a-reasoning-08-2025",
      "command-a-vision-07-2025",
      "command-r7b-12-2024",
    ],
    note: "Free tier available",
    description: "Cohere's language models",
  },
  huggingface: {
    models: [
      "microsoft/DialoGPT-medium",
      "facebook/blenderbot-400M-distill",
      "microsoft/DialoGPT-large",
    ],
    note: "Free",
    description: "Open-source models via Hugging Face",
  },
  perplexity: {
    models: ["sonar", "sonar-pro", "sonar-reasoning", "sonar-reasoning-pro", "sonar-deep-research"],
    note: "Paid",
    description: "Perplexity's search-enhanced models",
  },
};

// Utility functions for better UX
function displayHeader() {
  if (!isVerbose) return;
  console.clear();
  console.log(chalk.cyan.bold("╔══════════════════════════════════════════════════════════════╗"));
  console.log(chalk.cyan.bold("║                        DBFuse AI Setup                      ║"));
  console.log(chalk.cyan.bold("║            Database GUI with AI-Powered Features            ║"));
  console.log(chalk.cyan.bold("╚══════════════════════════════════════════════════════════════╝"));
  console.log();
}

function displaySection(title) {
  if (!isVerbose) return;
  console.log(chalk.yellow.bold(`\n${title}`));
  console.log(chalk.gray("─".repeat(50)));
}

function displaySuccess(message) {
  if (!isVerbose) return;
  console.log(chalk.green.bold(`${message}`));
}

function displayInfo(message) {
  if (!isVerbose) return;
  console.log(chalk.blue(`${message}`));
}

function displayWarning(message) {
  console.log(chalk.yellow(`${message}`));
}

function askQuestion(question, defaultValue = null) {
  return new Promise((resolve) => {
    const prompt = defaultValue
      ? `${question} (default: ${chalk.gray(defaultValue)}): `
      : `${question}: `;

    rl.question(chalk.white(prompt), (answer) => {
      resolve(answer.trim() === "" && defaultValue ? defaultValue : answer.trim());
    });
  });
}

function askYesNo(question, defaultValue = null) {
  return new Promise((resolve) => {
    const options = defaultValue === true ? "[Y/n]" : defaultValue === false ? "[y/N]" : "[y/n]";
    rl.question(chalk.white(`${question} ${options}: `), (answer) => {
      const response = answer.toLowerCase().trim();
      if (response === "") {
        resolve(defaultValue);
      } else {
        resolve(response === "y" || response === "yes");
      }
    });
  });
}

async function askForPort() {
  displaySection("Server Configuration");
  const port = await askQuestion(`Server port`, defaultPort);
  const portNumber = parseInt(port, 10);
  return isNaN(portNumber) ? defaultPort : portNumber;
}

async function askForDatabaseCredentials() {
  displaySection("Database Configuration");

  const useCustomCreds = await askYesNo("Configure custom database credentials?", false);

  if (!useCustomCreds) {
    if (isVerbose) displayInfo("Using default credentials (root/root)");
    return { username: "root", password: "root" };
  }

  if (isVerbose) console.log(chalk.cyan("\nEnter your database credentials:"));
  const username = await askQuestion("   Username", "root");
  const password = await askQuestion("   Password", "root");

  return { username, password };
}

async function askForAIUsage() {
  displaySection("AI Configuration");
  if (isVerbose)
    displayInfo(
      "AI features enhance DBFuse with intelligent query suggestions and database insights.",
    );
  return await askYesNo("Enable AI features?", true);
}

async function askForAIModel() {
  console.log(chalk.cyan.bold("\nAvailable AI Models:"));
  console.log();

  let counter = 1;
  const modelMap = {};

  Object.entries(supportedModels).forEach(([providerKey, providerData]) => {
    const providerName = providerKey.charAt(0).toUpperCase() + providerKey.slice(1);
    providerData.models.forEach((model) => {
      console.log(
        ` ${chalk.white(counter.toString().padStart(2))}. ${chalk.green(providerName)} - ${chalk.green(model)}`,
      );
      modelMap[counter] = {
        provider: providerName === "Huggingface" ? "HuggingFace" : providerName,
        model,
      };
      counter++;
    });
  });

  const choice = await askQuestion("Select your preferred AI model (number)");
  const selectedModel = modelMap[choice];

  if (selectedModel) {
    return selectedModel;
  } else {
    displayWarning("Invalid selection. Using default: Gemini 2.5 Flash");
    return { provider: "Gemini", model: "gemini-2.5-flash" };
  }
}

async function askForAPIKey(provider) {
  const providerMap = {
    OpenAI: { name: "OpenAI", url: "https://platform.openai.com/api-keys" },
    Gemini: { name: "Google Gemini", url: "https://makersuite.google.com/app/apikey" },
    HuggingFace: { name: "Hugging Face", url: "https://huggingface.co/settings/tokens" },
    Cohere: { name: "Cohere", url: "https://dashboard.cohere.ai/api-keys" },
    Anthropic: { name: "Anthropic Claude", url: "https://console.anthropic.com/" },
    Mistral: { name: "Mistral AI", url: "https://console.mistral.ai/" },
    Perplexity: { name: "Perplexity", url: "https://www.perplexity.ai/settings/api" },
  };

  const providerInfo = providerMap[provider] || { name: provider, url: "" };

  if (isVerbose) console.log(chalk.blue(`\n${providerInfo.name} API Key Required`));
  if (providerInfo.url) {
    if (isVerbose) console.log(chalk.gray(`   Get your key at: ${providerInfo.url}`));
  }

  return await askQuestion(`   Enter your ${providerInfo.name} API key`);
}

// Merge / create .env in the execution CWD so the UI reflects CLI selections.
// Existing keys not in our config remain untouched.
function syncEnvFile(config) {
  try {
    const baseDir =
      process.env.DBFUSE_CONFIG_DIR && process.env.DBFUSE_CONFIG_DIR.trim()
        ? process.env.DBFUSE_CONFIG_DIR.trim()
        : path.resolve(__dirname);
    const envPath = path.join(baseDir, ".env");
    let existing = {};
    if (fs.existsSync(envPath)) {
      const raw = fs.readFileSync(envPath, "utf8");
      raw.split("\n").forEach((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) return;
        const [key, ...rest] = trimmed.split("=");
        if (!key || !rest.length) return;
        let val = rest.join("=");
        val = val.replace(/^"|"$/g, "");
        existing[key] = val;
      });
    }
    const merged = {
      ...existing,
      AI_MODEL: config.aiModel || existing.AI_MODEL || "",
      AI_API_KEY: config.apiKey || existing.AI_API_KEY || "",
      AI_PROVIDER: config.aiProvider || existing.AI_PROVIDER || "",
      PORT: String(config.port || existing.PORT || 5000),
      DBFUSE_USERNAME: config.dbUsername || existing.DBFUSE_USERNAME || "root",
      DBFUSE_PASSWORD: config.dbPassword || existing.DBFUSE_PASSWORD || "root",
    };
    const content = Object.entries(merged)
      .map(([k, v]) => {
        const needsQuotes = /\s|=/.test(v);
        return `${k}=${needsQuotes ? `"${v}"` : v}`;
      })
      .join("\n");
    fs.writeFileSync(envPath, content);
    if (isVerbose) displayInfo(`Synchronized .env at ${envPath}`);
  } catch (e) {
    displayWarning(`Failed to sync .env file: ${e.message}`);
  }
}

function validateEnvironment() {
  displaySection("Environment Check");

  if (majorVersion < MIN_NODE_VERSION) {
    console.error(
      chalk.red(
        `Node.js version ${MIN_NODE_VERSION} or higher is required. Current: ${majorVersion}`,
      ),
    );
    process.exit(1);
  }
  displaySuccess(`Node.js ${process.version}`);

  try {
    const npmVersion = execSync("npm --version").toString().trim();
    const [npmMajorVersion] = npmVersion.split(".").map(Number);
    if (npmMajorVersion < MIN_NPM_VERSION) {
      console.error(
        chalk.red(`npm version ${MIN_NPM_VERSION} or higher is required. Current: ${npmVersion}`),
      );
      process.exit(1);
    }
    displaySuccess(`npm ${npmVersion}`);
  } catch (error) {
    console.error(
      chalk.red("Failed to check npm version. Ensure npm is installed and accessible."),
    );
    process.exit(1);
  }
}

function displayConfiguration(config) {
  displaySection("Configuration Summary");
  console.log(chalk.white(`Server Port: ${chalk.green(config.port)}`));
  console.log(chalk.white(`Database User: ${chalk.green(config.dbUsername)}`));
  console.log(chalk.white(`Database Pass: ${chalk.green("*".repeat(config.dbPassword.length))}`));

  if (config.aiEnabled) {
    console.log(chalk.white(`AI Provider: ${chalk.green(config.aiProvider)}`));
    console.log(chalk.white(`AI Model: ${chalk.green(config.aiModel)}`));
    console.log(
      chalk.white(`API Key: ${chalk.green(config.apiKey ? "Configured" : "Not provided")}`),
    );
  } else {
    console.log(chalk.white(`AI Features: ${chalk.yellow("Disabled")}`));
  }
}

async function main() {
  try {
    displayHeader();
    validateEnvironment();

    // Handle command line arguments
    const config = {
      port: argv.p || (await askForPort()),
      aiEnabled: false,
      aiProvider: "",
      aiModel: "",
      apiKey: "",
    };

    // Database credentials
    if (argv.dbuser && argv.dbpass) {
      config.dbUsername = argv.dbuser;
      config.dbPassword = argv.dbpass;
    } else {
      const dbCreds = await askForDatabaseCredentials();
      config.dbUsername = dbCreds.username;
      config.dbPassword = dbCreds.password;
    }

    // AI Configuration
    if (argv.model && argv.apikey) {
      config.aiEnabled = true;
      config.aiModel = argv.model;
      config.apiKey = argv.apikey;

      // Determine provider based on model
      let provider = null;
      for (const [providerKey, providerData] of Object.entries(supportedModels)) {
        if (providerData.models.includes(argv.model)) {
          provider =
            providerKey === "gemini"
              ? "Gemini"
              : providerKey === "openai"
                ? "OpenAI"
                : providerKey === "anthropic"
                  ? "Anthropic"
                  : providerKey === "mistral"
                    ? "Mistral"
                    : providerKey === "cohere"
                      ? "Cohere"
                      : providerKey === "huggingface"
                        ? "HuggingFace"
                        : providerKey === "perplexity"
                          ? "Perplexity"
                          : null;
          break;
        }
      }

      if (!provider) {
        console.error(chalk.red("Invalid AI model specified. Exiting..."));
        process.exit(1);
      }
      config.aiProvider = provider;
    } else {
      config.aiEnabled = await askForAIUsage();

      if (config.aiEnabled) {
        const selectedModel = await askForAIModel();
        config.aiProvider = selectedModel.provider;
        config.aiModel = selectedModel.model;
        config.apiKey = await askForAPIKey(selectedModel.provider);
      }
    }

    // Set environment variables
    process.env.PORT = config.port;
    process.env.DBFUSE_USERNAME = config.dbUsername;
    process.env.DBFUSE_PASSWORD = config.dbPassword;
    process.env.AI_PROVIDER = config.aiProvider;
    process.env.AI_MODEL = config.aiModel;
    process.env.AI_API_KEY = config.apiKey;

    // Provider-specific API key export (for downstream model loader convenience)
    if (config.apiKey) {
      const providerMap = {
        OpenAI: "OPENAI_API_KEY",
        Gemini: "GOOGLE_API_KEY",
        Anthropic: "ANTHROPIC_API_KEY",
        Mistral: "MISTRAL_API_KEY",
        Cohere: "COHERE_API_KEY",
        HuggingFace: "HUGGINGFACE_API_KEY",
        Perplexity: "PPLX_API_KEY",
      };
      const varName = providerMap[config.aiProvider];
      if (varName) process.env[varName] = config.apiKey;
    }

    // Persist selections for UI / subsequent restarts
    syncEnvFile(config);

    // Display final configuration
    displayConfiguration(config);

    displaySection("Starting DBFuse AI");
    displayInfo("Press Ctrl+C to stop the server");
    console.log();

    const scriptPath = path.resolve(__dirname, "src/index.js");
    // Run nodemon with a controlled working directory and limited watch scope
    // to avoid picking up unrelated filesystem changes (e.g., VSCode workspace storage)
    nodemon({
      script: scriptPath,
      stdout: false,
      cwd: path.resolve(__dirname),
      watch: [path.resolve(__dirname, "src")],
      ignore: ["**/node_modules/**", "**/.vscode/**", "**/workspaceStorage/**"],
    });

    nodemon.on("start", () => {
      console.log(
        chalk.green.bold(
          `> Login Credentials: ${process.env.DBFUSE_USERNAME} / ${process.env.DBFUSE_PASSWORD}`,
        ),
      );
      console.log(chalk.green.bold(`DBFuse AI is running on http://localhost:${config.port}`));
    });

    nodemon.on("restart", (files) => {
      console.log(chalk.blue("App restarted due to:", files));
    });
  } catch (error) {
    console.error(chalk.red("Setup failed:"), error.message);
    process.exit(1);
  } finally {
    rl.close();
  }
}

// Graceful shutdown
process.on("SIGINT", () => {
  console.log(chalk.yellow("\nShutting down DBFuse AI..."));
  rl.close();
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log(chalk.yellow("\nShutting down DBFuse AI..."));
  rl.close();
  process.exit(0);
});

main().catch((error) => {
  console.error(chalk.red("An unexpected error occurred:"), error);
  rl.close();
  process.exit(1);
});
