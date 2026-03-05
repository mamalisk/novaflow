export type AIProvider = "anthropic" | "openai" | "azure-openai" | "ollama";

export interface NovaflowConfig {
  version: "1";
  ai: {
    provider: AIProvider;
    model: string;
    apiKey: string;
    baseUrl?: string;
    temperature?: number;
  };
  chromadb: {
    host: string;
    port: number;
    collectionPrefix: string;
  };
}

export interface NovaflowProjectConfig {
  version: "1";
  projectName: string;
  jira: {
    baseUrl: string;
    email: string;
    apiToken: string;
    defaultProject: string;
  };
  gitlab: {
    baseUrl: string;
    personalAccessToken: string;
    projectId: string;
    defaultBranch: string;
    branchPrefix: string;
    commitMessageTemplate: string;
  };
  figma?: {
    accessToken: string;
    defaultFileId?: string;
  };
  permissions: {
    checkpoints: {
      afterBusinessAnalysis: boolean;
      beforeImplementation: boolean;
      beforeCommit: boolean;
    };
    allowAgentUncertaintyPause: boolean;
  };
  knowledgeBase: {
    documents: Array<{ id: string; path: string; type: string; description: string }>;
    autoIngestOnStart: boolean;
  };
}
