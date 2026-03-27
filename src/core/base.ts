export interface ToolDefinition {
  id: string;
  name: string;
  description: string;
  parameters: any;
  isBuiltin?: boolean;
}

export abstract class BaseTool implements ToolDefinition {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly parameters: any;
  readonly isBuiltin: boolean = false;

  abstract handler(args: { input: string; history?: AIMessage[] }): Promise<any>;
}

export interface AIMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | null;
  tool_calls?: any[];
  tool_call_id?: string;
  name?: string;
}

export interface AIResponse {
  content: string;
  tool_calls?: any[];
  usage?: any;
}

export interface AIProvider {
  name: string;
  generateContent(prompt: string | AIMessage[], tools: any[], systemInstruction?: string): Promise<AIResponse>;
  generateStream?(prompt: string | AIMessage[], tools: any[], systemInstruction?: string): AsyncIterable<string>;
}

export interface KnowledgeBaseService {
  queryKnowledge(query: string, options?: { limit?: number, skipAiSearch?: boolean }): Promise<string>;
}

export interface LogService {
  info(msg: string): void;
  error(msg: string): void;
  warn(msg: string): void;
}

export interface ServiceContext {
  aiProvider?: AIProvider;
  knowledgeBaseService: KnowledgeBaseService;
}
