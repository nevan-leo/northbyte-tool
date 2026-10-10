'use client';

import ScenarioTool from './northbyte/ScenarioTool';

// The site is the NorthByte scenario tool. Nothing else belongs on it.
export default function Home() {
  return <main>
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brandmark">NB</span>
          <span><b>NorthByte</b><small>Profit scenario tool</small></span>
        </div>
        <div className="source">First Byte 2026 · FY25-26</div>
      </header>
    </div>
    <ScenarioTool />
  </main>;
}
