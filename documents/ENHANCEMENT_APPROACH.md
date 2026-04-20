# Feasibility Study: Access Control, Role-Based Brand Visibility & AEM Integration

## AramarkEDSTaskrunner — Brand CSS Token Manager

This document evaluates three enhancements requested for the AramarkEDSTaskrunner application:

1. **Author Permissions** — Controlling who can access and use the app, using existing organisational user groups
2. **Brand-Level Data Visibility** — Ensuring individual brand managers see only their assigned brands, while administrators retain full visibility
3. **AEM Integration** — Surfacing the app as a tile within AEM Tools so brand managers can access it directly from their existing AEM workflow

**Overall Assessment: All three enhancements are fully feasible.** The application is built on Adobe App Builder, which natively supports all the required platform capabilities. The majority of the required identity and authentication infrastructure already exists within the organisation's Adobe Experience Cloud subscription. No new vendor relationships, external identity providers, or additional platform licenses are required.

---

## 1. Scope & Context

The AramarkEDSTaskrunner is an **Adobe App Builder** application that allows brand managers and developers to:

- Create and edit CSS design token sets (colours, typography, breakpoints) per brand
- Preview CSS variables live in the browser
- Publish brand token sets as Pull Requests to a GitHub repository, which feeds Adobe Edge Delivery Services (EDS) sites

The application currently allows any authenticated Adobe IMS user within the organisation to access all brands and all operations. The feedback requests that this be restricted based on role and brand assignment.

**Platform Foundation:**  
Adobe App Builder runs on top of Adobe's identity management infrastructure — **Adobe IMS (Identity Management System)** — the same system used for AEM, AEM as a Cloud Service, Adobe Analytics, and all other Adobe Experience Cloud products. This is the key enabler for all three requirements.

---

## 2. Current State

The application already satisfies the foundational requirement: **every request must carry a valid Adobe IMS token**. The enhancements build on this existing foundation.

---

## 3. Requirement 1 — Author Permissions Using Existing User Groups

### 3.1 Feasibility

**✅ Fully Feasible — using the same Adobe Admin Console already in use for AEM, DAM, and Cloud Manager.**

### 3.2 How Adobe IMS User Groups Work

Adobe IMS (Identity Management System) is the central identity platform for all Adobe Experience Cloud products. User access is controlled through **Product Profiles**, which are created and managed in the **Adobe Admin Console** (`adminconsole.adobe.com`) — the same console used today to manage AEM author access, DAM permissions, and Cloud Manager roles.

Each user can be assigned to one or more Product Profiles. When that user authenticates with any Adobe application, their assigned profiles (group memberships) are included in their IMS token and are accessible to any App Builder application in the same organisation.

### 3.3 Recommended Approach

**Create a dedicated set of Product Profiles** for the token manager application in the Adobe Admin Console:

| Product Profile Name                              | Intended Users                                        | Access Level                                                             |
| ------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------ |
| `EDS Token Manager - Administrator`               | Digital platform team, IT admins                      | Full access — all brands, all operations including permission management |
| `EDS Token Manager - Brand Manager - {BrandName}` | Individual brand teams (e.g., Aramark, FLIK, Bateman) | Access limited to their assigned brand(s) only                           |
| `EDS Token Manager - Viewer`                      | Stakeholders, approvers, read-only reviewers          | Read-only access — can view and preview CSS but cannot save or publish   |

**User assignment** is managed in the same Admin Console interface already used for AEM. No new tools are required. Adding or removing a user's brand access is a single action in the Admin Console.

### 3.4 How the App Reads Group Membership

When the application receives a request, it calls the **Adobe IMS Profile API** using the user's Bearer token:

```
GET https://ims-na1.adobelogin.com/ims/profile/v1
Authorization: Bearer <user's IMS token>
```

This returns the user's identity, including their Product Profile assignments:

```json
{
  "userId": "jsmith@aramark.com",
  "email": "jsmith@aramark.com",
  "displayName": "Jane Smith",
  "groups": [
    "EDS Token Manager - Brand Manager - Aramark",
    "AEM Authors - Publish"
  ]
}
```

The application backend checks this group list before allowing any operation.

### 3.5 Reusing Existing AEM/DAM Groups

If the organisation already has IMS groups like `AEM-Brand-Managers-Aramark` for AEM DAM access, those **exact same groups can be reused**. The token manager application simply needs to be configured to recognise those group names. No duplication of user management is required.

> **Decision required:** Should the app use new token-manager-specific profiles, or map to existing AEM/DAM groups? The technical approach supports both. Using existing groups minimises Admin Console overhead but couples the token manager's access model to AEM's model.

---

## 4. Requirement 2 — Brand-Level Data Visibility (RBAC)

### 4.1 Feasibility

**✅ Fully Feasible — implemented entirely within the existing application backend, no external services required.**

### 4.2 How It Works

The application stores brand tokens in **Adobe I/O State** (a managed key-value store). A new **permissions map** will be stored in the same state store, associating each brand with the group(s) permitted to access it:

