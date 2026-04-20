/*
 * Client-side utilities for the Brand CSS Token Manager
 *
 * Includes:
 *   - CSS token helpers (flattenObject, toKebabCase, toCssVariables)
 *   - Schema loader (loadSchema)
 *   - Action invocation helper (actionWebInvoke)
 */

import tokenSchema from '../../config/token-schema.json' assert { type: 'json' };

// ---------------------------------------------------------------------------
// CSS Token Helpers  (mirrors actions/utils.js — no server round-trip needed)
// ---------------------------------------------------------------------------

/**
 * Recursively flatten a nested token object into kebab-joined keys.
 * CSS-like leaf values (hex colors, px/rem sizes, rgb()) are not recursed.
 *
 * @param {object} obj
 * @param {string} prefix
 * @returns {object} flat key → value map
 * import jsonData from './data.json' assert { type: 'json' };
 */

export function flattenObject (obj, prefix = '') {
  const out = {}
  for (const [key, value] of Object.entries(obj)) {
    const k = prefix ? `${prefix}-${key}` : key
    if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      !isCssValue(value)
    ) {
      Object.assign(out, flattenObject(value, k))
    } else {
      out[k] = value
    }
  }
  return out
}

/**
 * Returns true if a value should be treated as a CSS leaf (no recursion).
 * @param {*} v
 * @returns {boolean}
 */
export function isCssValue (v) {
  if (Array.isArray(v)) return true
  if (
    typeof v === 'string' &&
    (v.startsWith('rgb') ||
      v.startsWith('#') ||
      v.includes('px') ||
      v.includes('rem'))
  ) {
    return true
  }
  return false
}

/**
 * Convert camelCase / PascalCase to kebab-case.
 * @param {string} str
 * @returns {string}
 */
export function toKebabCase (str) {
  return str
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/[\s._]+/g, '-')
    .toLowerCase()
}

/**
 * Build a CSS `:root {}` block of custom properties from a flat key-value map.
 *
 * @param {object} flat   - flat key → value pairs
 * @param {string} prefix - CSS variable prefix, e.g. '--brand-'
 * @returns {string} full CSS text
 */
export function toCssVariables (flat, prefix = '--brand-') {
  const lines = []
  const pre = prefix.endsWith('-') ? prefix : `${prefix}-`
  for (const [key, value] of Object.entries(flat)) {
    const varName = pre + toKebabCase(String(key))
    const cssValue = typeof value === 'string' ? value : JSON.stringify(value)
    lines.push(`  ${varName}: ${cssValue};`)
  }
  return `:root {\n${lines.join('\n')}\n}\n`
}

// ---------------------------------------------------------------------------
// Schema — imported from config/token-schema.json
// ---------------------------------------------------------------------------

let _schemaCache = null

/**
 * Return the token schema from the imported config/token-schema.json.
 * Throws an error if the schema is not available.
 *
 * @returns {Promise<object>} the parsed schema object
 */
export async function loadSchema () {
  if (_schemaCache) return _schemaCache
  if (!tokenSchema) {
    throw new Error('token-schema.json is not available. Ensure config/token-schema.json exists and is properly imported.')
  }
  _schemaCache = tokenSchema
  return _schemaCache
}

/**
 * Build a default token object from the schema (all values set to schema defaults).
 * @param {object} schema - parsed token-schema.json
 * @returns {object} token object with default values
 */
export function buildDefaultTokens (schema) {
  const tokens = {}
  for (const [category, fields] of Object.entries(schema)) {
    tokens[category] = {}
    for (const [key, def] of Object.entries(fields)) {
      tokens[category][key] = def.default
    }
  }
  return tokens
}

// ---------------------------------------------------------------------------
// Action Invocation Helper
// ---------------------------------------------------------------------------

/**
 * Invoke an Adobe I/O Runtime web action.
 *
 * @param {string} actionUrl  - full action URL
 * @param {object} headers    - HTTP headers (e.g. Authorization)
 * @param {object} params     - query/body parameters
 * @param {string} [method]   - HTTP method (default: 'POST')
 * @returns {Promise<object>} parsed JSON response body
 */
export async function actionWebInvoke (actionUrl, headers = {}, params = {}, method = 'POST') {
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers
    }
  }

  if (method === 'GET') {
    const qs = new URLSearchParams(params).toString()
    const url = qs ? `${actionUrl}?${qs}` : actionUrl
    const res = await fetch(url, opts)
    return _handleResponse(res)
  }

  opts.body = JSON.stringify(params)
  const res = await fetch(actionUrl, opts)
  return _handleResponse(res)
}

async function _handleResponse (res) {
  let data
  const contentType = res.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    data = await res.json()
  } else {
    data = await res.text()
  }
  if (!res.ok) {
    const msg = (data && data.error) ? data.error : `HTTP ${res.status}`
    throw new Error(msg)
  }
  return data
}

export default actionWebInvoke
