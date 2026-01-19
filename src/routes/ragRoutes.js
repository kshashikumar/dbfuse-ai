const express = require("express");

const ragController = require("../controllers/ragController");

const ragRouter = express.Router();

ragRouter.post("/schema/refresh", ragController.refreshSchema);
ragRouter.get("/schema/context", ragController.getContext);
ragRouter.post("/schema/context", ragController.getContext);
ragRouter.post("/analyze", ragController.analyzeQuery);
ragRouter.post("/query", ragController.query);
ragRouter.get("/history", ragController.getHistory);
ragRouter.post("/feedback", ragController.submitFeedback);

module.exports = ragRouter;
