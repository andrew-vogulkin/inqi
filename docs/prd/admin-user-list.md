# PRD — Admin User List & Suspension

**Feature codes:** HP-22 (backend), FE-18 (frontend)
**Status:** Draft
**Author:** (via Claude, 2026-07-13)
**Depends on:** existing `AdminGuard`, admin report-search stack, `AdminShell` nav.

---

## 1. Summary

A new admin-only screen at `/admin/users` that lists every registered account in a table, **sorted alphabetically by email by default**. Each row shows the user's identity and account state at a glance. Selecting a row reveals actions: **suspend / reactivate** the account, and **jump to that user's report list**. Suspension is a new, enforced account state — a suspended user cannot sign in or use the API until reactivated.

This is the first admin surface that treats *users* (not reports) as the primary object. It reuses the keyset-pagination + `AdminGuard` pattern already established by admin report-search.

## 2. Goals / Non-goals

**Goals**
- G1. Admins can browse all accounts, alphabetized by email, with search.
- G2. The table shows: **email, registration date, role, active/suspended status** (the four columns the user requested).
- G3. Selecting a user exposes a **Suspend** control (and **Reactivate** for already-suspended users).
- G4. From a selected user, an admin can **navigate to that user's reports**.
- G5. Suspension is *enforced*: a suspended account is blocked at auth (sign-in + every API call) until reactivated.

**Non-goals (this iteration)**
- Editing user profile fields (name, email), changing a user's role, or deleting accounts.
- Bulk suspend / multi-select. Selection is single-row.
- Credit management here — that already lives in the Credit Top-up screen (`/admin/topup`).
- Self-service account status for customers; this is an operator tool only.

## 3. Users & access

- **Actor:** admins only. Gated identically to every other admin page: FE via `ROUTE_META[...].adminOnly` → `resolveAccess` → Forbidden screen for non-admins; BE via `@UseGuards(AdminGuard)` (`backend/src/edge/auth/admin.guard.ts`), which 401s when unauthenticated and 403s when `user.role !== AuthRole.Admin`.
- An admin **cannot suspend their own account**, and cannot suspend another **admin** (guardrail against self-lockout / privilege fights). Enforced server-side; the FE hides/disables the control for these rows.

## 4. Data model changes

The `Customer` model (`backend/prisma/schema.prisma:132-149`) has **no** active/suspended field today. Add one.

```prisma
model Customer {
  // ... existing fields ...
  suspendedAt DateTime?   // HP-22: null = active; set = suspended (admin action)
  // (optional) suspendedReason String?
  // (optional) suspendedById  String?   // admin Customer.id who suspended
}
```

- **`suspendedAt: DateTime?`** — the single source of truth. `active` is a derived boolean: `suspendedAt === null`.
  - Chosen over a `status` string/enum because status here is genuinely binary and a timestamp also records *when* — useful in the audit trail. If a richer lifecycle (`pending`, `banned`, …) is ever needed, migrate to a `UserStatus` enum then.
- DB reset is dev-only per project convention, so this ships as a destructive `prisma db push` + reseed, not a production migration. Seed a couple of accounts with `suspendedAt` set so the FE has both states to render.
- No new shared enum strictly required. If we prefer an explicit label in DTOs, add `AccountStatus { Active: 'active', Suspended: 'suspended' }` to `packages/shared/src/enums.ts` (sibling of `AuthRole` at `:245`) and derive it from `suspendedAt` at the DTO boundary. **Recommendation:** add the enum — the FE status pill and tests read cleaner off a discriminant than off a nullable timestamp.

**Report linkage (for "navigate to user's reports"):** reports link to a customer by FK `Report.customerId` *and* by `Report.customerEmail` (a report can exist with only the email set before account linking; `schema.prisma:158-159,200`). Any "reports for this user" view and any report *count* must union both — `customerId == user.id` **OR** `customerEmail == user.email`.

## 5. Backend

### 5.1 New controller — `GET /admin/users`

New `AdminUsersController` in `backend/src/edge/auth/`, `@Controller('admin/users')`, `@UseGuards(AdminGuard)`. Mirrors `admin-report-search.controller.ts` exactly.

**Query DTO** (`user-search.dto.ts`, modeled on `report-search.dto.ts:7-19`):

```ts
class UserSearchQueryDto {
  q?: string;                    // case-insensitive contains over email + name
  status?: 'active' | 'suspended' | 'all';  // default 'all'
  limit?: number;                // IsInt, Min 1, Max 50, default 25
  cursor?: string;               // keyset cursor (see ordering note)
}
```

**Result DTO** (`{ rows: UserRowDto[]; nextCursor: string | null }`):

