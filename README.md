# journey

A desktop developer tool for testing multi-step API flows. Think Postman collections, but purpose-built for stateful journeys where each step's output feeds the next.

---

## The problem

Testing a payment flow end-to-end requires:
1. Hitting an entitlements endpoint to discover accounts and get a submission key
2. Using those accounts to call a fees endpoint
3. Submitting with the key from step 1 and the fees from step 2

In practice this means either: a Postman collection with fragile `pm.environment.set` scripts wiring state between requests, or a k6 load test script with hardcoded seed data and no interactive interface. Neither is great for day-to-day endpoint testing during development.

`journey` solves this with a single UI: pick a journey, fill in seed parameters (currency, amount, transfer type), hit Run, and watch each step execute in sequence with its response inline.

---

## What it is

- **Desktop-only** internal dev tool (~1200px minimum width)
- **Dark theme**, dense and technical — aimed at backend/API developers
- Three-panel layout: journey list → seed parameters form → live execution results
- Journeys defined as TypeScript config files (typed, refactorable, version-controlled)
- Steps execute sequentially; each step's extracted fields are available to all subsequent steps

---

## Key concepts

### Journey
A named sequence of API steps with a shared context. Defined in `src/journeys/`. Each journey declares its seed parameters (the inputs a developer fills in before running) and its steps.

### Seed parameters
The minimal set of inputs a developer chooses before running a journey:
- **Enum** — a set of choices rendered as toggle chips (e.g. currency, transfer type)
- **Number** — optional numeric input (e.g. amount; leave empty to use API-returned limits)
- **String** — free-text input (e.g. account reference)

### Step
One HTTP request. A step can:
- Build its path and body from seed values and the accumulated journey context
- Extract fields from the response and add them to context for downstream steps
- Be optional (skipped if a condition isn't met)

### Journey context
A plain object that accumulates as the journey runs. Step 1 might add `{ submissionKey, fromAccountUrl, businessDate }`; step 2 reads `fromAccountUrl` to build its request body; step 3 POSTs to `/transfer/${submissionKey}`.

---

## Journey catalog (planned)

| Journey | Steps | Description |
|---|---|---|
| Own Accounts Transfer — Same Currency | 3 | Entitlements → Fees → Submit |
| Own Accounts Transfer — Cross Currency | 3 | Entitlements → Exchange Rate → Submit |
| Third Party Transfer | 3 | Entitlements → Fees → Submit |
| International Transfer | 5 | Create Recipient → Entitlements → Fees → Submit → Cleanup |
| Bill Payment | 2 | Entitlements → Submit |
| Mobile Top-Up | 3 | Entitlements → Fees → Submit |
| Tax Payment | 4 | Entitlements → Account Types → Fees → Submit |
| Recipients CRUD | 5 | List → Create → Name Search → Edit → Delete |
| Credit Card Detail | 4 | Accounts → Card Detail → Transactions → Installments |

---

## Tech stack

| Layer | Choice | Reason |
|---|---|---|
| UI framework | React + TypeScript | Typed component model fits the journey config pattern |
| Build | Vite | Fast HMR, simple proxy config for CORS |
| Styling | Tailwind CSS | Easy to maintain a custom dark palette; no design system overhead |
| Primitives | Radix UI | Headless, accessible; no visual opinions to fight |
| State | Zustand | Lightweight; execution state (running steps, context accumulation) fits a single store slice |
| HTTP | fetch (native) | No extra dependency; Vite proxy handles CORS for local dev |
| Syntax highlight | Shiki or Prism | Token-based highlighting for the JSON result panes |

---

## Project structure

```
src/
  journeys/          # Journey definitions (TypeScript config)
    index.ts         # Re-exports all journeys
    ownAccounts.ts
    thirdParty.ts
    international.ts
    ...
  types/             # Core types: Journey, Step, SeedParam, JourneyContext
  components/
    Sidebar/         # Journey list
    SeedForm/        # Parameter form
    Execution/       # Results panel + step cards
    shared/          # Reusable primitives (Chip, JsonViewer, StatusDot, ...)
  store/             # Zustand store (selected journey, seed values, run state)
  lib/
    runner.ts        # Journey executor — iterates steps, builds requests, accumulates context
    http.ts          # Thin fetch wrapper (auth headers, base URL, error normalisation)
    token.ts         # Token acquisition and per-session caching
vite.config.ts       # Proxy rules per target service
```

---

## Running locally

```bash
npm install
npm run dev        # Vite dev server at http://localhost:5173
```

The Vite proxy is configured in `vite.config.ts`. Each service has a named proxy rule (e.g. `/api/accounts` → `https://accounts.your-env.internal`). Set the target URLs in a `.env.local` file.

---

## Adding a journey

1. Create `src/journeys/myJourney.ts` — implement the `Journey` interface
2. Export it from `src/journeys/index.ts`
3. The sidebar picks it up automatically (journeys list is just the exported array)

A minimal journey looks like:

```typescript
import type { Journey } from '../types'

export const myJourney: Journey = {
  id: 'my-journey',
  name: 'My Journey',
  description: 'Does X then Y then Z',
  seedParams: [
    {
      id: 'currency',
      label: 'Currency',
      type: 'enum',
      options: ['BBD', 'USD', 'TTD'],
      defaultValue: 'BBD',
      required: true,
    },
    {
      id: 'amount',
      label: 'Amount',
      type: 'number',
      placeholder: 'Leave empty to use entitlement limits',
    },
  ],
  steps: [
    {
      name: 'Fetch entitlements',
      method: 'POST',
      path: () => '/api/v1/transfers',
      body: ({ seed }) => ({ currency: seed.currency }),
      extract: (res) => ({
        submissionKey: res.data.key,
        fromAccountUrl: res.data.accounts.find((a) => a.type === 'SAVINGS')?.url,
      }),
    },
    {
      name: 'Submit transfer',
      method: 'POST',
      path: ({ ctx }) => `/api/v1/transfers/${ctx.submissionKey}`,
      body: ({ seed, ctx }) => ({
        from_account: ctx.fromAccountUrl,
        amount: seed.amount,
      }),
    },
  ],
}
```
