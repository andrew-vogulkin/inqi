import { AccessScreen } from '../conventions/enums';
import { Route, hrefFor } from '../conventions/routes';
import { ErrorState } from '../ui';

/** 401 / 403 / 404 cross-cutting screens, rendered from the typed error envelope / guard. */
export function AccessScreenView({ screen }: { screen: AccessScreen }) {
  switch (screen) {
    case AccessScreen.SignInRequired:
      return <ErrorState title="Please sign in" message="You need to sign in to view this." action={<a href={hrefFor({ route: Route.SignIn })}>Go to sign in →</a>} />;
    case AccessScreen.Forbidden:
      return <ErrorState title="For operators" message="This area is limited to inqi operators." action={<a href={hrefFor({ route: Route.Home })}>Back to inqi →</a>} />;
    case AccessScreen.NotFound:
    default:
      return <ErrorState title="Can't find that inquiry" message="The page or inquiry you're looking for doesn't exist." action={<a href={hrefFor({ route: Route.Home })}>Back to inqi →</a>} />;
  }
}
