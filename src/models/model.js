const { ChatOpenAI } = require("@langchain/openai");
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { ChatAnthropic } = require("@langchain/anthropic");
const { ChatMistralAI } = require("@langchain/mistralai");
const { ChatCohere } = require("@langchain/cohere");

const {
  AI_MODELS,
  DEFAULT_MODEL_TEMPERATURE,
  PERPLEXITY_API_BASE_URL,
  HUGGINGFACE_API_BASE_URL,
} = require("../core/constants");
const { inferProviderFromModel, PROVIDER_API_ENV_KEYS } = require("../core/env");

const resolveModel = (models, aiModel) => {
  if (!aiModel || typeof aiModel !== "string") return "";
  const lower = aiModel.toLowerCase();
  return models.find((model) => model.toLowerCase() === lower);
};

const getAIModel = (aiModel, explicitApiKey) => {
  const provider = inferProviderFromModel(aiModel);

  const envVarName = PROVIDER_API_ENV_KEYS[provider];
  const apiKey = explicitApiKey || (envVarName ? process.env[envVarName] : undefined);
  if (!apiKey) {
    throw new Error(
      `${provider} API key is missing. Please provide a valid API key for ${provider}.`,
    );
  }

  const openAIModel = resolveModel(AI_MODELS.OPENAI.models, aiModel);
  if (openAIModel) {
    return new ChatOpenAI({
      apiKey,
      model: openAIModel,
      temperature: DEFAULT_MODEL_TEMPERATURE,
    });
  }

  const geminiModel = resolveModel(AI_MODELS.GEMINI.models, aiModel);
  if (geminiModel) {
    return new ChatGoogleGenerativeAI({
      apiKey,
      model: geminiModel,
      temperature: DEFAULT_MODEL_TEMPERATURE,
    });
  }

  const anthropicModel = resolveModel(AI_MODELS.ANTHROPIC.models, aiModel);
  if (anthropicModel) {
    return new ChatAnthropic({
      apiKey,
      model: anthropicModel,
      temperature: DEFAULT_MODEL_TEMPERATURE,
    });
  }

  const mistralModel = resolveModel(AI_MODELS.MISTRAL.models, aiModel);
  if (mistralModel) {
    return new ChatMistralAI({
      apiKey,
      model: mistralModel,
      temperature: DEFAULT_MODEL_TEMPERATURE,
    });
  }

  const cohereModel = resolveModel(AI_MODELS.COHERE.models, aiModel);
  if (cohereModel) {
    return new ChatCohere({
      apiKey,
      model: cohereModel,
      temperature: DEFAULT_MODEL_TEMPERATURE,
    });
  }

  const huggingFaceModel = resolveModel(AI_MODELS.HUGGINGFACE.models, aiModel);
  if (huggingFaceModel) {
    // HuggingFace via OpenAI-compatible API with extended timeout
    return new ChatOpenAI({
      apiKey: apiKey,
      model: huggingFaceModel,
      temperature: DEFAULT_MODEL_TEMPERATURE,
      timeout: 60000, // 60 second timeout for HuggingFace cold starts
      configuration: {
        baseURL: HUGGINGFACE_API_BASE_URL,
      },
    });
  }

  const perplexityModel = resolveModel(AI_MODELS.PERPLEXITY.models, aiModel);
  if (perplexityModel) {
    return new ChatOpenAI({
      apiKey,
      model: perplexityModel,
      temperature: DEFAULT_MODEL_TEMPERATURE,
      configuration: {
        baseURL: PERPLEXITY_API_BASE_URL,
      },
    });
  }

  if (provider === "Gemini") {
    return new ChatGoogleGenerativeAI({
      apiKey,
      model: aiModel,
      temperature: DEFAULT_MODEL_TEMPERATURE,
    });
  }

  if (provider === "Anthropic") {
    return new ChatAnthropic({ apiKey, model: aiModel, temperature: DEFAULT_MODEL_TEMPERATURE });
  }

  if (provider === "Mistral") {
    return new ChatMistralAI({ apiKey, model: aiModel, temperature: DEFAULT_MODEL_TEMPERATURE });
  }

  if (provider === "Cohere") {
    return new ChatCohere({ apiKey, model: aiModel, temperature: DEFAULT_MODEL_TEMPERATURE });
  }

  if (provider === "HuggingFace") {
    return new ChatOpenAI({
      apiKey,
      model: aiModel,
      temperature: DEFAULT_MODEL_TEMPERATURE,
      timeout: 60000,
      configuration: {
        baseURL: HUGGINGFACE_API_BASE_URL,
      },
    });
  }

  if (provider === "Perplexity") {
    return new ChatOpenAI({
      apiKey,
      model: aiModel,
      temperature: DEFAULT_MODEL_TEMPERATURE,
      configuration: {
        baseURL: PERPLEXITY_API_BASE_URL,
      },
    });
  }

  if (provider === "OpenAI") {
    return new ChatOpenAI({ apiKey, model: aiModel, temperature: DEFAULT_MODEL_TEMPERATURE });
  }

  throw new Error(
    `Unsupported AI model: ${aiModel}. Supported providers: ${Object.values(AI_MODELS)
      .map((m) => m.provider)
      .join(", ")}`,
  );
};

module.exports = { getAIModel, AI_MODELS };
