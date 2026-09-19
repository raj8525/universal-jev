import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/alpha/decisions';
export const OPENROUTER_MODEL = '~typesafe/jev-latest';

export const TYPESAFE_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
export const TYPESAFE_MODEL = 'jev-latest';

function readLocalConfigs() {
  const candidateFiles = [
    join(homedir(), '.agents', 'skills', 'typesafe-ai', 'config.json'),
    join(homedir(), '.gemini', 'config', 'skills', 'typesafe-ai', 'config.json'),
  ];
  for (const file of candidateFiles) {
    if (existsSync(file)) {
      try {
        const data = JSON.parse(readFileSync(file, 'utf-8'));
        if (data && typeof data === 'object') return data;
      } catch {}
    }
  }
  return {};
}

export function resolveCredentials(options = {}) {
  const localConfig = readLocalConfigs();

  // 1. Primary official TypeSafe API Key
  const typesafeKey =
    options.typesafeApiKey ||
    (options.apiKey && (options.apiKey.startsWith('apikey_') || options.apiKey.startsWith('ts-')) ? options.apiKey : null) ||
    process.env.TYPESAFE_API_KEY ||
    localConfig.typesafe_api_key ||
    (localConfig.api_key && (localConfig.api_key.startsWith('apikey_') || localConfig.api_key.startsWith('ts-')) ? localConfig.api_key : null);

  // 2. Backup / Fallback OpenRouter API Key
  const openrouterKey =
    options.openrouterApiKey ||
    (options.apiKey && options.apiKey.startsWith('sk-or-') ? options.apiKey : null) ||
    process.env.OPENROUTER_API_KEY ||
    localConfig.openrouter_api_key ||
    localConfig.fallback_openrouter_api_key ||
    (localConfig.api_key && localConfig.api_key.startsWith('sk-or-') ? localConfig.api_key : null);

  return { typesafeKey, openrouterKey };
}

export class JevClient {
  constructor(options = {}) {
    const { typesafeKey, openrouterKey } = resolveCredentials(options);

    this.typesafeKey = typesafeKey;
    this.openrouterKey = openrouterKey;
    this.timeout = options.timeout || 15000;

    // Determine primary provider
    if (options.provider === 'openrouter' || (!this.typesafeKey && this.openrouterKey)) {
      this.primaryProvider = 'openrouter';
      this.primaryKey = this.openrouterKey;
      this.primaryBaseUrl = options.baseUrl || OPENROUTER_ENDPOINT;
      this.primaryModel = options.model || OPENROUTER_MODEL;

      this.fallbackProvider = this.typesafeKey ? 'typesafe' : null;
      this.fallbackKey = this.typesafeKey;
      this.fallbackBaseUrl = TYPESAFE_ENDPOINT;
      this.fallbackModel = TYPESAFE_MODEL;
    } else if (this.typesafeKey) {
      this.primaryProvider = 'typesafe';
      this.primaryKey = this.typesafeKey;
      this.primaryBaseUrl = options.baseUrl || TYPESAFE_ENDPOINT;
      this.primaryModel = options.model || TYPESAFE_MODEL;

      this.fallbackProvider = this.openrouterKey ? 'openrouter' : null;
      this.fallbackKey = this.openrouterKey;
      this.fallbackBaseUrl = OPENROUTER_ENDPOINT;
      this.fallbackModel = OPENROUTER_MODEL;
    } else {
      throw new Error(
        'Missing API key. Please set TYPESAFE_API_KEY or OPENROUTER_API_KEY environment variable.'
      );
    }

    // Retain backward compatibility properties
    this.provider = this.primaryProvider;
    this.apiKey = this.primaryKey;
    this.baseUrl = this.primaryBaseUrl;
    this.model = this.primaryModel;
  }

  async _executeRequest(baseUrl, apiKey, model, state, questions) {
    const payload = {
      model,
      state: typeof state === 'string' ? state : JSON.stringify(state),
      questions,
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(baseUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://typesafe.ai',
          'X-Title': 'Universal-Jev-Plugin',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Jev API error (${response.status}): ${text.slice(0, 300)}`);
      }

      const data = await response.json();
      if (!data || typeof data !== 'object' || !data.answers) {
        throw new Error('Jev returned an unexpected response structure (missing answers).');
      }

      return {
        model: data.model || model,
        answers: data.answers,
        usage: data.usage || null,
      };
    } catch (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') {
        throw new Error(`Jev API request timed out after ${this.timeout}ms`);
      }
      throw err;
    }
  }

  async decide(state, questions, options = {}) {
    const targetModel = options.model || this.primaryModel;

    try {
      return await this._executeRequest(
        this.primaryBaseUrl,
        this.primaryKey,
        targetModel,
        state,
        questions
      );
    } catch (primaryErr) {
      if (this.fallbackKey && this.fallbackBaseUrl) {
        // Attempt fallback transparently
        try {
          const fallbackModel = this.fallbackModel;
          return await this._executeRequest(
            this.fallbackBaseUrl,
            this.fallbackKey,
            fallbackModel,
            state,
            questions
          );
        } catch (fallbackErr) {
          throw new Error(
            `Primary provider (${this.primaryProvider}) failed: ${primaryErr.message}; ` +
            `Fallback provider (${this.fallbackProvider}) also failed: ${fallbackErr.message}`
          );
        }
      }
      throw primaryErr;
    }
  }
}
