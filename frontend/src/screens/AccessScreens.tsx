import { ReactNode } from 'react';
import { AccessScreen } from '../conventions/enums';
import { Route, hrefFor } from '../conventions/routes';
import { space } from '../theme/tokens';
import { ErrorState } from '../ui';

/** Full-height centered wrapper so bare access screens sit in the middle (no app chrome). */
function Centered({ children }: { children: ReactNode }) {
  return (
    <div style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: space[6] }}>
      <div style={{ width: '100%', maxWidth: 460 }}>{children}</div>
    </div>
  );
}

/** 401 / 403 / 404 cross-cutting screens, rendered from the typed error envelope / guard. */
export function AccessScreenView({ screen }: { screen: AccessScreen }) {
  switch (screen) {
    case AccessScreen.SignInRequired:
      return <Centered><ErrorState title="Please sign in" message="You need to sign in to view this." action={<a href={hrefFor({ route: Route.SignIn })}>Go to sign in →</a>} /></Centered>;
    case AccessScreen.Forbidden:
      return <Centered><ErrorState title="For operators" message="This area is limited to inqi operators." action={<a href={hrefFor({ route: Route.Home })}>Back to inqi →</a>} /></Centered>;
    case AccessScreen.NotFound:
    default:
      return <Centered><ErrorState title="Can't find that inquiry" message="The page or inquiry you're looking for doesn't exist." action={<a href={hrefFor({ route: Route.Home })}>Back to inqi →</a>} /></Centered>;
  }
}
