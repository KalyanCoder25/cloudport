/**
 * CloudPort Authentication & Authorization Module.
 *
 * Provides cryptographic password hashing using Node.js crypto (scrypt),
 * signed stateless HMAC-SHA256 session tokens, and Express middleware.
 */
'use strict';

const crypto = require('crypto');

const TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const DEFAULT_SECRET = 'cloudport-deterministic-secret-key-for-local-dev';

function getAuthSecret() {
  const secret = process.env.AUTH_SECRET || process.env.JWT_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('SECURITY CONFIGURATION ERROR: AUTH_SECRET must be set in production environment');
    }
    return DEFAULT_SECRET;
  }
  return secret;
}

/**
 * Hashes a plaintext password using scrypt with a random 16-byte salt.
 */
function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 8) {
    throw new Error('Password must be at least 8 characters long');
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

/**
 * Verifies a plaintext password against a stored scrypt hash and salt.
 */
function verifyPassword(password, storedHash, storedSalt) {
  if (!password || !storedHash || !storedSalt) return false;
  try {
    const computed = crypto.scryptSync(password, storedSalt, 64);
    const storedBuf = Buffer.from(storedHash, 'hex');
    if (computed.length !== storedBuf.length) return false;
    return crypto.timingSafeEqual(computed, storedBuf);
  } catch (_e) {
    return false;
  }
}

function base64UrlEncode(str) {
  return Buffer.from(str).toString('base64url');
}

function base64UrlDecode(str) {
  return Buffer.from(str, 'base64url').toString('utf8');
}

/**
 * Signs a user session payload into an HMAC-SHA256 token.
 */
function signToken(user) {
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64UrlEncode(
    JSON.stringify({
      sub: user.id,
      email: user.email,
      role: user.role,
      displayName: user.display_name,
      iat: Date.now(),
      exp: Date.now() + TOKEN_EXPIRY_MS,
    })
  );
  const signature = crypto
    .createHmac('sha256', getAuthSecret())
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${signature}`;
}

/**
 * Verifies an HMAC-SHA256 token and returns the decoded payload, or null if invalid/expired.
 */
function verifyToken(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;
  try {
    const expectedSig = crypto
      .createHmac('sha256', getAuthSecret())
      .update(`${header}.${payload}`)
      .digest('base64url');

    const expectedBuf = Buffer.from(expectedSig);
    const actualBuf = Buffer.from(signature);
    if (expectedBuf.length !== actualBuf.length || !crypto.timingSafeEqual(expectedBuf, actualBuf)) {
      return null;
    }

    const decoded = JSON.parse(base64UrlDecode(payload));
    if (!decoded.exp || decoded.exp < Date.now()) {
      return null;
    }
    return decoded;
  } catch (_e) {
    return null;
  }
}

/**
 * Strips sensitive fields from a user record.
 */
function sanitizeUser(user) {
  if (!user) return null;
  return {
    id: user.id || user.sub,
    email: user.email,
    displayName: user.display_name || user.displayName,
    role: user.role,
    createdAt: user.created_at || user.createdAt,
  };
}

/**
 * Creates authentication middleware with an optional database query function.
 */
function createAuthMiddleware(query) {
  return async function authMiddleware(req, res, next) {
    const authHeader = req.headers.authorization || req.headers.Authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      req.user = null;
      return next();
    }

    const token = authHeader.slice(7).trim();
    const payload = verifyToken(token);
    if (!payload) {
      req.user = null;
      req.authError = 'Invalid or expired token';
      return next();
    }

    if (query) {
      try {
        const result = await query(
          'SELECT id, email, display_name, role, created_at FROM users WHERE id = $1',
          [payload.sub]
        );
        if (result.rowCount > 0) {
          req.user = result.rows[0];
        } else {
          req.user = null;
          req.authError = 'User no longer exists';
        }
      } catch (_err) {
        req.user = {
          id: payload.sub,
          email: payload.email,
          display_name: payload.displayName,
          role: payload.role,
        };
      }
    } else {
      req.user = {
        id: payload.sub,
        email: payload.email,
        display_name: payload.displayName,
        role: payload.role,
      };
    }
    next();
  };
}

/**
 * Express middleware to strictly require an authenticated user.
 */
function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({
      error: 'Unauthorized: authentication required',
      detail: req.authError || 'Missing or invalid authorization token',
    });
  }
  next();
}

module.exports = {
  hashPassword,
  verifyPassword,
  signToken,
  verifyToken,
  sanitizeUser,
  createAuthMiddleware,
  requireAuth,
};
