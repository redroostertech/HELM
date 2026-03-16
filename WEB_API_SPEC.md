# HELM Web Platform & API Specification

**For:** RedRooster Technologies Inc.
**Last Updated:** March 16, 2026

---

## Overview

The HELM web platform serves three purposes:

1. **Marketing site** — Landing page, pricing, product info
2. **User dashboard** — Account management, usage tracking, billing
3. **API backend** — Auth, licensing, usage sync for the HELM Electron app

The backend integrates with the existing RedRoosterTech-Web infrastructure and shares auth sessions between the web platform and the desktop app.

---

## Architecture

```
HELM Desktop App (Electron)
    │
    ├── Auth: JWT token stored in ~/.helm-license.json
    ├── On launch: POST /helm/api/license/validate
    ├── On AI call: POST /helm/api/usage/record
    └── On upgrade: Opens browser to /helm/pricing

RedRoosterTech-Web (Express/Node.js)
    │
    ├── /helm/                    ← Marketing pages
    ├── /helm/api/               ← REST API
    ├── MongoDB (helm database)  ← Users, subscriptions, usage
    └── Stripe                   ← Payment processing
```

---

## MongoDB Collections

### Database: `helm`

#### `helm_users`
```json
{
  "_id": "ObjectId",
  "email": "user@example.com",
  "passwordHash": "bcrypt...",
  "name": "John Doe",
  "tier": "free | byok | basic | pro",
  "stripeCustomerId": "cus_...",
  "createdAt": "2026-03-16T00:00:00Z",
  "lastLoginAt": "2026-03-16T00:00:00Z",
  "settings": {
    "aiProvider": "openai",
    "openaiModel": "gpt-4o"
  }
}
```

#### `helm_subscriptions`
```json
{
  "_id": "ObjectId",
  "userId": "ObjectId",
  "tier": "byok | basic | pro",
  "stripeSubscriptionId": "sub_...",
  "stripePriceId": "price_...",
  "status": "active | canceled | past_due | trialing",
  "currentPeriodStart": "2026-03-16T00:00:00Z",
  "currentPeriodEnd": "2026-04-16T00:00:00Z",
  "cancelAtPeriodEnd": false,
  "createdAt": "2026-03-16T00:00:00Z"
}
```

#### `helm_usage`
```json
{
  "_id": "ObjectId",
  "userId": "ObjectId",
  "month": "2026-03",
  "aiCalls": 42,
  "explains": 15,
  "chatMessages": 27,
  "lastRecordedAt": "2026-03-16T00:00:00Z"
}
```

#### `helm_sessions` (for analytics)
```json
{
  "_id": "ObjectId",
  "userId": "ObjectId",
  "appVersion": "0.1.0",
  "os": "darwin",
  "startedAt": "2026-03-16T00:00:00Z",
  "endedAt": "2026-03-16T01:00:00Z",
  "commandCount": 47
}
```

---

## API Endpoints

Base URL: `https://redroostertech.com/helm/api`

### Authentication

#### `POST /auth/register`
Create a new HELM account.

**Request:**
```json
{
  "email": "user@example.com",
  "password": "securepassword",
  "name": "John Doe"
}
```

**Response (200):**
```json
{
  "token": "eyJhbGciOi...",
  "user": {
    "id": "abc123",
    "email": "user@example.com",
    "name": "John Doe",
    "tier": "free"
  }
}
```

**Errors:** `400` validation, `409` email exists

---

#### `POST /auth/login`
Login to existing account.

**Request:**
```json
{
  "email": "user@example.com",
  "password": "securepassword"
}
```

**Response (200):**
```json
{
  "token": "eyJhbGciOi...",
  "user": {
    "id": "abc123",
    "email": "user@example.com",
    "name": "John Doe",
    "tier": "pro"
  }
}
```

**Errors:** `401` invalid credentials

---

#### `POST /auth/refresh`
Refresh an expiring JWT token.

**Headers:** `Authorization: Bearer <token>`

**Response (200):**
```json
{
  "token": "eyJhbGciOi...(new token)"
}
```

---

#### `GET /auth/me`
Get current user profile.

**Headers:** `Authorization: Bearer <token>`

**Response (200):**
```json
{
  "id": "abc123",
  "email": "user@example.com",
  "name": "John Doe",
  "tier": "pro",
  "subscription": {
    "status": "active",
    "currentPeriodEnd": "2026-04-16T00:00:00Z"
  }
}
```

---

### Licensing

#### `POST /license/validate`
Called by the desktop app on launch to validate the session.

**Headers:** `Authorization: Bearer <token>`

**Response (200):**
```json
{
  "valid": true,
  "tier": "pro",
  "expiresAt": "2026-04-16T00:00:00Z",
  "usage": {
    "aiCalls": 142,
    "aiCallsLimit": 2000,
    "resetDate": "2026-04-01T00:00:00Z"
  }
}
```

**Response (401):** Token expired or invalid — app should prompt re-login.

---

#### `POST /license/activate`
Activate a license from the desktop app (after purchase on web).

**Headers:** `Authorization: Bearer <token>`

**Request:**
```json
{
  "licenseKey": "HELM-PRO-xxxxx"
}
```

**Response (200):**
```json
{
  "valid": true,
  "tier": "pro",
  "expiresAt": "2026-04-16T00:00:00Z"
}
```

---

### Usage Tracking

#### `POST /usage/record`
Record AI usage from the desktop app. Called after each AI request.

**Headers:** `Authorization: Bearer <token>`

**Request:**
```json
{
  "type": "explain | chat | suggest",
  "model": "gpt-4o-mini",
  "tokensUsed": 450
}
```

**Response (200):**
```json
{
  "recorded": true,
  "usage": {
    "aiCalls": 143,
    "aiCallsLimit": 2000,
    "remaining": 1857
  }
}
```

