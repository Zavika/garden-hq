import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useStoredData } from "../state/StorageProvider";
import { Footer } from "./Footer";
import { TabBar } from "./TabBar";

export function Layout() {
  const { link } = useStoredData();
  const { pathname: rawPathname } = useLocation();
  const pathname =
    rawPathname.length > 1 ? rawPathname.replace(/\/+$/, "") : rawPathname;
  const onLinkRoute = pathname === "/link";
  // Settings stays reachable while unlinked: a fresh device restores its
  // save there with a sync code, without needing a Hypixel link first.
  // /privacy and /credits are public notices, readable before linking.
  const onOpenRoute =
    pathname === "/settings" ||
    pathname === "/privacy" ||
    pathname === "/credits";

  if (link === null && !onLinkRoute && !onOpenRoute) {
    return <Navigate to="/link" replace />;
  }

  return (
    <div className={link !== null && !onLinkRoute ? "app with-tabs" : "app"}>
      <main className="main">
        <Outlet />
      </main>
      <Footer />
      {link !== null && !onLinkRoute ? <TabBar /> : null}
    </div>
  );
}
