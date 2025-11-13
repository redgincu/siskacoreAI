import { serve } from "https://deno.land/std@0.140.0/http/server.ts";

function handler(req: Request): Response {
  return new Response("Hello from Deno Deploy!");
}

console.log("Server running at http://localhost:8000");
serve(handler, { port: 8000 });
