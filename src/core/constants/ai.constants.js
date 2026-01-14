/**
 * @fileoverview AI and LLM-related constants
 * Contains AI model configurations, API settings, and schema processing constants
 */

const DEFAULT_MODEL_TEMPERATURE = 0.7;
const FALLBACK_AI_MODEL = "gpt-4o";
const PERPLEXITY_API_BASE_URL = "https://api.perplexity.ai";
const HUGGINGFACE_API_BASE_URL = "https://router.huggingface.co/v1";
const SCHEMA_PROMPT_BUDGET_CHARS = 4000;

const AI_MODELS = Object.freeze({
  OPENAI: {
    models: [
      "gpt-5",
      "gpt-5-mini",
      "gpt-5-nano",
      "gpt-4.1",
      "gpt-4.1-mini",
      "gpt-4.1-nano",
      "gpt-4o",
      "gpt-4o-mini",
    ],
    provider: "OpenAI",
  },
  GEMINI: {
    models: [
      "gemini-2.5-flash",
      "gemini-2.5-pro",
      "gemini-2.0-flash",
      "gemini-1.5-pro",
      "gemini-1.5-flash",
    ],
    provider: "Gemini",
  },
  ANTHROPIC: {
    models: [
      "claude-opus-4-1",
      "claude-opus-4",
      "claude-sonnet-4",
      "claude-3-7-sonnet",
      "claude-3-5-sonnet",
      "claude-3-5-haiku",
      "claude-3-opus",
      "claude-3-sonnet",
    ],
    provider: "Anthropic",
  },
  MISTRAL: {
    models: [
      "mistral-medium-2508",
      "mistral-large-2411",
      "mistral-small-2407",
      "codestral-2508",
      "mistral-large-latest",
      "mistral-medium-latest",
      "mistral-small-latest",
      "codestral-latest",
    ],
    provider: "Mistral",
  },
  COHERE: {
    models: [
      "command-a-03-2025",
      "command-a-reasoning-08-2025",
      "command-a-vision-07-2025",
      "command-r7b-12-2024",
      "command-r",
      "command-r-plus",
    ],
    provider: "Cohere",
  },
  HUGGINGFACE: {
    models: [
      "meta-llama/Llama-3.1-8B-Instruct",
      "meta-llama/Llama-3.1-70B-Instruct",
      "Qwen/Qwen2.5-7B-Instruct",
      "mistralai/Mistral-7B-Instruct-v0.3",
      "mistralai/Mixtral-8x7B-Instruct-v0.1",
      "google/gemma-2-9b-it",
      "google/gemma-2-27b-it",
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
  HUGGINGFACE_API_BASE_URL,
  SCHEMA_PROMPT_BUDGET_CHARS,
  AI_MODELS,
};
