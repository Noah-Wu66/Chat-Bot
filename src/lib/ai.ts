import OpenAI from 'openai';

export function getAIClient() {
  const apiKey = process.env.OPENROUTER_API_KEY || process.env.AIHUBMIX_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('Missing OPENROUTER_API_KEY');
  }
  const defaultHeaders: Record<string, string> = {};
  if (process.env.OPENROUTER_SITE_URL) {
    defaultHeaders['HTTP-Referer'] = process.env.OPENROUTER_SITE_URL;
  }
  if (process.env.OPENROUTER_APP_TITLE) {
    defaultHeaders['X-Title'] = process.env.OPENROUTER_APP_TITLE;
  }
  return new OpenAI({
    apiKey,
    baseURL: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
    ...(Object.keys(defaultHeaders).length ? { defaultHeaders } : {}),
  });
}

