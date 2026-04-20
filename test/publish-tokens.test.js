/*
 * Unit tests for actions/publish-tokens/index.js
 *
 * Mocks:
 *   - @adobe/aio-sdk       → Core.Logger stub
 *   - @adobe/aio-lib-state → in-memory state store stub
 *   - node-fetch           → all GitHub API calls stubbed
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

// ---------- node-fetch stub ----------
const mockFetch = jest.fn()
jest.mock('node-fetch', () => mockFetch)

// Helper: build a mock response object
function mockResponse (body, ok = true, status = 200) {
  return {
    ok,
    status,
    json: jest.fn().mockResolvedValue(body),
    text: jest.fn().mockResolvedValue(JSON.stringify(body))
  }
}

const { main } = require('../actions/publish-tokens/index')

// ── Sample data ──────────────────────────────
const SAMPLE_TOKENS = {
  colors: {
    primary: '#e87722',
    secondary: '#003865',
    background: '#ffffff'
  },
  typography: {
    fontSizeBase: '16px',
    fontWeightBold: '700'
  }
}

const BASE_PARAMS = {
  brandName: 'aramark',
  GITHUB_TOKEN: 'ghp_test_token',
  owner: 'aramark-org',
  repo: 'aramark-eds',
  base_branch: 'main',
  target_branch: 'main'
}

// GitHub API mock responses
const MOCK_SHA_RESPONSE = {
  object: { sha: 'abc123def456abc123def456abc123def456abc1' }
}

const MOCK_BRANCH_RESPONSE = {
  ref: 'refs/heads/brand/css-tokens-aramark-1234567890',
  object: { sha: 'abc123def456abc123def456abc123def456abc1' }
}

const MOCK_FILE_CHECK_RESPONSE = { sha: null }    // file doesn't exist yet
const MOCK_FILE_PUT_RESPONSE = {
  content: { html_url: 'https://github.com/aramark-org/aramark-eds/blob/brand/css-tokens-aramark/brand/aramark.css' }
}

const MOCK_PR_RESPONSE = {
  number: 42,
  title: 'Brand tokens: update CSS variables for aramark',
  html_url: 'https://github.com/aramark-org/aramark-eds/pull/42',
  state: 'open',
  head: { ref: 'brand/css-tokens-aramark-1234567890' },
  base: { ref: 'main' }
}

// ─────────────────────────────────────────────
// Helper: set up happy-path fetch mocks
// ─────────────────────────────────────────────
function setupHappyPathFetch () {
  mockFetch
    // 1. getBranchSHA → GET /git/ref/heads/main
    .mockResolvedValueOnce(mockResponse(MOCK_SHA_RESPONSE, true, 200))
    // 2. createBranch → POST /git/refs
    .mockResolvedValueOnce(mockResponse(MOCK_BRANCH_RESPONSE, true, 201))
    // 3. createOrUpdateFile — check existing file → GET /contents/brand/aramark.css
    .mockResolvedValueOnce(mockResponse(MOCK_FILE_CHECK_RESPONSE, false, 404))
    // 4. createOrUpdateFile — PUT /contents/brand/aramark.css
    .mockResolvedValueOnce(mockResponse(MOCK_FILE_PUT_RESPONSE, true, 201))
    // 5. createPullRequest → POST /pulls
    .mockResolvedValueOnce(mockResponse(MOCK_PR_RESPONSE, true, 201))
}

beforeEach(() => {
  Object.keys(_store).forEach(k => delete _store[k])
  mockFetch.mockReset()
})

// ─────────────────────────────────────────────
// Happy path
// ─────────────────────────────────────────────
describe('publish-tokens: happy path', () => {
  beforeEach(() => {
    _store['brand:aramark'] = SAMPLE_TOKENS
  })

  test('returns 200 with PR details and CSS file info', async () => {
    setupHappyPathFetch()
    const res = await main(BASE_PARAMS)

    expect(res.statusCode).toBe(200)
    expect(res.body.brand).toBe('aramark')

    // CSS file metadata
    expect(res.body.css_file).toBeDefined()
    expect(res.body.css_file.path).toBe('brand/aramark.css')
    expect(res.body.css_file.variables).toBeGreaterThan(0)

    // PR details
    expect(res.body.pull_request).toBeDefined()
    expect(res.body.pull_request.number).toBe(42)
    expect(res.body.pull_request.url).toContain('github.com')
  })

  test('generates correct number of CSS variables from token set', async () => {
    setupHappyPathFetch()
    const res = await main(BASE_PARAMS)
    // SAMPLE_TOKENS has 3 colors + 2 typography = 5 flat variables
    expect(res.body.css_file.variables).toBe(5)
  })

  test('calls GitHub API 5 times (SHA + branch + check file + put file + PR)', async () => {
    setupHappyPathFetch()
    await main(BASE_PARAMS)
    expect(mockFetch).toHaveBeenCalledTimes(5)
  })

  test('uses custom css_prefix when supplied', async () => {
    setupHappyPathFetch()

    // Capture the PUT body to check CSS content
    let capturedCssContent = null
    mockFetch.mockReset()
    mockFetch
      .mockResolvedValueOnce(mockResponse(MOCK_SHA_RESPONSE))
      .mockResolvedValueOnce(mockResponse(MOCK_BRANCH_RESPONSE))
      .mockResolvedValueOnce(mockResponse(null, false, 404))
      .mockImplementationOnce(async (_url, opts) => {
        const body = JSON.parse(opts.body)
        capturedCssContent = Buffer.from(body.content, 'base64').toString('utf8')
        return mockResponse(MOCK_FILE_PUT_RESPONSE)
      })
      .mockResolvedValueOnce(mockResponse(MOCK_PR_RESPONSE))

    await main({ ...BASE_PARAMS, css_prefix: '--my-' })
    expect(capturedCssContent).toContain('--my-')
    expect(capturedCssContent).not.toContain('--brand-')
  })

  test('includes the correct file path in the commit', async () => {
    mockFetch.mockReset()
    let capturedPutUrl = null
    mockFetch
      .mockResolvedValueOnce(mockResponse(MOCK_SHA_RESPONSE))
      .mockResolvedValueOnce(mockResponse(MOCK_BRANCH_RESPONSE))
      .mockResolvedValueOnce(mockResponse(null, false, 404))
      .mockImplementationOnce(async (url) => {
        capturedPutUrl = url
        return mockResponse(MOCK_FILE_PUT_RESPONSE)
      })
      .mockResolvedValueOnce(mockResponse(MOCK_PR_RESPONSE))

    await main(BASE_PARAMS)
    expect(capturedPutUrl).toContain('brand/aramark.css')
  })
})

// ─────────────────────────────────────────────
// Validation errors
// ─────────────────────────────────────────────
describe('publish-tokens: parameter validation', () => {
  test('returns 400 when brandName is missing', async () => {
    const params = Object.assign({}, BASE_PARAMS)
    delete params.brandName
    const res = await main(params)
    expect(res.error.statusCode).toBe(400)
  })

  test('returns 400 when GITHUB_TOKEN is missing', async () => {
    const params = Object.assign({}, BASE_PARAMS)
    delete params.GITHUB_TOKEN
    const res = await main(params)
    expect(res.error.statusCode).toBe(400)
  })

  test('returns 400 when owner is missing', async () => {
    const params = Object.assign({}, BASE_PARAMS)
    delete params.owner
    const res = await main(params)
    expect(res.error.statusCode).toBe(400)
  })

  test('returns 400 when repo is missing', async () => {
    const params = Object.assign({}, BASE_PARAMS)
    delete params.repo
    const res = await main(params)
    expect(res.error.statusCode).toBe(400)
  })
})

// ─────────────────────────────────────────────
// Brand not found
// ─────────────────────────────────────────────
describe('publish-tokens: brand not found', () => {
  test('returns 404 when brand does not exist in I/O State', async () => {
    // _store is empty — no brand stored
    const res = await main(BASE_PARAMS)
    expect(res.error.statusCode).toBe(404)
    expect(mockFetch).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────
// GitHub API failure handling
// ─────────────────────────────────────────────
describe('publish-tokens: GitHub API error handling', () => {
  beforeEach(() => {
    _store['brand:aramark'] = SAMPLE_TOKENS
  })

  test('returns 500 when getBranchSHA fails', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({ message: 'Branch not found' }, false, 404)
    )
    const res = await main(BASE_PARAMS)
    expect(res.error.statusCode).toBe(500)
  })

  test('returns 500 when createBranch fails', async () => {
    mockFetch
      .mockResolvedValueOnce(mockResponse(MOCK_SHA_RESPONSE))           // SHA ok
      .mockResolvedValueOnce(mockResponse({ message: 'Reference already exists' }, false, 422)) // branch fail
    const res = await main(BASE_PARAMS)
    expect(res.error.statusCode).toBe(500)
  })

  test('returns 500 when createPullRequest fails', async () => {
    mockFetch
      .mockResolvedValueOnce(mockResponse(MOCK_SHA_RESPONSE))
      .mockResolvedValueOnce(mockResponse(MOCK_BRANCH_RESPONSE))
      .mockResolvedValueOnce(mockResponse(null, false, 404))
      .mockResolvedValueOnce(mockResponse(MOCK_FILE_PUT_RESPONSE))
      .mockResolvedValueOnce(mockResponse({ message: 'Validation Failed' }, false, 422)) // PR fail
    const res = await main(BASE_PARAMS)
    expect(res.error.statusCode).toBe(500)
  })
})

// ─────────────────────────────────────────────
// CSS generation correctness
// ─────────────────────────────────────────────
describe('publish-tokens: CSS generation', () => {
  beforeEach(() => {
    _store['brand:aramark'] = SAMPLE_TOKENS
  })

  test('generated CSS contains :root block', async () => {
    let capturedCss = null
    mockFetch
      .mockResolvedValueOnce(mockResponse(MOCK_SHA_RESPONSE))
      .mockResolvedValueOnce(mockResponse(MOCK_BRANCH_RESPONSE))
      .mockResolvedValueOnce(mockResponse(null, false, 404))
      .mockImplementationOnce(async (_url, opts) => {
        const body = JSON.parse(opts.body)
        capturedCss = Buffer.from(body.content, 'base64').toString('utf8')
        return mockResponse(MOCK_FILE_PUT_RESPONSE)
      })
      .mockResolvedValueOnce(mockResponse(MOCK_PR_RESPONSE))

    await main(BASE_PARAMS)
    expect(capturedCss).toMatch(/^:root \{/)
    expect(capturedCss).toContain('--brand-colors-primary: #e87722')
    expect(capturedCss).toContain('--brand-colors-secondary: #003865')
    expect(capturedCss).toContain('--brand-typography-font-size-base: 16px')
  })
})
