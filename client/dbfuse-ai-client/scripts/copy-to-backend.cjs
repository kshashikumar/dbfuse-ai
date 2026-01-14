const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const buildDir = path.join(projectRoot, 'dist', 'dbfuse-ai-client');
const targetDir = path.resolve(projectRoot, '..', '..', 'src', 'public', 'dbfuse-ai-client');

if (!fs.existsSync(buildDir)) {
    console.error(`Build output not found at ${buildDir}. Run the build before copying.`);
    process.exit(1);
}

fs.mkdirSync(targetDir, { recursive: true });
fs.cpSync(buildDir, targetDir, { recursive: true });

console.log(`Copied client build from ${buildDir} -> ${targetDir}`);
