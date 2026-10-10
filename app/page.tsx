'use client';

import ScenarioTool from './northbyte/ScenarioTool';

// The site is the NorthByte scenario tool. Nothing else belongs on it.
export default function Home() {
  return <main>
    <header className="topbar">
      <div className="brand">
        <span className="brandmark">N</span>
        <span><b>NorthByte</b><small>Profit scenario tool</small></span>
      </div>
      <div className="source"><span /> FY25-26 · 54 routes · First Byte 2026</div>
    </header>
    <ScenarioTool />
  </main>;
}
