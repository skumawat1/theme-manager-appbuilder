/*
 * Brand CSS Token Manager — Vanilla JS Application
 *
 * Manages CSS design tokens for multiple brands.
 * Tokens are stored server-side in Adobe I/O State via the manage-tokens action.
 * IMS Bearer token + Org ID are entered by the user and stored in localStorage.
 * Publishing generates a CSS file and raises a GitHub PR via the publish-tokens action.
 */

import 'regenerator-runtime/runtime'
import Runtime, { init } from '@adobe/exc-app'
import actions from './config.json'
import actionWebInvoke from './utils.js'
import {
  flattenObject,
  toCssVariables,
  loadSchema,
  buildDefaultTokens
} from './utils.js'

// ---------------------------------------------------------------------------
// IMS Auth helpers — reads from localStorage
// Keys: tokenManager.imsToken  /  tokenManager.imsOrgId
// ---------------------------------------------------------------------------
const LS_IMS_TOKEN = 'tokenManager.imsToken'
const LS_IMS_ORG   = 'tokenManager.imsOrgId'

function getAuthHeaders () {
  const token = localStorage.getItem(LS_IMS_TOKEN) || ''
  const orgId = localStorage.getItem(LS_IMS_ORG) || ''
  const headers = {}
  if (token) headers['Authorization'] = `Bearer ${token}`
  if (orgId) headers['x-gw-ims-org-id'] = orgId
  return headers
}

function hasToken () {
  return !!(localStorage.getItem(LS_IMS_TOKEN))
}

