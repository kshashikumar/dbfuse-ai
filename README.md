<img src="assets/dbfuse-ai-logo.png" width=75 height=75 align=left />

# DBFuse

[![npm version](https://img.shields.io/npm/v/dbfuse-ai.svg?color=success)](https://www.npmjs.com/package/dbfuse-ai)
[![Known Vulnerabilities](https://snyk.io/test/github/kshashikumar/dbfuse-ai/badge.svg)](https://snyk.io/test/github/kshashikumar/dbfuse-ai)
[![GitHub stars](https://img.shields.io/github/stars/kshashikumar/dbfuse-ai.svg?style=social)](https://github.com/kshashikumar/dbfuse-ai/stargazers)

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

1. Docker (production image)

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
        # AI configuration (optional) — DO NOT commit real keys to Git
        - AI_PROVIDER=gemini
        - AI_MODEL=gemini-2.5-flash
        - AI_API_KEY=
      extra_hosts:
        - "host.docker.internal:host-gateway"
  ```

  Then run:

  ```bash
  docker compose up -d
  ```

  Open http://localhost:5000 and log in. To stop:

  ```bash
  docker compose down
  ```

2. Docker (development, hot reload)

- Run straight from your source tree with live reload using the provided `docker-compose-dev.yml`:

  ```bash
  docker compose -f docker-compose-dev.yml up
  ```

  Notes:
  - The container mounts your working folder and runs `npm install && npm run start` (nodemon) for the server.
  - It includes `extra_hosts: host.docker.internal:host-gateway` so the app can reach databases running on your host.
  - Leave `AI_API_KEY` empty in the YAML; export it locally instead of committing a real key.
  - You can copy `.env.example` to `.env` and customize values for local development.

3. Local development (server + client)

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

4. Local development (server only)

- Build frontend assets once and serve them from the backend:

  ```bash
  cd client/dbfuse-ai-client
  npm install
  npm run clean-build-compress
  cd ../../
  npm run start
  ```

  The backend serves the built UI from `src/public` at http://localhost:5000.

5. Global CLI (optional)

- Install the CLI globally from npm and run directly:

  ```bash
  npm install -g dbfuse-ai
  dbfuse-ai -p 5000 --model gemini-2.5-flash --apikey <YOUR_API_KEY>
  ```

  Then open http://localhost:5000.

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

- **Multi-Relational DB Support**: PostgreSQL, MariaDB, SQLite3, Oracle, Amazon Redshift, and more.
- **Dynamic Filtering**: Filter data directly within result grids.
- **Result Limit Options**: Control the number of records displayed.
- **Enhanced AI Integration**: Leverage AI for complex query generation and analysis.

## Contributions

DBFuse AI is open for **contributions**! If you have ideas for features, improvements, or bug fixes, feel free to submit a pull request or open an issue.

## Demo

![dbfuse-ai](assets/dbfuse-gif.gif)
![dbfuse-ai](assets/dbfuse-ai-ai-gif.gif)

## License

DBFuse AI is distributed under the [MIT License](LICENSE). This license permits commercial use, modification, distribution, and private use, with the requirement to include the original copyright and license notice.
