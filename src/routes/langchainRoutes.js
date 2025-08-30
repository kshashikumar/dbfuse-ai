const express = require("express");
const langchainController = require("../controllers/langchainController");
const langchainRouter = express.Router();

langchainRouter.post("/prompt", langchainController.executePrompt);

module.exports = langchainRouter;
