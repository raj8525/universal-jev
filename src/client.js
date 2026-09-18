import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/alpha/decisions';
export const OPENROUTER_MODEL = '~typesafe/jev-latest';

export const TYPESAFE_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
export const TYPESAFE_MODEL = 'jev-latest';

export function resolveApiKey(options = {}) {
  if (options.apiKey) return options.apiKey;
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  if (process.env.TYPESAFE_API_KEY) return process.env.TYPESAFE_API_KEY;

  // Fallback to local config files
  const candidateFiles = [
    join(homedir(), '.agents', 'skills', 'typesafe-ai', 'config.json'),
    join(homedir(), '.gemini', 'config', 'skills', 'typesafe-ai', 'config.json'),
  ];
  for (const file of candidateFiles) {
    if (existsSync(file)) {
      try {
        const data = JSON.parse(readFileSync(file, 'utf-8'));
        if (data.api_key) return data.api_key;
        if (data.openrouter_api_key) return data.openrouter_api_key;
      } catch {}
    }
  }
  return undefined;
}

export class JevClient {
  constructor(options = {}) {
    this.apiKey = resolveApiKey(options);
    if (!this.apiKey) {
      throw new Error(
        'Missing API key. Please set OPENROUTER_API_KEY or TYPESAFE_API_KEY environment variable.'
      );
    }
    const isTypesafe = this.apiKey.startsWith('ts-') || options.provider === 'typesafe';
    this.provider = isTypesafe ? 'typesafe' : 'openrouter';
    this.baseUrl =
      options.baseUrl || (isTypesafe ? TYPESAFE_ENDPOINT : OPENROUTER_ENDPOINT);
    this.model =
      options.model || (isTypesafe ? TYPESAFE_MODEL : OPENROUTER_MODEL);
    this.timeout = options.timeout || 15000;
  }

  async decide(state, questions, options = {}) {
    const payload = {
      model: options.model || this.model,
      state: typeof state === 'string' ? state : JSON.stringify(state),
      questions,
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
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
        model: data.model || this.model,
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
}
