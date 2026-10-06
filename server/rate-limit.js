// @ts-check
// A small in-memory rate limiter. Each key (an IP address, a user id, or a socket's user) gets `max`
// hits per `windowMs`. It lives in this process only, which is fine for a single server, and it resets
// when the server restarts. Nothing here stores anything about a player beyond the counts.

/**
 * @param {{max: number, windowMs: number}} opts
 * @returns {(key: string) => boolean} True if this hit is allowed, false once the key is over its limit.
 */
export function createLimiter({max, windowMs}){
  /** @type {Map<string, {count: number, reset: number}>} */
  const hits = new Map();
  // Forget expired keys now and then, so the map can't grow without limit.
  setInterval(() => {
    const now = Date.now();
    for(const [key, entry] of hits) if(entry.reset <= now) hits.delete(key);
  }, windowMs).unref();
  return (key) => {
    const now = Date.now();
    let entry = hits.get(key);
    if(!entry || entry.reset <= now){
      entry = {count: 0, reset: now + windowMs};
      hits.set(key, entry);
    }
    entry.count++;
    return entry.count <= max;
  };
}

/**
 * Express middleware that answers 429 once a key is over its limit.
 * @param {(key: string) => boolean} allow
 * @param {(req: import('express').Request) => string} keyOf
 * @param {string} message
 * @returns {import('express').RequestHandler}
 */
export function limitRoute(allow, keyOf, message){
  return (req, res, next) => {
    if(allow(keyOf(req))) return next();
    res.status(429).json({ error: message });
  };
}

/** Limit by the signed-in user when there is one, otherwise by IP address. */
/** @param {import('express').Request} req */
export function userOrIp(req){
  const userId = req.session?.userId;
  return userId ? `user:${userId}` : `ip:${req.ip}`;
}
