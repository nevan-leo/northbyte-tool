'use client';

import { useMemo, useState } from 'react';

const routes = [
  { code: 'YVR → BNA', city: 'Vancouver to Nashville', demand: 70000, fare: 364, growth: 18.4, competitors: 0, distance: 2031, confidence: 82, score: 91, x: 68, y: 63 },
  { code: 'YVR → AUS', city: 'Vancouver to Austin', demand: 92000, fare: 331, growth: 14.2, competitors: 0, distance: 1871, confidence: 78, score: 88, x: 59, y: 74 },
  { code: 'YYZ → SAT', city: 'Toronto to San Antonio', demand: 81000, fare: 347, growth: 12.8, competitors: 0, distance: 1435, confidence: 86, score: 86, x: 57, y: 76 },
  { code: 'YUL → RDU', city: 'Montréal to Raleigh', demand: 64000, fare: 302, growth: 16.1, competitors: 0, distance: 714, confidence: 75, score: 83, x: 74, y: 65 },
];

const aircraft = {
  'A220-300': { seats: 137, range: 3450 },
  '737 MAX 8': { seats: 169, range: 3550 },
  'A321XLR': { seats: 182, range: 4700 },
};

export default function Home() {
  const [selected, setSelected] = useState(0);
  const [plane, setPlane] = useState<keyof typeof aircraft>('A220-300');
  const [frequency, setFrequency] = useState(4);
  const [loadFactor, setLoadFactor] = useState(85);
  const [capture, setCapture] = useState(38);
  const route = routes[selected];

  const model = useMemo(() => {
    const seats = aircraft[plane].seats * frequency * 52;
    const required = Math.round(seats * loadFactor / 100);
    const captured = Math.round(route.demand * capture / 100);
    const flown = Math.min(captured, seats);
    return {
      seats,
      captured,
      projectedLoad: Math.min(100, captured / seats * 100),
      revenue: flown * route.fare,
      breakEvenCapture: required / route.demand * 100,
    };
  }, [route, plane, frequency, loadFactor, capture]);

  const viable = model.projectedLoad >= loadFactor && aircraft[plane].range >= route.distance;

  return (
    <main>
      <header className="topbar">
        <div className="brand"><span className="brandmark">N</span><div><b>Northbound</b><small>Network intelligence</small></div></div>
        <nav><button className="active">Route lab</button><button>Network</button><button>Methodology</button></nav>
        <div className="source"><span /> 3 sources live</div>
      </header>

      <section className="hero">
        <div><p className="eyebrow">AIR CANADA · TRANSBORDER PLANNING</p><h1>Which route should<br />we launch next?</h1></div>
        <p className="intro">Explore underserved U.S.–Canada markets, pressure-test aircraft economics, and turn public aviation data into a defensible network decision.</p>
      </section>

      <section className="workspace">
        <aside className="rankings">
          <div className="sectionhead"><span>Candidate routes</span><button>Ranked by opportunity ↕</button></div>
          <div className="filterrow"><button className="pill active">All hubs</button><button className="pill">YVR</button><button className="pill">YYZ</button><button className="pill">YUL</button></div>
          <div className="routeList">
            {routes.map((item, index) => (
              <button key={item.code} className={`routeCard ${selected === index ? 'selected' : ''}`} onClick={() => setSelected(index)}>
                <span className="rank">{String(index + 1).padStart(2, '0')}</span>
                <span className="routeName"><b>{item.code}</b><small>{item.city}</small></span>
                <span className="score"><b>{item.score}</b><small>score</small></span>
              </button>
            ))}
          </div>
        </aside>

        <div className="mapPanel">
          <div className="mapLabel"><b>Opportunity map</b><span>○ Existing hub &nbsp; ● Candidate</span></div>
          <div className="mapCanvas">
            <div className="continent one"/><div className="continent two"/><div className="continent three"/>
            <span className="hub yvr">YVR</span><span className="hub yyz">YYZ</span><span className="hub yul">YUL</span>
            <div className="flightpath" style={{ left: '28%', top: '37%', width: `${route.x - 24}%`, transform: `rotate(${selected * 5 + 18}deg)` }} />
            {routes.map((item, index) => <button aria-label={`Select ${item.code}`} key={item.code} className={`destination ${selected === index ? 'on' : ''}`} style={{ left: `${item.x}%`, top: `${item.y}%` }} onClick={() => setSelected(index)}><span>{item.code.split(' → ')[1]}</span></button>)}
            <div className="mapStat"><small>Selected market</small><b>{route.code}</b><span>{route.demand.toLocaleString()} annual O&amp;D passengers</span></div>
          </div>
          <div className="metrics">
            <div><small>Latent demand</small><b>{(route.demand / 1000).toFixed(0)}K</b><span>annual pax</span></div>
            <div><small>Average fare</small><b>${route.fare}</b><span>one way</span></div>
            <div><small>Demand growth</small><b className="green">+{route.growth}%</b><span>year over year</span></div>
            <div><small>Nonstop rivals</small><b>{route.competitors}</b><span>current carriers</span></div>
          </div>
        </div>

        <aside className="simulator">
          <div className="sectionhead"><span>Route simulator</span><i>LIVE</i></div>
          <label>Aircraft<select value={plane} onChange={e => setPlane(e.target.value as keyof typeof aircraft)}>{Object.keys(aircraft).map(p => <option key={p}>{p}</option>)}</select></label>
          <Slider label="Weekly frequency" value={frequency} min={2} max={14} suffix=" flights" onChange={setFrequency}/>
          <Slider label="Target load factor" value={loadFactor} min={65} max={95} suffix="%" onChange={setLoadFactor}/>
          <Slider label="Expected market capture" value={capture} min={10} max={80} suffix="%" onChange={setCapture}/>
          <div className="results">
            <div><span>Annual capacity</span><b>{model.seats.toLocaleString()}</b></div>
            <div><span>Projected passengers</span><b>{model.captured.toLocaleString()}</b></div>
            <div><span>Projected load factor</span><b>{model.projectedLoad.toFixed(1)}%</b></div>
            <div><span>Directional revenue</span><b>${(model.revenue / 1e6).toFixed(1)}M</b></div>
            <div><span>Break-even capture</span><b>{model.breakEvenCapture.toFixed(1)}%</b></div>
          </div>
          <div className={`verdict ${viable ? 'go' : 'watch'}`}><span>{viable ? 'RECOMMENDATION · PROMISING' : 'RECOMMENDATION · PRESSURE TEST'}</span><p>{viable ? `${plane} service clears the ${loadFactor}% load target under this scenario.` : 'This scenario misses the target. Adjust frequency or capture assumptions.'}</p></div>
        </aside>
      </section>
      <footer><span>Sources: BTS T-100 · Statistics Canada · OurAirports</span><span>Directional screening model · Data confidence {route.confidence}%</span></footer>
    </main>
  );
}

function Slider({ label, value, min, max, suffix, onChange }: { label: string; value: number; min: number; max: number; suffix: string; onChange: (v: number) => void }) {
  const progress = (value - min) / (max - min) * 100;
  return <label className="slider"><span>{label}<b>{value}{suffix}</b></span><input aria-label={label} type="range" min={min} max={max} value={value} style={{ background: `linear-gradient(90deg,#d8ff5f ${progress}%,#303633 ${progress}%)` }} onChange={e => onChange(Number(e.target.value))}/><small>{min}{suffix}<i>{max}{suffix}</i></small></label>;
}
