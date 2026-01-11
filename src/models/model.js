const { ChatOpenAI } = require("@langchain/openai");
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { ChatAnthropic } = require("@langchain/anthropic");
const { ChatMistralAI } = require("@langchain/mistralai");
const { ChatCohere } = require("@langchain/cohere");
const { HuggingFaceInference } = require("@langchain/community/llms/hf");

const {
  AI_MODELS,
  DEFAULT_MODEL_TEMPERATURE,
  PERPLEXITY_API_BASE_URL,
} = require("../core/constants");
const { inferProviderFromModel, PROVIDER_API_ENV_KEYS } = require("../core/env");

const getAIModel = (aiModel, explicitApiKey) => {
  const provider = inferProviderFromModel(aiModel);

  const envVarName = PROVIDER_API_ENV_KEYS[provider];
  const apiKey = explicitApiKey || (envVarName ? process.env[envVarName] : undefined);
  if (!apiKey) {
    throw new Error(
      `${provider} API key is missing. Please provide a valid API key for ${provider}.`,
    );
  }

  if (AI_MODELS.OPENAI.models.includes(aiModel)) {
    return new ChatOpenAI({ apiKey, model: aiModel, temperature: DEFAULT_MODEL_TEMPERATURE });
  }

  if (AI_MODELS.GEMINI.models.includes(aiModel)) {
    return new ChatGoogleGenerativeAI({
      apiKey,
      model: aiModel,
      temperature: DEFAULT_MODEL_TEMPERATURE,
    });
  }

  if (AI_MODELS.ANTHROPIC.models.includes(aiModel)) {
    return new ChatAnthropic({ apiKey, model: aiModel, temperature: DEFAULT_MODEL_TEMPERATURE });
  }

  if (AI_MODELS.MISTRAL.models.includes(aiModel)) {
    return new ChatMistralAI({ apiKey, model: aiModel, temperature: DEFAULT_MODEL_TEMPERATURE });
  }

  if (AI_MODELS.COHERE.models.includes(aiModel)) {
    return new ChatCohere({ apiKey, model: aiModel, temperature: DEFAULT_MODEL_TEMPERATURE });
  }

  if (AI_MODELS.HUGGINGFACE.models.includes(aiModel)) {
    return new HuggingFaceInference({
      apiKey,
      model: aiModel,
      temperature: DEFAULT_MODEL_TEMPERATURE,
    });
  }

  if (AI_MODELS.PERPLEXITY.models.includes(aiModel)) {
    return new ChatOpenAI({
      apiKey,
      model: aiModel,
      temperature: DEFAULT_MODEL_TEMPERATURE,
      baseURL: PERPLEXITY_API_BASE_URL,
    });
  }

  throw new Error(
    `Unsupported AI model: ${aiModel}. Supported providers: ${Object.values(AI_MODELS)
      .map((m) => m.provider)
      .join(", ")}`,
  );
};

module.exports = { getAIModel, AI_MODELS };
