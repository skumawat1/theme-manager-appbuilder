/*
 * Unit tests for actions/manage-tokens/index.js
 *
 * Mocks:
 *   - @adobe/aio-sdk       → Core.Logger stub
 *   - @adobe/aio-lib-state → in-memory state store stub
 *   - ../utils             → real implementation (no network calls needed)
 */

jest.mock('@adobe/aio-sdk', () => ({
  Core: {
    Logger: jest.fn().mockReturnValue({
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    })
  }
}))

// ---------- in-memory I/O State stub ----------
const _store = {}

jest.mock('@adobe/aio-lib-state', () => ({
  init: jest.fn().mockResolvedValue({
    get: jest.fn().mockImplementation(async (key) => {
      if (_store[key] === undefined) return undefined
      return { value: _store[key] }
    }),
    put: jest.fn().mockImplementation(async (key, value) => {
      _store[key] = value
    }),
    delete: jest.fn().mockImplementation(async (key) => {
      delete _store[key]
    })
  })
}))

const { main } = require('../actions/manage-tokens/index')

// Helper to reset in-memory store between tests
beforeEach(() => {
  Object.keys(_store).forEach(k => delete _store[k])
})

// ─────────────────────────────────────────────
// list
// ─────────────────────────────────────────────
describe('manage-tokens: list', () => {
  test('returns empty array when no brands exist', async () => {
    const res = await main({ operation: 'list' })
    expect(res.statusCode).toBe(200)
    expect(res.body.brands).toEqual([])
  })

  test('returns stored brand index', async () => {
    _store['brand:__index__'] = ['aramark', 'avendra']
    const res = await main({ operation: 'list' })
    expect(res.statusCode).toBe(200)
    expect(res.body.brands).toEqual(['aramark', 'avendra'])
  })
})

// ─────────────────────────────────────────────
// save
// ─────────────────────────────────────────────
describe('manage-tokens: save', () => {
  const sampleTokens = {
    colors: { primary: '#e87722', secondary: '#003865' }
  }

  test('saves tokens and creates index entry', async () => {
    const res = await main({ operation: 'save', brandName: 'aramark', tokens: sampleTokens })
    expect(res.statusCode).toBe(200)
    expect(res.body.brandName).toBe('aramark')
    expect(_store['brand:aramark']).toEqual(sampleTokens)
    expect(_store['brand:__index__']).toContain('aramark')
  })

  test('does not duplicate brand in index on second save', async () => {
    await main({ operation: 'save', brandName: 'aramark', tokens: sampleTokens })
    await main({ operation: 'save', brandName: 'aramark', tokens: { ...sampleTokens, colors: { primary: '#ff0000' } } })
    expect(_store['brand:__index__'].filter(b => b === 'aramark').length).toBe(1)
  })

  test('sanitises brand name to kebab-case lowercase', async () => {
    const res = await main({ operation: 'save', brandName: 'My Brand!', tokens: sampleTokens })
    expect(res.statusCode).toBe(200)
    expect(res.body.brandName).toBe('my-brand')
    expect(_store['brand:my-brand']).toEqual(sampleTokens)
  })

  test('parses JSON string tokens', async () => {
    const res = await main({ operation: 'save', brandName: 'test', tokens: JSON.stringify(sampleTokens) })
    expect(res.statusCode).toBe(200)
    expect(_store['brand:test']).toEqual(sampleTokens)
  })

  test('returns 400 for invalid JSON string tokens', async () => {
    const res = await main({ operation: 'save', brandName: 'test', tokens: 'not-json' })
    expect(res.error.statusCode).toBe(400)
  })

  test('returns 400 when brandName is missing', async () => {
    const res = await main({ operation: 'save', tokens: sampleTokens })
    expect(res.error.statusCode).toBe(400)
  })

  test('returns 400 when tokens is missing', async () => {
    const res = await main({ operation: 'save', brandName: 'aramark' })
    expect(res.error.statusCode).toBe(400)
  })
})

// ─────────────────────────────────────────────
// get
// ─────────────────────────────────────────────
describe('manage-tokens: get', () => {
  const sampleTokens = { colors: { primary: '#e87722' } }

  beforeEach(async () => {
    _store['brand:aramark'] = sampleTokens
  })

  test('returns tokens for a known brand', async () => {
    const res = await main({ operation: 'get', brandName: 'aramark' })
    expect(res.statusCode).toBe(200)
    expect(res.body.tokens).toEqual(sampleTokens)
  })

  test('returns 404 for unknown brand', async () => {
    const res = await main({ operation: 'get', brandName: 'unknown-brand' })
    expect(res.error.statusCode).toBe(404)
  })

  test('returns 400 when brandName is missing', async () => {
    const res = await main({ operation: 'get' })
    expect(res.error.statusCode).toBe(400)
  })
})

// ─────────────────────────────────────────────
// delete
// ─────────────────────────────────────────────
describe('manage-tokens: delete', () => {
  const sampleTokens = { colors: { primary: '#e87722' } }

  beforeEach(() => {
    _store['brand:aramark'] = sampleTokens
    _store['brand:__index__'] = ['aramark', 'avendra']
  })

  test('removes brand tokens and updates index', async () => {
    const res = await main({ operation: 'delete', brandName: 'aramark' })
    expect(res.statusCode).toBe(200)
    expect(_store['brand:aramark']).toBeUndefined()
    expect(_store['brand:__index__']).not.toContain('aramark')
    expect(_store['brand:__index__']).toContain('avendra')
  })

  test('returns 400 when brandName is missing', async () => {
    const res = await main({ operation: 'delete' })
    expect(res.error.statusCode).toBe(400)
  })
})

// ─────────────────────────────────────────────
// error handling
// ─────────────────────────────────────────────
describe('manage-tokens: error handling', () => {
  test('returns 400 for missing operation', async () => {
    const res = await main({})
    expect(res.error.statusCode).toBe(400)
  })

  test('returns 400 for unknown operation', async () => {
    const res = await main({ operation: 'upsert' })
    expect(res.error.statusCode).toBe(400)
  })
})
