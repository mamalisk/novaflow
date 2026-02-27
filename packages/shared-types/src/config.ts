export type AIProvider = "anthropic" | "openai" | "azure-openai" | "ollama";

export interface NovaflowConfig {
  version: "1";
  ai: {
    provider: AIProvider;
    model: string;
    apiKey: string; // "__keychain__" when stored in OS keychain
    baseUrl?: string; // for Azure/Ollama custom endpoints
    temperature?: number; // default 0.2
  };
  server: {
    port: number; // default 3000
    host: string; // default "localhost"
  };
  chromadb: {
    host: string; // default "localhost"
    port: number; // default 8000
    collectionPrefix: string; // default "novaflow"
  };
}

export interface NovaflowProjectConfig {
  version: "1";
  projectName: string;
  jira: {
    baseUrl: string;
    email: string;
    apiToken: string; // "__keychain__" when stored via keytar
    defaultProject: string; // JIRA project key e.g. "PROJ"
  };
  gitlab: {
    baseUrl: string;
    personalAccessToken: string; // "__keychain__" when stored via keytar
    projectId: string;
    defaultBranch: string;
    branchPrefix: string; // default "novaflow/"
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
    documents: KnowledgeDocument[];
    autoIngestOnStart: boolean;
  };
}

export type KnowledgeDocType =
  | "architecture"
  | "test-strategy"
  | "definition-of-ready"
  | "definition-of-done"
  | "coding-conventions"
  | "git-strategy"
  | "nfr"
  | "component-library"
  | "observability"
  | "accessibility"
  | "custom";

export interface KnowledgeDocument {
  id: string;
  path: string; // relative to .novaflow/knowledge/
  type: KnowledgeDocType;
  description: string;
}

export function defaultNovaflowConfig(): NovaflowConfig {
  return {
    version: "1",
    ai: {
      provider: "anthropic",
      model: "claude-opus-4-6",
      apiKey: "",
      temperature: 0.2,
    },
    server: {
      port: 3847,
      host: "localhost",
    },
    chromadb: {
      host: "localhost",
      port: 8000,
      collectionPrefix: "novaflow",
    },
  };
}

export function defaultProjectConfig(projectName: string): NovaflowProjectConfig {
  return {
    version: "1",
    projectName,
    jira: {
      baseUrl: "",
      email: "",
      apiToken: "",
      defaultProject: "",
    },
    gitlab: {
      baseUrl: "",
      personalAccessToken: "",
      projectId: "",
      defaultBranch: "main",
      branchPrefix: "novaflow/",
      commitMessageTemplate: "{ticketId}: {summary}",
    },
    permissions: {
      checkpoints: {
        afterBusinessAnalysis: true,
        beforeImplementation: true,
        beforeCommit: true,
      },
      allowAgentUncertaintyPause: true,
    },
    knowledgeBase: {
      documents: [],
      autoIngestOnStart: true,
    },
  };
}
