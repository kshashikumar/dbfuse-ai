/**
 * @fileoverview AI and LLM-related constants
 * Contains AI model configurations, API settings, and schema processing constants
 */

const DEFAULT_MODEL_TEMPERATURE = 0.7;
const FALLBACK_AI_MODEL = "gpt-4";
const PERPLEXITY_API_BASE_URL = "https://api.perplexity.ai";
const SCHEMA_PROMPT_BUDGET_CHARS = 4000;

const AI_MODELS = Object.freeze({
  OPENAI: {
    models: ["gpt-5", "gpt-5-mini", "gpt-5-nano", "gpt-4.1", "gpt-4o"],
    provider: "OpenAI",
  },
  GEMINI: {
    models: ["gemini-2.5-flash", "gemini-2.5-pro"],
    provider: "Gemini",
  },
  ANTHROPIC: {
    models: [
      "claude-opus-4-1",
      "claude-opus-4",
      "claude-sonnet-4",
      "claude-3-7-sonnet",
      "claude-3-5-haiku",
    ],
    provider: "Anthropic",
  },
  MISTRAL: {
    models: ["mistral-medium-2508", "mistral-large-2411", "mistral-small-2407", "codestral-2508"],
    provider: "Mistral",
  },
  COHERE: {
    models: [
      "command-a-03-2025",
      "command-a-reasoning-08-2025",
      "command-a-vision-07-2025",
      "command-r7b-12-2024",
    ],
    provider: "Cohere",
  },
  HUGGINGFACE: {
    models: [
      "microsoft/DialoGPT-medium",
      "facebook/blenderbot-400M-distill",
      "microsoft/DialoGPT-large",
    ],
    provider: "HuggingFace",
  },
  PERPLEXITY: {
    models: ["sonar", "sonar-pro", "sonar-reasoning", "sonar-reasoning-pro", "sonar-deep-research"],
    provider: "Perplexity",
  },
});

module.exports = {
  DEFAULT_MODEL_TEMPERATURE,
  FALLBACK_AI_MODEL,
  PERPLEXITY_API_BASE_URL,
  SCHEMA_PROMPT_BUDGET_CHARS,
  AI_MODELS,
};
