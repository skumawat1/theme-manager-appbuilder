/*
* <license header>
*/

/**
 * Fetches a property-specific theme Content Fragment from AEM (REST API),
 * then converts the JSON into a CSS custom properties (variables) file.
 * Optionally creates a new Pull Request that adds/updates brand/{brandName}.css in the repo.
 *
 * Inputs:
 *   - aemBaseUrl: AEM publish/delivery base URL
 *   - fragmentPath: Path to the theme Content Fragment
 *   - cssVarPrefix: Optional prefix for CSS variables (default: '--theme-')
 *   - brandName: Optional. If set with githubToken, creates a PR saving CSS to brand/{brandName}.css
 *   - githubToken: Optional. GitHub PAT or GITHUB_TOKEN for creating the PR (or set env GITHUB_TOKEN)
 *   - repo: Optional. "owner/repo" (default from env GITHUB_REPOSITORY when running in GitHub Actions)
 *   - baseBranch: Optional. Base branch for the PR (default: 'main')
 *
 * Output: { css, contentType, json?, pr?: { url, number, branch } }
 */

const fetch = require('node-fetch')
const { Core } = require('@adobe/aio-sdk')
const { errorResponse, getBearerToken, checkMissingRequestInputs } = require('../utils')

/** Default prefix for generated CSS variables */
const DEFAULT_CSS_PREFIX = '--theme-'

/**
 * Recursively flatten an object into a single level with dot-separated keys.
 * @param {object} obj
 * @param {string} prefix
 * @returns {object}
 */
function flattenObject (obj, prefix = '') {
  const out = {}
  for (const [key, value] of Object.entries(obj)) {
    const k = prefix ? `${prefix}-${key}` : key
    if (value !== null && typeof value === 'object' && !Array.isArray(value) && !isCssValue(value)) {
      Object.assign(out, flattenObject(value, k))
    } else {
      out[k] = value
    }
  }
  return out
}

/** Treat as single value (don't recurse) if it looks like a CSS value or is array */
function isCssValue (v) {
  if (Array.isArray(v)) return true
  if (typeof v === 'string' && (v.startsWith('rgb') || v.startsWith('#') || v.includes('px') || v.includes('rem'))) return true
  return false
}

/**
 * Convert camelCase or PascalCase to kebab-case.
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
 * Turn a flat key-value object into CSS custom property declarations.
 * @param {object} flat - key-value pairs (keys become --var-names)
 * @param {string} prefix - e.g. '--theme-'
 * @returns {string} CSS block
 */
function toCssVariables (flat, prefix = DEFAULT_CSS_PREFIX) {
  const lines = []
  const pre = prefix.endsWith('-') ? prefix : prefix + '-'
  for (const [key, value] of Object.entries(flat)) {
    const varName = pre + toKebabCase(String(key))
    const cssValue = typeof value === 'string' ? value : JSON.stringify(value)
    lines.push(`  ${varName}: ${cssValue};`)
  }
  return `:root {\n${lines.join('\n')}\n}\n`
}

/**
 * Build AEM Content Fragment Delivery API URL.
 * Uses path to content fragment as endpoint (GET). If your AEM environment uses
 * a different base path, pass the full URL in aemBaseUrl and set fragmentPath to ''.
 * @param {string} baseUrl - AEM base URL (no trailing slash), or full CF Delivery URL
 * @param {string} fragmentPath - CF path e.g. /content/dam/site/themes/my-property-theme
 */
function buildDeliveryUrl (baseUrl, fragmentPath) {
  const base = baseUrl.replace(/\/$/, '')
  if (!fragmentPath || fragmentPath === '') return base
  const path = fragmentPath.startsWith('/') ? fragmentPath : `/${fragmentPath}`
  return `${base}/api/delivery/contentfragments${path}`
}

/** Safe filename and branch segment from brand name */
function sanitizeBrandName (name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'brand'
}

/**
 * Create a new branch, add or update brand/{fileName}.css with css content, and open a PR.
 * @param {object} opts - { token, repo, baseBranch, branchName, css, fileName, logger }
 * @returns {Promise<{ url: string, number: number, branch: string }>}
 */