```ts
class UserRowDto {
  id: string;
  email: string;
  name: string | null;
  role: 'customer' | 'admin';
  registeredAt: string;      // Customer.createdAt (ISO)
  status: 'active' | 'suspended';
  suspendedAt: string | null;
  credits: number;           // handy context; cheap to include
  reportCount: number;       // union of customerId + customerEmail (see §4)
}
```

`reportCount` is a per-row aggregate — compute it in one grouped query keyed by both id and email rather than N+1 per row. If it proves expensive at scale, drop it to a lazy value fetched only for the selected row.

### 5.2 Ordering & pagination

- **Default order: `email ASC`** (the requested alphabetical default), tiebroken by `id ASC` for a stable keyset.
- Keyset cursor is the composite `(email, id)` of the last row, base64-encoded — *not* the report-search `createdAt`-desc cursor. Prisma: `orderBy: [{ email: 'asc' }, { id: 'asc' }]`, `cursor + skip: 1`, `take: limit + 1` to detect a next page (same take+1 trick as `report.repository.ts:60-76`).
- `q` filters with case-insensitive `contains` over `email` and `name`. `status` filters on `suspendedAt` null-ness.

### 5.3 Suspend / reactivate actions

Two admin-guarded mutations on the same controller:

- `POST /admin/users/:id/suspend` — body optional `{ reason?: string }`. Sets `suspendedAt = now()` (and reason/by if we keep those columns). Idempotent (suspending an already-suspended user is a no-op 200). **Rejects with 400/403** when: target is the acting admin, or target has `role === admin`.
- `POST /admin/users/:id/reactivate` — clears `suspendedAt = null`. Idempotent.

Both return the updated `UserRowDto`. Both write an **audit-trail** entry (privileged action) so it shows up in `/admin/audit` (`AuditTrail.tsx`) — action types e.g. `user.suspended` / `user.reactivated`, carrying actor + target + reason.

### 5.4 Enforcement (the part that makes suspension real)

Suspending must actually lock the account out, not just flip a flag:

- **Sign-in:** the two-step email/MFA sign-in must **deny** a suspended account after the code is verified — return a typed error (e.g. `AccountSuspendedError` → 403) instead of minting a session token. Message: "This account is suspended. Contact support."
- **Live sessions:** `AuthGuard` (`backend/src/edge/auth/auth.guard.ts`, which loads `req.user`) must reject when the underlying customer is suspended — 403 with the same typed error — so any token minted before suspension stops working immediately. This requires the guard to know suspension state; either (a) re-read the customer row in the guard, or (b) accept up-to-token-TTL staleness (8h) and only block at sign-in. **Recommendation:** (a) for suspend to take effect immediately; it's one indexed lookup already partly done for role.
- Realtime/WS connections keyed off the same session are dropped on next auth check.

### 5.5 Frontend API client

Add to `adminApi` (`frontend/src/api/endpoints.ts:58-77`):

```ts
searchUsers({ q, status, cursor, limit }) → GET /admin/users → UserSearchResultDto
suspendUser({ id, reason? })            → POST /admin/users/:id/suspend → UserRowDto
reactivateUser({ id })                  → POST /admin/users/:id/reactivate → UserRowDto
```

Types mirrored in `frontend/src/api/types.ts`; paths added to `Paths.*` in `@inqi/shared`.

## 6. Frontend

### 6.1 Route & shell wiring

- `routes.ts`: add `Route.AdminUsers = '/admin/users'` (`:8-31`) and a `ROUTE_META` entry `{ layout: LayoutMode.Admin, requiresAuth: true, adminOnly: true }` (`:53-63`).
- `App.tsx`: add a `content()` case `Route.AdminUsers → <AdminUsers/>` (`:95-121`).
- `AdminShell.tsx`: add a nav `Item` + `ACTIVE_KEY` entry (`:14-36`) — under the **Insight** group (alongside Audit), labeled "Users".

### 6.2 Screen — `AdminUsers.tsx`

Layout follows `AdminBoard.tsx`: a flex `<header>` (title "Users" + count pill on the left; a search input on the right) over the list body.

- **Rendered as a real `<table>`** (the user asked for a table; a `<table>` is the honest control for tabular, sortable, columnar data — unlike the card-row stacks AdminBoard uses). Reuse `CostReport.tsx`'s table styling as the in-repo `<table>` precedent (`borderCollapse`, `color.line` row borders, muted `<thead>`, `MonoRef` for figures).
- **Columns:** Email · Registered · Role · Status · (Reports count). Right-aligned numeric columns use `tabular-nums` / `MonoRef`.
  - **Status** renders as a tone pill (reuse `../ui/tone`): Active → neutral/brand tone; Suspended → danger tone.
  - **Role** renders as a subtle pill; admins visually distinguished.
  - **Registered** = `registeredAt` formatted (date only).
