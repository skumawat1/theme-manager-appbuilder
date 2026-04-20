/*
 * <license header>
 */

/**
 * manage-tokens action — Standalone CSS Token CRUD for multi-brand management.
 *
 * Stores brand token sets in Adobe I/O State (key-value store).
 * No AEM / Content Fragment dependency.
 *
 * Operations (passed as params.operation):
 *
 *   list    → returns array of all stored brand names
 *   get     → returns token JSON for params.brandName
 *   save    → upserts token JSON (params.brandName + params.tokens)
 *   delete  → removes brand key for params.brandName
 *
 * State keys used:
 *   "brand.index"       → JSON-serialised array of all brand names
 *   "brand.<name>"      → JSON-serialised token object for that brand
 */

const { Core } = require('@adobe/aio-sdk')
const stateLib = require('@adobe/aio-lib-state')
const { errorResponse, stringParameters, checkMissingRequestInputs } = require('../utils')

const STATE_INDEX_KEY = 'brand.index'

/**
 * Sanitise a brand name so it is safe to use as a state key segment.
 * Lowercases, replaces non-alphanumeric chars with hyphens, trims hyphens.
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
  const logger = Core.Logger('manage-tokens', { level: params.LOG_LEVEL || 'info' })

  try {
    logger.info('manage-tokens action called')
    logger.debug(stringParameters(params))

    const operation = params.operation

    if (!operation) {
      return errorResponse(400, "missing parameter 'operation'. Valid values: list, get, save, delete", logger)
    }

    // Initialise Adobe I/O State
    const state = await stateLib.init()

    // -----------------------------------------------------------------------
    // LIST — return all known brand names
    // -----------------------------------------------------------------------
    if (operation === 'list') {
      const entry = await state.get(STATE_INDEX_KEY)
      const brands = (entry && entry.value) ? JSON.parse(entry.value) : []
      logger.info(`list: ${brands.length} brand(s) found`)
      return { statusCode: 200, body: { brands } }
    }

    // -----------------------------------------------------------------------
    // GET — return stored tokens for a brand
    // -----------------------------------------------------------------------
    if (operation === 'get') {
      const missingParams = checkMissingRequestInputs(params, ['brandName'], [])
      if (missingParams) {
        return errorResponse(400, missingParams, logger)
      }
      const brandKey = `brand.${sanitiseBrandName(params.brandName)}`
      const entry = await state.get(brandKey)
      if (!entry || entry.value === undefined) {
        return errorResponse(404, `Brand '${params.brandName}' not found`, logger)
      }
      logger.info(`get: returning tokens for '${params.brandName}'`)
      return { statusCode: 200, body: { brandName: params.brandName, tokens: JSON.parse(entry.value) } }
    }

    // -----------------------------------------------------------------------
    // SAVE — upsert token set for a brand
    // -----------------------------------------------------------------------
    if (operation === 'save') {
      const missingParams = checkMissingRequestInputs(params, ['brandName', 'tokens'], [])
      if (missingParams) {
        return errorResponse(400, missingParams, logger)
      }

      let tokens = params.tokens
      // If tokens came in as a JSON string (e.g. from a form POST), parse it
      if (typeof tokens === 'string') {
        try {
          tokens = JSON.parse(tokens)
        } catch (e) {
          return errorResponse(400, 'tokens parameter is not valid JSON', logger)
        }
      }

      const safeName = sanitiseBrandName(params.brandName)
      const brandKey = `brand.${safeName}`

      // Persist tokens — max TTL of 365 days (31536000s); infinite TTLs are not supported
      await state.put(brandKey, JSON.stringify(tokens), { ttl: 31536000 })

      // Update the brand index
      const indexEntry = await state.get(STATE_INDEX_KEY)
      const index = (indexEntry && indexEntry.value) ? JSON.parse(indexEntry.value) : []
      if (!index.includes(safeName)) {
        index.push(safeName)
        await state.put(STATE_INDEX_KEY, JSON.stringify(index), { ttl: 31536000 })
      }

      logger.info(`save: stored tokens for brand '${safeName}'`)
      return {
        statusCode: 200,
        body: {
          message: `Tokens saved for brand '${safeName}'`,
          brandName: safeName
        }
      }
    }

    // -----------------------------------------------------------------------
    // DELETE — remove a brand and its tokens
    // -----------------------------------------------------------------------
    if (operation === 'delete') {
      const missingParams = checkMissingRequestInputs(params, ['brandName'], [])
      if (missingParams) {
        return errorResponse(400, missingParams, logger)
      }

      const safeName = sanitiseBrandName(params.brandName)
      const brandKey = `brand.${safeName}`

      await state.delete(brandKey)

      // Remove from index
      const indexEntry = await state.get(STATE_INDEX_KEY)
      const index = (indexEntry && indexEntry.value) ? JSON.parse(indexEntry.value) : []
      const updatedIndex = index.filter(b => b !== safeName)
      await state.put(STATE_INDEX_KEY, JSON.stringify(updatedIndex), { ttl: 31536000 })

      logger.info(`delete: removed brand '${safeName}'`)
      return {
        statusCode: 200,
        body: {
          message: `Brand '${safeName}' deleted`,
          brandName: safeName
        }
      }
    }

    // -----------------------------------------------------------------------
    // Unknown operation
    // -----------------------------------------------------------------------
    return errorResponse(400, `Unknown operation '${operation}'. Valid values: list, get, save, delete`, logger)
  } catch (error) {
    logger.error(error)
    return errorResponse(500, error.message || 'server error', logger)
  }
}

exports.main = main
