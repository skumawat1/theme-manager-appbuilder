/*
 * <license header>
 */

/**
 * This action:
 *  1. Fetches mock CSS data (simulating an external API response)
 *  2. Converts the data into CSS custom properties
 *  3. Creates a new branch in a GitHub repository
 *  4. Commits the generated CSS file as brand/<css_file_name>.css on that branch
 *  5. Raises a Pull Request against the target branch
 *
 * Required inputs:
 *   - GITHUB_TOKEN: GitHub Personal Access Token (injected via env / app.config.yaml)
 *   - owner: GitHub repository owner (org or user)
 *   - repo: Repository name
 *   - new_branch: Name of the new branch to create
 *   - pr_title: Title of the Pull Request
 *
 * Optional inputs:
 *   - base_branch: Branch to create the new branch from (default: 'main')
 *   - target_branch: Branch to raise the PR against (default: 'main')
 *   - pr_body: Body/description of the Pull Request
 *   - css_file_name: Base name for the CSS file saved as brand/<css_file_name>.css (default: 'brand-theme')
 */

const fetch = require('node-fetch')
const { Core } = require('@adobe/aio-sdk')
const { errorResponse, stringParameters, checkMissingRequestInputs } = require('../utils')

const GITHUB_API_BASE = 'https://api.github.com'

// ---------------------------------------------------------------------------
// CSS helpers (adapted from referJS.js)
// ---------------------------------------------------------------------------

/**
 * Recursively flatten a nested object into dot-separated keys.
 * Arrays and CSS-like values are kept as-is.
 *
 * @param {object} obj
 * @param {string} prefix
 * @returns {object}
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
      Object.assign(out, flattenObject(value, k))
    } else {
      out[k] = value
    }
  }
  return out
}

/** Returns true if the value should be treated as a leaf CSS value. */
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
 * @param {object} flat  - flat key → value pairs
 * @param {string} prefix - CSS variable prefix, e.g. '--brand-'
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
// Mock CSS data source
// ---------------------------------------------------------------------------

/**
 * Returns a mock CSS theme data object, simulating what a real API would return.
 * Replace the body of this function with a real fetch() call to your CSS API endpoint.
 *
 * @returns {Promise<object>}
 */
async function fetchMockCssData () {
  // Simulated API response — swap with:
  //   const res = await fetch('https://your-api.example.com/theme')
  //   return res.json()
  return {
    colors: {
      primary: '#e87722',
      secondary: '#003865',
      background: '#ffffff',
      surface: '#f5f5f5',
      error: '#d32f2f',
      onPrimary: '#ffffff',
      onSecondary: '#ffffff',
      textPrimary: '#212121',
      textSecondary: '#757575'
    },
    typography: {
      fontFamilyBase: '"Source Sans Pro", Arial, sans-serif',
      fontSizeBase: '16px',
      fontSizeSmall: '12px',
      fontSizeLarge: '20px',
      fontWeightRegular: '400',
      fontWeightBold: '700',
      lineHeightBase: '1.5'
    },
    spacing: {
      xs: '4px',
      sm: '8px',
      md: '16px',
      lg: '24px',
      xl: '32px',
      xxl: '48px'
    },
    borderRadius: {
      small: '4px',
      medium: '8px',
      large: '16px',
      pill: '9999px'
    },
    shadows: {
      card: '0 2px 4px rgba(0,0,0,0.12)',
      modal: '0 8px 24px rgba(0,0,0,0.2)'
    },
    breakpoints: {
      mobile: '480px',
      tablet: '768px',
      desktop: '1024px',
      wide: '1280px'
    }
  }
}

// ---------------------------------------------------------------------------
// GitHub API helpers
// ---------------------------------------------------------------------------

/**
 * Builds GitHub API request headers.
 *
 * @param {string} token GitHub Personal Access Token
 * @returns {object} headers object
 */
function buildHeaders (token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28'
  }
}

/**
 * Fetches the SHA of the tip commit of a branch.
 *
 * @param {string} owner repo owner
 * @param {string} repo repo name
 * @param {string} branch branch name
 * @param {string} token GitHub token
 * @returns {Promise<string>} the SHA string
 */
