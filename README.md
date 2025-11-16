<img src="assets/dbfuse-ai-logo.png" width="75" height="75" align="left" />

# DBFuse AI

[![npm version](https://img.shields.io/npm/v/dbfuse-ai.svg?color=success)](https://www.npmjs.com/package/dbfuse-ai)
[![Known Vulnerabilities](https://snyk.io/test/github/kshashikumar/dbfuse-ai/badge.svg)](https://snyk.io/test/github/kshashikumar/dbfuse-ai)
[![GitHub Stars](https://img.shields.io/github/stars/kshashikumar/dbfuse-ai?style=social)](https://github.com/kshashikumar/dbfuse-ai/stargazers)
[![Issues](https://img.shields.io/github/issues/kshashikumar/dbfuse-ai?color=0088ff)](https://github.com/kshashikumar/dbfuse-ai/issues)
[![Pull Requests](https://img.shields.io/github/issues-pr/kshashikumar/dbfuse-ai?color=0088ff)](https://github.com/kshashikumar/dbfuse-ai/pulls)
[![Contributors](https://img.shields.io/github/contributors/kshashikumar/dbfuse-ai)](https://github.com/kshashikumar/dbfuse-ai/graphs/contributors)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/kshashikumar/dbfuse-ai/badge)](https://securityscorecards.dev/viewer/?uri=github.com/kshashikumar/dbfuse-ai)

**DBFuse AI** is a simple web UI to connect to your databases, run SQL, and generate SQL with AI. It works with MySQL, PostgreSQL, SQL Server, Oracle, and SQLite.

## Features

- **Connect to Local/Remote Databases**  
  Easily connect to databases on your local machine or remote servers.
- **CRUD Operations**  
  Perform Create, Read, Update, and Delete actions on databases and tables.

- **Multi-Tab Support**  
  Work across multiple databases or queries simultaneously, with a smooth and responsive interface.

- **Query Editor with Autocompletion**  
  Write queries faster with intelligent autocompletion and syntax highlighting.

- **Improved Pagination**  
  Navigate large datasets with optimized pagination.

- **Rich User Interface**  
  A dynamic and user-friendly interface designed to enhance productivity.

- **Dynamic Result Grid**  
  Visualize query results with a responsive, grid-based layout.

- **Basic Authentication**  
  Optional authentication for added security when running on remote servers.

- **Clipboard Copy**  
  Quickly copy cell data with a single click.

- **AI Integration**  
  Leverage OpenAI and Google Gemini for generating intelligent SQL queries. Talk to your selected Database

## Prerequisites

- **Node.js 16.0.0 or above**  
  Install Node.js from the [official downloads page](https://nodejs.org/). Alternatively, manage versions dynamically with tools like nvm on macOS, Linux, or WSL.

- **npm 8.0.0 or above**  
  npm is bundled with Node.js. To upgrade, use:
  ```bash
  npm i -g npm
  ```
- A running database you can connect to (or a SQLite file)

## Ways to run

Pick the option that fits your setup. All commands below assume a Bash-compatible shell (Windows users can use Git Bash).

1. Global CLI (optional)

- The command name is `dbfuse-ai`. Install it globally from npm, then run it with optional flags:

  ```bash
  npm install -g dbfuse-ai
  dbfuse-ai              # starts interactively and asks for options

  # or non-interactive with arguments
  dbfuse-ai -p 5000 --model gemini-2.5-flash --apikey <YOUR_API_KEY>
  ```

  Command-line options:
  - `-p, --port <number>`: Server port (default 5000)
  - `--dbuser <username>` and `--dbpass <password>`: Set Basic Auth credentials for the web UI
  - `--model <name>` and `--apikey <key>`: Enable AI with the selected model and API key
  - `-v, --verbose`: Show detailed prompts and info in the CLI

  Supported AI providers include: Gemini, OpenAI, Anthropic, Mistral, Cohere, Hugging Face, and Perplexity. Without `--model` and `--apikey`, the CLI will ask whether to enable AI and guide you interactively.

  Then open http://localhost:5000.

2. Docker

- Use the prebuilt image for a quick start. Create a `docker-compose.yml` like:

  ```yaml
  version: "3.8"
  services:
    dbfuse-ai:
      container_name: dbfuse-ai
      image: shashikumarkasturi/dbfuse-ai:latest
      restart: unless-stopped
      ports:
        - "5000:5000"
      environment:
        - PORT=5000
        # Optional basic auth for UI (set both to enable)
        - DBFUSE_USERNAME=admin
        - DBFUSE_PASSWORD=admin
        # AI configuration (optional)
        - AI_PROVIDER=gemini
        - AI_MODEL=gemini-2.5-flash
        - AI_API_KEY=
      extra_hosts:
        - "host.docker.internal:host-gateway"
      tty: true
  ```

  Then run:

  ```bash
  docker compose up -d
  ```

  Open http://localhost:5000 and log in. To stop:

  ```bash
  docker compose down
  ```

3. Docker (development, hot reload)

- Run straight from your source tree with live reload using the provided `docker-compose-dev.yml`:

  ```bash
  docker compose -f docker-compose-dev.yml up
  ```

  Notes:
  - The container mounts your working folder and runs `npm install && npm run start` (nodemon) for the server.
  - It includes `extra_hosts: host.docker.internal:host-gateway` so the app can reach databases running on your host.
  - Leave `AI_API_KEY` empty in the YAML; export it locally instead of committing a real key.
  - You can copy `.env.example` to `.env` and customize values for local development.

4. Local development (server + client)

- Install dependencies at the repo root:

  ```bash
  npm install
  ```

- Start both backend and frontend together (concurrently):

  ```bash
  npm run dev
  ```

  This runs:
  - Backend (Express) with hot reload at http://localhost:5000
  - Frontend (Angular dev server) at http://localhost:4200

5. Local development (server only)

- Build frontend assets once and serve them from the backend:

  ```bash
  cd client/dbfuse-ai-client
  npm install
  npm run clean-build-compress
  cd ../../
  npm run start
  ```

  The backend serves the built UI from `src/public` at http://localhost:5000.

## AI Integration

DBFuse AI integrates OpenAI and Google Gemini to generate intelligent SQL queries with the following features:

### Setting Up AI Integration

To enable AI-powered prompt querying, you need to set up the API keys for OpenAI or Google Gemini:

1. **Obtain an API Key**
   - For OpenAI: Visit OpenAI's platform and generate an API key.
   - For Google Gemini: Follow Google's platform to obtain an API key (free tier provides 15 requests per minute).
2. **Add the API Key to Your Environment Variables**
   In the root directory of your project, create a .env file (or set env vars in Docker):

```bash
AI_PROVIDER=gemini
AI_MODEL=gemini-2.5-flash
AI_API_KEY=<YOUR_API_KEY>
```

3. **Restart DBFuse**
   Restart the application to activate AI integration.

### Using AI Prompt Querying

- Enable AI from the user interface using the AI toggle button.
- Write a natural language query in the input box and click on AI Prompt button, AI will generate the corresponding SQL query.
- The AI can join tables, generate aggregated queries, and suggest optimal SQL syntax based on the database you selected.

**Example Workflow:**

1. Write a query prompt:
   `Find the average salary of employees in each department.`
2. The AI generates the SQL:

```bash
SELECT Department, AVG(Salary) AS AvgSalary FROM employeerecords GROUP BY Department;
```

### Supported AI Models

Below is the current list of model IDs you can use with `--model` (CLI), the Config UI, or via environment variables. Keep provider + model aligned (provider casing is normalized automatically).

| Provider    | Models                                                                                                |
| ----------- | ----------------------------------------------------------------------------------------------------- |
| Gemini      | `gemini-2.5-flash`, `gemini-2.5-pro`                                                                  |
| OpenAI      | `gpt-5`, `gpt-5-mini`, `gpt-5-nano`, `gpt-4.1`, `gpt-4o`                                              |
| Anthropic   | `claude-opus-4-1`, `claude-opus-4`, `claude-sonnet-4`, `claude-3-7-sonnet`, `claude-3-5-haiku`        |
| Mistral     | `mistral-medium-2508`, `mistral-large-2411`, `mistral-small-2407`, `codestral-2508`                   |
| Cohere      | `command-a-03-2025`, `command-a-reasoning-08-2025`, `command-a-vision-07-2025`, `command-r7b-12-2024` |
| HuggingFace | `microsoft/DialoGPT-medium`, `facebook/blenderbot-400M-distill`, `microsoft/DialoGPT-large`           |
| Perplexity  | `sonar`, `sonar-pro`, `sonar-reasoning`, `sonar-reasoning-pro`, `sonar-deep-research`                 |

Notes:

1. HuggingFace models are examples; you can substitute any compatible chat/text model available to your account.
2. Perplexity models use the OpenAI-compatible API surface; the app sets the correct base URL automatically.
3. Additional models can be added by editing `src/models/model.js` (server) and `cli.js` (CLI list) — keep both in sync for best UX.
4. If you only set `AI_MODEL`, the provider is inferred automatically (e.g. any `claude-*` → Anthropic).
5. The generic `AI_API_KEY` is mirrored to provider-specific variables (`OPENAI_API_KEY`, `GOOGLE_API_KEY`, etc.) internally.

## Security Note

- Confidentiality: Never expose your .env file containing the API key.
- **Secure Connections**: Ensure your MySQL connections and API keys are used securely, especially in production.

### Environment Variables

- PORT: Server port (default 5000)
- DBFUSE_USERNAME / DBFUSE_PASSWORD: enable Basic Auth for the web UI (optional)
- AI_PROVIDER, AI_MODEL, AI_API_KEY: AI settings (optional)
- BODY_SIZE: request body size limit (default 50mb)
- NODE_ENV: set to `production` in containers for best performance
  Note: Database connection details are entered via the UI; no DB URL environment variables are used by the server.

Tips:

- When running inside Docker, use `host.docker.internal` to connect to databases on your host machine (we add `extra_hosts` for Linux compatibility).
- Prefer exporting secrets (like AI_API_KEY) in your shell or using Docker secrets; avoid committing real keys to version control.
- For a quick start, copy `.env.example` to `.env` and adjust values. The app reads `.env` automatically.

### Supported Databases

- MySQL
- PostgreSQL
- Microsoft SQL Server
- Oracle Database
- SQLite

## CLI (optional)

If you installed globally with npm, you can start with:

```bash
dbfuse-ai -p 5000 --model gemini-2.5-flash --apikey <YOUR_API_KEY>
```

Then open http://localhost:5000.

## Testing (optional)

Basic connectivity test suites are available:

```bash
npm run test:all       # run all DB connectivity tests (requires databases available)
npm run test:mysql     # MySQL
npm run test:postgres  # PostgreSQL
npm run test:mssql     # SQL Server
npm run test:oracle    # Oracle
```

These tests expect databases reachable at the configured defaults; adjust environment variables as needed.

## Basic Authentication (Optional)

Protect data with basic authentication when running on remote servers.

1. Create a `.env` file in the root directory.
2. Add the following variables

```bash
DBFUSE_USERNAME=<your_username>
DBFUSE_PASSWORD=<your_password>
```

3. Restart the server.

To disable authentication, remove these variables from `.env` and restart the server.

## Upcoming Features

- Additional databases: MariaDB, NoSQL and caches via strategy adapters (MongoDB, Redis)
- SSH tunneling and client certificate auth for secure remote connections
- Query history, saved connections/snippets, and export to CSV/JSON/Excel
- Schema explorer improvements (indexes/constraints), and ER diagram view
- AI: Explain/optimize queries and suggest indexes in addition to SQL generation
- Charts and visual analysis for query results (line/bar/pie), with quick pivots
- Pluggable driver/extension SDK to add new databases and tools
- MCP servers implementation to connect to different databases

## Contributions

DBFuse AI is open for **contributions**! If you have ideas for features, improvements, or bug fixes, feel free to submit a pull request or open an issue.

## Demo

<p align="center">
  <video src="https://github.com/user-attachments/assets/0cf93034-246e-4938-8531-4a1b92b9ad01" width="800" controls title="DBFuse AI Demo">
    Your browser does not support the video tag.
  </video>
</p>

## Merging Guidelines

Follow these guidelines to keep the repo healthy and the history clean.

- Branches
  - Create feature branches from main: feature/<short-description>, fix/<issue-id>, chore/<task>.
  - Use issue numbers in branch name when applicable (e.g. feature/123-add-pagination).

- Commits
  - Use concise, conventional commit-style messages: type(scope): short summary
    - types: feat, fix, docs, chore, refactor, test, ci
  - Keep commits focused and atomic.

- Local workflow (recommended)
  1. git checkout main
  2. git pull --rebase origin main
  3. git checkout -b feature/your-change
  4. Make changes, run lint/tests
     - npm run lint
     - npm test
  5. git add .
  6. git commit -m "feat(scope): short description"
  7. git pull --rebase origin main
  8. git push origin feature/your-change

- Pull Requests
  - Open PR against main with a clear description and testing steps.
  - Include related issue/issue number.
  - Attach screenshots or logs when UI/behavior changes.
  - Add labels and set reviewers as needed.
  - PR checklist:
    - Code compiles and passes lint/tests
    - No console errors/warnings for UI changes
    - Updated README or docs when behavior/config changed
    - Minimal, descriptive PR title and body

- CI & Tests
  - Ensure CI passes before merging.
  - Fix failing tests locally before pushing.
  - If CI fails after your merge, revert or patch promptly.

- Merge strategy
  - Prefer "Squash and merge" for feature/fix PRs to keep main history clean.
  - Use "Rebase and merge" only when preserving individual commits is required.
  - Avoid direct merges to main; always use PRs.

- Conflict resolution
  - Rebase your branch onto the latest main, resolve conflicts locally, run tests, then force-push:
    - git fetch origin
    - git rebase origin/main
    - Resolve conflicts, git add <file>, git rebase --continue
    - git push --force-with-lease origin feature/your-change

- Small PRs and Reviews
  - Prefer small, focused PRs (max ~300 lines changed) for faster review.
  - Respond to review comments promptly and request re-review.

- Release notes / Changelog
  - Add notable user-facing changes to the PR description; maintainers will add to changelog as needed.
  
- Emergency hotfixes
  - Create a hotfix branch from main, test thoroughly, and open a PR with high priority reviewers.

## License

DBFuse AI is distributed under the [MIT License](LICENSE). This license permits commercial use, modification, distribution, and private use, with the requirement to include the original copyright and license notice.
