import OpenAI from 'openai';

export function getAIClient() {
  const apiKey = process.env.OPENROUTER_API_KEY as string | undefined;
  if (!apiKey) {
    throw new Error('Missing OPENROUTER_API_KEY');
  }
  return new OpenAI({
    apiKey,
    baseURL: 'https://openrouter.ai/api/v1',
  });
}

