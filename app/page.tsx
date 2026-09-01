'use client';

import { useMemo, useState } from 'react';
import RouteMap, { type RouteRecord } from './RouteMap';

type Route = RouteRecord & { city: string; demand: number; fare: number; growth: number; competitors: number; distance: number; confidence: number; score: number };

const routes: Route[] = [
  { code: 'YVR → BNA', originCode: 'YVR', destinationCode: 'BNA', origin: [-123.184, 49.194], destination: [-86.678, 36.126], city: 'Vancouver to Nashville', demand: 70000, fare: 364, growth: 18.4, competitors: 0, distance: 2031, confidence: 82, score: 91 },
  { code: 'YVR → AUS', originCode: 'YVR', destinationCode: 'AUS', origin: [-123.184, 49.194], destination: [-97.669, 30.197], city: 'Vancouver to Austin', demand: 92000, fare: 331, growth: 14.2, competitors: 0, distance: 1871, confidence: 78, score: 88 },
  { code: 'YYZ → SAT', originCode: 'YYZ', destinationCode: 'SAT', origin: [-79.624, 43.677], destination: [-98.469, 29.534], city: 'Toronto to San Antonio', demand: 81000, fare: 347, growth: 12.8, competitors: 0, distance: 1435, confidence: 86, score: 86 },
  { code: 'YUL → RDU', originCode: 'YUL', destinationCode: 'RDU', origin: [-73.741, 45.470], destination: [-78.787, 35.880], city: 'Montréal to Raleigh', demand: 64000, fare: 302, growth: 16.1, competitors: 0, distance: 714, confidence: 75, score: 83 },
  { code: 'YYC → PIT', originCode: 'YYC', destinationCode: 'PIT', origin: [-114.021, 51.121], destination: [-80.233, 40.491], city: 'Calgary to Pittsburgh', demand: 58000, fare: 389, growth: 11.7, competitors: 0, distance: 1735, confidence: 73, score: 79 },
  { code: 'YVR → CMH', originCode: 'YVR', destinationCode: 'CMH', origin: [-123.184, 49.194], destination: [-82.891, 39.998], city: 'Vancouver to Columbus', demand: 55000, fare: 375, growth: 13.6, competitors: 0, distance: 2038, confidence: 71, score: 77 },
];

const aircraft = { 'A220-300': { seats: 137, range: 3450 }, '737 MAX 8': { seats: 169, range: 3550 }, 'A321XLR': { seats: 182, range: 4700 } };

export default function Home() {
  const [view, setView] = useState<'lab' | 'network' | 'methodology'>('lab');
  const [selected, setSelected] = useState(0);
  const [hub, setHub] = useState('All');
  const [plane, setPlane] = useState<keyof typeof aircraft>('A220-300');
  const [frequency, setFrequency] = useState(4);
  const [loadFactor, setLoadFactor] = useState(85);
  const [capture, setCapture] = useState(38);
  const route = routes[selected];
  const visibleRoutes = hub === 'All' ? routes : routes.filter(item => item.originCode === hub);

  const model = useMemo(() => {
    const seats = aircraft[plane].seats * frequency * 52;
    const required = Math.round(seats * loadFactor / 100);
    const captured = Math.round(route.demand * capture / 100);
    const flown = Math.min(captured, seats);
    return { seats, captured, projectedLoad: Math.min(100, captured / seats * 100), revenue: flown * route.fare, breakEvenCapture: required / route.demand * 100 };
  }, [route, plane, frequency, loadFactor, capture]);
  const viable = model.projectedLoad >= loadFactor && aircraft[plane].range >= route.distance;

  return <main>
    <header className="topbar">
      <button className="brand" onClick={() => setView('lab')}><span className="brandmark">N</span><span><b>Northbound</b><small>Network intelligence</small></span></button>
      <nav>{[['lab','Route lab'],['network','Network'],['methodology','Methodology']].map(([id,label]) => <button key={id} className={view === id ? 'active' : ''} onClick={() => setView(id as typeof view)}>{label}</button>)}</nav>
      <div className="source"><span /> 3 sources connected</div>
    </header>

    {view === 'lab' && <>
      <Hero eyebrow="AIR CANADA · TRANSBORDER PLANNING" title={<>Which route should<br />we launch next?</>} copy="Explore underserved U.S.–Canada markets, pressure-test aircraft economics, and turn public aviation data into a defensible network decision." />
      <section className="workspace">
        <aside className="rankings">
          <div className="sectionhead"><span>Candidate routes</span><small>OPPORTUNITY SCORE</small></div>
          <div className="filterrow">{['All','YVR','YYZ','YUL','YYC'].map(item => <button key={item} className={`pill ${hub === item ? 'active' : ''}`} onClick={() => setHub(item)}>{item === 'All' ? 'All hubs' : item}</button>)}</div>
          <div className="routeList">{visibleRoutes.map(item => { const index = routes.indexOf(item); return <button key={item.code} className={`routeCard ${selected === index ? 'selected' : ''}`} onClick={() => setSelected(index)}><span className="rank">{String(index + 1).padStart(2, '0')}</span><span className="routeName"><b>{item.code}</b><small>{item.city}</small></span><span className="score"><b>{item.score}</b><small>score</small></span></button> })}</div>
        </aside>
        <div className="mapPanel">
          <div className="mapLabel"><b>Live opportunity map</b><span>Drag · scroll to zoom · click an airport</span></div>
          <div className="mapWrap"><RouteMap routes={routes} selected={selected} onSelect={setSelected}/><div className="mapStat"><small>Selected market</small><b>{route.code}</b><span>{route.demand.toLocaleString()} annual O&amp;D passengers</span></div></div>
          <Metrics route={route}/>
        </div>
        <Simulator route={route} plane={plane} setPlane={setPlane} frequency={frequency} setFrequency={setFrequency} loadFactor={loadFactor} setLoadFactor={setLoadFactor} capture={capture} setCapture={setCapture} model={model} viable={viable}/>
      </section>
    </>}

    {view === 'network' && <NetworkView selected={selected} setSelected={setSelected}/>} 
    {view === 'methodology' && <Methodology/>}
    <footer><span>Sources: BTS T-100 · Statistics Canada · OurAirports</span><span>Directional screening model · Prototype data</span></footer>
  </main>;
}

