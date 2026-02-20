const cache = new Map();

export async function cachedGet(axios, url, config = {}, ttlMs = 10000) {
    const authKey = config?.headers?.Authorization ? 'auth' : 'anon';
    const key = JSON.stringify({ url, params: config.params || {}, auth: authKey });
    const now = Date.now();
    const hit = cache.get(key);
    if (hit && (now - hit.ts) < ttlMs) {
        return { data: hit.data, cached: true };
    }
    const res = await axios.get(url, config);
    cache.set(key, { ts: now, data: res.data });
    return { data: res.data, cached: false };
}
