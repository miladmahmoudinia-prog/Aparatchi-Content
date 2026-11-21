// Header-only success and ordinary web/portal pages never prove playability.
export async function inspectMedia(response) {
  if ([404, 410].includes(response.status)) {
    if (!response.body) return 'unknown';
    const reader = response.body.getReader();
    const parts = []; let size = 0;
    try {
      while (size <= 2048) {
        const {done,value} = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 2048) return 'unknown';
        parts.push(value);
      }
      const text = Buffer.concat(parts).toString('utf8').trim();
      const mime = response.headers.get('content-type')?.split(';')[0].trim();
      const message = mime === 'application/json' ? JSON.parse(text)?.message : mime === 'text/plain' ? text : '';
      return /^(?:file|video|media) (?:not found|removed|has been deleted)[.!]?$/i.test(message || '') ? 'dead' : 'unknown';
    } catch { return 'unknown'; } finally { await reader.cancel().catch(()=>{}); }
  }
  if (![200, 206].includes(response.status) || !response.body) return 'unknown';
  const reader = response.body.getReader();
  const prefix = Buffer.alloc(2048); let n = 0;
  try {
    while (n < prefix.length) {
      const {done,value} = await reader.read(); if (done) break;
      const part = value.subarray(0, prefix.length - n); prefix.set(part,n); n += part.length;
    }
    const text = prefix.subarray(0,n).toString().trimStart();
    if (prefix.toString('ascii',4,8) === 'ftyp' || /^#EXTM3U\s/.test(text) || prefix.readUInt32BE(0) === 0x1a45dfa3) return 'healthy';
    if (/^This Video is Not For Streaming\s*$/i.test(text)) return 'dead';
    return 'unknown'; // Includes HTML challenges, login portals and unrecognized formats.
  } finally { await reader.cancel().catch(()=>{}); }
}
// Append only: an incomplete provider response must never replace stored files.
export function appendMediaVersions(group, incoming, prefix = '') {
  const files = group.files ?? [];
  if (!Array.isArray(files)) return 0;
  const key = f => `${f?.mode || 'download'}:${f?.url}`;
  const seen = new Set(files.map(key));
  const ids = new Set(files.map(f => f?.id));
  let added = 0;
  for (const file of incoming || []) {
    if (!file?.id || !/^https?:\/\//i.test(file.url || '') || seen.has(key(file))) continue;
    const id = `${prefix}${file.id}`;
    if (ids.has(id)) continue;
    files.push({...file, id}); seen.add(key(file)); ids.add(id); added++;
  }
  if (added) group.files = files;
  return added;
}
export const appendSubtitledFiles = (group, incoming, prefix) => appendMediaVersions(group, incoming?.filter(f => f?.language === 'subtitled'), prefix);
export function storedUrls(item) {
  return [...new Set([item.streamUrl,...(item.downloads || []).flatMap(g => [g.streamUrl,...(g.files || []).map(f=>f.url)])].filter(Boolean))];
}
export function removalReady(first,now) {return Number.isFinite(first) && now-first >= 24*3600000;}