**Response (429):** Usage limit exceeded.
```json
{
  "error": "limit_exceeded",
  "message": "Monthly AI request limit reached",
  "usage": {
    "aiCalls": 2000,
    "aiCallsLimit": 2000,
    "remaining": 0
  },
  "upgradeUrl": "https://redroostertech.com/helm/pricing"
}
```

---

#### `GET /usage/summary`
Get current month's usage summary.

**Headers:** `Authorization: Bearer <token>`

**Response (200):**
```json
{
  "month": "2026-03",
  "tier": "basic",
  "aiCalls": 342,
  "aiCallsLimit": 500,
  "remaining": 158,
  "breakdown": {
    "explains": 120,
    "chatMessages": 200,
    "suggests": 22
  },
  "resetDate": "2026-04-01T00:00:00Z"
}
```

---

### Billing (Stripe)

#### `POST /billing/create-checkout`
Create a Stripe checkout session. Called when user clicks "Upgrade" in the app or website.

**Headers:** `Authorization: Bearer <token>`

**Request:**
```json
{
  "tier": "byok | basic | pro"
}
```

**Response (200):**
```json
{
  "checkoutUrl": "https://checkout.stripe.com/c/pay/cs_..."
}
```

The app opens this URL in the system browser.

---

#### `POST /billing/portal`
Create a Stripe billing portal session for managing subscription.

**Headers:** `Authorization: Bearer <token>`

**Response (200):**
```json
{
  "portalUrl": "https://billing.stripe.com/p/session/..."
}
```

---

#### `POST /billing/webhook`
Stripe webhook endpoint. **No auth header** — verified via Stripe signature.

Handles events:
- `checkout.session.completed` — activate subscription, update user tier
- `invoice.paid` — renew subscription period
- `invoice.payment_failed` — set status to `past_due`
- `customer.subscription.deleted` — downgrade to free tier
- `customer.subscription.updated` — tier change

---

## Stripe Configuration

### Products & Prices

| Product | Stripe Price ID | Amount | Interval |
|---------|----------------|--------|----------|
| HELM BYOK | `price_helm_byok` | $2.99 | monthly |
| HELM Basic | `price_helm_basic` | $9.99 | monthly |
| HELM Pro | `price_helm_pro` | $12.99 | monthly |

### Webhook Events to Listen For
```
checkout.session.completed
invoice.paid
invoice.payment_failed
customer.subscription.deleted
customer.subscription.updated
```

---

## Web Pages

### Marketing Pages (Public)

| Route | Purpose |
|-------|---------|
| `/helm/` | Landing page — hero, features, social proof |
| `/helm/pricing` | Pricing table with Stripe checkout buttons |
| `/helm/features` | Detailed feature breakdown |
| `/helm/download` | Download .dmg with OS detection |

### Auth Pages

| Route | Purpose |
|-------|---------|
| `/helm/login` | Login form |
| `/helm/register` | Registration form |
| `/helm/forgot-password` | Password reset |

### Dashboard Pages (Authenticated)

| Route | Purpose |
|-------|---------|
| `/helm/dashboard` | Usage overview, current plan, quick actions |
| `/helm/dashboard/usage` | Detailed usage charts and history |
| `/helm/dashboard/billing` | Manage subscription (links to Stripe portal) |
| `/helm/dashboard/settings` | Account settings, API keys |

---

## Desktop App Integration

### How the App Connects to the Backend

1. **First launch:** App shows login/register prompt. User creates account on web or in-app.
2. **Auth flow:** App calls `/auth/login`, receives JWT, stores in `~/.helm-license.json`.
3. **On every launch:** App calls `/license/validate` to check tier and sync usage.
4. **On AI call:** App calls `/usage/record` after each successful AI request.
5. **On upgrade click:** App opens `https://redroostertech.com/helm/pricing` in system browser.
6. **After purchase:** Stripe webhook updates user tier. Next `/license/validate` call picks it up.

### Files to Update in HELM App

**`src/main/licensing.ts`** — Replace `validateWithBackend()` stub:
```typescript
private async validateWithBackend(email: string, licenseKey: string) {
  const response = await fetch('https://redroostertech.com/helm/api/license/activate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.license.token}`,
    },
    body: JSON.stringify({ licenseKey }),
  });
  return response.json();
}
```

**`src/main/main.ts`** — Add usage recording to AI handlers:
```typescript
// After successful AI call:
fetch('https://redroostertech.com/helm/api/usage/record', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  },
  body: JSON.stringify({ type: 'explain', model: 'gpt-4o-mini' }),
}).catch(() => {}); // fire and forget
```

---

## Environment Variables

### Backend (.env)
```
MONGO_URI=mongodb+srv://...
JWT_SECRET=helm-jwt-secret-change-me
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
HELM_OPENAI_KEY=sk-proj-...
```

### Desktop App (.env)
```
HELM_OPENAI_KEY=sk-proj-...
HELM_API_URL=https://redroostertech.com/helm/api
```

---

## Implementation Order

1. **MongoDB setup** — Create `helm` database and collections with indexes
2. **Auth endpoints** — Register, login, refresh, me
3. **Stripe setup** — Products, prices, webhook endpoint
4. **Billing endpoints** — Create checkout, portal, webhook handler
5. **License endpoints** — Validate, activate
6. **Usage endpoints** — Record, summary
7. **Marketing pages** — Landing, pricing, download
8. **Dashboard pages** — Usage, billing, settings
9. **Desktop app integration** — Wire licensing.ts to real API
10. **Testing** — End-to-end flow: register → subscribe → use AI → see usage

---

**HELM** — Powered by LANA AI
Copyright 2026 RedRooster Technologies Inc.