```
permissions.index → {
  "aramark":   ["EDS Token Manager - Administrator", "EDS Token Manager - Brand Manager - Aramark"],
  "pepsi":     ["EDS Token Manager - Administrator", "EDS Token Manager - Brand Manager - Pepsi"],
  "bateman":   ["EDS Token Manager - Administrator", "EDS Token Manager - Brand Manager - Bateman"]
}
```

### 4.3 Access Control Flow

Every request to the application backend follows this permission evaluation:

```
User Request
      │
      ▼
1. Extract IMS Bearer token from request header
      │
      ▼
2. Call IMS Profile API → get user's group memberships
      │
      ▼
3. Load permissions map from I/O State
      │
      ├── Is user in "EDS Token Manager - Administrator"?
      │        Yes → Full access, skip further checks
      │
      ├── "List brands" operation?
      │        Filter brand list → return only brands where user's groups
      │        intersect with the brand's allowed groups
      │
      └── "Get / Save / Delete / Publish" operation?
               Check: does user's group have permission for this specific brand?
                   Yes → Proceed
                   No  → 403 Forbidden (access denied)
```

### 4.4 User Experience by Role

**Administrator:**

- Sees all brands in the left panel
- Can create, edit, delete any brand
- Has access to a Permissions Management panel to assign brands to groups
- Can publish any brand's tokens as a GitHub PR

**Brand Manager (e.g., Aramark team):**

- Sees only the brands they are assigned to
- Brands they do not have access to are not visible — they are never sent from the server
- Cannot see, edit, or publish any other brand's tokens
- No indication that other brands even exist (unless deliberately shown as a count)

**Viewer:**

- Sees brands they have been granted view access to
- Can open the token editor and preview the CSS
- Save and Publish buttons are disabled or hidden
- Cannot make any modifications

### 4.5 Security Model

**All enforcement is server-side.** The frontend UI hides irrelevant brands as a convenience, but the backend independently validates every request. Even if a technically sophisticated user attempted to call the backend API directly with another brand's name, the permission check would reject the request with a `403 Forbidden` response.

This means there is **no reliance on "security through obscurity"** in the frontend — the backend is the authoritative gatekeeper.

### 4.6 Permission Administration

A **Permissions Management panel** (visible only to Administrators) will be added to the application UI, allowing admins to:

- View current brand-to-group assignments
- Add or remove group access for a brand
- Create new brands and immediately assign them to groups

This eliminates the need to directly modify state store entries for routine permission changes.

---

## 5. Requirement 3 — AEM Tools Tile & Single Sign-On from AEM

### 5.1 Feasibility

**✅ Fully Feasible — this is a first-class, supported integration pattern for Adobe App Builder applications within the Adobe Experience Cloud.**

### 5.2 Single Sign-On (Already Effectively Working)

Because both AEM as a Cloud Service and this App Builder application use **Adobe IMS as their identity provider**, users who are logged into AEM are already authenticated with the same identity across the entire Experience Cloud.

When a user clicks a link from AEM to this application:

- The Experience Cloud Shell detects the active IMS session
- The `@adobe/exc-app` SDK (already integrated in this application) receives the user's IMS token automatically via a `ready` event
- The user lands in the token manager **already authenticated** — no second login prompt

**There is no additional SSO configuration required.** This is a native capability of the platform.

### 5.3 Option A — Adobe Experience Cloud Shell Tile (Recommended)

The application can be registered in the **Adobe Developer Console** as browsable within Experience Cloud. Once registered:

- The app appears as a named tile in the Experience Cloud app launcher (the grid/waffle icon at the top of every Experience Cloud product)
- Only users who have been assigned the relevant Product Profile see the tile — users without access simply do not see it
- Clicking the tile opens the app with SSO — no additional login

**Steps required:**

1. In the Adobe Developer Console, enable "App is browsable in Experience Cloud" for the App Builder project
2. Configure the app's display name, icon, and description (e.g., "Brand Token Manager")
3. Associate the app with the relevant Product Profile(s)
4. Users assigned to those profiles will see the tile on their next Experience Cloud login

**Effort:** Low — this is a configuration change in the Developer Console, no code changes required.

### 5.4 Option B — AEM Tools Navigation Tile

For users who spend their day primarily within AEM and want to access the token manager directly from the AEM Tools panel (the wrench/hammer icon), a custom tile can be added to the AEM admin navigation.

**How it works:**  
AEM as a Cloud Service's admin UI supports overlay nodes that add custom entries to the Tools navigation. A small configuration addition to the AEM project repository (the content package deployed to AEMaaCS) registers the tile:

- **Display Name:** Brand Token Manager
- **Icon:** Custom coral icon (code bracket, design token, or brand-appropriate)
- **Target URL:** The App Builder CDN deployment URL
- **Access Control:** Tile visibility can be restricted by AEM user group (e.g., only visible to users in `AEM-Brand-Manager-*` groups)

Clicking the tile opens the App Builder application in a new browser tab, with SSO continuity.

**Effort:** Low-to-medium — requires a configuration node addition to the AEM project and a deployment to AEMaaCS.

### 5.5 Navigation Flow (End State)

