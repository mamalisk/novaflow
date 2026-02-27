import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { NovaflowConfig } from "@novaflow/shared-types";

/**
 * Creates a ChatModel instance based on the configured provider.
 * Provider packages are lazy-imported to avoid loading all SDKs at startup.
 */
export async function createChatModel(config: NovaflowConfig): Promise<BaseChatModel> {
  const { provider, model, apiKey, baseUrl, temperature = 0.2 } = config.ai;

  switch (provider) {
    case "anthropic": {
      const { ChatAnthropic } = await import("@langchain/anthropic");
      return new ChatAnthropic({
        model,
        apiKey,
        temperature,
        ...(baseUrl ? { anthropicApiUrl: baseUrl } : {}),
      });
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
