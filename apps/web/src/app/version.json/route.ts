// The build id of whatever is deployed right now. Static — generated once per
// build — so it costs nothing to serve; the no-store header (next.config.ts)
// keeps browsers and the CDN from answering with an old copy.
export const dynamic = 'force-static';

export function GET() {
  return Response.json({ buildId: process.env.NEXT_PUBLIC_BUILD_ID });
}
