const { ChatOpenAI } = require("@langchain/openai");
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { ChatAnthropic } = require("@langchain/anthropic");
const { ChatMistralAI } = require("@langchain/mistralai");
const { ChatCohere } = require("@langchain/cohere");
const { HuggingFaceInference } = require("@langchain/community/llms/hf");

// Keep these fresh (examples only)
const AI_MODELS = {
  OPENAI: {
    // Current, broadly available chat/reasoning models
    models: ["gpt-5", "gpt-5-mini", "gpt-5-nano", "gpt-4.1", "gpt-4o"],
    provider: "OpenAI",
  },
  GEMINI: {
    // Google Gemini public API focus
    models: ["gemini-2.5-flash", "gemini-2.5-pro"],
    provider: "Gemini",
  },
  ANTHROPIC: {
    // Use Anthropic's recommended aliases (they point to latest snapshots)
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
    // Latest public API model IDs (premier + stable prior)
    models: ["mistral-medium-2508", "mistral-large-2411", "mistral-small-2407", "codestral-2508"],
    provider: "Mistral",
  },
  COHERE: {
    // Command A family is current; older Command/Command-R* are deprecated
    models: [
      "command-a-03-2025",
      "command-a-reasoning-08-2025",
      "command-a-vision-07-2025",
      "command-r7b-12-2024",
    ],
    provider: "Cohere",
  },
  HUGGINGFACE: {
    // Leave as-is (examples); HF infra varies by account/space
    models: [
      "microsoft/DialoGPT-medium",
      "facebook/blenderbot-400M-distill",
      "microsoft/DialoGPT-large",
    ],
    provider: "HuggingFace",
  },
  PERPLEXITY: {
    // New Sonar names for the OpenAI-compatible endpoint
    models: ["sonar", "sonar-pro", "sonar-reasoning", "sonar-reasoning-pro", "sonar-deep-research"],
    provider: "Perplexity",
  },
};

function inferProvider(aiModel) {
  const m = aiModel.toLowerCase();
  if (m.startsWith("gemini")) return "Gemini";
  if (m.startsWith("claude")) return "Anthropic";
  if (m.startsWith("mistral") || m.startsWith("codestral")) return "Mistral";
  if (m.startsWith("pplx") || m.includes("sonar")) return "Perplexity";
  if (m.startsWith("command")) return "Cohere";
  if (m.includes("/")) return "HuggingFace";
  return "OpenAI";
}

const getAIModel = (aiModel, explicitApiKey) => {
  const provider = inferProvider(aiModel);

  const keys = {
    OpenAI: process.env.OPENAI_API_KEY,
    Gemini: process.env.GOOGLE_API_KEY,
    Anthropic: process.env.ANTHROPIC_API_KEY,
    Mistral: process.env.MISTRAL_API_KEY,
    Cohere: process.env.COHERE_API_KEY,
    HuggingFace: process.env.HUGGINGFACE_API_KEY,
    Perplexity: process.env.PPLX_API_KEY,
  };
  const apiKey = explicitApiKey || keys[provider];
  if (!apiKey) {
    throw new Error(
      `${provider} API key is missing. Please provide a valid API key for ${provider}.`,
    );
  }

  if (AI_MODELS.OPENAI.models.includes(aiModel)) {
    return new ChatOpenAI({ apiKey, model: aiModel, temperature: 0.7 });
  }

  if (AI_MODELS.GEMINI.models.includes(aiModel)) {
    return new ChatGoogleGenerativeAI({ apiKey, model: aiModel, temperature: 0.7 });
  }

  if (AI_MODELS.ANTHROPIC.models.includes(aiModel)) {
    return new ChatAnthropic({ apiKey, model: aiModel, temperature: 0.7 });
  }

  if (AI_MODELS.MISTRAL.models.includes(aiModel)) {
    return new ChatMistralAI({ apiKey, model: aiModel, temperature: 0.7 });
  }

  if (AI_MODELS.COHERE.models.includes(aiModel)) {
    return new ChatCohere({ apiKey, model: aiModel, temperature: 0.7 });
  }

  if (AI_MODELS.HUGGINGFACE.models.includes(aiModel)) {
    return new HuggingFaceInference({ apiKey, model: aiModel, temperature: 0.7 });
  }

  if (AI_MODELS.PERPLEXITY.models.includes(aiModel)) {
    return new ChatOpenAI({
      apiKey,
      model: aiModel,
      temperature: 0.7,
      baseURL: "https://api.perplexity.ai",
    });
  }

  throw new Error(
    `Unsupported AI model: ${aiModel}. Supported providers: ${Object.values(AI_MODELS)
      .map((m) => m.provider)
      .join(", ")}`,
  );
};

module.exports = { getAIModel, AI_MODELS };
