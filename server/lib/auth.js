// Password hashing (scrypt), JWT (HMAC-SHA256), and cookie helpers.
import {
  scryptSync,
  randomBytes,
  createHmac,
  timingSafeEqual,
} from 'node:crypto';

const SCRYPT_KEYLEN = 64;

/** Hash a password -> 'scrypt$<saltHex>$<hashHex>'. */
export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(String(password), salt, SCRYPT_KEYLEN).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

/** Verify a password against a stored hash. Never throws. */
export function verifyPassword(password, stored) {
  try {
    if (typeof stored !== 'string') return false;
    const parts = stored.split('$');
    if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
    const [, salt, hashHex] = parts;
    const expected = Buffer.from(hashHex, 'hex');
    const actual = scryptSync(String(password), salt, expected.length);
    if (actual.length !== expected.length) return false;
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function b64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function b64urlDecode(str) {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + pad;
  return Buffer.from(b64, 'base64');
}

/**
 * Sign a JWT. payload must include `sub`; `exp` is added from ttlHours.
 */
export function signJwt(payload, secret, ttlHours = 12) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const nowSec = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: nowSec, exp: nowSec + Math.round(ttlHours * 3600) };
  const encHeader = b64url(JSON.stringify(header));
  const encBody = b64url(JSON.stringify(body));
  const data = `${encHeader}.${encBody}`;
  const sig = b64url(createHmac('sha256', secret).update(data).digest());
  return `${data}.${sig}`;
}

/** Verify a JWT. Returns payload object or null. */
export function verifyJwt(token, secret) {
  try {
    if (typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [encHeader, encBody, encSig] = parts;
    const data = `${encHeader}.${encBody}`;
    const expected = createHmac('sha256', secret).update(data).digest();
    const given = b64urlDecode(encSig);
    if (given.length !== expected.length) return null;
    if (!timingSafeEqual(given, expected)) return null;
    const payload = JSON.parse(b64urlDecode(encBody).toString('utf8'));
    if (typeof payload.exp === 'number' && payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export const COOKIE_NAME = 'absensi_token';

/**
 * Whether the auth cookie must be marked Secure.
 * Default: on in production, off in development. `COOKIE_SECURE=false`
 * forces it off (e.g. production behind a plain-HTTP internal proxy),
 * `COOKIE_SECURE=true` forces it on.
 */
function cookieSecure() {
  if (process.env.COOKIE_SECURE === 'false') return false;
  return process.env.NODE_ENV === 'production' || process.env.COOKIE_SECURE === 'true';
}

/** Cookie options shared by set and clear so the cookie is really removed. */
function authCookieOptions() {
  return { httpOnly: true, sameSite: 'lax', secure: cookieSecure(), path: '/' };
}

/** Set the auth cookie (HttpOnly, SameSite=Lax, Secure in production). */
export function setAuthCookie(res, token, ttlHours = 12) {
  res.cookie(COOKIE_NAME, token, {
    ...authCookieOptions(),
    maxAge: Math.round(ttlHours * 3600 * 1000),
  });
}

/** Clear the auth cookie using the same attributes it was set with. */
export function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME, authCookieOptions());
}

/** Parse the Cookie header into an object. */
export function parseCookies(req) {
  const out = {};
  const raw = req?.headers?.cookie;
  if (!raw) return out;
  for (const pair of String(raw).split(';')) {
    const idx = pair.indexOf('=');
    if (idx === -1) continue;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    if (!k) continue;
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}
