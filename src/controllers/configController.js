/**
 * @fileoverview Configuration controller
 * Handles reading and updating application configuration
 */

const BaseController = require("./base/BaseController");
const logger = require("../utils/logger");
const configService = require("../services/ConfigService");
const connectionStore = require("../config/connection-store");
const { CONFIG_MESSAGES, HTTP_STATUS } = require("../core/constants");
const { CONFIG_PORT_RESTART_DELAY_MS, ENV_KEYS } = require("../core/env");

class ConfigController extends BaseController {
  /**
   * Read current configuration
   */
  async readConfig(req, res) {
    try {
      this.logOperation("readConfig", { user: req.user });

      const config = configService.readConfig();
      return this.sendSuccess(res, config);
    } catch (error) {
      this.handleError(res, error, "reading configuration");
    }
  }

  /**
   * Update configuration with validation and restart handling
   */
  async updateConfig(req, res) {
    try {
      const newConfig = req.body;

      this.logOperation("updateConfig", {
        user: req.user,
        hasPortChange: newConfig[ENV_KEYS.PORT] !== process.env[ENV_KEYS.PORT],
      });

      // Validate configuration
      const validation = configService.validateConfig(newConfig);
      if (!validation.valid) {
        logger.warn("Invalid configuration:", validation.errors);
        return this.sendError(res, validation.errors.join(", "), HTTP_STATUS.BAD_REQUEST);
      }

      // Get current config to check for changes
      const currentConfig = configService.readConfig();
      const restartInfo = configService.requiresRestart(currentConfig, newConfig);

      // Check if connections key was removed
      const currentConnectionsKey = currentConfig[ENV_KEYS.CONNECTIONS_KEY] || "";
      const newConnectionsKey = newConfig[ENV_KEYS.CONNECTIONS_KEY] || "";
      const keyRemoved = Boolean(currentConnectionsKey && !newConnectionsKey);

      // Write configuration with transaction safety
      const writeResult = configService.writeConfig(newConfig);

      if (!writeResult.success) {
        logger.error("Failed to write configuration:", writeResult.error);
        return this.sendError(
          res,
          writeResult.restored
            ? "Configuration save failed but previous config restored"
            : CONFIG_MESSAGES.SAVE_ERROR,
          HTTP_STATUS.INTERNAL_SERVER_ERROR,
        );
      }

      // Update process.env for immediate effect
      configService.updateProcessEnv(newConfig);

      // Handle connection store deletion if key removed
      let connectionsCleared = false;
      if (keyRemoved) {
        try {
          connectionsCleared = await connectionStore.deleteConnectionStore();
          if (connectionsCleared) {
            logger.warn("Connection store deleted due to encryption key removal");
          }
        } catch (deleteError) {
          logger.error("Failed to delete connection store:", deleteError);
        }
      }

      // Send response based on restart requirement
      if (restartInfo.requiresRestart) {
        const response = {
          message: CONFIG_MESSAGES.SAVE_SUCCESS_PORT_CHANGE,
          requiresRestart: true,
          reason: restartInfo.reason,
          oldValue: restartInfo.oldValue,
          newValue: restartInfo.newValue,
          connectionsCleared,
          configVersion: configService.getConfigVersion(),
        };

        this.sendSuccess(res, response);

        // Schedule server restart
        setTimeout(() => {
          logger.info(`Configuration change (${restartInfo.reason}) requires restart. Exiting...`);
          process.exit(0); // nodemon will restart
        }, CONFIG_PORT_RESTART_DELAY_MS);
      } else {
        const response = {
          message: CONFIG_MESSAGES.SAVE_SUCCESS,
          requiresRestart: false,
          connectionsCleared,
          configVersion: configService.getConfigVersion(),
        };

        this.sendSuccess(res, response);
      }
    } catch (error) {
      this.handleError(res, error, "updating configuration");
    }
  }
}

// Export controller instance with bound methods
const controller = new ConfigController();

module.exports = {
  readConfig: controller.readConfig.bind(controller),
  updateConfig: controller.updateConfig.bind(controller),
};