async function getBranchSHA (owner, repo, branch, token) {
  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/ref/heads/${branch}`
  const res = await fetch(url, { headers: buildHeaders(token) })
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
 *
 * @param {string} owner repo owner
 * @param {string} repo repo name
 * @param {string} newBranch name of the new branch
 * @param {string} sha SHA to base the new branch on
 * @param {string} token GitHub token
 * @returns {Promise<object>} GitHub API response
 */
async function createBranch (owner, repo, newBranch, sha, token) {
  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/refs`
  const res = await fetch(url, {
    method: 'POST',
    headers: buildHeaders(token),
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
  const { owner, repo, branch, path, content, message, token } = opts
  const headers = buildHeaders(token)

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
 *
 * @param {string} owner repo owner
 * @param {string} repo repo name
 * @param {string} head branch to merge from
 * @param {string} base branch to merge into
 * @param {string} title PR title
 * @param {string} body PR body/description
 * @param {string} token GitHub token
 * @returns {Promise<object>} GitHub API response with PR details
 */
async function createPullRequest (owner, repo, head, base, title, body, token) {
  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/pulls`
  const res = await fetch(url, {
    method: 'POST',
    headers: buildHeaders(token),
    body: JSON.stringify({ title, body: body || '', head, base })
  })
  if (!res.ok) {
    const respBody = await res.json().catch(() => ({}))
    throw new Error(`Failed to create PR: ${res.status} ${respBody.message || ''}`)
  }
  return res.json()
}

// ---------------------------------------------------------------------------
// Action entry point
// ---------------------------------------------------------------------------

async function main (params) {
  const logger = Core.Logger('main', { level: params.LOG_LEVEL || 'info' })

  try {
    logger.info('Calling the github-branch-pr action')
    logger.debug(stringParameters(params))

    // Validate required parameters
    const requiredParams = ['GITHUB_TOKEN', 'owner', 'repo', 'new_branch', 'pr_title']
    const errorMessage = checkMissingRequestInputs(params, requiredParams, [])
    if (errorMessage) {
      return errorResponse(400, errorMessage, logger)
    }

    const {
      GITHUB_TOKEN,
      owner,
      repo,
      new_branch: newBranch,
      base_branch: baseBranch = 'main',
      target_branch: targetBranch = 'main',
      pr_title: prTitle,
      pr_body: prBody = '',
      css_file_name: cssFileName = 'brand-theme'
    } = params

    // ------------------------------------------------------------------
    // Step 1: Get SHA of the base branch
    // ------------------------------------------------------------------
    logger.info(`Step 1: Getting SHA for base branch '${baseBranch}' in ${owner}/${repo}`)
    const sha = await getBranchSHA(owner, repo, baseBranch, GITHUB_TOKEN)
    logger.debug(`Base branch SHA: ${sha}`)

    // ------------------------------------------------------------------
    // Step 2: Fetch CSS data from mock (or real) API and generate CSS
    // ------------------------------------------------------------------
    logger.info('Step 2: Fetching CSS theme data from API')
    const themeData = await fetchMockCssData()
    const flat = flattenObject(themeData)
    const cssContent = toCssVariables(flat, '--brand-')
    logger.info(`CSS generated: ${Object.keys(flat).length} custom properties`)
    logger.debug(`CSS content:\n${cssContent}`)

    // ------------------------------------------------------------------
    // Step 3: Create the new branch
    // ------------------------------------------------------------------
    logger.info(`Step 3: Creating branch '${newBranch}' from '${baseBranch}'`)
    const branchResult = await createBranch(owner, repo, newBranch, sha, GITHUB_TOKEN)
    logger.info(`Branch '${newBranch}' created: ${branchResult.ref}`)

    // ------------------------------------------------------------------
    // Step 4: Commit brand/<cssFileName>.css to the new branch
    // ------------------------------------------------------------------
    const filePath = `brand/${cssFileName}.css`
    logger.info(`Step 4: Committing '${filePath}' to branch '${newBranch}'`)
    const fileResult = await createOrUpdateFile({
      owner,
      repo,
      branch: newBranch,
      path: filePath,
      content: cssContent,
      message: `chore(brand): add/update CSS theme variables for ${cssFileName}`,
      token: GITHUB_TOKEN
    })
    const fileUrl =
      fileResult.content && fileResult.content.html_url
        ? fileResult.content.html_url
        : `https://github.com/${owner}/${repo}/blob/${newBranch}/${filePath}`
    logger.info(`File committed: ${fileUrl}`)

    // ------------------------------------------------------------------
    // Step 5: Create the Pull Request
    // ------------------------------------------------------------------
    logger.info(`Step 5: Creating PR from '${newBranch}' into '${targetBranch}'`)
    const pr = await createPullRequest(
      owner,
      repo,
      newBranch,
      targetBranch,
      prTitle,
      prBody ||
        `Adds \`${filePath}\` with ${Object.keys(flat).length} CSS custom properties generated from theme data.`,
      GITHUB_TOKEN
    )
    logger.info(`PR #${pr.number} created: ${pr.html_url}`)

    const response = {
      statusCode: 200,
      body: {
        message: 'Branch, CSS file, and Pull Request created successfully',
        branch: {
          name: newBranch,
          ref: branchResult.ref,
          sha: branchResult.object.sha
        },
        css_file: {
          path: filePath,
          variables: Object.keys(flat).length,
          url: fileUrl
        },
        pull_request: {
          number: pr.number,
          title: pr.title,
          url: pr.html_url,
          state: pr.state,
          head: pr.head.ref,
          base: pr.base.ref
        }
      }
    }

    logger.info(`${response.statusCode}: successful request`)
    return response
  } catch (error) {
    logger.error(error)
    return errorResponse(500, error.message || 'server error', logger)
  }
}

exports.main = main
