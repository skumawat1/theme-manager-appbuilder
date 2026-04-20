/*
 * <license header>
 */

jest.mock('@adobe/aio-sdk', () => ({
  Core: {
    Logger: jest.fn()
  }
}))

const { Core } = require('@adobe/aio-sdk')
const mockLoggerInstance = { info: jest.fn(), debug: jest.fn(), error: jest.fn() }
Core.Logger.mockReturnValue(mockLoggerInstance)

jest.mock('node-fetch')
const fetch = require('node-fetch')
const action = require('./../actions/github-branch-pr/index.js')

beforeEach(() => {
  Core.Logger.mockClear()
  mockLoggerInstance.info.mockReset()
  mockLoggerInstance.debug.mockReset()
  mockLoggerInstance.error.mockReset()
  fetch.mockReset()
})

// ---------------------------------------------------------------------------
// Shared fake params – using the real target repo
// ---------------------------------------------------------------------------
const OWNER = 'skumawat1'
const REPO = 'sourabh-world-bank'
const GITHUB_BASE = `https://api.github.com/repos/${OWNER}/${REPO}`
const GITHUB_HTML_BASE = `https://github.com/${OWNER}/${REPO}`

const fakeParams = {
  GITHUB_TOKEN: 'ghp_faketoken',
  owner: OWNER,
  repo: REPO,
  new_branch: 'feature/new-branch',
  base_branch: 'main',
  target_branch: 'main',
  pr_title: 'My Test PR',
  pr_body: 'This is a test PR',
  css_file_name: 'aramark-brand'
}

// ---------------------------------------------------------------------------
// Fake fetch responses
// ---------------------------------------------------------------------------
const fakeSHAResponse = {
  ok: true,
  json: () =>
    Promise.resolve({
      ref: 'refs/heads/main',
      object: { sha: 'abc123def456' }
    })
}

const fakeCreateBranchResponse = {
  ok: true,
  json: () =>
    Promise.resolve({
      ref: 'refs/heads/feature/new-branch',
      object: { sha: 'abc123def456' }
    })
}

// GET /contents/:path – file does not exist yet (404)
const fakeFileNotFoundResponse = {
  ok: false,
  status: 404,
  json: () => Promise.resolve({ message: 'Not Found' })
}

// PUT /contents/:path – file created successfully
const fakeCreateFileResponse = {
  ok: true,
  json: () =>
    Promise.resolve({
      content: {
        name: 'aramark-brand.css',
        path: 'brand/aramark-brand.css',
        sha: 'filesha123',
        html_url: `${GITHUB_HTML_BASE}/blob/feature/new-branch/brand/aramark-brand.css`
      },
      commit: { sha: 'commitsha456' }
    })
}

const fakeCreatePRResponse = {
  ok: true,
  json: () =>
    Promise.resolve({
      number: 42,
      title: 'My Test PR',
      html_url: `${GITHUB_HTML_BASE}/pull/42`,
      state: 'open',
      head: { ref: 'feature/new-branch' },
      base: { ref: 'main' }
    })
}

/**
 * Helper: set up the full happy-path mock sequence.
 * Order of fetch calls in main():
 *  1. GET  /git/ref/heads/<baseBranch>          → SHA
 *  2. POST /git/refs                             → create branch
 *  3. GET  /contents/brand/<name>.css?ref=<br>  → check existing file
 *  4. PUT  /contents/brand/<name>.css            → commit file
 *  5. POST /pulls                                → create PR
 */
