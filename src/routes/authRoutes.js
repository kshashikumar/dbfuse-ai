const express = require("express");
const rateLimit = require("express-rate-limit");

const authController = require("../controllers/authController");
const authRouter = express.Router();

// Rate limiter for authentication routes
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: "Too many authentication attempts, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
});

authRouter.post("/login", authLimiter, authController.login);
authRouter.post("/logout", authLimiter, authController.logout);
authRouter.get("/isAuthenticated", authLimiter, authController.isAuthenticated);

module.exports = authRouter;