function Hero({ eyebrow, title, copy }: { eyebrow: string; title: React.ReactNode; copy: string }) { return <section className="hero"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1></div><p className="intro">{copy}</p></section> }

function Metrics({ route }: { route: Route }) { return <div className="metrics"><div><small>Latent demand</small><b>{(route.demand/1000).toFixed(0)}K</b><span>annual pax</span></div><div><small>Average fare</small><b>${route.fare}</b><span>one way</span></div><div><small>Demand growth</small><b className="green">+{route.growth}%</b><span>year over year</span></div><div><small>Nonstop rivals</small><b>{route.competitors}</b><span>current carriers</span></div></div> }

function Simulator({ route, plane, setPlane, frequency, setFrequency, loadFactor, setLoadFactor, capture, setCapture, model, viable }: any) { return <aside className="simulator"><div className="sectionhead"><span>Route simulator</span><i>LIVE</i></div><label>Aircraft<select value={plane} onChange={e => setPlane(e.target.value)}>{Object.keys(aircraft).map(p => <option key={p}>{p}</option>)}</select></label><Slider label="Weekly frequency" value={frequency} min={2} max={14} suffix=" flights" onChange={setFrequency}/><Slider label="Target load factor" value={loadFactor} min={65} max={95} suffix="%" onChange={setLoadFactor}/><Slider label="Expected market capture" value={capture} min={10} max={80} suffix="%" onChange={setCapture}/><div className="results"><div><span>Annual capacity</span><b>{model.seats.toLocaleString()}</b></div><div><span>Projected passengers</span><b>{model.captured.toLocaleString()}</b></div><div><span>Projected load factor</span><b>{model.projectedLoad.toFixed(1)}%</b></div><div><span>Directional revenue</span><b>${(model.revenue/1e6).toFixed(1)}M</b></div><div><span>Break-even capture</span><b>{model.breakEvenCapture.toFixed(1)}%</b></div></div><div className={`verdict ${viable?'go':'watch'}`}><span>{viable?'RECOMMENDATION · PROMISING':'RECOMMENDATION · PRESSURE TEST'}</span><p>{viable?`${plane} service clears the ${loadFactor}% load target for ${route.code}.`:'This scenario misses the target. Adjust frequency or capture assumptions.'}</p></div></aside> }

function NetworkView({ selected, setSelected }: { selected: number; setSelected: (index: number) => void }) { const route = routes[selected]; return <section className="viewPage"><Hero eyebrow="NETWORK OVERVIEW" title={<>See the whole<br />opportunity set.</>} copy="Explore every modeled transborder candidate on a real basemap. Click any airport or table row to move it into focus."/><div className="networkGrid"><div className="networkMap"><RouteMap routes={routes} selected={selected} onSelect={setSelected} networkMode/><div className="networkLegend"><b>{route.code}</b><span>Selected · score {route.score}</span></div></div><div className="networkTable"><div className="sectionhead"><span>All candidates</span><small>{routes.length} ROUTES</small></div>{routes.map((item,index)=><button key={item.code} className={selected===index?'selected':''} onClick={()=>setSelected(index)}><b>{item.code}</b><span>{(item.demand/1000).toFixed(0)}K pax</span><span>+{item.growth}%</span><em>{item.score}</em></button>)}</div></div></section> }

function Methodology() { return <section className="viewPage"><Hero eyebrow="MODEL METHODOLOGY" title={<>From public data<br />to a route decision.</>} copy="A transparent screening framework—not a black box profitability forecast. Every metric, assumption, and limitation stays visible."/><div className="methodGrid"><article><span>01</span><h2>Demand</h2><p>Normalize Statistics Canada city-pair O&amp;D estimates and reconcile directionality to estimate latent annual travel demand.</p><b>35% of score</b></article><article><span>02</span><h2>Existing supply</h2><p>Aggregate BTS T-100 passengers, seats, departures, and carriers to identify current nonstop service and capacity pressure.</p><b>20% of score</b></article><article><span>03</span><h2>Route economics</h2><p>Translate aircraft seats, frequency, target load factor, market capture, and fare into directional capacity and revenue.</p><b>25% of score</b></article><article><span>04</span><h2>Market quality</h2><p>Layer growth, competition, distance feasibility, seasonality, and source confidence into the opportunity ranking.</p><b>20% of score</b></article></div><div className="formula"><small>OPPORTUNITY SCORE</small><code>0.35 demand + 0.20 supply gap + 0.25 economics + 0.20 market quality</code><p>Scores are tested across alternative weights. The tool is a network-screening model, not a complete route profitability or revenue-management system.</p></div></section> }

function Slider({ label,value,min,max,suffix,onChange }:{label:string;value:number;min:number;max:number;suffix:string;onChange:(v:number)=>void}) { const progress=(value-min)/(max-min)*100; return <label className="slider"><span>{label}<b>{value}{suffix}</b></span><input aria-label={label} type="range" min={min} max={max} value={value} style={{background:`linear-gradient(90deg,#d8ff5f ${progress}%,#303633 ${progress}%)`}} onChange={e=>onChange(Number(e.target.value))}/><small>{min}{suffix}<i>{max}{suffix}</i></small></label> }