// ---------------------------------------------------------------------------
// Application state
// ---------------------------------------------------------------------------
const state = {
  schema: null,           // parsed token-schema.json
  brands: [],             // list of brand names from I/O State
  currentBrand: null,     // currently selected brand name
  tokens: {},             // token values being edited
  isDirty: false,         // unsaved changes flag
  actionUrls: {}          // action URLs resolved from config.json
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------
window.onload = async () => {
  // ── Step 1: Attempt to load the Experience Cloud Runtime ──
  try {
    // eslint-disable-next-line no-undef
    require('./exc-runtime')
    init(initRuntime)
  } catch (e) {
    console.log('application not running in Adobe Experience Cloud Shell')
  }

  // ── Step 2: Attach all event listeners synchronously ──
  setupSettingsHandlers()
  setupModalHandlers()
  setupGitHubSettingsHandlers()
  setupActionBarHandlers()

  // ── Step 3: Load config.json action URLs from imported actions ──
  if (actions && Object.keys(actions).length > 0) {
    state.actionUrls = actions
  }

  // ── Step 4: Update auth badge from stored token ──
  updateAuthBadge()

  // ── Step 5: Load schema, brand list ──
  try {
    await bootstrap()
  } catch (err) {
    showToast(`Initialisation error: ${err.message}`, 'error')
    console.error(err)
    renderEmptyEditor()
  }
}

/**
 * Initialize runtime and get IMS profile from Adobe Experience Cloud Shell
 */
function initRuntime () {
  const runtime = Runtime()
  runtime.on('ready', ({ imsOrg, imsToken, imsProfile, locale }) => {
    runtime.done()
    // Store IMS credentials into localStorage so the existing auth flow picks them up
    if (imsToken) localStorage.setItem(LS_IMS_TOKEN, imsToken)
    if (imsOrg) localStorage.setItem(LS_IMS_ORG, imsOrg)
    updateAuthBadge()
    console.log('exc-app:ready', { imsOrg, imsProfile, locale })
  })
  runtime.solution = {
    icon: 'AdobeExperienceCloud',
    title: 'AramarkEDSTaskrunner'
  }
  runtime.title = 'AramarkEDSTaskrunner'
}

async function bootstrap () {
  state.schema = await loadSchema()
  await loadBrands()
}

// ---------------------------------------------------------------------------
// Action URL helper
// ---------------------------------------------------------------------------
function getActionUrl (actionName) {
  if (state.actionUrls[actionName]) return state.actionUrls[actionName]
  return `/api/v1/web/AramarkEDSTaskrunner/${actionName}`
}

// ---------------------------------------------------------------------------
// IMS Token Settings Panel
// ---------------------------------------------------------------------------
function setupSettingsHandlers () {
  document.getElementById('btn-settings').addEventListener('click', openSettingsPanel)
  document.getElementById('btn-settings-close').addEventListener('click', closeSettingsPanel)
  document.getElementById('btn-save-token').addEventListener('click', saveImsToken)
  document.getElementById('btn-clear-token').addEventListener('click', clearImsToken)

  // Restore current values into fields
  const tokenField = document.getElementById('ims-token-input')
  const orgField   = document.getElementById('ims-org-id-input')
  const stored = localStorage.getItem(LS_IMS_TOKEN) || ''
  const orgStored = localStorage.getItem(LS_IMS_ORG) || ''
  if (stored) tokenField.value = stored
  if (orgStored) orgField.value = orgStored
}

function openSettingsPanel () {
  // Sync fields with current localStorage values
  document.getElementById('ims-token-input').value = localStorage.getItem(LS_IMS_TOKEN) || ''
  document.getElementById('ims-org-id-input').value = localStorage.getItem(LS_IMS_ORG) || ''
  document.getElementById('settings-status').textContent = ''
  document.getElementById('settings-panel').classList.add('visible')
}

function closeSettingsPanel () {
  document.getElementById('settings-panel').classList.remove('visible')
}

function saveImsToken () {
  const token = document.getElementById('ims-token-input').value.trim()
  const orgId = document.getElementById('ims-org-id-input').value.trim()

  if (!token) {
    setSettingsStatus('⚠️ Bearer token cannot be empty.', 'error')
    return
  }

  localStorage.setItem(LS_IMS_TOKEN, token)
  if (orgId) localStorage.setItem(LS_IMS_ORG, orgId)

  updateAuthBadge()
  setSettingsStatus('✅ Token saved successfully. Reloading brands…', 'success')

  // Reload brand list now that we have auth
  loadBrands().catch(err => {
    setSettingsStatus(`⚠️ Token saved, but brand load failed: ${err.message}`, 'error')
  })
}

function clearImsToken () {
  localStorage.removeItem(LS_IMS_TOKEN)
  localStorage.removeItem(LS_IMS_ORG)
  document.getElementById('ims-token-input').value = ''
  document.getElementById('ims-org-id-input').value = ''
  updateAuthBadge()
  setSettingsStatus('🗑 Token cleared.', 'info')
  state.brands = []
  state.currentBrand = null
  state.tokens = {}
  renderBrandList()
  renderEmptyEditor()
}

function setSettingsStatus (message, type = 'info') {
  const el = document.getElementById('settings-status')
  el.textContent = message
  el.className = `settings-status settings-status--${type}`
}

function updateAuthBadge () {
  const badge = document.getElementById('auth-badge')
  if (hasToken()) {
    badge.textContent = '🟢 Authenticated'
    badge.className = 'auth-badge auth-badge--ok'
    badge.title = 'IMS token is set'
  } else {
    badge.textContent = '🔴 No Token'
    badge.className = 'auth-badge auth-badge--none'
    badge.title = 'Click ⚙ to enter your IMS token'
  }
}

// ---------------------------------------------------------------------------
// Handle auth errors (401 / 403 / 405) from action calls
// ---------------------------------------------------------------------------
function handleAuthError (err) {
  const msg = err.message || ''
  if (msg.includes('401') || msg.includes('403') || msg.includes('405') || msg.includes('Unauthorized')) {
    showToast('Authentication required — click ⚙ to set your IMS token', 'error')
    openSettingsPanel()
    return true
  }
  return false
}

// ---------------------------------------------------------------------------
// Brand list (uses manage-tokens I/O State action)
// ---------------------------------------------------------------------------
async function loadBrands () {
  setLoading(true, 'Loading brands…')
  try {
    const res = await actionWebInvoke(
      getActionUrl('manage-tokens'),
      getAuthHeaders(),
      { operation: 'list' }
    )
    state.brands = (res && res.brands) ? res.brands : []
    renderBrandList()
    if (state.brands.length > 0) {
      await selectBrand(state.brands[0])
    } else {
      renderEmptyEditor()
    }
  } catch (err) {
    if (!handleAuthError(err)) {
      showToast(`Failed to load brands: ${err.message}`, 'error')
    }
    renderEmptyEditor()
  } finally {
    setLoading(false)
  }
}

function renderBrandList () {
  const list = document.getElementById('brand-list')
  list.innerHTML = ''
  if (state.brands.length === 0) {
    list.innerHTML = '<li class="brand-empty">No brands yet.<br>Click + to create one.</li>'
    return
  }
  state.brands.forEach(name => {
    const li = document.createElement('li')
    li.className = 'brand-item' + (name === state.currentBrand ? ' active' : '')
    li.dataset.brand = name
    li.innerHTML = `
      <span class="brand-name">${escapeHtml(name)}</span>
      <button class="brand-delete-btn" data-brand="${escapeHtml(name)}" title="Delete brand">✕</button>
    `
    li.querySelector('.brand-name').addEventListener('click', () => selectBrand(name))
    li.querySelector('.brand-delete-btn').addEventListener('click', (e) => {
      e.stopPropagation()
      confirmDeleteBrand(name)
    })
    list.appendChild(li)
  })
}

async function selectBrand (name) {
  if (state.isDirty) {
    const discard = confirm(`You have unsaved changes for "${state.currentBrand}". Discard them?`)
    if (!discard) return
  }
  setLoading(true, `Loading tokens for "${name}"…`)
  try {
    const res = await actionWebInvoke(
      getActionUrl('manage-tokens'),
      getAuthHeaders(),
      { operation: 'get', brandName: name }
    )
    state.currentBrand = name
    state.tokens = (res && res.tokens) ? JSON.parse(JSON.stringify(res.tokens)) : {}
    state.isDirty = false
    renderBrandList()
    renderTokenEditor()
    renderCssPreview()
    updateBrandHeader()
  } catch (err) {
    if (!handleAuthError(err)) {
      showToast(`Failed to load tokens for "${name}": ${err.message}`, 'error')
    }
  } finally {
    setLoading(false)
  }
}

function renderEmptyEditor () {
  document.getElementById('editor-placeholder').style.display = 'flex'
  document.getElementById('token-editor-content').style.display = 'none'
  document.getElementById('action-bar').style.display = 'none'
  document.getElementById('brand-header').textContent = 'Select or create a brand'
  document.getElementById('css-preview-code').textContent = '/* No brand selected */'
}

function updateBrandHeader () {
  document.getElementById('brand-header').textContent = state.currentBrand || ''
  document.getElementById('editor-placeholder').style.display = 'none'
  document.getElementById('token-editor-content').style.display = 'block'
  document.getElementById('action-bar').style.display = 'flex'
}

// ---------------------------------------------------------------------------
// New Brand Modal
// ---------------------------------------------------------------------------
function setupModalHandlers () {
  document.getElementById('btn-new-brand').addEventListener('click', openNewBrandModal)
  document.getElementById('modal-cancel').addEventListener('click', closeNewBrandModal)
  document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeNewBrandModal()
  })
  document.getElementById('new-brand-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    await handleNewBrand()
  })
}

