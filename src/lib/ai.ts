import OpenAI from 'openai';

export function getAIClient() {
  if (!process.env.AIHUBMIX_API_KEY) {
    throw new Error('Missing AIHUBMIX_API_KEY');
  }
  return new OpenAI({
    apiKey: process.env.AIHUBMIX_API_KEY,
    baseURL: 'https://aihubmix.com/v1',
  });
}