- **Default sort:** email ascending, as delivered by the API. (Column-header sort toggles are a nice-to-have; out of scope for v1 beyond the default.)
- **Search:** debounced input (reuse the 250ms `REPORT_SEARCH_DEBOUNCE_MS` convention) → `searchUsers({ q })`, resets the list.
- **Pagination:** cursor-based infinite scroll — append on scroll near list end, dedupe by `id`, track `nextCursor` (same shape as `ReportPicker.tsx:24-68`).
- **Status filter:** a small segmented control (All / Active / Suspended) → `status` query param. Optional for v1; include if cheap.
- **Loading/empty/error:** `<Skeleton>` rows while loading; a friendly empty state ("No users match"); `<ErrorState>` on failure.

### 6.3 Selection & actions

- Clicking a row **selects** it (highlighted row + `aria-selected`). Selection opens an **action bar / detail strip** (either a right-hand panel à la AdminBoard's aside, or an inline expanded row — **recommendation: a right sticky panel**, consistent with AdminBoard's `ActivityStream` aside).
- The panel shows the selected user's details and the controls:
  - **Suspend** (danger button) when active → confirm dialog ("Suspend {email}? They will be signed out and blocked from using inqi.") → `suspendUser({ id })` → optimistic row → `status: suspended`.
  - **Reactivate** (primary button) when suspended → `reactivateUser({ id })`.
  - The control is **hidden/disabled** when the selected row is the current admin or another admin (server enforces too; FE just avoids offering it).
  - **"View reports →"** link → navigates to the user's report list (§6.4).
- Confirm-gated, following the `RunControls.tsx` confirm pattern for destructive admin actions.

### 6.4 Navigate to the user's reports

Reuse the existing admin report-search rather than build a second report list. Options:

- **Recommended (low-cost):** "View reports →" routes to the admin board's report picker pre-seeded with the user's email as the search query — i.e. navigate to `/admin` (or `/admin/reports`-backed picker) with `?q=<email>`. Report-search already matches `customerEmail` (`report.repository.ts:61-69`), so this surfaces exactly their reports with zero new backend work.
- **Fuller (later):** a dedicated `Route.AdminUserReports = '/admin/users/:id/reports'` screen that calls a `GET /admin/users/:id/reports` endpoint (union of `customerId` + `customerEmail`). Only build this if the pre-filtered picker proves insufficient.

## 7. Telemetry / audit

- Every suspend/reactivate is a privileged action → audit-trail row (actor, target, reason, timestamp), visible in `/admin/audit`.
- Optionally record a `UsageRecord`-independent event; not required — the audit trail is the system of record here.

## 8. Testing

**Backend**
- Repo/service: alphabetical ordering by email; keyset pagination correctness across page boundaries; `q` filter; `status` filter; `reportCount` unions id + email (a report with only `customerEmail` set still counts).
- Controller: `AdminGuard` 401/403; suspend sets `suspendedAt`; reactivate clears it; idempotency; **self-suspend rejected**; **admin-target rejected**.
- Enforcement: suspended user's sign-in denied; suspended user's live token rejected by `AuthGuard`; reactivated user works again.

**Frontend**
- `AdminUsers` renders the four columns; default order is email-ascending; status pill tone matches state.
- Row select → action bar; Suspend confirm → optimistic status flip; controls hidden for self/admin rows.
- Non-admin hitting `/admin/users` → Forbidden screen (guard test).
- "View reports →" navigates with the email pre-filled.

## 9. Rollout & migration

- Dev-only DB reset: add `suspendedAt` (+ optional reason/by) → `prisma db push` → reseed with at least one suspended fixture.
- Shared build if the `AccountStatus` enum is added.
- Ship BE (model + endpoints + enforcement) and FE together; deploy to dev via the standard rsync + rebuild flow.

## 10. Open questions / decisions

| # | Question | Recommendation |
|---|---|---|
| Q1 | `suspendedAt` timestamp vs `status` enum column? | Timestamp (records when); add derived `AccountStatus` enum for DTO/FE clarity. |
| Q2 | Immediate lockout (guard re-reads customer) vs eventual (block only at sign-in, up to 8h token TTL)? | **Immediate** — suspend should mean suspend now. |
| Q3 | Keep `suspendedReason` / `suspendedById` columns? | Yes if cheap — makes the audit trail and support conversations far better. |
| Q4 | "View reports" = pre-filtered existing picker vs dedicated per-user route? | Start with the **pre-filtered picker** (zero new BE); build the dedicated route only if needed. |
| Q5 | Include `reportCount` / `credits` columns beyond the four requested? | Include as secondary columns — both are cheap and high-value context; can be hidden if the table feels busy. |
| Q6 | Column-header click-to-sort (name, registered, status)? | Out of scope for v1; email-asc default only. |
