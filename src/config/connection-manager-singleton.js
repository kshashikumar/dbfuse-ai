// Exports a single shared ConnectionManager instance across the app
const ConnectionManager = require("./connection-manager");
const instance = new ConnectionManager();
module.exports = instance;
