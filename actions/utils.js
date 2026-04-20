/* 
* <license header>
*/

/* This file exposes some common utilities for your actions */

/**
 *
 * Returns a log ready string of the action input parameters.
 * The `Authorization` header content will be replaced by '<hidden>'.
 *
 * @param {object} params action input parameters.
 *
 * @returns {string}
 *
 */
function stringParameters (params) {
  // hide authorization token without overriding params
  let headers = params.__ow_headers || {}
  if (headers.authorization) {
    headers = { ...headers, authorization: '<hidden>' }
  }
  return JSON.stringify({ ...params, __ow_headers: headers })
}

/**
 *
 * Returns the list of missing keys giving an object and its required keys.
 * A parameter is missing if its value is undefined or ''.
 * A value of 0 or null is not considered as missing.
 *
 * @param {object} obj object to check.
 * @param {array} required list of required keys.
 *        Each element can be multi level deep using a '.' separator e.g. 'myRequiredObj.myRequiredKey'
 *
 * @returns {array}
 * @private
 */
function getMissingKeys (obj, required) {
  return required.filter(r => {
    const splits = r.split('.')
    const last = splits[splits.length - 1]
    const traverse = splits.slice(0, -1).reduce((tObj, split) => { tObj = (tObj[split] || {}); return tObj }, obj)
    return traverse[last] === undefined || traverse[last] === '' // missing default params are empty string
  })
}

/**
 *
 * Returns the list of missing keys giving an object and its required keys.
 * A parameter is missing if its value is undefined or ''.
 * A value of 0 or null is not considered as missing.
 *
 * @param {object} params action input parameters.
 * @param {array} requiredHeaders list of required input headers.
 * @param {array} requiredParams list of required input parameters.
 *        Each element can be multi level deep using a '.' separator e.g. 'myRequiredObj.myRequiredKey'.
 *
 * @returns {string} if the return value is not null, then it holds an error message describing the missing inputs.
 *
 */
function checkMissingRequestInputs (params, requiredParams = [], requiredHeaders = []) {
  let errorMessage = null

  // input headers are always lowercase
  requiredHeaders = requiredHeaders.map(h => h.toLowerCase())
  // check for missing headers
  const missingHeaders = getMissingKeys(params.__ow_headers || {}, requiredHeaders)
  if (missingHeaders.length > 0) {
    errorMessage = `missing header(s) '${missingHeaders}'`
  }

  // check for missing parameters
  const missingParams = getMissingKeys(params, requiredParams)
  if (missingParams.length > 0) {
    if (errorMessage) {
      errorMessage += ' and '
    } else {
      errorMessage = ''
    }
    errorMessage += `missing parameter(s) '${missingParams}'`
  }

  return errorMessage
}

/**
 *
 * Extracts the bearer token string from the Authorization header in the request parameters.
 *
 * @param {object} params action input parameters.
 *
 * @returns {string|undefined} the token string or undefined if not set in request headers.
 *
 */
function getBearerToken (params) {
  if (params.__ow_headers &&
      params.__ow_headers.authorization &&
      params.__ow_headers.authorization.startsWith('Bearer ')) {
    return params.__ow_headers.authorization.substring('Bearer '.length)
  }
  return undefined
}
/**
 *
 * Returns an error response object and attempts to log.info the status code and error message
 *
 * @param {number} statusCode the error status code.
 *        e.g. 400
 * @param {string} message the error message.
 *        e.g. 'missing xyz parameter'
 * @param {*} [logger] an optional logger instance object with an `info` method
 *        e.g. `new require('@adobe/aio-sdk').Core.Logger('name')`
 *
 * @returns {object} the error object, ready to be returned from the action main's function.
 *
 */
function errorResponse (statusCode, message, logger) {
  if (logger && typeof logger.info === 'function') {
    logger.info(`${statusCode}: ${message}`)
  }
  return {
    error: {
      statusCode,
      body: {
        error: message
      }
    }
  }
}

// ---------------------------------------------------------------------------
// CSS Token Helpers
// ---------------------------------------------------------------------------

/**
 * Recursively flatten a nested object into dot-separated (kebab) keys.
 * Arrays and CSS-like values (colors, px, rem) are kept as leaf values.
 *
 * @param {object} obj  - source token object
 * @param {string} prefix - current key prefix
 * @returns {object} flat key → value map
 */
function flattenObject (obj, prefix = '') {
  const out = {}
  for (const [key, value] of Object.entries(obj)) {
    const k = prefix ? `${prefix}-${key}` : key
    if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      !isCssValue(value)
    ) {
      // Token descriptor shape: { type, default, label } — extract the actual value
      if ('default' in value) {
        out[k] = value.default
      } else {
        Object.assign(out, flattenObject(value, k))
      }
    } else {
      out[k] = value
    }
  }
  return out
}

/**
 * Returns true if the value should be treated as a CSS leaf value (not recursed into).
 * @param {*} v
 * @returns {boolean}
 */
