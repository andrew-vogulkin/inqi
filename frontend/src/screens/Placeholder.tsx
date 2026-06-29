import { Route, hrefFor } from '../conventions/routes';
import { EmptyState, Button } from '../ui';

/** Foundation placeholder for feature routes (real screens land in FE-02+). */
export function Placeholder({ title, story }: { title: string; story: string }) {
  return (
    <EmptyState
      title={title}
      hint={`Coming in ${story}. The foundation (shell, tokens, api/socket/reducers) is in place.`}
      action={<a href={hrefFor({ route: Route.StyleGuide })}><Button>View styleguide</Button></a>}
    />
  );
}
