import { ReactNode, useEffect, useState } from 'react';
import { AuthRole } from '@inqi/shared';
import { LayoutMode, AccessScreen, ButtonVariant } from './conventions/enums';
import { Route, RouteMatch, ROUTE_META, matchRoute, hrefFor, navigate, redirectToSignIn } from './conventions/routes';
import { resolveAccess } from './conventions/guard';
import { color, space, fontSize, fontWeight } from './theme/tokens';
import { setUnauthorizedHandler } from './api';
import { useAppDispatch, useSelector } from './state/store';
import { ActionType } from './state/actions';
import { Card, Button, ToastHost } from './ui';
import { StyleGuide } from './screens/StyleGuide';
import { SignIn } from './screens/SignIn';
import { Dashboard } from './screens/Dashboard';
import { NewInquiry } from './screens/NewInquiry';
import { Questionnaire } from './screens/Questionnaire';
import { LiveReport } from './screens/LiveReport';
import { FreemiumTeaser } from './screens/FreemiumTeaser';
import { Dossier } from './screens/Dossier';
import { Credits } from './screens/Credits';
import { AdminBoard } from './screens/AdminBoard';
import { AdminInquiryFrame } from './screens/AdminInquiryFrame';
import { RunControlsPanel } from './screens/RunControls';
import { CreditTopup } from './screens/CreditTopup';
import { SubtaskView } from './screens/SubtaskView';
import { CostReport } from './screens/CostReport';
import { AuditTrail } from './screens/AuditTrail';
import { WorkflowVersions } from './screens/WorkflowVersions';
import { OutreachThread } from './screens/OutreachThread';
import { DossierOrigin } from './conventions/enums';
import { Placeholder } from './screens/Placeholder';
import { AccessScreenView } from './screens/AccessScreens';
import { CustomerShell } from './shell/CustomerShell';
import { AdminShell } from './shell/AdminShell';