function openNewBrandModal () {
  const cloneSelect = document.getElementById('clone-from-select')
  cloneSelect.innerHTML = '<option value="">— start from schema defaults —</option>'
  state.brands.forEach(name => {
    const opt = document.createElement('option')
    opt.value = name
    opt.textContent = name
    cloneSelect.appendChild(opt)
  })
  document.getElementById('new-brand-name').value = ''
  document.getElementById('modal-overlay').classList.add('visible')
  document.getElementById('new-brand-name').focus()
}

function closeNewBrandModal () {
  document.getElementById('modal-overlay').classList.remove('visible')
}

async function handleNewBrand () {
  const nameInput = document.getElementById('new-brand-name')
  const cloneFrom = document.getElementById('clone-from-select').value
  const rawName = nameInput.value.trim()

  if (!rawName) {
    showToast('Brand name cannot be empty', 'error')
    return
  }

  const safeName = rawName.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  if (state.brands.includes(safeName)) {
    showToast(`Brand "${safeName}" already exists`, 'error')
    return
  }

  if (!state.schema) {
    try {
      state.schema = await loadSchema()
    } catch (e) {
      showToast(`Token schema unavailable: ${e.message}`, 'error')
      return
    }
  }

  let tokens
  if (cloneFrom && state.brands.includes(cloneFrom)) {
    try {
      const res = await actionWebInvoke(
        getActionUrl('manage-tokens'),
        getAuthHeaders(),
        { operation: 'get', brandName: cloneFrom }
      )
      tokens = (res && res.tokens) ? JSON.parse(JSON.stringify(res.tokens)) : buildDefaultTokens(state.schema)
    } catch (e) {
      tokens = buildDefaultTokens(state.schema)
    }
  } else {
    tokens = buildDefaultTokens(state.schema)
  }

  closeNewBrandModal()
  setLoading(true, `Creating brand "${safeName}"…`)
  try {
    await actionWebInvoke(
      getActionUrl('manage-tokens'),
      getAuthHeaders(),
      { operation: 'save', brandName: safeName, tokens }
    )
    state.brands.push(safeName)
    state.brands.sort()
    state.currentBrand = safeName
    state.tokens = tokens
    state.isDirty = false
    renderBrandList()
    renderTokenEditor()
    renderCssPreview()
    updateBrandHeader()
    showToast(`Brand "${safeName}" created`, 'success')
  } catch (err) {
    if (!handleAuthError(err)) {
      showToast(`Failed to create brand: ${err.message}`, 'error')
    }
  } finally {
    setLoading(false)
  }
}

