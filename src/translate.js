import OpenAI from 'openai';

let client;

function getClient() {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured');
  client ||= new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
}

export async function translateArabicObject(input) {
  const entries = Object.entries(input).filter(([, value]) => typeof value === 'string' && value.trim());
  if (!entries.length) return {};
  if (process.env.TRANSLATION_ENABLED === 'false' || !process.env.OPENAI_API_KEY) {
    return Object.fromEntries(entries.map(([key, value]) => [key, value]));
  }

  const schemaProperties = Object.fromEntries(entries.map(([key]) => [key, { type: 'string' }]));
  const required = entries.map(([key]) => key);
  const response = await getClient().responses.create({
    model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
    instructions: [
      'Translate Iraqi Arabic or Modern Standard Arabic e-commerce text into natural concise English.',
      'Preserve brand names, usernames, numbers, durations, technical terms, URLs, line breaks and formatting.',
      'Do not add claims, guarantees, prices, or details not present in the source.',
      'Return only the requested JSON fields.',
    ].join(' '),
    input: JSON.stringify(Object.fromEntries(entries)),
    text: {
      format: {
        type: 'json_schema',
        name: 'product_translation',
        strict: true,
        schema: { type: 'object', properties: schemaProperties, required, additionalProperties: false },
      },
    },
  });
  return JSON.parse(response.output_text);
}
