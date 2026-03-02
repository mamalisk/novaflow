import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { NovaflowConfig } from "@novaflow/shared-types";

/**
 * Creates a ChatModel instance based on the configured provider.
 * Provider packages are lazy-imported to avoid loading all SDKs at startup.
 */
export async function createChatModel(config: NovaflowConfig): Promise<BaseChatModel> {
  const { provider, model, apiKey, baseUrl, temperature = 0.2 } = config.ai;

  // TODO: remove before release
  console.log("[model-factory] provider:", provider);
  console.log("[model-factory] model:", model);
  console.log("[model-factory] baseUrl:", baseUrl ?? "(none)");
  console.log("[model-factory] apiKey:", apiKey ? `${apiKey.slice(0, 6)}…(${apiKey.length} chars)` : "(empty)");

  switch (provider) {
    case "anthropic": {
      const { ChatAnthropic } = await import("@langchain/anthropic");
      // When a baseUrl is set (e.g. Azure AI Foundry), Azure expects the key
      // in the "api-key" header, not the Anthropic-standard "x-api-key".
      const azureOptions = baseUrl ? {
        anthropicApiUrl: baseUrl,
        clientOptions: {
          defaultHeaders: { "api-key": apiKey },
        },
      } : {};
      console.log("[model-factory] anthropicApiUrl:", baseUrl ?? "(using default api.anthropic.com)");
      console.log("[model-factory] azure api-key header:", baseUrl ? "yes" : "no");
      return new ChatAnthropic({ model, apiKey, temperature, ...azureOptions });
    }

    case "openai": {
      const { ChatOpenAI } = await import("@langchain/openai");
      return new ChatOpenAI({ model, openAIApiKey: apiKey, temperature });
    }

    case "azure-openai": {
      const { AzureChatOpenAI } = await import("@langchain/openai");
      return new AzureChatOpenAI({
        model,
        apiKey,
        azureOpenAIBasePath: baseUrl,
        temperature,
      });
    }

    case "ollama": {
      const { ChatOllama } = await import("@langchain/ollama");
      return new ChatOllama({
        model,
        baseUrl: baseUrl ?? "http://localhost:11434",
        temperature,
      });
    }

    default:
      throw new Error(`Unsupported AI provider: ${provider as string}`);
  }
}
