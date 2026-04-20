# Building a Multi-Brand CSS Design Token Manager on Adobe App Builder — From I/O State to GitHub PR

> A step-by-step tutorial for managing brand CSS variables with serverless actions, Adobe I/O State, and automated GitHub Pull Requests — no database required.

---

## Table of Contents

1. [What We're Building](#1-what-were-building)
2. [What is Adobe App Builder?](#2-what-is-adobe-app-builder)
3. [Architecture Overview](#3-architecture-overview)
4. [Prerequisites & Project Setup](#4-prerequisites--project-setup)
5. [Step 1 — Define the Token Schema](#5-step-1--define-the-token-schema)
6. [Step 2 — The manage-tokens Action (CRUD with Adobe I/O State)](#6-step-2--the-manage-tokens-action-crud-with-adobe-io-state)
7. [Step 3 — The CSS Utility Functions](#7-step-3--the-css-utility-functions)
8. [Step 4 — The publish-tokens Action (GitHub PR Pipeline)](#8-step-4--the-publish-tokens-action-github-pr-pipeline)
9. [Step 5 — The GitHub API Helpers](#9-step-5--the-github-api-helpers)
10. [Step 6 — Authentication Design](#10-step-6--authentication-design)
11. [Step 7 — The Frontend SPA](#11-step-7--the-frontend-spa)
12. [Step 8 — App Configuration (app.config.yaml)](#12-step-8--app-configuration-appconfigyaml)
13. [Step 9 — Local Development & Testing](#13-step-9--local-development--testing)
14. [Step 10 — Deploying to Production](#14-step-10--deploying-to-production)
15. [End-to-End Walk-through](#15-end-to-end-walk-through)
16. [Key Design Decisions & Lessons Learned](#16-key-design-decisions--lessons-learned)
17. [Conclusion & What's Next](#17-conclusion--whats-next)
18. [Full Source Files](#18-full-source-files)

---

## 1. What We're Building

If you manage a digital experience platform that serves multiple brands — think a large enterprise with Aramark, Pepsi, or any number of sub-brands, each needing its own colours, typography, and spacing — you know the pain of maintaining CSS per-brand. Rebuilding or redeploying your site every time a designer tweaks a brand colour is not sustainable.

In this tutorial we'll build **AramarkEDSTaskrunner**: a serverless web application that lets your team:

- **Create and manage multiple brand token sets** (colors, typography, breakpoints) through a visual UI
- **Preview CSS custom properties live** as tokens are edited — no server round-trip
- **Store tokens server-side** using Adobe I/O State (a managed key-value store — zero database setup)
- **Publish tokens with one click**: auto-generates a `brand/{name}.css` file and opens a GitHub Pull Request

The downstream consumer is an **Adobe Edge Delivery Services (EDS)** site that imports the brand CSS file and applies the variables site-wide — brand theming without a rebuild.

Here's what the publish output looks like for a brand called `aramark`:

```css
:root {
  --brand-colors-primary: #e87722;
  --brand-colors-secondary: #003865;
  --brand-colors-background: #ffffff;
  --brand-typography-font-family-base: "Source Sans Pro", Arial, sans-serif;
  --brand-typography-font-size-base: 16px;
  --brand-typography-font-size-small: 12px;
  --brand-breakpoints-mobile: 480px;
  --brand-breakpoints-tablet: 768px;
  --brand-breakpoints-desktop: 1024px;
  --brand-breakpoints-wide: 1280px;
}
```

Clean, standard CSS. Any EDS page (or any web page) can import this file and immediately apply brand-specific styles.

Let's build it.

---

## 2. What is Adobe App Builder?

Before we write a single line of code, let's take a moment to understand the platform we're building on.

**Adobe App Builder** is Adobe's official framework for building custom cloud-native applications that integrate with the Adobe Experience Cloud ecosystem. Think of it as a fully managed serverless platform designed specifically for Adobe integrations.

Here's what makes it different from a generic serverless platform like AWS Lambda or Vercel:

### 2.1 What's included out of the box

| Capability                   | What it means                                                                                                                                                              |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Adobe I/O Runtime**        | Apache OpenWhisk-based serverless function execution. Your "actions" (functions) run here.                                                                                 |
| **Adobe I/O State**          | A managed key-value store for persisting data between action calls. No RDS, no DynamoDB, no setup.                                                                         |
| **Adobe I/O Files**          | Blob/file storage if you need it.                                                                                                                                          |
| **Adobe IMS Authentication** | Built-in token validation against Adobe's Identity Management System. Add `require-adobe-auth: true` to your action and the gateway validates every request automatically. |
| **Adobe CDN**                | Static frontend assets (your HTML/CSS/JS) are deployed to a global Adobe CDN automatically.                                                                                |
| **Experience Cloud Shell**   | Your app can be embedded inside Adobe Experience Cloud with automatic IMS token injection.                                                                                 |

### 2.2 The programming model

An App Builder application is structured like this:

```
my-app/
├── app.config.yaml       ← The heart: defines actions, auth, env vars
├── actions/              ← Serverless backend (Node.js functions)
│   └── my-action/
│       └── index.js      ← exports.main = async (params) => { ... }
└── web-src/              ← Static frontend (deployed to Adobe CDN)
    └── src/
        └── index.js
```

Each **action** (serverless function) is a Node.js module that exports a `main` function:

```javascript
async function main(params) {
  // params contains: query params, body params, injected env vars, HTTP headers
  return {
    statusCode: 200,
    body: { message: "Hello, App Builder!" },
  };
}

exports.main = main;
```

The `app.config.yaml` file declares which actions exist, what environment variables they get, and whether they require Adobe authentication.

### 2.3 Why App Builder for this use case?

- **No infrastructure to manage** — no servers, no containers, no Kubernetes
- **I/O State** eliminates the need for a database — perfect for storing small-to-medium JSON token sets
- **Built-in IMS auth** — one line in config and your action is protected
- **Adobe CDN hosting** for the frontend — zero deployment config
- **GitHub token stays server-side** — never exposed to the browser

### 2.4 The `aio` CLI

Everything is managed through the `aio` (Adobe I/O) CLI:

```bash
npm install -g @adobe/aio-cli   # Install once

aio app use          # Link to your Developer Console project, generates .env
aio app run          # Start local dev server
aio app deploy       # Deploy to production
aio app undeploy     # Tear down
```

Now let's build.

---

## 3. Architecture Overview

Here's how all the pieces connect:

```
Browser (User)
    │
    │  POST /api/v1/web/AramarkEDSTaskrunner/manage-tokens
    │  Headers: { Authorization: Bearer <imsToken>, x-gw-ims-org-id: <orgId> }
    │
    ▼
Adobe I/O Runtime Gateway
    │
    ├─ require-adobe-auth: false ──────────────────► Action runs directly
    └─ require-adobe-auth: true
           │
           ▼
       Adobe IMS Token Validation
           │
           └─ Token VALID ────────────────────────► Action code runs
    │
    ├─── manage-tokens ──────────────────────────► Adobe I/O State (KV store)
    │                                               brand.index = ["aramark","pepsi"]
    │                                               brand.aramark = { colors: {...} }
    │
    └─── publish-tokens
              │
              ├── 1. Read tokens from I/O State
              ├── 2. flattenObject() + toCssVariables()
              ├── 3. GET /repos/{owner}/{repo}/git/ref/heads/main  (SHA)
              ├── 4. POST /repos/{owner}/{repo}/git/refs           (create branch)
              ├── 5. PUT  /repos/{owner}/{repo}/contents/brand/aramark.css
              └── 6. POST /repos/{owner}/{repo}/pulls              (open PR)
                                  │
                                  ▼
                        GitHub Repository
                        brand/aramark.css committed
                        PR #42 opened: brand/css-tokens-aramark-{ts} → main
                                  │
                                  ▼  PR merged
                        Adobe EDS Site
                        Imports /brand/aramark.css
                        → CSS variables applied site-wide
```

The key insight: the browser **never touches** the GitHub token. It only calls your App Builder actions. The actions hold the secret on the server.

---

## 4. Prerequisites & Project Setup

### What you'll need

- **Node.js ≥ 18** installed
- **Adobe Developer Console** access — [console.adobe.io](https://console.adobe.io)
- An **Adobe App Builder project** created in the Developer Console (with I/O Runtime + I/O State entitlements enabled)
- A **GitHub Personal Access Token (PAT)** with `repo` scope
- The `aio` CLI installed globally

```bash
npm install -g @adobe/aio-cli
```

### Clone the repository

```bash
git clone https://github.com/skumawat1/appbuilder-poc.git
cd AramarkEDSTaskrunner
npm install
```

### Link to your Adobe Developer Console project

```bash
aio login            # Authenticate with Adobe IMS
aio app use          # Select your org, project, workspace → generates .env
```

### Populate the `.env` file

After `aio app use`, you'll have a `.env` file. Add your GitHub token and Service API key:

```bash
# .env — NEVER commit this to source control

# Adobe I/O Runtime credentials (auto-populated by aio app use)
AIO_RUNTIME_AUTH=your_runtime_auth_token_here
AIO_RUNTIME_NAMESPACE=your_namespace_here

# Your GitHub Personal Access Token (needs repo scope)
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx

# Adobe Service API key (from Developer Console, for publish-events action)
SERVICE_API_KEY=your_service_api_key_here
```

The `.gitignore` already excludes `.env` — never commit this file.

---

## 5. Step 1 — Define the Token Schema

The single most important architectural decision in this project: **one JSON file drives everything** — the UI form, the default token values for new brands, and the CSS variable names.

### `config/token-schema.json`

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
    },
    "fontSizeSmall": {
      "type": "size",
      "default": "12px",
      "label": "Small Font Size"
    }
  },
  "breakpoints": {
    "mobile": { "type": "size", "default": "480px", "label": "Mobile" },
    "tablet": { "type": "size", "default": "768px", "label": "Tablet" },
    "desktop": { "type": "size", "default": "1024px", "label": "Desktop" },
    "wide": { "type": "size", "default": "1280px", "label": "Wide" }
  }
}
```

Each entry has three fields:

| Field     | Purpose                                                                                                    |
| --------- | ---------------------------------------------------------------------------------------------------------- |
| `type`    | Drives the UI input: `color` → renders a colour picker + hex input; `string`/`size` → renders a text input |
| `default` | Used to seed new brands with sensible starting values                                                      |
| `label`   | The human-readable label shown in the form                                                                 |

The schema is loaded at runtime by the frontend (`loadSchema()`) and is also referenced by `buildDefaultTokens()` when creating a new brand. **Changing the schema instantly adds/removes fields everywhere** — no code changes needed.

---

## 6. Step 2 — The `manage-tokens` Action (CRUD with Adobe I/O State)

This is the heart of the persistence layer. It stores brand token sets using **Adobe I/O State** — a managed, serverless key-value store included with App Builder. No database, no Redis, no setup.

### How Adobe I/O State works

```javascript
const stateLib = require("@adobe/aio-lib-state");
const state = await stateLib.init(); // connects to the managed KV store

await state.put("myKey", "myValue", { ttl: 31536000 }); // store with 365-day TTL
const entry = await state.get("myKey"); // entry.value = 'myValue'
await state.delete("myKey"); // remove key
```

**Important quirk:** I/O State does not support infinite TTL. The maximum is approximately 365 days (31,536,000 seconds). We use this as the TTL for all brand tokens, which is more than sufficient for a design token store.

### State key design

We use two types of keys:

| Key            | Value                   | Purpose                                  |
| -------------- | ----------------------- | ---------------------------------------- |
| `brand.index`  | `'["aramark","pepsi"]'` | JSON array of all registered brand names |
| `brand.<name>` | `'{"colors":{...}}'`    | Full token JSON for a specific brand     |

This simple index pattern lets us list all brands with a single state read instead of scanning for keys.

### Brand name sanitisation

User-entered brand names are sanitised before use as state keys or file names:

```javascript
function sanitiseBrandName(name) {
  return (
    String(name)
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-") // replace anything not alphanumeric/hyphen
      .replace(/-+/g, "-") // collapse multiple hyphens
      .replace(/^-|-$/g, "") || // trim leading/trailing hyphens
    "brand"
  );
}

// Examples:
// "Aramark Corp"  → "aramark-corp"
// "Pepsi-Cola!"   → "pepsi-cola"
// "Brand #3"      → "brand--3" → "brand-3"
```

This ensures state keys, file names, and branch names are always safe regardless of what the user types.

### The four operations

The action accepts a `params.operation` parameter to route to the appropriate handler.

**List:**

```javascript
const entry = await state.get("brand.index");
const brands = entry && entry.value ? JSON.parse(entry.value) : [];
return { statusCode: 200, body: { brands } };
```

**Get:**

```javascript
const brandKey = `brand.${sanitiseBrandName(params.brandName)}`;
const entry = await state.get(brandKey);
if (!entry || entry.value === undefined) {
  return errorResponse(404, `Brand '${params.brandName}' not found`, logger);
}
return {
  statusCode: 200,
  body: { brandName: params.brandName, tokens: JSON.parse(entry.value) },
};
```

**Save (upsert):**

```javascript
const safeName = sanitiseBrandName(params.brandName);
// 1. Store the token JSON
await state.put(`brand.${safeName}`, JSON.stringify(tokens), { ttl: 31536000 });
// 2. Update the index (add to list if new brand)
const index = (await state.get("brand.index"))?.value
  ? JSON.parse((await state.get("brand.index")).value)
  : [];
if (!index.includes(safeName)) {
  index.push(safeName);
  await state.put("brand.index", JSON.stringify(index), { ttl: 31536000 });
}
```

**Delete:**

```javascript
await state.delete(`brand.${safeName}`);
// Remove from index
const updatedIndex = index.filter((b) => b !== safeName);
await state.put("brand.index", JSON.stringify(updatedIndex), { ttl: 31536000 });
```

The full action code is in the [Full Source Files](#18-full-source-files) section at the end of this article.

---

## 7. Step 3 — The CSS Utility Functions

The token-to-CSS transformation is a three-step pipeline. These utility functions live in `actions/utils.js` (used by the backend) and are duplicated in `web-src/src/utils.js` (used by the frontend for live preview). This intentional duplication means the browser can render a CSS preview instantly without a server round-trip.

### Step A — `flattenObject()`

Nested token JSON is recursively flattened into kebab-joined keys:

```javascript
function flattenObject(obj, prefix = "") {
  const out = {};
  for (const [key, value] of Object.entries(obj)) {
    const k = prefix ? `${prefix}-${key}` : key;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      // Handle schema descriptor shape: { type, default, label }
      if ("default" in value) {
        out[k] = value.default;
      } else {
        Object.assign(out, flattenObject(value, k));
      }
    } else {
      out[k] = value;
    }
  }
  return out;
}
```

Example:

```javascript
flattenObject({ colors: { primary: "#e87722" } });
// → { 'colors-primary': '#e87722' }

flattenObject({ typography: { fontSizeBase: "16px" } });
// → { 'typography-fontSizeBase': '16px' }
```

### Step B — `toKebabCase()`

CSS variable names must be kebab-case. JavaScript object keys are often camelCase, so we convert:

```javascript
function toKebabCase(str) {
  return str
    .replace(/([a-z])([A-Z])/g, "$1-$2") // camelCase → kebab-case
    .replace(/[\s._]+/g, "-") // spaces, dots, underscores → hyphens
    .toLowerCase();
}

// toKebabCase('fontSizeBase')  → 'font-size-base'
// toKebabCase('fontFamilyBase') → 'font-family-base'
```

### Step C — `toCssVariables()`

Combines the flat map + kebab conversion into a proper CSS `:root {}` block:

```javascript
function toCssVariables(flat, prefix = "--brand-") {
  const lines = [];
  const pre = prefix.endsWith("-") ? prefix : `${prefix}-`;
  for (const [key, value] of Object.entries(flat)) {
    const varName = pre + toKebabCase(String(key));
    const cssValue = typeof value === "string" ? value : JSON.stringify(value);
    lines.push(`  ${varName}: ${cssValue};`);
  }
  return `:root {\n${lines.join("\n")}\n}\n`;
}
```

**Full transformation example:**

Input token JSON:

```json
{
  "colors": { "primary": "#e87722", "secondary": "#003865" },
  "typography": { "fontSizeBase": "16px" }
}
```

After `flattenObject()`:

```javascript
{
  'colors-primary': '#e87722',
  'colors-secondary': '#003865',
  'typography-fontSizeBase': '16px'
}
```

After `toCssVariables()`:

```css
:root {
  --brand-colors-primary: #e87722;
  --brand-colors-secondary: #003865;
  --brand-typography-font-size-base: 16px;
}
```

The `--brand-` prefix is configurable, ensuring no collision with other CSS variables in the EDS site.

---

## 8. Step 4 — The `publish-tokens` Action (GitHub PR Pipeline)

This action orchestrates the end-to-end publish flow: read stored tokens → generate CSS → create a GitHub branch → commit the file → open a Pull Request.

### The six-step pipeline

```javascript
async function main(params) {
  const {
    brandName,
    GITHUB_TOKEN,
    owner,
    repo,
    base_branch: baseBranch = "main",
    target_branch: targetBranch = "main",
    css_prefix: cssPrefix = "--brand-",
  } = params;

  const safeName = sanitiseBrandName(brandName);

  // ── Step 1: Load tokens from I/O State ──────────────────────────────
  const state = await stateLib.init();
  const entry = await state.get(`brand.${safeName}`);
  if (!entry || entry.value === undefined) {
    return errorResponse(404, `Brand '${brandName}' not found.`, logger);
  }
  const tokens = JSON.parse(entry.value);

  // ── Step 2: Generate CSS ─────────────────────────────────────────────
  const flat = flattenObject(tokens);
  const cssContent = toCssVariables(flat, cssPrefix);
  const variableCount = Object.keys(flat).length;

  // ── Step 3: Get base branch SHA ──────────────────────────────────────
  const sha = await getBranchSHA(owner, repo, baseBranch, GITHUB_TOKEN);

  // ── Step 4: Create new branch ────────────────────────────────────────
  const timestamp = Date.now();
  const newBranch = `brand/css-tokens-${safeName}-${timestamp}`;
  await createBranch(owner, repo, newBranch, sha, GITHUB_TOKEN);

  // ── Step 5: Commit brand/<name>.css ──────────────────────────────────
  const filePath = `brand/${safeName}.css`;
  const fileResult = await createOrUpdateFile({
    owner,
    repo,
    branch: newBranch,
    path: filePath,
    content: cssContent,
    message: `chore(brand): update CSS token variables for ${safeName}`,
    token: GITHUB_TOKEN,
  });

  // ── Step 6: Open Pull Request ─────────────────────────────────────────
  const pr = await createPullRequest(
    owner,
    repo,
    newBranch,
    targetBranch,
    `Brand tokens: update CSS variables for ${safeName}`,
    `Updates \`${filePath}\` with ${variableCount} CSS custom properties.`,
    GITHUB_TOKEN,
  );

  return {
    statusCode: 200,
    body: {
      message: "CSS tokens published successfully",
      brand: safeName,
      css_file: { path: filePath, variables: variableCount },
      pull_request: { number: pr.number, url: pr.html_url, state: pr.state },
    },
  };
}
```

### Why timestamp-based branch names?

```javascript
const newBranch = `brand/css-tokens-${safeName}-${Date.now()}`;
// e.g. brand/css-tokens-aramark-1740456000000
```

Every publish creates a unique branch name. Without this, re-publishing the same brand would fail because the branch already exists. Using `Date.now()` (milliseconds since epoch) guarantees uniqueness on every call.

### The response the frontend receives:

```json
{
  "message": "CSS tokens published successfully",
  "brand": "aramark",
  "css_file": {
    "path": "brand/aramark.css",
    "variables": 10,
    "url": "https://github.com/myorg/my-eds-repo/blob/brand/css-tokens-aramark-1740456000000/brand/aramark.css"
  },
  "pull_request": {
    "number": 42,
    "title": "Brand tokens: update CSS variables for aramark",
    "url": "https://github.com/myorg/my-eds-repo/pull/42",
    "state": "open"
  }
}
```

---

## 9. Step 5 — The GitHub API Helpers

All GitHub interaction is handled through four pure utility functions in `actions/utils.js`, each wrapping a GitHub REST API v3 endpoint.

### Standard headers

```javascript
function buildGitHubHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}
```

### `getBranchSHA()` — Get the tip commit of a branch

```javascript
async function getBranchSHA(owner, repo, branch, token) {
  const fetch = require("node-fetch");
  const url = `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${branch}`;
  const res = await fetch(url, { headers: buildGitHubHeaders(token) });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      `Failed to get branch SHA for '${branch}': ${res.status} ${body.message}`,
    );
  }
  const data = await res.json();
  return data.object.sha; // the SHA we need to fork from
}
```

### `createBranch()` — Fork a new branch from a SHA

```javascript
async function createBranch(owner, repo, newBranch, sha, token) {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/refs`,
    {
      method: "POST",
      headers: buildGitHubHeaders(token),
      body: JSON.stringify({ ref: `refs/heads/${newBranch}`, sha }),
    },
  );
  if (!res.ok) throw new Error(`Failed to create branch '${newBranch}'`);
  return res.json();
}
```

### `createOrUpdateFile()` — Commit a file

This function handles both creating and updating a file. If the file already exists on the branch, the GitHub API requires its current SHA to update it — so we check first:

```javascript
async function createOrUpdateFile({
  owner,
  repo,
  branch,
  path,
  content,
  message,
  token,
}) {
  const headers = buildGitHubHeaders(token);

  // Check if file already exists (so we can pass its SHA for updates)
  const checkRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`,
    { headers },
  );
  const existingFile = checkRes.ok
    ? await checkRes.json().catch(() => null)
    : null;
  const existingSha = existingFile?.sha;

  const putBody = {
    message,
    content: Buffer.from(content, "utf8").toString("base64"), // must be base64
    branch,
  };
  if (existingSha) putBody.sha = existingSha; // required for updates

  const putRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
    { method: "PUT", headers, body: JSON.stringify(putBody) },
  );
  if (!putRes.ok) throw new Error(`Failed to create/update file '${path}'`);
  return putRes.json();
}
```

> **Note:** GitHub's Contents API requires file content to be Base64-encoded. `Buffer.from(content, 'utf8').toString('base64')` handles this cleanly in Node.js.

### `createPullRequest()` — Open a PR

```javascript
async function createPullRequest(owner, repo, head, base, title, body, token) {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/pulls`,
    {
      method: "POST",
      headers: buildGitHubHeaders(token),
      body: JSON.stringify({ title, body: body || "", head, base }),
    },
  );
  if (!res.ok) throw new Error(`Failed to create PR`);
  return res.json();
}
```

---

## 10. Step 6 — Authentication Design

This is one of the most nuanced parts of the project. We have two separate authentication concerns:

### 10.1 Adobe IMS Authentication (who can call the actions)

In `app.config.yaml`, each action declares:

```yaml
annotations:
  require-adobe-auth: true # or false
  final: true
```

When `require-adobe-auth: true`:

- The **Adobe I/O Runtime API Gateway** intercepts every request
- It validates the `Authorization: Bearer <token>` header against Adobe IMS
- Invalid or missing tokens get a `401 Unauthorized` — the action code is **never invoked**
- The action receives the validated IMS context in its parameters

When `require-adobe-auth: false`:

- Requests pass through to the action unconditionally
- Useful for actions that do their own auth check, or don't need IMS-level protection

Our action auth matrix:

| Action             | `require-adobe-auth` | Rationale                                             |
| ------------------ | -------------------- | ----------------------------------------------------- |
| `manage-tokens`    | `true`               | Token CRUD should require valid Adobe identity        |
| `publish-tokens`   | `true`               | Publishing to GitHub requires verified Adobe identity |
| `github-branch-pr` | `true`               | Prototype action — requires IMS auth                  |
| `publish-events`   | `true`               | I/O Events require IMS org context                    |
| `sample-app`       | `true`               | Boilerplate — protected by default                    |

> **Note about app.config.yaml vs ARCHITECTURE.md:** The `app.config.yaml` in this repository actually sets `require-adobe-auth: true` for all actions, including `manage-tokens` and `publish-tokens`. The ARCHITECTURE.md notes an earlier design where they were `false`. The current deployed config requires IMS auth for all actions.

The `final: true` annotation prevents these actions from being chained inside an OpenWhisk action sequence. Each action is a standalone, independently-callable endpoint.

### 10.2 IMS Token Handling in the Frontend

IMS credentials are stored in `localStorage` and attached to every action call as HTTP headers:

```javascript
const LS_IMS_TOKEN = "tokenManager.imsToken";
const LS_IMS_ORG = "tokenManager.imsOrgId";

function getAuthHeaders() {
  const token = localStorage.getItem(LS_IMS_TOKEN) || "";
  const orgId = localStorage.getItem(LS_IMS_ORG) || "";
  const headers = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (orgId) headers["x-gw-ims-org-id"] = orgId;
  return headers;
}
```

**Two ways to get an IMS token:**

**Mode 1 — Adobe Experience Cloud Shell (automatic):**

```javascript
function initRuntime() {
  const runtime = Runtime(); // @adobe/exc-app
  runtime.on("ready", ({ imsOrg, imsToken }) => {
    runtime.done();
    if (imsToken) localStorage.setItem(LS_IMS_TOKEN, imsToken);
    if (imsOrg) localStorage.setItem(LS_IMS_ORG, imsOrg);
    updateAuthBadge();
  });
}
```

When your app is loaded inside Adobe Experience Cloud, the shell automatically provides valid IMS credentials via the `@adobe/exc-app` SDK. Zero user interaction needed.

**Mode 2 — Standalone / Direct URL (manual):**
The app has a Settings panel (⚙ icon) where the user can manually enter their IMS Bearer token and Org ID. These are saved to `localStorage` on click and used for all subsequent action calls.

### 10.3 GitHub Token Security

The GitHub PAT flow is deliberately designed to never reach the browser:

```
.env file
  GITHUB_TOKEN=ghp_xxxxxxxxxxxx
      │
      ▼
app.config.yaml (server-side env var injection)
  inputs:
    GITHUB_TOKEN: $GITHUB_TOKEN
      │
      ▼  (injected as params.GITHUB_TOKEN at runtime)
actions/publish-tokens/index.js
  const { GITHUB_TOKEN } = params
      │
      ▼
GitHub REST API calls (server-side only)
```

The browser sends its IMS token (for Adobe auth), but never the GitHub PAT. Security maintained with zero extra infrastructure.

### 10.4 Auth Error Recovery

The frontend gracefully handles auth failures:

```javascript
function handleAuthError(err) {
  const msg = err.message || "";
  if (
    msg.includes("401") ||
    msg.includes("403") ||
    msg.includes("405") ||
    msg.includes("Unauthorized")
  ) {
    showToast(
      "Authentication required — click ⚙ to set your IMS token",
      "error",
    );
    openSettingsPanel(); // auto-opens the Settings panel
    return true;
  }
  return false;
}
```

When any action call returns a 401/403, the Settings panel automatically opens and prompts the user to re-enter their IMS token — a much better UX than a generic error message.

---

## 11. Step 7 — The Frontend SPA

The frontend is a **vanilla JavaScript single-page application** — no React, no Vue, no framework overhead. This keeps the App Builder bundle size small and the deployment fast.

### 11.1 The `actionWebInvoke()` helper

All action calls go through a thin `fetch` wrapper:

```javascript
async function actionWebInvoke(actionUrl, headers, params) {
  const response = await fetch(actionUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(params),
  });

  let content = await response.text();
  try {
    content = JSON.parse(content);
  } catch (e) {
    // keep as string if not JSON
  }

  if (!response.ok) {
    throw new Error(
      `Error invoking ${actionUrl}: [${response.status}] ${
        typeof content === "object" ? JSON.stringify(content) : content
      }`,
    );
  }
  return content;
}
```

Every UI function that talks to a backend action uses this wrapper:

```javascript
const res = await actionWebInvoke(
  getActionUrl("manage-tokens"), // resolves the action URL from config.json
  getAuthHeaders(), // attaches Bearer token + org ID headers
  { operation: "list" }, // body params
);
```

### 11.2 Schema-driven form generation

The token editor form is entirely dynamically generated from the schema — no hardcoded HTML for token fields:

```javascript
function buildCategoryForm(category) {
  const fields = state.schema[category];
  const form = document.createElement("div");
  form.className = "token-form";

  Object.entries(fields).forEach(([key, def]) => {
    const currentValue =
      state.tokens[category]?.[key] !== undefined
        ? state.tokens[category][key]
        : def.default;

    const row = document.createElement("div");
    row.className = "token-row";

    const label = document.createElement("label");
    label.textContent = def.label;

    let input;

    if (def.type === "color") {
      // Color type: render a colour picker + hex text input side by side
      const wrapper = document.createElement("div");
      wrapper.className = "color-input-wrapper";

      const colorPicker = document.createElement("input");
      colorPicker.type = "color";
      colorPicker.value = normalizeHex(currentValue);

      const hexText = document.createElement("input");
      hexText.type = "text";
      hexText.value = currentValue;

      colorPicker.addEventListener("input", () => {
        hexText.value = colorPicker.value;
        onTokenChange(category, key, colorPicker.value);
      });
      hexText.addEventListener("input", () => {
        onTokenChange(category, key, hexText.value.trim());
        if (/^#[0-9a-fA-F]{3,6}$/.test(hexText.value.trim())) {
          colorPicker.value = hexText.value.trim();
        }
      });

      wrapper.appendChild(colorPicker);
      wrapper.appendChild(hexText);
      input = wrapper;
    } else {
      // string/size: plain text input
      input = document.createElement("input");
      input.type = "text";
      input.value = currentValue;
      input.addEventListener("input", () =>
        onTokenChange(category, key, input.value),
      );
    }

    row.appendChild(label);
    row.appendChild(input);
    form.appendChild(row);
  });

  return form;
}
```

When a user edits any field, `onTokenChange()` fires immediately:

```javascript
function onTokenChange(category, key, value) {
  if (!state.tokens[category]) state.tokens[category] = {};
  state.tokens[category][key] = value;
  state.isDirty = true; // mark unsaved changes
  updateDirtyIndicator(); // highlight the Save button
  renderCssPreview(); // update live CSS preview instantly
}
```

### 11.3 Live CSS Preview

The CSS preview panel updates on every keystroke — zero latency, zero server calls:

```javascript
function renderCssPreview() {
  const flat = flattenObject(state.tokens); // client-side flattenObject
  const css = toCssVariables(flat, "--brand-"); // client-side toCssVariables

  // Update the <pre> display block
  document.getElementById("css-preview-code").textContent = css;

  // Also inject into a <style> tag so preview styles apply to the page itself
  let styleEl = document.getElementById("live-preview-style");
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = "live-preview-style";
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = css;
}
```

The CSS is not only shown in the preview panel — it's injected into the page's `<head>` as a `<style>` tag. If your UI uses the `--brand-*` variables for its own styling, you get a true live preview of how the brand would look.

### 11.4 The Publish Panel

When the user clicks **Publish**, a side panel slides in asking for the GitHub owner and repo:

```javascript
async function publishTokens() {
  const owner = document.getElementById("gh-owner").value.trim();
  const repo = document.getElementById("gh-repo").value.trim();
  const baseBranch =
    document.getElementById("gh-base-branch").value.trim() || "main";
  const targetBranch =
    document.getElementById("gh-target-branch").value.trim() || "main";

  if (!owner || !repo) {
    showToast("GitHub owner and repository are required", "error");
    return;
  }

  // Warn about unsaved changes
  if (state.isDirty) {
    const proceed = confirm("You have unsaved changes. Save them first?");
    if (proceed) {
      await saveTokens();
      if (state.isDirty) return; // save failed
    }
  }

  const resultEl = document.getElementById("publish-result");
  resultEl.innerHTML = '<span class="spinner"></span> Creating branch and PR…';

  try {
    const res = await actionWebInvoke(
      getActionUrl("publish-tokens"),
      getAuthHeaders(),
      {
        brandName: state.currentBrand,
        owner,
        repo,
        base_branch: baseBranch,
        target_branch: targetBranch,
      },
    );

    const pr = res.pull_request;
    resultEl.innerHTML = `
      <div class="publish-success">
        <strong>✓ Pull Request created!</strong><br>
        <a href="${pr.url}" target="_blank">${pr.url}</a><br>
        <small>${res.css_file.path} · ${res.css_file.variables} CSS variables</small>
      </div>
    `;
    showToast(`PR #${pr.number} created successfully`, "success");
  } catch (err) {
    resultEl.innerHTML = `<span class="publish-error">✗ ${err.message}</span>`;
  }
}
```

GitHub settings (owner, repo, branches) are persisted to `localStorage` so the user doesn't have to re-enter them every session.

---

## 12. Step 8 — App Configuration (`app.config.yaml`)

The `app.config.yaml` is the single configuration file that wires everything together. Here's the complete file:

```yaml
application:
  actions: actions
  web: web-src
  runtimeManifest:
    packages:
      AramarkEDSTaskrunner:
        license: Apache-2.0
        actions:
          manage-tokens:
            function: actions/manage-tokens/index.js
            web: "yes"
            runtime: nodejs:22
            inputs:
              LOG_LEVEL: debug
            annotations:
              require-adobe-auth: true
              final: true

          publish-tokens:
            function: actions/publish-tokens/index.js
            web: "yes"
            runtime: nodejs:22
            inputs:
              LOG_LEVEL: debug
              GITHUB_TOKEN: $GITHUB_TOKEN # ← injected from .env
            annotations:
              require-adobe-auth: true
              final: true

          github-branch-pr:
            function: actions/github-branch-pr/index.js
            web: "yes"
            runtime: nodejs:22
            inputs:
              LOG_LEVEL: debug
              GITHUB_TOKEN: $GITHUB_TOKEN
            annotations:
              require-adobe-auth: true
              final: true

          publish-events:
            function: actions/publish-events/index.js
            web: "yes"
            runtime: nodejs:22
            inputs:
              LOG_LEVEL: debug
              apiKey: $SERVICE_API_KEY # ← injected from .env
            annotations:
              require-adobe-auth: true
              final: true

          sample-app:
            function: actions/sample-app/index.js
            web: "yes"
            runtime: nodejs:22
            inputs:
              LOG_LEVEL: debug
            annotations:
              require-adobe-auth: true
              final: true
```

Key points to notice:

- **`function` field** — points to the action's entry file. Webpack bundles this file + its dependencies into a single minified JS file before deployment.
- **`web: "yes"`** — makes the action accessible via a public HTTPS URL (not just through the `aio` CLI).
- **`runtime: nodejs:22`** — specifies the Node.js runtime version on OpenWhisk.
- **`inputs`** — static or env-var values injected as action parameters. `$GITHUB_TOKEN` reads from the `.env` file at deploy time.
- **`require-adobe-auth: true`** — the gateway validates IMS tokens before the action runs.
- **`final: true`** — the action cannot be used as a step in an OpenWhisk sequence.

---

## 13. Step 9 — Local Development & Testing

### Running locally

```bash
# Option 1: UI local, actions deployed to I/O Runtime
aio app run
# UI: http://localhost:9080
# Actions: deployed at https://runtime.adobe.io/api/v1/web/...

# Option 2: Both UI and actions run locally
aio app dev
# Better for action debugging — no deploy needed on every change
```

The difference: `aio app run` deploys your actions to the real I/O Runtime and proxies them to your local UI. `aio app dev` runs everything locally, which is faster for iteration but doesn't use the real I/O State service.

### Unit tests

Tests use **Jest** and mock the Adobe SDK dependencies:

```bash
npm test
# or
aio app test
```

Example test for `manage-tokens`:

```javascript
// test/manage-tokens.test.js
const { main } = require("../actions/manage-tokens/index");

// Mock Adobe I/O State
jest.mock("@adobe/aio-lib-state", () => ({
  init: jest.fn().mockResolvedValue({
    get: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  }),
}));

test("list returns empty array when no brands exist", async () => {
  const stateLib = require("@adobe/aio-lib-state");
  stateLib.init.mockResolvedValue({
    get: jest.fn().mockResolvedValue(null),
    put: jest.fn(),
    delete: jest.fn(),
  });

  const result = await main({ operation: "list" });
  expect(result.statusCode).toBe(200);
  expect(result.body.brands).toEqual([]);
});
```

### E2E tests

```bash
npm run e2e
# or
aio app test --e2e
```

E2E tests call the actual deployed actions. You'll need a valid `.env` and the actions deployed.

### Direct CLI action invocation

You can invoke actions directly without the UI for quick testing:

```bash
# List all brands
aio rt action invoke AramarkEDSTaskrunner/manage-tokens \
  --param operation list \
  --result

# Save a brand
aio rt action invoke AramarkEDSTaskrunner/manage-tokens \
  --param operation save \
  --param brandName aramark \
  --param tokens '{"colors":{"primary":"#e87722"}}' \
  --result

# Publish tokens as a PR
aio rt action invoke AramarkEDSTaskrunner/publish-tokens \
  --param brandName aramark \
  --param owner myorg \
  --param repo my-eds-repo \
  --result

# List all deployed actions
aio rt action list
```

---

## 14. Step 10 — Deploying to Production

```bash
# Build and deploy everything in one command
aio app deploy
```

This single command:

1. Bundles each action file with Webpack (tree-shaking, minification)
2. Deploys all actions to Adobe I/O Runtime
3. Builds the frontend (HTML/CSS/JS)
4. Uploads the frontend to the Adobe CDN

After deployment you'll see output like:

```
✔ Deploying actions
  ✔ AramarkEDSTaskrunner/manage-tokens
  ✔ AramarkEDSTaskrunner/publish-tokens
  ✔ AramarkEDSTaskrunner/github-branch-pr
  ✔ AramarkEDSTaskrunner/publish-events
  ✔ AramarkEDSTaskrunner/sample-app

✔ Deploying web assets
  ✔ Deployed to CDN: https://your-namespace.adobeio-static.net/index.html

Your application is live at:
  https://your-namespace.adobeio-static.net/index.html
```

To undeploy (remove everything):

```bash
aio app undeploy
```

---

## 15. End-to-End Walk-through

Let's trace through the three main user flows from click to outcome.

### Flow 1 — Create a New Brand

```
1. User clicks [+ New Brand] button
   → openNewBrandModal() → shows modal with brand name input + clone-from selector

2. User types "Aramark Corp" and submits
   → safeName = "aramark-corp" (sanitised)
   → buildDefaultTokens(state.schema) → seeds tokens from schema defaults

3. POST manage-tokens { operation: "save", brandName: "aramark-corp", tokens: {...defaults} }
   →  Server: state.put("brand.aramark-corp", JSON.stringify(tokens), { ttl: 31536000 })
   →  Server: state.put("brand.index", JSON.stringify(["aramark-corp"]), { ttl: 31536000 })

4. UI updates:
   → "aramark-corp" appears in the left panel brand list
   → Token editor opens with default values
   → Live CSS preview renders --brand-* variables
```

### Flow 2 — Edit Tokens & Save

```
1. User is on the Colors tab, changes Primary Color from #e87722 to #ff0000
   → colorPicker input fires → onTokenChange("colors", "primary", "#ff0000")
   → state.tokens.colors.primary = "#ff0000"
   → state.isDirty = true → Save button highlights
   → renderCssPreview() → CSS preview instantly shows --brand-colors-primary: #ff0000;
   → <style> tag in <head> updates → any --brand-colors-primary usage on the page changes

2. User clicks [Save]
   → POST manage-tokens { operation: "save", brandName: "aramark-corp", tokens: state.tokens }
   → Server: state.put("brand.aramark-corp", JSON.stringify(tokens), { ttl: 31536000 })
   → state.isDirty = false → Save button returns to normal state
   → Toast: "Tokens saved successfully"
```

### Flow 3 — Publish as GitHub PR

```
1. User clicks [Publish]
   → openPublishPanel() → side panel slides in
   → User enters: owner = "myorg", repo = "my-eds-repo"
   → User clicks [Create PR]

2. POST publish-tokens {
     brandName: "aramark-corp",
     owner: "myorg",
     repo: "my-eds-repo",
     base_branch: "main",
     target_branch: "main"
   }

3. Server executes 6-step pipeline:
   Step 1: state.get("brand.aramark-corp") → loads token JSON
   Step 2: flattenObject(tokens) + toCssVariables() → generates CSS (10 variables)
   Step 3: GET /repos/myorg/my-eds-repo/git/ref/heads/main → sha = "abc123..."
   Step 4: POST /repos/myorg/my-eds-repo/git/refs
           → creates branch: brand/css-tokens-aramark-corp-1740456000000
   Step 5: PUT /repos/myorg/my-eds-repo/contents/brand/aramark-corp.css
           → commits brand/aramark-corp.css (base64 encoded) to new branch
   Step 6: POST /repos/myorg/my-eds-repo/pulls
           → PR #43 opened: "Brand tokens: update CSS variables for aramark-corp"

4. Response: { pull_request: { number: 43, url: "https://github.com/myorg/my-eds-repo/pull/43" } }

5. UI shows:
   ✓ Pull Request created!
   https://github.com/myorg/my-eds-repo/pull/43
   brand/aramark-corp.css · 10 CSS variables

6. Developer reviews PR, merges it
   → brand/aramark-corp.css lands on main branch
   → EDS site's next request for /brand/aramark-corp.css serves the new variables
   → Brand theming applied site-wide — zero rebuild required
```

---

## 16. Key Design Decisions & Lessons Learned

After building this, here are the decisions we'd make the same way again — and a few gotchas to watch out for.

### ✅ Adobe I/O State is the right choice for token storage

For JSON blobs under a few KB each (a brand token set is typically ~1–3 KB), I/O State is a perfect fit. No database provisioning, no connection management, no billing surprises. The 365-day TTL limitation is a non-issue for design tokens — you're updating them regularly anyway.

**Watch out for:** The `brand.index` pattern is simple but not atomic. If two users simultaneously save new brands, there's a theoretical race condition on updating the index. For a design token tool used by a small internal team, this is acceptable. For high-concurrency scenarios, you'd want a lock or a different indexing strategy.

### ✅ `flattenObject` / `toCssVariables` duplicated on client and server — intentional

Having the CSS generation logic on both the frontend (for live preview) and backend (for the authoritative GitHub commit) means:

- The preview is **instant** — no debounce, no server call
- The committed CSS is **identical** to what the user previewed

The downside: if you change the CSS generation logic, you must update it in two places. In this case, the benefit outweighs the DRY violation.

### ✅ Timestamp branch names prevent collision

`brand/css-tokens-${name}-${Date.now()}` ensures every publish creates a fresh branch. Alternative approaches (incrementing counters, checking branch existence and retrying) are more complex and prone to race conditions. The timestamp approach is simple and correct.

### ⚠️ GitHub Contents API requires Base64 encoding

Don't forget: when committing a file via the GitHub REST API, the `content` field must be Base64-encoded. `Buffer.from(css, 'utf8').toString('base64')` is the correct Node.js approach. Sending raw UTF-8 will result in a 422 Unprocessable Entity error.

### ⚠️ GitHub Contents API requires the file SHA for updates

If a file already exists on the branch you're writing to, you must include its current `sha` in the PUT request. Our `createOrUpdateFile()` function handles this automatically with a pre-check GET request.

### ✅ `final: true` is a good default

Unless you explicitly need OpenWhisk action chaining (which adds complexity), mark all your actions `final: true`. It makes your API surface explicit and prevents unintended composition.

### ✅ Vanilla JS keeps the bundle lean

App Builder's CDN deployment works best with small, fast-loading frontends. Vanilla JS with ES modules gives you everything you need for a token management UI without the overhead of a full framework. The tradeoff is more verbose DOM manipulation code — worth it for performance.

---

## 17. Conclusion & What's Next

You've built a fully functional, production-ready multi-brand CSS design token manager on Adobe App Builder. Here's what you have:

- **5 serverless actions** deployed on Adobe I/O Runtime (Node.js 22)
- **Persistent storage** in Adobe I/O State — no database, no ops
- **Full brand CRUD**: create, read, update, delete brand token sets
- **Live CSS preview** in the browser — instant, no round-trips
- **One-click GitHub PR** from stored tokens to a deployable CSS file
- **Dual auth model**: Adobe IMS for action access, GitHub PAT for repository writes
- **Schema-driven UI** — add new token categories by editing one JSON file

### What to build next

**Token versioning:** Store a `brand.<name>.history` array in I/O State and append a snapshot on each save. Let users roll back to a previous version.

**Multi-workspace support:** The current design stores tokens at the namespace level. Add a `workspace` concept so staging and production have separate token sets.

**Webhooks on PR merge:** Use Adobe I/O Events or a GitHub webhook to trigger a notification (Slack, Teams, email) when a brand PR is merged — closing the loop for the design team.

**Token diff on publish:** Before creating the PR, compare the new CSS against the last committed version and include the diff in the PR description. Makes reviews much faster.

**EDS integration test:** After merge, automatically fetch the committed CSS and validate that all expected variables are present. A lightweight GitHub Action could handle this.

---
