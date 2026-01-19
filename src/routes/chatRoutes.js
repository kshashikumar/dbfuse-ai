const express = require("express");

const chatController = require("../controllers/chatController");

const chatRouter = express.Router();

chatRouter.post("/session", chatController.createSession);
chatRouter.get("/history", chatController.getHistory);
chatRouter.post("/history", chatController.getHistory);
chatRouter.post("/feedback", chatController.submitFeedback);
chatRouter.post("/enrich-query", chatController.enrichQuery);

module.exports = chatRouter;
