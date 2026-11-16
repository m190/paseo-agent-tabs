import { type OpenerProps, Openers } from "./opener";
import { RouteAnchor } from "./route";

/** What each top-level view of the plugin needs from the app: its route (to highlight) and its functions to open a tab. */
export function AppAnchor(props: OpenerProps) {
  return (
    <>
      <RouteAnchor />
      <Openers {...props} />
    </>
  );
}
