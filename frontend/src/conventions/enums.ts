/**
 * Frontend enums (convention #1: no string literals — routes, statuses, modes,
 * event types, tokens are all enums/const-unions, re-imported). Domain enums come
 * from `@inqi/shared`; these are the FE-only ones.
 */

/** Which shell chrome a route renders in. */
export const LayoutMode = {
  Customer: 'customer', // mobile-first top bar
  Admin: 'admin',       // desktop-first console nav
  Bare: 'bare',         // no chrome: public deep links + auth/error screens
} as const;
export type LayoutMode = (typeof LayoutMode)[keyof typeof LayoutMode];

/** Semantic colour tone for badges/dots/pills → maps to a brand/status token. */
export const StatusTone = {
  Brand: 'brand',   // qualified / success / CTA
  Info: 'info',     // contacted / replied / links
  Muted: 'muted',   // queued / neutral
  Warn: 'warn',     // attention / 402 / soon
  Danger: 'danger', // error / bounce / cancelled
  Subtle: 'subtle', // disabled / placeholder
} as const;
export type StatusTone = (typeof StatusTone)[keyof typeof StatusTone];

/** Toast kinds (cross-cutting notices: reconnect, errors, confirmations). */
export const ToastKind = {
  Info: 'info',
  Success: 'success',
  Warn: 'warn',
  Danger: 'danger',
} as const;
export type ToastKind = (typeof ToastKind)[keyof typeof ToastKind];

/** Live-report layout (FE-06): three views over one report state. */
export const ReportLayout = {
  List: 'list',
  Split: 'split',
  Table: 'table',
} as const;
export type ReportLayout = (typeof ReportLayout)[keyof typeof ReportLayout];

/** Inquiry outreach variant (FE-11) — richer than the dossier's, incl. the 550 bounce. */
export const InquiryOutreachVariant = {
  Replied: 'replied',
  Contacted: 'contacted',
  Queued: 'queued',
  Bounced: 'bounced',     // 550 / undeliverable
  Suspended: 'suspended',
  Canceled: 'canceled',
  Error: 'error',
} as const;
export type InquiryOutreachVariant = (typeof InquiryOutreachVariant)[keyof typeof InquiryOutreachVariant];

/** Research dossier (FE-08): how deep inqi went on an option. */
export const ResearchDepth = {
  WebOnly: 'web_only',
  WebFeedback: 'web_feedback',
  WebOutreachFeedback: 'web_outreach_feedback',
} as const;
export type ResearchDepth = (typeof ResearchDepth)[keyof typeof ResearchDepth];

/** The research methods that produced data (drives the method badges). */
export const ResearchMethod = {
  WebSearch: 'web_search',
  Outreach: 'outreach',
  FeedbackScan: 'feedback_scan',
} as const;
export type ResearchMethod = (typeof ResearchMethod)[keyof typeof ResearchMethod];

/** Outreach step variant (FE-08 step 2). */
export const OutreachVariant = {
  Replied: 'replied',
  Pending: 'pending',
  NotContacted: 'not_contacted',
} as const;
export type OutreachVariant = (typeof OutreachVariant)[keyof typeof OutreachVariant];

/** Where the dossier was opened from — gates the outreach access boundary + Back target. */
export const DossierOrigin = {
  Customer: 'customer', // redacted outreach summary; never the admin chain
  Admin: 'admin',       // may show the full email chain
} as const;
export type DossierOrigin = (typeof DossierOrigin)[keyof typeof DossierOrigin];

/** Freemium teaser unlock state (FE-07). */
export const FreemiumState = {
  Locked: 'locked',
  Unlocking: 'unlocking',
  Unlocked: 'unlocked',
} as const;
export type FreemiumState = (typeof FreemiumState)[keyof typeof FreemiumState];

/**
 * Forward-looking report event types the reducer upserts options from. The current
 * backend re-assembles options server-side (snapshot refetch) and does not emit
 * these; the reducer supports them for when it does (and they're unit-tested).
 */
export const ReportEventType = {
  FindingAdded: 'finding.added',
  SnapshotUpdated: 'snapshot.updated',
} as const;
export type ReportEventType = (typeof ReportEventType)[keyof typeof ReportEventType];

/** Sign-in flow state (FE-02). Drives the two-step email → MFA-code form. */
export const AuthState = {
  SignedOut: 'signed_out', // resting (email step)
  SigningIn: 'signing_in', // a request is in flight (either step)
  CodeSent: 'code_sent',   // step 1 accepted — the MFA-code step is showing
  Error: 'error',          // re-enable + message
} as const;
export type AuthState = (typeof AuthState)[keyof typeof AuthState];

/** Generic async lifecycle for data slices. */
export const AsyncStatus = {
  Idle: 'idle',
  Loading: 'loading',
  Ready: 'ready',
  Error: 'error',
} as const;
export type AsyncStatus = (typeof AsyncStatus)[keyof typeof AsyncStatus];

/** Button visual variants. */
export const ButtonVariant = {
  Primary: 'primary',
  Secondary: 'secondary',
  Ghost: 'ghost',
  Danger: 'danger',
} as const;
export type ButtonVariant = (typeof ButtonVariant)[keyof typeof ButtonVariant];

/** Questionnaire capability-token state (FE-05). */
export const TokenState = {
  Loading: 'loading',
  Open: 'open',         // render the form
  Submitted: 'submitted', // success confirmation
  Expired: 'expired',   // friendly recovery
  NotFound: 'not_found',
} as const;
export type TokenState = (typeof TokenState)[keyof typeof TokenState];

/**
 * Form field control type (FE-05). Mirrors the backend question `type` wire values
 * (`confirm`/`text`/`select`) + a forward-looking `multiselect` for multi filters.
 */
export const FieldType = {
  Confirm: 'confirm',
  Text: 'text',
  Select: 'select',          // single-select
  MultiSelect: 'multiselect', // multi-select
} as const;
export type FieldType = (typeof FieldType)[keyof typeof FieldType];

/** Reserved questionnaire field ids the FE adds beyond the payload questions. */
export const QuestionnaireField = { Notes: 'notes' } as const;
export type QuestionnaireField = (typeof QuestionnaireField)[keyof typeof QuestionnaireField];

/** Map a wire `type` string to a FieldType (unknown → Text). */
export function fieldTypeFromWire(type: string): FieldType {
  switch (type) {
    case FieldType.Confirm: return FieldType.Confirm;
    case FieldType.Select: return FieldType.Select;
    case FieldType.MultiSelect: return FieldType.MultiSelect;
    default: return FieldType.Text;
  }
}

/** Which cross-cutting access screen to show. */
export const AccessScreen = {
  SignInRequired: 'signin_required', // 401
  Forbidden: 'forbidden',            // 403
  NotFound: 'not_found',             // 404
} as const;
export type AccessScreen = (typeof AccessScreen)[keyof typeof AccessScreen];
