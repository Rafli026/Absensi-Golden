// Small input validation helpers. Each returns the coerced value or throws.

import { ApiError } from '../middleware/errorHandler.js';

/** Non-empty trimmed string. */
export function str(value, field, { required = true, max = 1000 } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new ApiError(400, `Field '${field}' wajib diisi`);
    return undefined;
  }
  const s = String(value).trim();
  if (s.length === 0) {
    if (required) throw new ApiError(400, `Field '${field}' wajib diisi`);
    return undefined;
  }
  if (s.length > max) throw new ApiError(400, `Field '${field}' terlalu panjang`);
  return s;
}

/** Integer, optionally bounded. */
export function int(value, field, { required = true, min = -Infinity, max = Infinity } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new ApiError(400, `Field '${field}' wajib diisi`);
    return undefined;
  }
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new ApiError(400, `Field '${field}' harus berupa angka bulat`);
  }
  if (n < min || n > max) throw new ApiError(400, `Field '${field}' di luar rentang yang diizinkan`);
  return n;
}

/** Float, optionally bounded. */
export function num(value, field, { required = true, min = -Infinity, max = Infinity } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new ApiError(400, `Field '${field}' wajib diisi`);
    return undefined;
  }
  const n = Number(value);
  if (!Number.isFinite(n)) throw new ApiError(400, `Field '${field}' harus berupa angka`);
  if (n < min || n > max) throw new ApiError(400, `Field '${field}' di luar rentang yang diizinkan`);
  return n;
}

/** Coerce to boolean. Accepts true/false, 1/0, 'true'/'false'. */
export function bool(value, field, { required = true } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new ApiError(400, `Field '${field}' wajib diisi`);
    return undefined;
  }
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  throw new ApiError(400, `Field '${field}' harus berupa boolean`);
}

/** Value must be in the allowed list. */
export function enumOf(value, field, allowed, { required = true } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new ApiError(400, `Field '${field}' wajib diisi`);
    return undefined;
  }
  if (!allowed.includes(value)) {
    throw new ApiError(400, `Field '${field}' harus salah satu dari: ${allowed.join(', ')}`);
  }
  return value;
}

/** Assert required keys exist (non-empty) on an object. */
export function requireFields(obj, fields) {
  for (const f of fields) {
    const v = obj?.[f];
    if (v === undefined || v === null || v === '') {
      throw new ApiError(400, `Field '${f}' wajib diisi`);
    }
  }
}
