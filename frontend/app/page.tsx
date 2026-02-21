import AthenaGlobe from "@/components/AthenaGlobe";

export default function HomePage() {
  return (
    <main className="page">
      <header className="topbar">
        <h1>Project Athena</h1>
        <p>Global humanitarian intelligence (green/yellow/red)</p>
      </header>
      <section className="map-wrap">
        <AthenaGlobe />
      </section>
    </main>
  );
}
