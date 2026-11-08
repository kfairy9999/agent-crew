export const DEFAULT_GROQ_MODEL = "qwen/qwen3.8-27b";
export const DEFAULT_GROQ_BASE_URL = "https://api.groq.com/openai/v1";

/** Groq sits behind Cloudflare, which blocks empty and library-default user agents. */
export const USER_AGENT = "AgentCrew/1.0 (Kevin Fairley portfolio; +https://github.com/kfairy9999)";
