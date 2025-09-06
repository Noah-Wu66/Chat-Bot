import OpenAI from 'openai';

export function getAIClient() {
  const apiKey = process.env.AIHUBMIX_API_KEY as string | undefined;
  if (!apiKey) {
    throw new Error('Missing AIHUBMIX_API_KEY');
  }
  return new OpenAI({
    apiKey,
    baseURL: 'https://aihubmix.com/v1',
  });
}

