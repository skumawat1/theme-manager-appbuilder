# AramarkEDSTaskrunner — Technical Architecture & Documentation

> **Generated:** February 2026  
> **Repository:** https://github.com/skumawat1/appbuilder-poc  
> **Platform:** Adobe App Builder (Adobe I/O Runtime)

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Technology Stack](#2-technology-stack)
3. [Repository Structure](#3-repository-structure)
4. [Core Concepts & Approach](#4-core-concepts--approach)
5. [Actions — Detailed Breakdown](#5-actions--detailed-breakdown)
6. [Authorization & Authentication](#6-authorization--authentication)
7. [Important Commands](#7-important-commands)
8. [High-Level Architecture Diagram](#8-high-level-architecture-diagram)
9. [End-to-End Flow Summary](#9-end-to-end-flow-summary)
10. [Key Design Decisions](#10-key-design-decisions)

---

## 1. Project Overview

**AramarkEDSTaskrunner** is an **Adobe App Builder** application running on **Adobe I/O Runtime** that serves as a **Brand CSS Design Token Manager**. It enables multi-brand CSS design token management — storing token sets per brand, generating CSS custom properties, and publishing them to a GitHub repository via Pull Requests.

The application is designed to feed a downstream **Adobe Edge Delivery Services (EDS)** site with brand-specific CSS variables, enabling runtime brand theming without rebuilding the EDS site.

**Key capabilities:**

- Create and manage multiple brand token sets (colors, typography, breakpoints)
- Live CSS preview as tokens are edited
- Store tokens server-side in Adobe I/O State (persistent key-value store)
- One-click publish: generates `brand/{name}.css` and opens a GitHub PR
- Integrates with Adobe Experience Cloud Shell for seamless IMS authentication

---

## 2. Technology Stack

| Layer              | Technology                                      | Version     |
| ------------------ | ----------------------------------------------- | ----------- |
| Platform           | Adobe App Builder / Adobe I/O Runtime           | SDK v6      |
| Serverless Runtime | Apache OpenWhisk (Node.js actions)              | `nodejs:22` |
| State Store        | `@adobe/aio-lib-state` (Adobe I/O State)        | ^5.3.1      |
| Auth Platform      | Adobe IMS (Identity Management System)          | —           |
| Events Platform    | Adobe I/O Events (`@adobe/aio-sdk` Events)      | —           |
| Frontend Shell     | Adobe Experience Cloud Shell (`@adobe/exc-app`) | ^1.3.0      |
| Frontend JS        | Vanilla JavaScript (ES Modules)                 | —           |
| CI/CD Integration  | GitHub REST API v3 (via `node-fetch`)           | —           |
| Testing            | Jest (unit + e2e)                               | ^29         |
| Bundler            | Webpack                                         | —           |
| Node Minimum       | Node.js                                         | ≥ 18        |

---

## 3. Repository Structure

```
AramarkEDSTaskrunner/
│
├── app.config.yaml              ← Runtime manifest: action routes, auth, env var injection
├── package.json                 ← Dependencies, scripts
├── webpack-config.js            ← Webpack config for action bundling
├── tsconfig.json                ← TypeScript config (for UI)
│
├── config/
│   └── token-schema.json        ← Design token schema (categories, field types, defaults)
│
├── actions/                     ← Serverless backend (Adobe I/O Runtime actions)
│   ├── utils.js                 ← Shared utilities: auth helpers, CSS helpers, GitHub API helpers
│   ├── manage-tokens/
│   │   └── index.js             ← Brand token CRUD using Adobe I/O State
│   ├── publish-tokens/
│   │   └── index.js             ← Token → CSS → GitHub branch + PR pipeline
│   ├── github-branch-pr/
│   │   └── index.js             ← Direct CSS mock → GitHub branch + PR (prototype)
│   ├── publish-events/
│   │   └── index.js             ← Publish CloudEvents to Adobe I/O Events
│   └── sample-app/
│       └── index.js             ← Boilerplate: external API call with IMS auth
│
├── web-src/                     ← Frontend single-page application
│   ├── index.html               ← Main HTML shell
│   ├── index.css                ← Application styles
│   └── src/
│       ├── index.js             ← App bootstrap, all UI logic, action invocations
│       ├── utils.js             ← Client-side CSS helpers + actionWebInvoke()
│       └── exc-runtime.js       ← Adobe Experience Cloud Shell integration
│
├── test/                        ← Jest unit tests
│   ├── manage-tokens.test.js
│   ├── publish-tokens.test.js
│   ├── github-branch-pr.test.js
│   ├── publish-events.test.js
│   ├── sample-app.test.js
│   └── utils.test.js
│
└── e2e/                         ← Jest end-to-end tests
    ├── publish-events.e2e.test.js
    └── sample-app.e2e.test.js
```

---

## 4. Core Concepts & Approach

### 4.1 Multi-Brand Token Architecture

The system manages **named brand token sets**. Each brand has a JSON token object structured by category (colors, typography, breakpoints). A **global schema** (`config/token-schema.json`) defines the structure, types, labels, and default values:

```json
{
  "colors": {
    "primary": {
      "type": "color",
      "default": "#e87722",
      "label": "Primary Color"
    },
    "secondary": {
      "type": "color",
      "default": "#003865",
      "label": "Secondary Color"
    },
    "background": {
      "type": "color",
      "default": "#ffffff",
      "label": "Background"
    }
  },
  "typography": {
    "fontFamilyBase": {
      "type": "string",
      "default": "\"Source Sans Pro\", Arial, sans-serif",
      "label": "Font Family"
    },
    "fontSizeBase": {
      "type": "size",
      "default": "16px",
      "label": "Base Font Size"
    }
  },
  "breakpoints": {
    "mobile": { "type": "size", "default": "480px", "label": "Mobile" },
    "tablet": { "type": "size", "default": "768px", "label": "Tablet" },
    "desktop": { "type": "size", "default": "1024px", "label": "Desktop" }
  }
}
```

Brands are stored in **Adobe I/O State** under these keys:

| State Key      | Value                      | Description                              |
| -------------- | -------------------------- | ---------------------------------------- |
| `brand.index`  | `["aramark","pepsi"]`      | JSON array of all registered brand names |
| `brand.<name>` | `{ "colors": {...}, ... }` | Full token JSON for a specific brand     |

**Brand name sanitisation:** Brand names are normalised to lowercase kebab-case before storage. For example `"Aramark Corp"` → `"aramark-corp"` → stored as `brand.aramark-corp`.

### 4.2 Token → CSS Pipeline

The core transformation pipeline converts structured token JSON into standard CSS custom properties:

**Step 1 — Flatten:** Nested token objects are recursively flattened into kebab-joined keys:

```
{ colors: { primary: "#e87722" } }
  → { "colors-primary": "#e87722" }
```

**Step 2 — Convert to CSS Variables:** Flat key-value pairs become CSS custom properties inside a `:root {}` block:

```css
:root {
  --brand-colors-primary: #e87722;
  --brand-colors-secondary: #003865;
  --brand-typography-font-family-base: "Source Sans Pro", Arial, sans-serif;
  --brand-typography-font-size-base: 16px;
  --brand-breakpoints-mobile: 480px;
}
```

The CSS variable prefix defaults to `--brand-` and is configurable.

**Step 3 — Publish to GitHub:** The generated CSS is committed as `brand/<brandName>.css` to a new branch and a Pull Request is raised against the target branch.

### 4.3 Frontend Architecture

The frontend is a **vanilla JavaScript single-page application** that:

- Reads `config/token-schema.json` to dynamically generate the token editing form
- Calls the Adobe I/O Runtime actions via `actionWebInvoke()` (a thin `fetch` wrapper)
- Stores IMS credentials in `localStorage` for session persistence
- Renders a live CSS preview as tokens are edited (no server round-trip needed)
- Integrates with Adobe Experience Cloud Shell for automatic IMS token injection

---

## 5. Actions — Detailed Breakdown

### 5.1 `manage-tokens`

| Property       | Value                            |
| -------------- | -------------------------------- |
| File           | `actions/manage-tokens/index.js` |
| Authentication | `require-adobe-auth: false`      |
| Runtime        | `nodejs:22`                      |
| Web            | `yes` (publicly accessible URL)  |

**Purpose:** CRUD operations for brand tokens stored in Adobe I/O State.

**Operations:**

| Operation | Required Params       | Description                               |
| --------- | --------------------- | ----------------------------------------- |
| `list`    | none                  | Returns `{ brands: ["aramark", ...] }`    |
| `get`     | `brandName`           | Returns `{ brandName, tokens: {...} }`    |
| `save`    | `brandName`, `tokens` | Upserts token JSON + updates brand index  |
| `delete`  | `brandName`           | Removes brand tokens + removes from index |

**State management:**

```
state.put("brand.index", JSON.stringify(["aramark", "pepsi"]), { ttl: 31536000 })
state.put("brand.aramark", JSON.stringify({ colors: {...}, ... }), { ttl: 31536000 })
```

> **Note:** Adobe I/O State does not support infinite TTL. All entries are stored with a 365-day (31,536,000 second) TTL.

---

### 5.2 `publish-tokens`

| Property          | Value                             |
| ----------------- | --------------------------------- |
| File              | `actions/publish-tokens/index.js` |
| Authentication    | `require-adobe-auth: false`       |
| Runtime           | `nodejs:22`                       |
| Env Vars Injected | `GITHUB_TOKEN`                    |

**Purpose:** Reads stored brand tokens → generates CSS → creates a GitHub branch → commits CSS file → opens Pull Request.

**Required Parameters:**

| Parameter      | Description                                             |
| -------------- | ------------------------------------------------------- |
| `brandName`    | Name of the brand whose tokens to publish               |
| `GITHUB_TOKEN` | GitHub PAT (injected from `.env` via `app.config.yaml`) |
| `owner`        | GitHub repository owner (org or user)                   |
| `repo`         | Repository name                                         |

**Optional Parameters:**

| Parameter       | Default        | Description                     |
| --------------- | -------------- | ------------------------------- |
| `base_branch`   | `main`         | Branch to fork from             |
| `target_branch` | `main`         | Branch for the PR to merge into |
| `css_prefix`    | `--brand-`     | CSS variable prefix             |
| `pr_title`      | auto-generated | Pull Request title              |
| `pr_body`       | auto-generated | Pull Request description        |

**Execution flow:**

```
1. state.get("brand.<safeName>")              → load token JSON
2. flattenObject(tokens) + toCssVariables()   → generate CSS text
3. GET /repos/{owner}/{repo}/git/ref/heads/{baseBranch}   → get base SHA
4. POST /repos/{owner}/{repo}/git/refs        → create branch
   (branch name: brand/css-tokens-{name}-{timestamp})
5. PUT /repos/{owner}/{repo}/contents/brand/{name}.css    → commit file
6. POST /repos/{owner}/{repo}/pulls           → open Pull Request
```

**Response:**

```json
{
  "message": "CSS tokens published successfully",
  "brand": "aramark",
  "css_file": { "path": "brand/aramark.css", "variables": 9, "url": "..." },
  "pull_request": {
    "number": 42,
    "title": "...",
    "url": "...",
    "state": "open"
  }
}
```

---

### 5.3 `github-branch-pr`

| Property          | Value                               |
| ----------------- | ----------------------------------- |
| File              | `actions/github-branch-pr/index.js` |
| Authentication    | `require-adobe-auth: true`          |
| Runtime           | `nodejs:22`                         |
| Env Vars Injected | `GITHUB_TOKEN`                      |

**Purpose:** Prototype/earlier version of the publish pipeline. Uses **hardcoded mock CSS theme data** (Aramark brand: colors, typography, spacing, border-radius, shadows, breakpoints) instead of reading from I/O State. Useful for testing the GitHub integration independently.

**Required Parameters:** `GITHUB_TOKEN`, `owner`, `repo`, `new_branch`, `pr_title`

**Optional Parameters:** `base_branch`, `target_branch`, `pr_body`, `css_file_name` (default: `brand-theme`)

**Key difference from `publish-tokens`:** The branch name is explicitly passed by the caller (not auto-generated), and the CSS content comes from the `fetchMockCssData()` function rather than I/O State.

---

### 5.4 `publish-events`

| Property          | Value                             |
| ----------------- | --------------------------------- |
| File              | `actions/publish-events/index.js` |
| Authentication    | `require-adobe-auth: true`        |
| Runtime           | `nodejs:22`                       |
| Env Vars Injected | `SERVICE_API_KEY` (as `apiKey`)   |

**Purpose:** Publish a [CloudEvent](https://cloudevents.io/) to Adobe I/O Events. Enables event-driven integrations with other Adobe services.

**Required Parameters:** `apiKey`, `providerId`, `eventCode`, `payload`  
**Required Headers:** `Authorization` (IMS Bearer token), `x-gw-ims-org-id`

**Execution flow:**

```
1. getBearerToken(params)                    → extract IMS token from Authorization header
2. Events.init(orgId, apiKey, token)         → initialise Events client
3. new CloudEvent({ source, type, data })    → construct CloudEvent (with uuid v4 ID)
4. eventsClient.publishEvent(cloudEvent)     → publish to I/O Events
```

**Response codes:**

- `200` — published successfully
- `204` — published but no registered event subscribers

---

### 5.5 `sample-app`

| Property       | Value                         |
| -------------- | ----------------------------- |
| File           | `actions/sample-app/index.js` |
| Authentication | `require-adobe-auth: true`    |

**Purpose:** Boilerplate action demonstrating how to call an external API with IMS authentication. Calls `https://adobeioruntime.net/api/v1` as a placeholder endpoint. Intended to be replaced with actual business logic.

---

## 6. Authorization & Authentication

### 6.1 Action-Level Auth — `app.config.yaml`

Each action declares `require-adobe-auth` in its annotations section:

```yaml
annotations:
  require-adobe-auth: true # or false
  final: true
```

| Action             | `require-adobe-auth` | Who Can Call                                      |
| ------------------ | -------------------- | ------------------------------------------------- |
| `manage-tokens`    | `false`              | Anyone with the action URL                        |
| `publish-tokens`   | `false`              | Anyone with the action URL + valid `GITHUB_TOKEN` |
| `github-branch-pr` | `true`               | Must have valid IMS Bearer token                  |
| `publish-events`   | `true`               | Must have valid IMS Bearer token + Org ID         |
| `sample-app`       | `true`               | Must have valid IMS Bearer token                  |

When `require-adobe-auth: true`:

- The **Adobe I/O Runtime API Gateway** intercepts the request
- It validates the `Authorization: Bearer <token>` header against **Adobe IMS** before the action code runs
- Invalid or missing tokens receive a `401 Unauthorized` response — the action is never invoked

When `require-adobe-auth: false`:

- The request passes through to the action unconditionally
- The action may still perform its own validation (e.g. `publish-events` manually checks for `Authorization` and `x-gw-ims-org-id` headers)

The `final: true` annotation prevents the action from being used as a step in an OpenWhisk action sequence.

---

### 6.2 IMS Token Handling — Frontend

**Storage:** IMS credentials are persisted in `localStorage`:

| localStorage Key        | Content                 |
| ----------------------- | ----------------------- |
| `tokenManager.imsToken` | IMS Bearer access token |
| `tokenManager.imsOrgId` | IMS Organisation ID     |

**Injection:** Every action invocation attaches these as HTTP headers:

```javascript
headers: {
  'Authorization': 'Bearer <imsToken>',
  'x-gw-ims-org-id': '<orgId>'
}
```

**Token Acquisition — Two Modes:**

**Mode 1: Adobe Experience Cloud Shell (automatic)**

```
Experience Cloud Shell loads app
    → @adobe/exc-app fires 'ready' event
    → { imsToken, imsOrg, imsProfile, locale } provided automatically
    → Stored into localStorage
    → UI shows 🟢 Authenticated badge
```

**Mode 2: Standalone / Direct URL (manual)**

```
User opens app directly (not via Experience Cloud Shell)
    → Clicks ⚙ Settings button
    → Enters IMS Bearer token + Org ID manually
    → Saved to localStorage on click
    → Brand list reloads with new credentials
```

**Auth Error Recovery:**  
The `handleAuthError()` function intercepts HTTP `401`, `403`, and `405` responses, automatically opens the Settings Panel, and prompts the user to re-enter their IMS token.

---

### 6.3 GitHub Authentication

The GitHub Personal Access Token (PAT) flow:

```
.env file
  GITHUB_TOKEN=ghp_xxxxxxxxxxxx
      │
      ▼
app.config.yaml (server-side injection)
  inputs:
    GITHUB_TOKEN: $GITHUB_TOKEN
      │
      ▼ (injected as params.GITHUB_TOKEN at action invocation)
actions/publish-tokens/index.js
  buildGitHubHeaders(params.GITHUB_TOKEN)
      │
      ▼
GitHub REST API
  Authorization: Bearer ghp_xxxxxxxxxxxx
  Accept: application/vnd.github+json
  X-GitHub-Api-Version: 2022-11-28
```

> **Security:** The GitHub PAT is **never exposed to the browser**. It lives only in the `.env` file (excluded from source control via `.gitignore`) and is injected as a server-side action parameter.

---

### 6.4 Authorization Flow Diagram

```
Browser (User)
    │
    │  POST /api/v1/web/AramarkEDSTaskrunner/manage-tokens
    │  Headers: { Authorization: Bearer <imsToken>, x-gw-ims-org-id: <orgId> }
    │
    ▼
Adobe I/O Runtime Gateway
    │
    ├─ require-adobe-auth: false ──────────────────────────► Action runs directly
    │
    └─ require-adobe-auth: true
           │
           ▼
       Adobe IMS Token Validation
           │
           ├─ Token INVALID ──────────────────────────────► 401 Unauthorized (action not called)
           │
           └─ Token VALID ─────────────────────────────────► Action runs with IMS context
```

---

## 7. Important Commands

### 7.1 Setup

```bash
# Generate .env file with your Adobe I/O Runtime credentials
aio app use

# Install dependencies
npm install
```

**`.env` file (never commit to source control):**

```bash
AIO_RUNTIME_AUTH=<your_runtime_auth_token>
AIO_RUNTIME_NAMESPACE=<your_namespace>
GITHUB_TOKEN=<your_github_personal_access_token>
SERVICE_API_KEY=<your_adobe_service_api_key>
```

### 7.2 Local Development

```bash
# Start local dev server
# UI served locally at localhost:9080
# Actions deployed to and served from Adobe I/O Runtime
aio app run

# Full local development (both UI and actions run locally)
aio app dev
```

> For the difference between `aio app run` vs `aio app dev`, see the [App Builder docs](https://developer.adobe.com/app-builder/docs/guides/development/#aio-app-dev-vs-aio-app-run).

### 7.3 Testing

```bash
# Run unit tests
aio app test
# OR:
npm test

# Run end-to-end tests
aio app test --e2e
# OR:
npm run e2e

# Lint code
npm run lint

# Auto-fix lint issues
npm run lint:fix
```

### 7.4 Deployment

```bash
# Build and deploy everything
# → Actions deployed to Adobe I/O Runtime
# → Static files (UI) deployed to Adobe CDN
aio app deploy

# Undeploy the application (remove from Runtime + CDN)
aio app undeploy
```

### 7.5 Action Invocation (Direct via CLI)

```bash
# Invoke manage-tokens action (list brands)
aio rt action invoke AramarkEDSTaskrunner/manage-tokens \
  --param operation list \
  --result

# Invoke manage-tokens action (save brand tokens)
aio rt action invoke AramarkEDSTaskrunner/manage-tokens \
  --param operation save \
  --param brandName aramark \
  --param tokens '{"colors":{"primary":"#e87722"}}' \
  --result

# Invoke publish-tokens action
aio rt action invoke AramarkEDSTaskrunner/publish-tokens \
  --param brandName aramark \
  --param owner myorg \
  --param repo my-eds-repo \
  --result

# List all deployed actions
aio rt action list
```

---

## 8. High-Level Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              USER / BROWSER                                 │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │               Brand CSS Token Manager UI (localhost:9080)           │   │
│  │                    web-src/src/index.js — Vanilla JS                │   │
│  │                                                                     │   │
│  │  ┌──────────────────────┐   ┌───────────────────────────────────┐  │   │
│  │  │    Settings Panel    │   │         Token Editor              │  │   │
│  │  │  ⚙ IMS Token input   │   │  Tab: Colors | Typography | ...   │  │   │
│  │  │  ⚙ Org ID input      │   │  ┌─────────────────────────────┐  │  │   │
│  │  │                      │   │  │  Live CSS Preview           │  │  │   │
│  │  │  localStorage:       │   │  │  :root {                    │  │  │   │
│  │  │  • imsToken          │   │  │    --brand-colors-primary:  │  │  │   │
│  │  │  • imsOrgId          │   │  │      #e87722;               │  │  │   │
│  │  │  • gh-owner          │   │  │  }                          │  │  │   │
│  │  │  • gh-repo           │   │  └─────────────────────────────┘  │  │   │
│  │  └──────────────────────┘   └───────────────────────────────────┘  │   │
│  │                                                                     │   │
│  │  [ Save ]  [ Export CSS ]  [ Publish → GitHub PR ]                  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                          │                                                  │
│                          │ fetch() via actionWebInvoke()                    │
│                          │ POST + { Authorization, x-gw-ims-org-id }        │
└──────────────────────────┼──────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     ADOBE I/O RUNTIME GATEWAY                               │
│                                                                             │
│   ┌─────────────────────────────────────────────────────────────────┐      │
│   │           IMS Authentication Check                              │      │
│   │   require-adobe-auth: true  → Validate Bearer token with IMS   │      │
│   │   require-adobe-auth: false → Pass request through             │      │
│   └─────────────────────────────────────────────────────────────────┘      │
│                                │                                            │
│         ┌──────────────────────┼──────────────────────┐                    │
│         │                      │                       │                    │
│         ▼                      ▼                       ▼                    │
│  ┌─────────────┐      ┌──────────────────┐   ┌─────────────────────┐      │
│  │manage-tokens│      │ publish-tokens   │   │  github-branch-pr   │      │
│  │             │      │                  │   │                     │      │
│  │auth: false  │      │  auth: false     │   │  auth: true         │      │
│  │             │      │  GITHUB_TOKEN    │   │  GITHUB_TOKEN       │      │
│  │  list       │      │  injected        │   │  injected           │      │
│  │  get        │      │                  │   │                     │      │
│  │  save       │      │  1. Read tokens  │   │  Mock CSS data      │      │
│  │  delete     │      │  2. Flatten CSS  │   │  → Branch + PR      │      │
│  └──────┬──────┘      │  3. Create branch│   └─────────┬───────────┘      │
│         │             │  4. Commit file  │             │                   │
│         │             │  5. Open PR      │             │                   │
│         ▼             └────────┬─────────┘             │                   │
│  ┌─────────────┐               │                       │                   │
│  │Adobe I/O    │◄──────────────┘                       │                   │
│  │State (KV)   │  Step 1: read tokens                  │                   │
│  │             │                                       │                   │
│  │brand.index  │                                       ▼                   │
│  │brand.aramark│                              ┌─────────────────┐          │
│  │brand.pepsi  │                              │  GitHub REST    │          │
│  │  TTL: 365d  │                              │  API v3         │          │
│  └─────────────┘                              │                 │          │
│                                               │ GET  /refs      │          │
│  ┌──────────────────┐  ┌──────────────────┐   │ POST /refs      │          │
│  │ publish-events   │  │   sample-app     │   │ PUT  /contents  │          │
│  │  auth: true      │  │   auth: true     │   │ POST /pulls     │          │
│  │                  │  │                  │   └────────┬────────┘          │
│  │  CloudEvent(uuid)│  │  External API    │            │                   │
│  │  → I/O Events    │  │  → response      │            │                   │
│  └──────────────────┘  └──────────────────┘            │                   │
└────────────────────────────────────────────────────────┼────────────────────┘
                                                         │
                                                         ▼ PR Created
┌─────────────────────────────────────────────────────────────────────────────┐
│                       TARGET GITHUB REPOSITORY                              │
│                                                                             │
│  New branch: brand/css-tokens-aramark-1740456000000                         │
│  New file:   brand/aramark.css                                              │
│                                                                             │
│  :root {                                                                    │
│    --brand-colors-primary: #e87722;                                         │
│    --brand-colors-secondary: #003865;                                       │
│    --brand-typography-font-family-base: "Source Sans Pro", Arial, sans-serif│
│    --brand-typography-font-size-base: 16px;                                 │
│    --brand-breakpoints-mobile: 480px;                                       │
│    ...                                                                      │
│  }                                                                          │
│                                                                             │
│  Pull Request #42: "Brand tokens: update CSS variables for aramark"         │
│    head: brand/css-tokens-aramark-1740456000000 → base: main               │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ PR merged by developer
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                  ADOBE EDGE DELIVERY SERVICES (EDS) SITE                    │
│                                                                             │
│  Imports /brand/aramark.css → CSS custom properties applied site-wide      │
│  → Brand-specific theming applied without EDS rebuild                      │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 9. End-to-End Flow Summary

### Flow 1: Create a New Brand

```
User enters brand name in New Brand modal
    │
    ├─ (Optional) Clone tokens from existing brand
    │       POST manage-tokens { operation: "get", brandName: <source> }
    │
    └─ Build default tokens from token-schema.json
    │
    ▼
POST manage-tokens { operation: "save", brandName: "aramark", tokens: {...} }
    │
    ▼
Adobe I/O State:
    state.put("brand.aramark", JSON.stringify(tokens), { ttl: 31536000 })
    state.put("brand.index",   JSON.stringify(["aramark"]), { ttl: 31536000 })
    │
    ▼
UI updates: brand appears in left panel, token editor opens
```

### Flow 2: Edit & Save Tokens

```
User edits a color/typography/breakpoint value in the UI
    │
    ▼
onTokenChange() → state.tokens[category][key] = newValue
    → state.isDirty = true
    → renderCssPreview() → live :root { --brand-* } update in page
    │
User clicks [Save]
    │
    ▼
POST manage-tokens { operation: "save", brandName: "aramark", tokens: state.tokens }
    │
    ▼
Adobe I/O State updated → isDirty = false
```

### Flow 3: Publish Tokens as GitHub PR

```
User clicks [Publish] → enters GitHub owner/repo → clicks [Create PR]
    │
    ▼
POST publish-tokens {
    brandName: "aramark",
    owner: "myorg",
    repo: "my-eds-repo",
    base_branch: "main",
    target_branch: "main"
}
    │
    ├─ Step 1: state.get("brand.aramark") → token JSON
    ├─ Step 2: flattenObject(tokens) → { "colors-primary": "#e87722", ... }
    │          toCssVariables() → ":root { --brand-colors-primary: #e87722; ... }"
    ├─ Step 3: GET /repos/myorg/my-eds-repo/git/ref/heads/main → SHA
    ├─ Step 4: POST /repos/myorg/my-eds-repo/git/refs
    │          creates branch: brand/css-tokens-aramark-{timestamp}
    ├─ Step 5: PUT /repos/myorg/my-eds-repo/contents/brand/aramark.css
    │          commits generated CSS to new branch
    └─ Step 6: POST /repos/myorg/my-eds-repo/pulls
               opens PR: new branch → main
    │
    ▼
Response: { pull_request: { number: 42, url: "https://github.com/..." } }
UI shows: ✓ Pull Request created! with clickable link
```

---

## 10. Key Design Decisions

| Decision                                                                       | Rationale                                                                                                                           |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `require-adobe-auth: false` for `manage-tokens` & `publish-tokens`             | Simplifies UI integration; IMS auth headers are passed but not enforced at gateway level                                            |
| Adobe I/O State for token storage                                              | Serverless persistence with no database to manage; built-in TTL support                                                             |
| GitHub PAT injected server-side via env                                        | Security — the token never reaches the browser; managed per-deployment in `.env`                                                    |
| CSS variables with `--brand-` prefix                                           | Namespaced to avoid conflicts; compatible with EDS CSS custom property consumption pattern                                          |
| `config/token-schema.json` as single source of truth                           | Drives both the UI form generation (field types, labels) and default token values for new brands                                    |
| `final: true` annotation on all actions                                        | Prevents actions from being chained in OpenWhisk sequences; each action is a standalone endpoint                                    |
| Timestamp in branch names                                                      | `brand/css-tokens-{name}-{timestamp}` ensures unique branch names on every publish — no collision on repeated publishes             |
| `flattenObject()` / `toCssVariables()` duplicated in both frontend and backend | Client-side functions enable live CSS preview without a server round-trip; backend functions generate authoritative CSS for commits |
| Brand name sanitisation to kebab-case                                          | Ensures consistent state keys and safe file/branch names regardless of user input casing or special characters                      |