// ---------------------------------------------------------------------------
// Delete Brand
// ---------------------------------------------------------------------------
function confirmDeleteBrand (name) {
  if (!confirm(`Delete brand "${name}" and all its tokens? This cannot be undone.`)) return
  deleteBrand(name)
}

async function deleteBrand (name) {
  setLoading(true, `Deleting brand "${name}"…`)
  try {
    await actionWebInvoke(
      getActionUrl('manage-tokens'),
      getAuthHeaders(),
      { operation: 'delete', brandName: name }
    )
    state.brands = state.brands.filter(b => b !== name)
    if (state.currentBrand === name) {
      state.currentBrand = null
      state.tokens = {}
      state.isDirty = false
    }
    renderBrandList()
    if (state.brands.length > 0) {
      await selectBrand(state.brands[0])
    } else {
      renderEmptyEditor()
    }
    showToast(`Brand "${name}" deleted`, 'success')
  } catch (err) {
    if (!handleAuthError(err)) {
      showToast(`Failed to delete brand "${name}": ${err.message}`, 'error')
    }
  } finally {
    setLoading(false)
  }
}

// ---------------------------------------------------------------------------
// Token Editor
// ---------------------------------------------------------------------------
function renderTokenEditor () {
  if (!state.schema || !state.currentBrand) return

  const tabBar = document.getElementById('tab-bar')
  const tabContent = document.getElementById('tab-content')
  tabBar.innerHTML = ''
  tabContent.innerHTML = ''

  const categories = Object.keys(state.schema)
  let firstTab = true

  categories.forEach(category => {
    const tab = document.createElement('button')
    tab.className = 'tab-btn' + (firstTab ? ' active' : '')
    tab.dataset.category = category
    tab.textContent = capitalize(category)
    tab.addEventListener('click', () => switchTab(category))
    tabBar.appendChild(tab)

    const panel = document.createElement('div')
    panel.className = 'tab-panel' + (firstTab ? ' active' : '')
    panel.id = `panel-${category}`
    panel.appendChild(buildCategoryForm(category))
    tabContent.appendChild(panel)

    firstTab = false
  })
}

