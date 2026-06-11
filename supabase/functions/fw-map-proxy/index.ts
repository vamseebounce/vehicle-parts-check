import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const METABASE_URL =
  "http://metabaselatest-dy7gqwqrma-el.a.run.app/api/public/card/18f2864d-eab9-44f9-806c-edd1542dee88/query/json?parameters=%5B%5D";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "https://bounceops.online",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  try {
    const mbRes = await fetch(METABASE_URL);
    if (!mbRes.ok) throw new Error(`Metabase error: ${mbRes.status} ${mbRes.statusText}`);
    const data = await mbRes.json();
    return new Response(JSON.stringify(data), { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
  }
});