```
Brand Manager logs into AEM as a Cloud Service
      │
      ▼
Clicks the wrench/tools icon in AEM navigation
      │
      ▼
"Brand Token Manager" tile appears in AEM Tools
      │
      ▼
Clicks tile → App Builder application opens
      │
      ▼
User is automatically authenticated (shared IMS session)
      │
      ▼
Brand manager sees ONLY their assigned brands
(permission-filtered list from server)
      │
      ▼
Edits tokens → previews CSS → publishes PR
```

---

## 6. Implementation Roadmap

### Phase 1 — Author Permissions & IMS Integration

**Estimated Effort: 2–3 days**  
**Outcome:** All actions enforce IMS Product Profile membership. Only users with the correct profile can reach the application at all.

- [ ] Create Product Profiles in Adobe Admin Console
- [ ] Add IMS Profile API call utility to application backend
- [ ] Implement group membership extraction and caching
- [ ] Add permission check middleware to all backend actions
- [ ] Test access granted/denied scenarios

### Phase 2 — Brand-Level Role-Based Access Control

**Estimated Effort: 3–4 days**  
**Outcome:** Brand managers see only their brands. All enforcement is server-side.

- [ ] Define permission map data model and initialise in I/O State
- [ ] Update `manage-tokens` action to filter brand list by user permissions
- [ ] Update `manage-tokens` `get`/`save`/`delete` operations with brand-level checks
- [ ] Update `publish-tokens` action with brand-level permission checks
- [ ] Add `manage-permissions` admin action for permission CRUD
- [ ] Add Permission Management panel to frontend (admin-only)
- [ ] Unit tests for permission logic
- [ ] Integration testing with real IMS tokens across multiple roles

### Phase 3 — AEM Integration

**Estimated Effort: 1–2 days**  
**Outcome:** Tile visible in AEM Tools and Experience Cloud Shell for authorised users.

- [ ] Enable "browsable in Experience Cloud" in Developer Console
- [ ] Configure app display name, icon, and description
- [ ] Add AEM Tools tile node to AEM project content package
- [ ] Deploy and validate SSO flow from AEM → Token Manager
- [ ] Confirm users without profile assignment do not see the tile

### Phase 4 — Audit & Hardening (Optional, Recommended)

**Estimated Effort: 2–3 days**  
**Outcome:** Full audit trail of who changed what and when.

- [ ] Log all save and publish operations (user, brand, timestamp, operation) to Adobe I/O Events or I/O State audit log
- [ ] Admin UI panel showing recent activity per brand
- [ ] Automated alerts (via I/O Events → email/Slack) on publish to GitHub

---

## 7. Risk & Considerations

| Risk / Consideration                                                             | Likelihood | Impact | Mitigation                                                                                                                                                |
| -------------------------------------------------------------------------------- | ---------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| IMS Profile API latency adds overhead to every request                           | Medium     | Low    | Cache the profile response per IMS token for the duration of the session (token validity window). Profile data changes rarely during an active session.   |
| Race condition on permission map updates if two admins edit simultaneously       | Low        | Low    | Acceptable for initial release given small admin team. Version-locking on the permission state key can be added in Phase 4.                               |
| Brand names must match exactly between permission map and state keys             | Medium     | Medium | Permission map uses sanitised brand keys (lowercase kebab-case), consistent with how brand data is already stored. Admin UI enforces this.                |
| AEM Tools tile requires AEM project deployment                                   | Low        | Low    | Tile addition is a minimal configuration change. Can be included in the next AEM content package release.                                                 |
| Users with no profile assigned see a blank app rather than a helpful error       | Low        | Low    | Add a graceful "access denied" screen with contact information for provisioning requests.                                                                 |
| Product Profile names must be agreed and standardised before Admin Console setup | Medium     | Medium | Define naming convention early (e.g., `EDS Token Manager - {Role} - {Brand}`) and document it. Changing names later requires updating the permission map. |

---

### Key Points

1. **No new vendors or licenses required.** Every capability described in this document is included in the organisation's existing Adobe Experience Cloud subscription.

2. **The user group infrastructure already exists.** The same Adobe Admin Console used to manage AEM, DAM, and Cloud Manager access is used to manage access to this application. Brand manager provisioning follows the same process already in place.

3. **Security is enforced server-side.** Permission checks happen in the backend (Adobe I/O Runtime actions), not in the browser. A brand manager cannot access another brand's data even by calling the API directly.

4. **SSO from AEM is native, not configured.** Because both AEM and this application use Adobe IMS, the shared session means no second login is required. This works today when accessing the app via Experience Cloud Shell — the tile in AEM Tools makes this access path more visible and convenient.

5. **The app is already built for this.** The `require-adobe-auth: true` setting on all backend actions means every request already carries a validated IMS token. The Phase 1 and 2 work adds logic to inspect and act on that token's profile data — it does not change the authentication model.

### Recommended Next Steps

1. **Align on Product Profile naming convention** with the Admin Console administrator
2. **Agree on initial brand-to-group mapping** (which brand managers get access to which brands)
3. **Confirm AEM Tools tile approach** (Option A: Experience Cloud Shell, Option B: AEM Tools panel, or both)
4. **Proceed to Phase 1 implementation** — Author Permissions & IMS Integration