function setupHappyPathMocks () {
  fetch
    .mockResolvedValueOnce(fakeSHAResponse)          // 1 – get SHA
    .mockResolvedValueOnce(fakeCreateBranchResponse) // 2 – create branch
    .mockResolvedValueOnce(fakeFileNotFoundResponse) // 3 – check file (404 → new file)
    .mockResolvedValueOnce(fakeCreateFileResponse)   // 4 – PUT file
    .mockResolvedValueOnce(fakeCreatePRResponse)     // 5 – create PR
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('github-branch-pr', () => {
  test('main should be defined', () => {
    expect(action.main).toBeInstanceOf(Function)
  })

  test('should set logger to use LOG_LEVEL param', async () => {
    setupHappyPathMocks()
    await action.main({ ...fakeParams, LOG_LEVEL: 'fakeLevel' })
    expect(Core.Logger).toHaveBeenCalledWith(expect.any(String), { level: 'fakeLevel' })
  })

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------
  test('should successfully create branch, commit CSS file, and create PR (200)', async () => {
    setupHappyPathMocks()

    const response = await action.main(fakeParams)

    expect(response).toEqual({
      statusCode: 200,
      body: {
        message: 'Branch, CSS file, and Pull Request created successfully',
        branch: {
          name: 'feature/new-branch',
          ref: 'refs/heads/feature/new-branch',
          sha: 'abc123def456'
        },
        css_file: {
          path: 'brand/aramark-brand.css',
          variables: expect.any(Number),
          url: `${GITHUB_HTML_BASE}/blob/feature/new-branch/brand/aramark-brand.css`
        },
        pull_request: {
          number: 42,
          title: 'My Test PR',
          url: `${GITHUB_HTML_BASE}/pull/42`,
          state: 'open',
          head: 'feature/new-branch',
          base: 'main'
        }
      }
    })
  })

  test('css_file.variables count should be greater than 0', async () => {
    setupHappyPathMocks()
    const response = await action.main(fakeParams)
    expect(response.statusCode).toBe(200)
    expect(response.body.css_file.variables).toBeGreaterThan(0)
  })

  // -------------------------------------------------------------------------
  // CSS file commit – step 4 calls
  // -------------------------------------------------------------------------
  test('should call GitHub contents API to check then commit the CSS file', async () => {
    setupHappyPathMocks()
    await action.main(fakeParams)

    // Call 3 is the GET check for the existing file
    expect(fetch.mock.calls[2][0]).toMatch(
      new RegExp(`/repos/${OWNER}/${REPO}/contents/brand/aramark-brand\\.css`)
    )

    // Call 4 is the PUT to create the file
    const putCall = fetch.mock.calls[3]
    expect(putCall[0]).toBe(`${GITHUB_BASE}/contents/brand/aramark-brand.css`)
    expect(putCall[1].method).toBe('PUT')

    const putBody = JSON.parse(putCall[1].body)
    expect(putBody.branch).toBe('feature/new-branch')
    expect(putBody.message).toMatch(/aramark-brand/)
    // Content should be base64-encoded
    expect(typeof putBody.content).toBe('string')
    expect(() => Buffer.from(putBody.content, 'base64').toString('utf8')).not.toThrow()
  })

  test('should include :root block with --brand- variables in committed CSS', async () => {
    setupHappyPathMocks()
    await action.main(fakeParams)

    const putBody = JSON.parse(fetch.mock.calls[3][1].body)
    const decodedCss = Buffer.from(putBody.content, 'base64').toString('utf8')

    expect(decodedCss).toContain(':root {')
    expect(decodedCss).toContain('--brand-')
    // Spot-check a few known variables from the mock data
    expect(decodedCss).toContain('--brand-colors-primary')
    expect(decodedCss).toContain('--brand-typography-font-size-base')
    expect(decodedCss).toContain('--brand-spacing-md')
  })

  test('should use default css_file_name of "brand-theme" when not provided', async () => {
    setupHappyPathMocks()

    const paramsWithoutFileName = { ...fakeParams }
    delete paramsWithoutFileName.css_file_name

    await action.main(paramsWithoutFileName)

    // The PUT call (index 3) should target the default file name
    expect(fetch.mock.calls[3][0]).toBe(`${GITHUB_BASE}/contents/brand/brand-theme.css`)
  })

  test('should include existing file SHA in PUT body when file already exists', async () => {
    fetch
      .mockResolvedValueOnce(fakeSHAResponse)          // 1 – get SHA
      .mockResolvedValueOnce(fakeCreateBranchResponse) // 2 – create branch
      .mockResolvedValueOnce({                         // 3 – file exists
        ok: true,
        json: () =>
          Promise.resolve({
            name: 'aramark-brand.css',
            path: 'brand/aramark-brand.css',
            sha: 'existingfilesha999'
          })
      })
      .mockResolvedValueOnce(fakeCreateFileResponse)   // 4 – PUT file (update)
      .mockResolvedValueOnce(fakeCreatePRResponse)     // 5 – create PR

    await action.main(fakeParams)

    const putBody = JSON.parse(fetch.mock.calls[3][1].body)
    expect(putBody.sha).toBe('existingfilesha999')
  })

  // -------------------------------------------------------------------------
  // Defaults
  // -------------------------------------------------------------------------
  test('should use default base_branch and target_branch as main when not provided', async () => {
    setupHappyPathMocks()

    const paramsWithoutDefaults = {
      GITHUB_TOKEN: 'ghp_faketoken',
      owner: OWNER,
      repo: REPO,
      new_branch: 'feature/new-branch',
      pr_title: 'My Test PR'
    }

    const response = await action.main(paramsWithoutDefaults)
    expect(response.statusCode).toBe(200)

    // SHA fetch should use 'main'
    expect(fetch.mock.calls[0][0]).toBe(`${GITHUB_BASE}/git/ref/heads/main`)
    // PR should target 'main'
    const prCallBody = JSON.parse(fetch.mock.calls[4][1].body)
    expect(prCallBody.base).toBe('main')
  })

  // -------------------------------------------------------------------------
  // Validation – missing required params
  // -------------------------------------------------------------------------
  test('should return 400 if GITHUB_TOKEN is missing', async () => {
    // eslint-disable-next-line no-unused-vars
    const { GITHUB_TOKEN, ...paramsWithoutToken } = fakeParams
    const response = await action.main(paramsWithoutToken)
    expect(response).toEqual({
      error: {
        statusCode: 400,
        body: { error: "missing parameter(s) 'GITHUB_TOKEN'" }
      }
    })
  })

  test('should return 400 if owner is missing', async () => {
    // eslint-disable-next-line no-unused-vars
    const { owner, ...paramsWithoutOwner } = fakeParams
    const response = await action.main(paramsWithoutOwner)
    expect(response).toEqual({
      error: {
        statusCode: 400,
        body: { error: "missing parameter(s) 'owner'" }
      }
    })
  })

  test('should return 400 if repo is missing', async () => {
    // eslint-disable-next-line no-unused-vars
    const { repo, ...paramsWithoutRepo } = fakeParams
    const response = await action.main(paramsWithoutRepo)
    expect(response).toEqual({
      error: {
        statusCode: 400,
        body: { error: "missing parameter(s) 'repo'" }
      }
    })
  })

  test('should return 400 if new_branch is missing', async () => {
    // eslint-disable-next-line no-unused-vars
    const { new_branch, ...paramsWithoutNewBranch } = fakeParams
    const response = await action.main(paramsWithoutNewBranch)
    expect(response).toEqual({
      error: {
        statusCode: 400,
        body: { error: "missing parameter(s) 'new_branch'" }
      }
    })
  })

  test('should return 400 if pr_title is missing', async () => {
    // eslint-disable-next-line no-unused-vars
    const { pr_title, ...paramsWithoutPrTitle } = fakeParams
    const response = await action.main(paramsWithoutPrTitle)
    expect(response).toEqual({
      error: {
        statusCode: 400,
        body: { error: "missing parameter(s) 'pr_title'" }
      }
    })
  })

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------
  test('should return 500 if fetching base branch SHA fails', async () => {
    fetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ message: 'Not Found' })
    })

    const response = await action.main(fakeParams)
    expect(response).toEqual({
      error: {
        statusCode: 500,
        body: { error: "Failed to get branch SHA for 'main': 404 Not Found" }
      }
    })
    expect(mockLoggerInstance.error).toHaveBeenCalled()
  })

  test('should return 500 if creating branch fails', async () => {
    fetch
      .mockResolvedValueOnce(fakeSHAResponse)
      .mockResolvedValueOnce({
        ok: false,
        status: 422,
        json: () => Promise.resolve({ message: 'Reference already exists' })
      })

    const response = await action.main(fakeParams)
    expect(response).toEqual({
      error: {
        statusCode: 500,
        body: { error: "Failed to create branch 'feature/new-branch': 422 Reference already exists" }
      }
    })
    expect(mockLoggerInstance.error).toHaveBeenCalled()
  })

  test('should return 500 if committing CSS file fails', async () => {
    fetch
      .mockResolvedValueOnce(fakeSHAResponse)          // 1 – get SHA
      .mockResolvedValueOnce(fakeCreateBranchResponse) // 2 – create branch
      .mockResolvedValueOnce(fakeFileNotFoundResponse) // 3 – check file
      .mockResolvedValueOnce({                         // 4 – PUT fails
        ok: false,
        status: 422,
        json: () => Promise.resolve({ message: 'Unprocessable Entity' })
      })

    const response = await action.main(fakeParams)
    expect(response).toEqual({
      error: {
        statusCode: 500,
        body: {
          error: "Failed to create/update file 'brand/aramark-brand.css': 422 Unprocessable Entity"
        }
      }
    })
    expect(mockLoggerInstance.error).toHaveBeenCalled()
  })

  test('should return 500 if creating PR fails', async () => {
    fetch
      .mockResolvedValueOnce(fakeSHAResponse)          // 1 – get SHA
      .mockResolvedValueOnce(fakeCreateBranchResponse) // 2 – create branch
      .mockResolvedValueOnce(fakeFileNotFoundResponse) // 3 – check file
      .mockResolvedValueOnce(fakeCreateFileResponse)   // 4 – PUT file
      .mockResolvedValueOnce({                         // 5 – PR fails
        ok: false,
        status: 422,
        json: () => Promise.resolve({ message: 'A pull request already exists' })
      })

    const response = await action.main(fakeParams)
    expect(response).toEqual({
      error: {
        statusCode: 500,
        body: { error: 'Failed to create PR: 422 A pull request already exists' }
      }
    })
    expect(mockLoggerInstance.error).toHaveBeenCalled()
  })

  test('should return 500 and log error on unexpected exception', async () => {
    const fakeError = new Error('Network failure')
    fetch.mockRejectedValue(fakeError)

    const response = await action.main(fakeParams)
    expect(response).toEqual({
      error: {
        statusCode: 500,
        body: { error: 'Network failure' }
      }
    })
    expect(mockLoggerInstance.error).toHaveBeenCalledWith(fakeError)
  })
})
