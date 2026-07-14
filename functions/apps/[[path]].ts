// Cloudflare Pages Function — serve WGB game bundles from an R2 bucket, SAME-ORIGIN.
//
// The site is cross-origin isolated (COOP/COEP `require-corp`, needed for
// SharedArrayBuffer), so serving bundles from THIS origin (`/apps/*`) sidesteps
// the CORP/CORS setup a cross-origin R2 domain would require. A WGB is a
// store-only ZIP read by random access, so the guest issues HTTP Range reads:
// partial responses (206) + `Accept-Ranges` are mandatory, or streaming breaks.
//
// Setup: bind an R2 bucket to the Pages project as `APPS`
// (Settings → Bindings → R2 bucket). Object keys are the bundle filenames from
// the catalog's wgbUrl, e.g. `/apps/re-volt-demo.wgb` → R2 key `re-volt-demo.wgb`.

interface Env {
  APPS: R2Bucket;
}

export const onRequest: PagesFunction<Env> = async ({ params, request, env }) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  }

  const segments = Array.isArray(params.path) ? params.path : [params.path];
  const key = segments.join("/");

  const headers = new Headers();
  headers.set("Accept-Ranges", "bytes");
  headers.set("Cross-Origin-Resource-Policy", "same-origin");
  headers.set("Cache-Control", "public, max-age=3600");

  // HEAD — metadata only (a range source probes the total size first).
  if (request.method === "HEAD") {
    const meta = await env.APPS.head(key);
    if (!meta) return new Response(null, { status: 404 });
    meta.writeHttpMetadata(headers);
    headers.set("Content-Length", String(meta.size));
    if (!headers.has("Content-Type")) headers.set("Content-Type", "application/octet-stream");
    return new Response(null, { status: 200, headers });
  }

  // Single-range parse: `bytes=start-end`, `bytes=start-`, `bytes=-suffix`.
  const rangeHeader = request.headers.get("Range");
  const m = rangeHeader ? /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim()) : null;
  let range: R2Range | undefined;
  if (m && !(m[1] === "" && m[2] === "")) {
    range = m[1] === ""
      ? { suffix: Number(m[2]) }
      : { offset: Number(m[1]), length: m[2] === "" ? undefined : Number(m[2]) - Number(m[1]) + 1 };
  }

  const obj = await env.APPS.get(key, range ? { range } : undefined);
  if (!obj) return new Response("Not found", { status: 404 });

  obj.writeHttpMetadata(headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/octet-stream");
  headers.set("ETag", obj.httpEtag);

  const total = obj.size; // full object size (not the served slice)
  const served = obj.range as { offset?: number; length?: number; suffix?: number } | undefined;
  if (range && served) {
    const offset = served.offset ?? total - (served.suffix ?? 0);
    const length = served.length ?? total - offset;
    headers.set("Content-Range", `bytes ${offset}-${offset + length - 1}/${total}`);
    headers.set("Content-Length", String(length));
    return new Response(obj.body, { status: 206, headers });
  }

  headers.set("Content-Length", String(total));
  return new Response(obj.body, { status: 200, headers });
};