function useHashRoute(): string {
  const [hash, setHash] = useState(window.location.hash || '#/');
  useEffect(() => {
    const on = () => setHash(window.location.hash || '#/');
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash;
}

/** Bare frame for login-free routes (deep links, auth + access screens) — no app chrome;
 * each screen owns its own full-screen, centered layout (matching the prototype). */
function BareFrame({ children }: { children: ReactNode }) {
  return (
    <div style={{ minHeight: '100%', background: color.appBg }}>
      <main>{children}</main>
    </div>
  );
}

/** HP-24: a guarded route hit while signed out — bounce to Sign in carrying returnTo. */
function RequireAuthRedirect() {
  useEffect(() => { redirectToSignIn(); }, []);
  return <BareFrame><AccessScreenView screen={AccessScreen.SignInRequired} /></BareFrame>;
}

/** Operators don't use the customer area — bounce any customer-layout route to the console. */
function RedirectToAdmin() {
  useEffect(() => { navigate({ route: Route.Admin }); }, []);
  return <BareFrame><div /></BareFrame>;
}

/** Root (`/`) + any unknown route → the right home: operators to the console, customers to
 * the dashboard, signed-out to Sign in (where the role-aware default lands them after auth). */
function RedirectHome() {
  const session = useSelector((s) => s.session.session);
  useEffect(() => {
    if (!session) navigate({ route: Route.SignIn });
    else navigate({ route: session.customer.role === AuthRole.Admin ? Route.Admin : Route.Dashboard });
  }, [session]);
  return <BareFrame><div /></BareFrame>;
}

function Home() {
  return (
    <Card>
      <h1 style={{ fontSize: fontSize.h2, marginBottom: space[2] }}>Your AI is on it.</h1>
      <p style={{ color: color.muted, marginBottom: space[4] }}>
        Describe what you're after — an item, service, rental, org, goods or a trade — and inqi researches, vets, and reaches out, then returns a live ranked report.
      </p>
      <div style={{ display: 'flex', gap: space[2] }}>
        <a href={hrefFor({ route: Route.NewInquiry })}><Button>Start an inquiry</Button></a>
        <a href={hrefFor({ route: Route.StyleGuide })}><Button variant={ButtonVariant.Secondary}>Styleguide</Button></a>
      </div>
    </Card>
  );
}

function content(match: RouteMatch): ReactNode {
  switch (match.route) {
    case Route.Home: return <Home />;
    case Route.StyleGuide: return <StyleGuide />;
    case Route.SignIn: return <SignIn />;
    case Route.Dashboard: return <Dashboard />;
    case Route.NewInquiry: return <NewInquiry />;
    case Route.Questionnaire: return <Questionnaire token={match.params.token} />;
    case Route.Inquiry: return <LiveReport inquiryId={match.params.id} />;
    case Route.Freemium: return <FreemiumTeaser inquiryId={match.params.id} />;
    case Route.Dossier: return <Dossier inquiryId={match.params.id} optionRef={match.params.ref} origin={DossierOrigin.Customer} />;
    case Route.AdminDossier: return <Dossier inquiryId={match.params.id} optionRef={match.params.ref} origin={DossierOrigin.Admin} />;
    case Route.Report: return <LiveReport token={match.params.token} />;
    case Route.Credits: return <Credits />;
    case Route.Admin: return <AdminBoard />;
    case Route.AdminRun: return <AdminInquiryFrame title="Run controls" basePath="/admin/run">{({ board }) => <RunControlsPanel board={board} />}</AdminInquiryFrame>;
    case Route.AdminCostOverview: return <AdminInquiryFrame title="Cost per report" basePath="/admin/cost">{({ inquiryId }) => <CostReport inquiryId={inquiryId} />}</AdminInquiryFrame>;
    case Route.AdminCredits: return <CreditTopup />;
    case Route.AdminAudit: return <AuditTrail />;
    case Route.AdminWorkflows: return <WorkflowVersions />;
    case Route.AdminInquiry: return <AdminBoard inquiryId={match.params.id} />;
    case Route.AdminCost: return <CostReport inquiryId={match.params.id} />;
    case Route.AdminSubtask: return <SubtaskView subtaskId={match.params.id} />;
    case Route.AdminThread: return <OutreachThread subtaskId={match.params.id} />;
    default: return <Placeholder title="inqi" story="FE-02+" />;
  }
}

export function App() {
  const hash = useHashRoute();
  const dispatch = useAppDispatch();
  const session = useSelector((s) => s.session.session);
  const match = matchRoute(hash);

  // FE-02 / HP-24: a 401 anywhere clears the session + returns to Sign in, remembering
  // where to resume (returnTo) so an expired-session deep link continues after re-auth.
  useEffect(() => {
    setUnauthorizedHandler(() => { dispatch({ type: ActionType.SignedOut }); redirectToSignIn(); });
    return () => setUnauthorizedHandler(null);
  }, [dispatch]);

  let body: ReactNode;
  if (!match || match.route === Route.Home) {
    // Root + unknown routes → role-aware home (operator console / dashboard / sign-in).
    body = <RedirectHome />;
  } else {
    const meta = ROUTE_META[match.route];
    const access = resolveAccess({ meta, session });
    if (!access.allowed && access.screen) {
      // HP-24: a signed-out (401) deep link bounces to Sign in with returnTo; 403/404 keep their screen.
      body = access.screen === AccessScreen.SignInRequired
        ? <RequireAuthRedirect />
        : <BareFrame><AccessScreenView screen={access.screen} /></BareFrame>;
    } else if (meta.layout === LayoutMode.Customer && session?.customer.role === AuthRole.Admin) {
      // An operator on a customer-area route → straight to the console.
      body = <RedirectToAdmin />;
    } else {
      const inner = content(match);
      if (meta.layout === LayoutMode.Admin) body = <AdminShell active={match.route}>{inner}</AdminShell>;
      else if (meta.layout === LayoutMode.Customer) body = <CustomerShell active={match.route}>{inner}</CustomerShell>;
      else body = <BareFrame>{inner}</BareFrame>;
    }
  }

  return (<>{body}<ToastHost /></>);
}
