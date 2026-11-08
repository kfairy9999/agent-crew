import type { LlmClient, LlmRequest, LlmResult } from "../core/types";
import { DEFAULT_GROQ_BASE_URL, DEFAULT_GROQ_MODEL, USER_AGENT } from "./constants";
import { retryAfterMs } from "./retry";

export class LlmError extends Error {
  readonly status: number;
  readonly retryAfterMs?: number;

  constructor(message: string, status: number, retryAfterMs?: number) {
    super(message);
    this.name = "LlmError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

export interface OpenAICompatibleOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  userAgent?: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  maxRetries?: number;
  maxRetryWaitMs?: number;
}

interface ChatResponse {
  choices?: { message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
}

export class OpenAICompatibleClient implements LlmClient {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly userAgent: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  private readonly maxRetries: number;
  private readonly maxRetryWaitMs: number;

  constructor(private readonly options: OpenAICompatibleOptions) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_GROQ_BASE_URL).replace(/\/$/, "");
    this.model = options.model ?? DEFAULT_GROQ_MODEL;
    this.userAgent = options.userAgent ?? USER_AGENT;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? defaultSleep;
    this.maxRetries = options.maxRetries ?? 3;
    this.maxRetryWaitMs = options.maxRetryWaitMs ?? 15_000;
  }

  async complete(request: LlmRequest): Promise<LlmResult> {
    let jsonMode = true;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const response = await this.send(request, jsonMode);
      if (response.status === 400 && jsonMode && (await looksLikeJsonModeRejection(response))) {
        jsonMode = false;
        continue;
      }
      if (response.status !== 429) return readSuccess(response, request, this.model);
      const wait = await rateLimitWait(response);
      if (attempt === this.maxRetries || wait > this.maxRetryWaitMs) {
        throw new LlmError(
          wait > this.maxRetryWaitMs
            ? `Rate limited. The token bucket resets in ${Math.ceil(wait / 1000)}s, past the wait cap.`
            : "Rate limited by the model provider after retries.",
          429,
          wait,
        );
      }
      await this.sleep(wait, request.signal);
    }
    throw new LlmError("Rate limited by the model provider.", 429);
  }

  private send(request: LlmRequest, jsonMode: boolean): Promise<Response> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: request.messages,
      temperature: request.temperature,
      max_tokens: request.maxTokens,
    };
    if (jsonMode) body.response_format = { type: "json_object" };
    return this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      signal: request.signal,
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": this.userAgent,
      },
      body: JSON.stringify(body),
    });
  }
}

async function looksLikeJsonModeRejection(response: Response): Promise<boolean> {
  const text = await response.clone().text();
  return /response_format|json_object|json mode/i.test(text);
}

async function rateLimitWait(response: Response): Promise<number> {
  const text = await response.clone().text();
  return retryAfterMs(response.headers, text) ?? 1_000;
}

async function readSuccess(response: Response, request: LlmRequest, model: string): Promise<LlmResult> {
  const text = await response.text();
  let payload: ChatResponse;
  try {
    payload = JSON.parse(text) as ChatResponse;
  } catch {
    throw new LlmError(`The model provider returned ${response.status} with a non-JSON body.`, response.status);
  }
  if (!response.ok) {
    throw new LlmError(payload.error?.message || `The model provider returned ${response.status}.`, response.status);
  }
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new LlmError("The model returned an empty completion.", 502);
  const promptTokens = payload.usage?.prompt_tokens ?? Math.ceil(request.messages.reduce((sum, message) => sum + message.content.length, 0) / 4);
  const completionTokens = payload.usage?.completion_tokens ?? Math.ceil(content.length / 4);
  return {
    content,
    promptTokens,
    completionTokens,
    model,
  };
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function abortError(): Error {
  if (typeof DOMException !== "undefined") return new DOMException("Aborted", "AbortError");
  const error = new Error("Aborted");
  error.name = "AbortError";
  return error;
}
