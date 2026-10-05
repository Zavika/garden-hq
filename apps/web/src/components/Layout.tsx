import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useStoredData } from "../state/StorageProvider";
import { Footer } from "./Footer";
import { TabBar } from "./TabBar";

export function Layout() {
  const { link } = useStoredData();
  const { pathname } = useLocation();
  const onLinkRoute = pathname === "/link";

  if (link === null && !onLinkRoute) return <Navigate to="/link" replace />;

  return (
    <div className="app">
      <main className="main">
        <Outlet />
      </main>
      <Footer />
      {link !== null && !onLinkRoute ? <TabBar /> : null}
    </div>
  );
}