function buildCategoryForm (category) {
  const fields = state.schema[category]
  const form = document.createElement('div')
  form.className = 'token-form'

  Object.entries(fields).forEach(([key, def]) => {
    const currentValue = (state.tokens[category] && state.tokens[category][key] !== undefined)
      ? state.tokens[category][key]
      : def.default

    const row = document.createElement('div')
    row.className = 'token-row'

    const label = document.createElement('label')
    label.className = 'token-label'
    label.textContent = def.label
    label.setAttribute('for', `token-${category}-${key}`)

    let input

    if (def.type === 'color') {
      const wrapper = document.createElement('div')
      wrapper.className = 'color-input-wrapper'

      const colorPicker = document.createElement('input')
      colorPicker.type = 'color'
      colorPicker.className = 'color-picker'
      colorPicker.value = normalizeHex(currentValue)
      colorPicker.id = `token-${category}-${key}`

      const hexText = document.createElement('input')
      hexText.type = 'text'
      hexText.className = 'color-hex'
      hexText.value = currentValue
      hexText.maxLength = 40
      hexText.setAttribute('spellcheck', 'false')

      colorPicker.addEventListener('input', () => {
        hexText.value = colorPicker.value
        onTokenChange(category, key, colorPicker.value)
      })
      hexText.addEventListener('input', () => {
        const v = hexText.value.trim()
        onTokenChange(category, key, v)
        if (/^#[0-9a-fA-F]{3,6}$/.test(v)) {
          colorPicker.value = v
        }
      })

      wrapper.appendChild(colorPicker)
      wrapper.appendChild(hexText)
      input = wrapper
    } else {
      input = document.createElement('input')
      input.type = 'text'
      input.className = 'token-text'
      input.id = `token-${category}-${key}`
      input.value = currentValue
      input.setAttribute('spellcheck', 'false')
      input.addEventListener('input', () => onTokenChange(category, key, input.value))
    }

    row.appendChild(label)
    row.appendChild(input)
    form.appendChild(row)
  })

  return form
}

function switchTab (category) {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.category === category)
  })
  document.querySelectorAll('.tab-panel').forEach(panel => {
    panel.classList.toggle('active', panel.id === `panel-${category}`)
  })
}

function onTokenChange (category, key, value) {
  if (!state.tokens[category]) state.tokens[category] = {}
  state.tokens[category][key] = value
  state.isDirty = true
  updateDirtyIndicator()
  renderCssPreview()
}

function updateDirtyIndicator () {
  const saveBtn = document.getElementById('btn-save')
  if (saveBtn) {
    saveBtn.classList.toggle('dirty', state.isDirty)
    saveBtn.title = state.isDirty ? 'Unsaved changes' : 'All changes saved'
  }
}

// ---------------------------------------------------------------------------
// CSS Preview
// ---------------------------------------------------------------------------
function renderCssPreview () {
  const pre = document.getElementById('css-preview-code')
  if (!state.currentBrand || Object.keys(state.tokens).length === 0) {
    pre.textContent = '/* No tokens loaded */'
    return
  }
  const flat = flattenObject(state.tokens)
  const css = toCssVariables(flat, '--brand-')
  pre.textContent = css

  let styleEl = document.getElementById('live-preview-style')
  if (!styleEl) {
    styleEl = document.createElement('style')
    styleEl.id = 'live-preview-style'
    document.head.appendChild(styleEl)
  }
  styleEl.textContent = css
}

// ---------------------------------------------------------------------------
// Action Bar & Publish Panel Button Handlers
// ---------------------------------------------------------------------------
function setupActionBarHandlers () {
  document.getElementById('btn-save').addEventListener('click', saveTokens)
  document.getElementById('btn-export-css').addEventListener('click', exportCss)
  document.getElementById('btn-publish').addEventListener('click', openPublishPanel)
  document.getElementById('btn-publish-confirm').addEventListener('click', publishTokens)
  document.getElementById('btn-publish-cancel').addEventListener('click', closePublishPanel)
}

// ---------------------------------------------------------------------------
// Save Tokens (manage-tokens action → I/O State)
// ---------------------------------------------------------------------------
async function saveTokens () {
  if (!state.currentBrand) return
  setLoading(true, 'Saving tokens…')
  try {
    await actionWebInvoke(
      getActionUrl('manage-tokens'),
      getAuthHeaders(),
      { operation: 'save', brandName: state.currentBrand, tokens: state.tokens }
    )
    state.isDirty = false
    updateDirtyIndicator()
    showToast('Tokens saved successfully', 'success')
  } catch (err) {
    if (!handleAuthError(err)) {
      showToast(`Failed to save tokens: ${err.message}`, 'error')
    }
  } finally {
    setLoading(false)
  }
}

