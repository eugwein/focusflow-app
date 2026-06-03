export const config = {
  runtime: 'edge',
};

export default function handler(request) {
  return new Response(
    JSON.stringify({
      apiKey: process.env.GEMINI_API_KEY || '',
    }),
    {
      status: 200,
      headers: {
        'content-type': 'application/json',
      },
    }
  );
}
