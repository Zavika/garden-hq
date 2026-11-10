import { Link } from "react-router-dom";

export function PublicPageLinks() {
  return (
    <nav aria-label="About" className="public-links">
      <Link to="/privacy">Privacy</Link> <Link to="/credits">Credits</Link>
    </nav>
  );
}