function isCssValue (v) {
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
 * Convert camelCase / PascalCase string to kebab-case.
 * @param {string} str
 * @returns {string}
 */
function toKebabCase (str) {
  return str
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/[\s._]+/g, '-')
    .toLowerCase()
}

/**
 * Build a CSS `:root {}` block of custom properties from a flat key-value map.
 *
 * @param {object} flat    - flat key → value pairs
 * @param {string} prefix  - CSS variable prefix, e.g. '--brand-'
 * @returns {string} CSS text
 */
function toCssVariables (flat, prefix = '--brand-') {
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
// GitHub API Helpers
// ---------------------------------------------------------------------------

const GITHUB_API_BASE = 'https://api.github.com'

/**
 * Builds standard GitHub API request headers.
 * @param {string} token - GitHub Personal Access Token
 * @returns {object}
 */
function buildGitHubHeaders (token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28'
  }
}

/**
 * Fetches the SHA of the tip commit of a branch.
 * @param {string} owner
 * @param {string} repo
 * @param {string} branch
 * @param {string} token
 * @returns {Promise<string>} the SHA string
 */
async function getBranchSHA (owner, repo, branch, token) {
  const fetch = require('node-fetch')
  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/ref/heads/${branch}`
  const res = await fetch(url, { headers: buildGitHubHeaders(token) })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(
      `Failed to get branch SHA for '${branch}': ${res.status} ${body.message || ''}`
    )
  }
  const data = await res.json()
  return data.object.sha
}

/**
 * Creates a new branch in the repository.
 * @param {string} owner
 * @param {string} repo
 * @param {string} newBranch - name of the new branch
 * @param {string} sha       - SHA to base the new branch on
 * @param {string} token
 * @returns {Promise<object>} GitHub API response
 */
async function createBranch (owner, repo, newBranch, sha, token) {
  const fetch = require('node-fetch')
  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/refs`
  const res = await fetch(url, {
    method: 'POST',
    headers: buildGitHubHeaders(token),
    body: JSON.stringify({ ref: `refs/heads/${newBranch}`, sha })
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(
      `Failed to create branch '${newBranch}': ${res.status} ${body.message || ''}`
    )
  }
  return res.json()
}

/**
 * Creates or updates a file on a branch using the GitHub Contents API.
 * If the file already exists on that branch its SHA must be supplied.
 *
 * @param {object} opts
 * @param {string} opts.owner
 * @param {string} opts.repo
 * @param {string} opts.branch  - branch where the file will be written
 * @param {string} opts.path    - file path within the repo e.g. "brand/aramark.css"
 * @param {string} opts.content - raw file content (will be base64-encoded)
 * @param {string} opts.message - commit message
 * @param {string} opts.token
 * @returns {Promise<object>} GitHub API response
 */
async function createOrUpdateFile (opts) {
  const fetch = require('node-fetch')
  const { owner, repo, branch, path, content, message, token } = opts
  const headers = buildGitHubHeaders(token)

  // Check whether the file already exists on the branch (so we can pass its SHA)
  const checkUrl = `${GITHUB_API_BASE}/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`
  const checkRes = await fetch(checkUrl, { headers })
  const existingFile = checkRes.ok ? await checkRes.json().catch(() => null) : null
  const existingSha = existingFile && existingFile.sha ? existingFile.sha : undefined

  const putUrl = `${GITHUB_API_BASE}/repos/${owner}/${repo}/contents/${path}`
  const putBody = {
    message,
    content: Buffer.from(content, 'utf8').toString('base64'),
    branch
  }
  if (existingSha) putBody.sha = existingSha

  const putRes = await fetch(putUrl, {
    method: 'PUT',
    headers,
    body: JSON.stringify(putBody)
  })

  if (!putRes.ok) {
    const errBody = await putRes.json().catch(() => ({}))
    throw new Error(
      `Failed to create/update file '${path}': ${putRes.status} ${errBody.message || ''}`
    )
  }
  return putRes.json()
}

/**
 * Creates a Pull Request.
 * @param {string} owner
 * @param {string} repo
 * @param {string} head   - branch to merge from
 * @param {string} base   - branch to merge into
 * @param {string} title
 * @param {string} body
 * @param {string} token
 * @returns {Promise<object>} GitHub API response with PR details
 */
async function createPullRequest (owner, repo, head, base, title, body, token) {
  const fetch = require('node-fetch')
  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/pulls`
  const res = await fetch(url, {
    method: 'POST',
    headers: buildGitHubHeaders(token),
    body: JSON.stringify({ title, body: body || '', head, base })
  })
  if (!res.ok) {
    const respBody = await res.json().catch(() => ({}))
    throw new Error(`Failed to create PR: ${res.status} ${respBody.message || ''}`)
  }
  return res.json()
}

module.exports = {
  // Original utilities
  errorResponse,
  getBearerToken,
  stringParameters,
  checkMissingRequestInputs,
  // CSS token helpers
  flattenObject,
  isCssValue,
  toKebabCase,
  toCssVariables,
  // GitHub API helpers
  buildGitHubHeaders,
  getBranchSHA,
  createBranch,
  createOrUpdateFile,
  createPullRequest
}
