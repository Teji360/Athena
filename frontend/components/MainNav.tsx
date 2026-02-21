import Link from "next/link";

const links = [
  { href: "/", label: "Globe" },
  { href: "/data", label: "Data" },
  { href: "/planning", label: "Planning" }
];

export default function MainNav() {
  return (
    <nav className="site-nav">
      <div className="site-nav-inner">
        <div className="site-brand">Athena</div>
        <div className="site-links">
          {links.map((link) => (
            <Link key={link.href} href={link.href} className="site-link">
              {link.label}
            </Link>
          ))}
        </div>
      </div>
    </nav>
  );
}
