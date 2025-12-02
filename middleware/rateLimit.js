// Rate Limiting Middleware for H2S Backend
// Prevents API abuse by limiting requests per session/IP

const requestCounts = new Map();
const WINDOW_MS = 60 * 1000; // 1 minute window
const MAX_REQUESTS_PER_WINDOW = 100; // 100 requests per minute per token
const MAX_REQUESTS_PER_IP = 200; // 200 requests per minute per IP (for unauthenticated endpoints)

// Clean up old entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, data] of requestCounts.entries()) {
    if (now - data.resetTime > WINDOW_MS) {
      requestCounts.delete(key);
    }
  }
}, 5 * 60 * 1000);

/**
 * Rate limiting middleware
 * @param {string} identifier - Session token or IP address
 * @param {number} maxRequests - Max requests allowed in window (default: 100)
 * @returns {object} { allowed: boolean, remaining: number, resetTime: number }
 */
export function checkRateLimit(identifier, maxRequests = MAX_REQUESTS_PER_WINDOW) {
  const now = Date.now();
  const key = identifier;
  
  if (!requestCounts.has(key)) {
    requestCounts.set(key, {
      count: 1,
      resetTime: now + WINDOW_MS
    });
    return {
      allowed: true,
      remaining: maxRequests - 1,
      resetTime: now + WINDOW_MS
    };
  }
  
  const data = requestCounts.get(key);
  
  // Reset window if expired
  if (now > data.resetTime) {
    data.count = 1;
    data.resetTime = now + WINDOW_MS;
    requestCounts.set(key, data);
    return {
      allowed: true,
      remaining: maxRequests - 1,
      resetTime: data.resetTime
    };
  }
  
  // Increment counter
  data.count++;
  
  if (data.count > maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      resetTime: data.resetTime
    };
  }
  
  return {
    allowed: true,
    remaining: maxRequests - data.count,
    resetTime: data.resetTime
  };
}

/**
 * Express-style middleware wrapper
 */
export function rateLimitMiddleware(req, res, next) {
  // Get identifier (token or IP)
  const token = req.body?.token || req.query?.token;
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const identifier = token || ip;
  
  const limit = checkRateLimit(identifier);
  
  // Set rate limit headers
  res.setHeader('X-RateLimit-Limit', MAX_REQUESTS_PER_WINDOW);
  res.setHeader('X-RateLimit-Remaining', limit.remaining);
  res.setHeader('X-RateLimit-Reset', limit.resetTime);
  
  if (!limit.allowed) {
    return res.status(429).json({
      ok: false,
      error: 'Too many requests. Please try again later.',
      error_code: 'rate_limit_exceeded',
      retry_after: Math.ceil((limit.resetTime - Date.now()) / 1000)
    });
  }
  
  if (next) next();
}

export default rateLimitMiddleware;
