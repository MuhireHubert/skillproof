// Signs private evidence-media URLs with the service key so outside verifiers can view photos.
export async function signMediaUrls({ supabaseUrl, serviceKey, bucket = 'evidence-media', paths, expiresIn = 3600, fetchImpl = fetch }) {
  if (!supabaseUrl || !serviceKey || !paths.length) return [];
  const res = await fetchImpl(supabaseUrl + '/storage/v1/object/sign/' + bucket, {
    method: 'POST',
    headers: { apikey: serviceKey, authorization: 'Bearer ' + serviceKey, 'content-type': 'application/json' },
    body: JSON.stringify({ expiresIn, paths }),
  });
  if (!res.ok) return [];
  const rows = await res.json();
  return rows.filter((r) => r.signedURL && !r.error).map((r) => ({ path: r.path, url: supabaseUrl + '/storage/v1' + r.signedURL }));
}
