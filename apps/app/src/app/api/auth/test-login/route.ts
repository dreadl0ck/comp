// Legacy E2E mutation endpoint retired; fixtures live outside the deployed app.
export function POST() {
  return new Response(null, { status: 404 });
}
