import { ReactNode, useEffect, useState } from 'react';
import { LayoutMode, AccessScreen, ButtonVariant } from './conventions/enums';
import { Route, RouteMatch, ROUTE_META, matchRoute, hrefFor, navigate } from './conventions/routes';
import { resolveAccess } from './conventions/guard';
import { color, space, fontSize, fontWeight } from './theme/tokens';
import { setUnauthorizedHandler } from './api';
import { useAppDispatch, useSelector } from './state/store';
import { ActionType } from './state/actions';
import { Card, Button, ToastHost } from './ui';
import { StyleGuide } from './screens/StyleGuide';
import { SignIn } from './screens/SignIn';
import { Dashboard } from './screens/Dashboard';
import { Questionnaire } from './screens/Questionnaire';
import { LiveReport } from './screens/LiveReport';
import { FreemiumTeaser } from './screens/FreemiumTeaser';
import { Dossier } from './screens/Dossier';
import { Credits } from './screens/Credits';
import { AdminBoard } from './screens/AdminBoard';
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

/** Minimal frame for bare routes (public deep links, auth + access screens). */
function BareFrame({ children }: { children: ReactNode }) {
  return (
    <div style={{ minHeight: '100%' }}>
      <header style={{ borderBottom: `1px solid ${color.line}` }}>
        <div style={{ maxWidth: 760, margin: '0 auto', padding: `${space[3]}px ${space[4]}px` }}>
          <a href={hrefFor({ route: Route.Home })} style={{ fontSize: fontSize.h3, fontWeight: fontWeight.bold, color: color.ink, textDecoration: 'none' }}>inqi</a>
        </div>
      </header>
      <main style={{ maxWidth: 760, margin: '0 auto', padding: space[4] }}>{children}</main>
    </div>
  );
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
    case Route.NewInquiry: return <Placeholder title="New inquiry" story="FE-04" />;
    case Route.Questionnaire: return <Questionnaire token={match.params.token} />;
    case Route.Inquiry: return <LiveReport inquiryId={match.params.id} />;
    case Route.Freemium: return <FreemiumTeaser inquiryId={match.params.id} />;
    case Route.Dossier: return <Dossier inquiryId={match.params.id} optionRef={match.params.ref} origin={DossierOrigin.Customer} />;
    case Route.AdminDossier: return <Dossier inquiryId={match.params.id} optionRef={match.params.ref} origin={DossierOrigin.Admin} />;
    case Route.Report: return <LiveReport token={match.params.token} />;
    case Route.Credits: return <Credits />;
    case Route.Admin: return <AdminBoard />;
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

  // FE-02: a 401 anywhere clears the session + returns to Sign in.
  useEffect(() => {
    setUnauthorizedHandler(() => { dispatch({ type: ActionType.SignedOut }); navigate({ route: Route.SignIn }); });
    return () => setUnauthorizedHandler(null);
  }, [dispatch]);

  let body: ReactNode;
  if (!match) {
    body = <BareFrame><AccessScreenView screen={AccessScreen.NotFound} /></BareFrame>;
  } else {
    const meta = ROUTE_META[match.route];
    const access = resolveAccess({ meta, session });
    if (!access.allowed && access.screen) {
      body = <BareFrame><AccessScreenView screen={access.screen} /></BareFrame>;
    } else {
      const inner = content(match);
      if (meta.layout === LayoutMode.Admin) body = <AdminShell active={match.route}>{inner}</AdminShell>;
      else if (meta.layout === LayoutMode.Customer) body = <CustomerShell active={match.route}>{inner}</CustomerShell>;
      else body = <BareFrame>{inner}</BareFrame>;
    }
  }

  return (<>{body}<ToastHost /></>);
}