// ---------------------------------------------------------------------------
// Export Tokens as CSS file (Download — no server needed)
// ---------------------------------------------------------------------------
function exportCss () {
  if (!state.currentBrand) return
  const flat = flattenObject(state.tokens)
  const css = toCssVariables(flat, '--brand-')
  const blob = new Blob([css], { type: 'text/css' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${state.currentBrand}-tokens.css`
  a.click()
  URL.revokeObjectURL(url)
  showToast(`CSS exported: ${state.currentBrand}-tokens.css`, 'success')
}

// ---------------------------------------------------------------------------
// GitHub Settings (persisted to localStorage)
// ---------------------------------------------------------------------------
function setupGitHubSettingsHandlers () {
  const fields = ['gh-owner', 'gh-repo', 'gh-base-branch', 'gh-target-branch']
  fields.forEach(id => {
    const el = document.getElementById(id)
    if (!el) return
    const saved = localStorage.getItem(`tokenManager.${id}`)
    if (saved) el.value = saved
    el.addEventListener('change', () => localStorage.setItem(`tokenManager.${id}`, el.value))
  })
}

function openPublishPanel () {
  if (!state.currentBrand) return
  document.getElementById('publish-brand-name').textContent = state.currentBrand
  document.getElementById('publish-panel').classList.add('visible')
}

function closePublishPanel () {
  document.getElementById('publish-panel').classList.remove('visible')
  document.getElementById('publish-result').innerHTML = ''
}

// ---------------------------------------------------------------------------
// Publish Tokens → GitHub PR
// ---------------------------------------------------------------------------
async function publishTokens () {
  const owner = document.getElementById('gh-owner').value.trim()
  const repo = document.getElementById('gh-repo').value.trim()
  const baseBranch = document.getElementById('gh-base-branch').value.trim() || 'main'
  const targetBranch = document.getElementById('gh-target-branch').value.trim() || 'main'

  if (!owner || !repo) {
    showToast('GitHub owner and repository are required', 'error')
    return
  }

  if (state.isDirty) {
    const proceed = confirm('You have unsaved changes. Save them first before publishing?')
    if (proceed) {
      await saveTokens()
      if (state.isDirty) return
    }
  }

  const resultEl = document.getElementById('publish-result')
  resultEl.innerHTML = '<span class="spinner"></span> Creating branch and PR…'

  try {
    const res = await actionWebInvoke(
      getActionUrl('publish-tokens'),
      getAuthHeaders(),
      {
        brandName: state.currentBrand,
        owner,
        repo,
        base_branch: baseBranch,
        target_branch: targetBranch
      }
    )

    const pr = res && res.pull_request
    const cssFile = res && res.css_file

    if (pr) {
      resultEl.innerHTML = `
        <div class="publish-success">
          <strong>✓ Pull Request created!</strong><br>
          <a href="${escapeHtml(pr.url)}" target="_blank" rel="noopener">${escapeHtml(pr.url)}</a><br>
          <small>${escapeHtml(cssFile ? cssFile.path : '')} · ${cssFile ? cssFile.variables : 0} CSS variables</small>
        </div>
      `
      showToast(`PR #${pr.number} created successfully`, 'success')
    } else {
      resultEl.innerHTML = '<span class="publish-error">Unexpected response from server</span>'
    }
  } catch (err) {
    if (handleAuthError(err)) {
      resultEl.innerHTML = '<span class="publish-error">Authentication required — set your IMS token in ⚙ Settings</span>'
    } else {
      resultEl.innerHTML = `<span class="publish-error">✗ ${escapeHtml(err.message)}</span>`
      showToast(`Publish failed: ${err.message}`, 'error')
    }
  }
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

function showToast (message, type = 'info') {
  const container = document.getElementById('toast-container')
  const toast = document.createElement('div')
  toast.className = `toast toast-${type}`
  toast.textContent = message
  container.appendChild(toast)
  requestAnimationFrame(() => toast.classList.add('visible'))
  setTimeout(() => {
    toast.classList.remove('visible')
    setTimeout(() => toast.remove(), 300)
  }, 3500)
}

function setLoading (active, message = 'Loading…') {
  const overlay = document.getElementById('loading-overlay')
  const msg = document.getElementById('loading-message')
  if (overlay) overlay.classList.toggle('visible', active)
  if (msg) msg.textContent = message
}

function capitalize (str) {
  return str.charAt(0).toUpperCase() + str.slice(1)
}

function normalizeHex (value) {
  if (!value) return '#000000'
  const v = String(value).trim()
  if (/^#[0-9a-fA-F]{6}$/.test(v)) return v
  if (/^#[0-9a-fA-F]{3}$/.test(v)) {
    return '#' + v.slice(1).split('').map(c => c + c).join('')
  }
  return '#000000'
}

function escapeHtml (str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
