export async function GET() {
  return new Response(
    JSON.stringify({ ok: true, message: "Better Auth mounted. Try /api/auth/ok or /api/auth/get-session." }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}