async function createPrWithCss (opts) {
  const { token, repo, baseBranch = 'main', css, fileName, logger } = opts
  const branchName = opts.branchName || `theme/brand-${opts.fileName}`
  const apiBase = 'https://api.github.com'
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28'
  }

  const [owner, repoName] = repo.split('/')
  if (!owner || !repoName) throw new Error('repo must be "owner/repo"')

  const getRef = (ref) =>
    fetch(`${apiBase}/repos/${owner}/${repoName}/git/ref/heads/${ref}`, { headers })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`getRef ${ref}: ${r.status}`))))

  const getDefaultBranch = () =>
    fetch(`${apiBase}/repos/${owner}/${repoName}`, { headers })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('get repo failed'))))
      .then((repoInfo) => repoInfo.default_branch || baseBranch)

  const base = await getDefaultBranch()
  const refResp = await getRef(base)
  const baseSha = refResp.object.sha

  const createBranchRes = await fetch(`${apiBase}/repos/${owner}/${repoName}/git/refs`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: baseSha })
  })
  if (!createBranchRes.ok) {
    const errText = await createBranchRes.text()
    throw new Error(`create branch: ${createBranchRes.status} ${errText}`)
  }
  const contentEnc = Buffer.from(css, 'utf8').toString('base64')
  const path = `brand/${fileName}.css`

  const getFileSha = () =>
    fetch(`${apiBase}/repos/${owner}/${repoName}/contents/${path}?ref=${encodeURIComponent(branchName)}`, { headers })
      .then((r) => (r.ok ? r.json() : null))
      .then((info) => (info && info.sha) || null)

  const fileSha = await getFileSha()
  const putBody = {
    message: `chore(brand): add/update theme CSS for ${fileName}`,
    content: contentEnc,
    branch: branchName
  }
  if (fileSha) putBody.sha = fileSha

  const putRes = await fetch(`${apiBase}/repos/${owner}/${repoName}/contents/${path}`, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(putBody)
  })
  if (!putRes.ok) {
    const errText = await putRes.text()
    throw new Error(`create/update file: ${putRes.status} ${errText}`)
  }

  const prRes = await fetch(`${apiBase}/repos/${owner}/${repoName}/pulls`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: `Brand theme: ${fileName}`,
      head: branchName,
      base,
      body: `Adds or updates \`brand/${fileName}.css\` with theme variables from Content Fragment.`
    })
  })
  if (!prRes.ok) {
    const errText = await prRes.text()
    throw new Error(`create PR: ${prRes.status} ${errText}`)
  }
  const pr = await prRes.json()
  if (logger) logger.info(`PR created: ${pr.html_url}`)
  return { url: pr.html_url, number: pr.number, branch: branchName }
}

async function main (params) {
  const logger = Core.Logger('main', { level: params.LOG_LEVEL || 'info' })

  try {
    logger.info('Theme-to-CSS: fetch Content Fragment and generate CSS variables')

    const requiredParams = ['aemBaseUrl', 'fragmentPath']
    const requiredHeaders = ['Authorization']
    const errorMessage = checkMissingRequestInputs(params, requiredParams, requiredHeaders)
    if (errorMessage) {
      return errorResponse(400, errorMessage, logger)
    }

    const token = getBearerToken(params)
    const { aemBaseUrl, fragmentPath, cssVarPrefix = DEFAULT_CSS_PREFIX } = params

    const url = buildDeliveryUrl(aemBaseUrl, fragmentPath)
    logger.debug(`Fetching theme CF: ${url}`)

    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    }
    if (token) headers.Authorization = `Bearer ${token}`
    if (params.edgeKey) headers['x-api-key'] = params.edgeKey

    const res = await fetch(url, { method: 'GET', headers })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`AEM request failed ${res.status}: ${text}`)
    }

    const data = await res.json()

    // Support both direct fragment payload and wrapped { data, ... } responses
    const payload = data?.data ?? data?.content ?? data
    const themeJson = typeof payload === 'object' ? payload : { value: payload }

    const flat = flattenObject(themeJson)
    const css = toCssVariables(flat, cssVarPrefix)

    const body = {
      css,
      contentType: 'text/css',
      json: themeJson
    }

    const brandName = params.brandName
    const githubToken = params.githubToken || process.env.GITHUB_TOKEN
    const repo = params.repo || process.env.GITHUB_REPOSITORY

    if (brandName && githubToken && repo) {
      const fileName = sanitizeBrandName(brandName)
      const branchName = `theme/brand-${fileName}-${Date.now()}`
      try {
        const pr = await createPrWithCss({
          token: githubToken,
          repo,
          baseBranch: params.baseBranch || 'main',
          branchName,
          css,
          fileName,
          logger
        })
        body.pr = pr
        logger.info(`PR created: ${pr.url}`)
      } catch (prError) {
        logger.error(prError)
        body.prError = prError.message
      }
    }

    const response = { statusCode: 200, body }
    logger.info(`${response.statusCode}: theme CSS generated (${Object.keys(flat).length} variables)`)
    return response
  } catch (error) {
    logger.error(error)
    return errorResponse(500, error.message || 'server error', logger)
  }
}

exports.main = main
 