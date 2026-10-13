// Editor-only typings for the Deno runtime used by Supabase Edge Functions (not part of the Vite build).
declare const Deno: {
  env: { get(key: string): string | undefined }
  serve(handler: (req: Request) => Response | Promise<Response>): void
}
