import Link from "next/link";
import type { ReactNode } from "react";

const links = [
  { href: "/", label: "Globe" },
  { href: "/data", label: "Data" },
  { href: "/planning", label: "Planning" },
  { href: "/settings", label: "Settings" }
];

export default function MainNav({ children }: { children?: ReactNode }) {
  return (
    <nav className="site-nav">
      <div className="site-nav-inner">
        <div className="site-brand">Project Angel</div>
        <div className="site-links">
          {links.map((link) => (
            <Link key={link.href} href={link.href} className="site-link">
              {link.label}
            </Link>
          ))}
          {children}
        </div>
      </div>
    </nav>
  );
}
