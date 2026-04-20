/*
 * <license header>
 */

/**
 * publish-tokens action — Generates CSS from stored brand tokens and creates a GitHub PR.
 *
 * Flow:
 *   1. Reads stored token set for params.brandName from Adobe I/O State
 *   2. Flattens the token object and generates a CSS :root { --brand-* } block
 *   3. Creates a new branch in the target GitHub repository
 *   4. Commits brand/<brandName>.css to that branch
 *   5. Opens a Pull Request against the target branch
 *
 * Required params:
 *   - brandName      : name of the brand whose tokens to publish
 *   - GITHUB_TOKEN   : GitHub PAT (injected via app.config.yaml / env)
 *   - owner          : GitHub repository owner (org or user)
 *   - repo           : Repository name
 *
 * Optional params:
 *   - base_branch    : branch to create the new branch from (default: 'main')
 *   - target_branch  : branch to raise the PR against (default: 'main')
 *   - pr_title       : title for the Pull Request
 *   - pr_body        : description for the Pull Request
 *   - css_prefix     : CSS variable prefix (default: '--brand-')
 */

const { Core } = require('@adobe/aio-sdk')
const stateLib = require('@adobe/aio-lib-state')
const {
  errorResponse,
  stringParameters,
  checkMissingRequestInputs,
  flattenObject,
  toCssVariables,
  getBranchSHA,
  createBranch,
  createOrUpdateFile,
  createPullRequest
} = require('../utils')

/**
 * Sanitise a brand name for use as a file/branch name segment.
 * @param {string} name
 * @returns {string}
 */
function sanitiseBrandName (name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'brand'
}

async function main (params) {
  const logger = Core.Logger('publish-tokens', { level: params.LOG_LEVEL || 'info' })

  try {
    logger.info('publish-tokens action called')
    logger.debug(stringParameters(params))

    // ------------------------------------------------------------------
    // Validate required inputs
    // ------------------------------------------------------------------
    const requiredParams = ['brandName', 'GITHUB_TOKEN', 'owner', 'repo']
    const errorMessage = checkMissingRequestInputs(params, requiredParams, [])
    if (errorMessage) {
      return errorResponse(400, errorMessage, logger)
    }

    const {
      brandName,
      GITHUB_TOKEN,
      owner,
      repo,
      base_branch: baseBranch = 'main',
      target_branch: targetBranch = 'main',
      css_prefix: cssPrefix = '--brand-'
    } = params

    const safeName = sanitiseBrandName(brandName)

    // ------------------------------------------------------------------
    // Step 1: Load brand tokens from I/O State
    // ------------------------------------------------------------------
    logger.info(`Step 1: Loading tokens for brand '${safeName}' from I/O State`)
    const state = await stateLib.init()
    const entry = await state.get(`brand.${safeName}`)

    if (!entry || entry.value === undefined) {
      return errorResponse(404, `Brand '${brandName}' not found. Save tokens first using the manage-tokens action.`, logger)
    }

    const tokens = typeof entry.value === 'string' ? JSON.parse(entry.value) : entry.value
    logger.info(`Loaded tokens for '${safeName}'`)

    // ------------------------------------------------------------------
    // Step 2: Generate CSS custom properties
    // ------------------------------------------------------------------
    logger.info('Step 2: Generating CSS custom properties')
    const flat = flattenObject(tokens)
    const cssContent = toCssVariables(flat, cssPrefix)
    const variableCount = Object.keys(flat).length
    logger.info(`Generated ${variableCount} CSS custom properties`)
    logger.debug(`CSS:\n${cssContent}`)

    // ------------------------------------------------------------------
    // Step 3: Get the SHA of the base branch
    // ------------------------------------------------------------------
    logger.info(`Step 3: Getting SHA for base branch '${baseBranch}' in ${owner}/${repo}`)
    const sha = await getBranchSHA(owner, repo, baseBranch, GITHUB_TOKEN)
    logger.debug(`Base branch SHA: ${sha}`)

    // ------------------------------------------------------------------
    // Step 4: Create a new branch
    // ------------------------------------------------------------------
    const timestamp = Date.now()
    const newBranch = `brand/css-tokens-${safeName}-${timestamp}`
    logger.info(`Step 4: Creating branch '${newBranch}' from '${baseBranch}'`)
    const branchResult = await createBranch(owner, repo, newBranch, sha, GITHUB_TOKEN)
    logger.info(`Branch created: ${branchResult.ref}`)

    // ------------------------------------------------------------------
    // Step 5: Commit brand/<safeName>.css to the new branch
    // ------------------------------------------------------------------
    const filePath = `brand/${safeName}.css`
    logger.info(`Step 5: Committing '${filePath}' to branch '${newBranch}'`)
    const fileResult = await createOrUpdateFile({
      owner,
      repo,
      branch: newBranch,
      path: filePath,
      content: cssContent,
      message: `chore(brand): update CSS token variables for ${safeName}`,
      token: GITHUB_TOKEN
    })
    const fileUrl =
      fileResult.content && fileResult.content.html_url
        ? fileResult.content.html_url
        : `https://github.com/${owner}/${repo}/blob/${newBranch}/${filePath}`
    logger.info(`File committed: ${fileUrl}`)

    // ------------------------------------------------------------------
    // Step 6: Open a Pull Request
    // ------------------------------------------------------------------
    const prTitle = params.pr_title || `Brand tokens: update CSS variables for ${safeName}`
    const prBody =
      params.pr_body ||
      `Updates \`${filePath}\` with ${variableCount} CSS custom properties for the **${safeName}** brand.\n\nGenerated by the Aramark EDS Token Manager App Builder application.`

    logger.info(`Step 6: Creating PR from '${newBranch}' into '${targetBranch}'`)
    const pr = await createPullRequest(
      owner,
      repo,
      newBranch,
      targetBranch,
      prTitle,
      prBody,
      GITHUB_TOKEN
    )
    logger.info(`PR #${pr.number} created: ${pr.html_url}`)

    // ------------------------------------------------------------------
    // Return success response
    // ------------------------------------------------------------------
    return {
      statusCode: 200,
      body: {
        message: 'CSS tokens published successfully',
        brand: safeName,
        css_file: {
          path: filePath,
          variables: variableCount,
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
  } catch (error) {
    logger.error(error)
    return errorResponse(500, error.message || 'server error', logger)
  }
}

exports.main = main
