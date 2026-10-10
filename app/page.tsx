'use client';

import { useMemo, useState } from 'react';
import RouteMap, { type RouteRecord } from './RouteMap';
import ScenarioTool from './northbyte/ScenarioTool';
import data from './data/routes.json';

// Everything on this page comes from app/data/routes.json, which is written by
// db/40_export.sql. Nothing here invents a number: to change what the interface
// says, change the query and re-run scripts/db.sh export.

type Route = RouteRecord & {
  rank: string; city: string; demand: number; fare: number; growth: number;
  competitors: number; distance: number; confidence: number; score: number;
  breakeven: number; fareIsModelled: boolean; components: { demand: number; supplyGap: number; economics: number; marketQuality: number };
};

const routes: Route[] = data.routes.map(r => ({
  ...r,
  origin: [r.origin[0], r.origin[1]] as [number, number],
  destination: [r.destination[0], r.destination[1]] as [number, number],
}));

const aircraft = data.aircraft as Record<string, { seats: number; range: number }>;
const weights = data.weights as Record<string, number>;
const hubs = ['All', ...Array.from(new Set(routes.map(r => r.originCode)))];

export default function Home() {
  const [view, setView] = useState<'lab' | 'network' | 'methodology' | 'scenario'>('lab');
  const [selected, setSelected] = useState(0);
  const [hub, setHub] = useState('All');
  const [plane, setPlane] = useState(data.assumptions.baseAircraft);
  const [frequency, setFrequency] = useState(data.assumptions.baseFrequency);
  const [loadFactor, setLoadFactor] = useState(data.assumptions.baseLoadFactor);
  const [capture, setCapture] = useState(Math.ceil(routes[0].breakeven));
  const route = routes[selected];
  const visibleRoutes = hub === 'All' ? routes : routes.filter(item => item.originCode === hub);

  const model = useMemo(() => {
    // A weekly frequency flies the market in both directions, and demand counts
    // both directions, so capacity is doubled to stay on the same footing.
    const seats = 2 * aircraft[plane].seats * frequency * 52;
    const required = Math.round(seats * loadFactor / 100);
    const captured = Math.round(route.demand * capture / 100);
    const flown = Math.min(captured, seats);
    return { seats, captured, projectedLoad: Math.min(100, captured / seats * 100), revenue: flown * route.fare, breakEvenCapture: required / route.demand * 100 };
  }, [route, plane, frequency, loadFactor, capture]);
  const inRange = aircraft[plane].range >= route.distance;
  const viable = model.projectedLoad >= loadFactor && inRange;

  return <main>
    <header className="topbar">
      <button className="brand" onClick={() => setView('lab')}><span className="brandmark">N</span><span><b>Northbound</b><small>Network intelligence</small></span></button>
      <nav>{[['lab','Route lab'],['network','Network'],['methodology','Methodology'],['scenario','NorthByte scenario']].map(([id,label]) => <button key={id} className={view === id ? 'active' : ''} onClick={() => setView(id as typeof view)}>{label}</button>)}</nav>
      <div className="source"><span /> {view === 'scenario'
        ? 'NorthByte FY25-26 · 54 routes'
        : `${data.dataset.marketsScreened.toLocaleString()} markets screened · ${data.referenceYear}`}</div>
    </header>

    {view === 'lab' && <>
      <Hero eyebrow="AIR CANADA · TRANSBORDER PLANNING" title={<>Which route should<br />we launch next?</>} copy="Western Canada to the U.S. West, screened from published traffic data. Find the markets nobody flies nonstop, then pressure-test whether an aircraft can actually carry them." />
      <section className="workspace">
        <aside className="rankings">
          <div className="sectionhead"><span>Candidate routes</span><small>OPPORTUNITY SCORE</small></div>
          <div className="filterrow">{hubs.map(item => <button key={item} className={`pill ${hub === item ? 'active' : ''}`} onClick={() => setHub(item)}>{item === 'All' ? 'All hubs' : item}</button>)}</div>
          <div className="routeList">{visibleRoutes.map(item => { const index = routes.indexOf(item); return <button key={item.code} className={`routeCard ${selected === index ? 'selected' : ''}`} onClick={() => setSelected(index)}><span className="rank">{item.rank}</span><span className="routeName"><b>{item.code}</b><small>{item.city}</small></span><span className="score"><b>{item.score}</b><small>score</small></span></button> })}</div>
        </aside>
        <div className="mapPanel">
          <div className="mapLabel"><b>Live opportunity map</b><span>Drag · scroll to zoom · click an airport</span></div>
          <div className="mapWrap"><RouteMap routes={routes} selected={selected} onSelect={setSelected}/><div className="mapStat"><small>Selected market</small><b>{route.code}</b><span>{route.demand.toLocaleString()} annual O&amp;D passengers · no nonstop in {data.referenceYear}</span></div></div>
          <Metrics route={route}/>
        </div>
        <Simulator route={route} plane={plane} setPlane={setPlane} frequency={frequency} setFrequency={setFrequency} loadFactor={loadFactor} setLoadFactor={setLoadFactor} capture={capture} setCapture={setCapture} model={model} viable={viable} inRange={inRange}/>
      </section>
    </>}

    {view === 'network' && <NetworkView selected={selected} setSelected={setSelected}/>}
    {view === 'methodology' && <Methodology/>}
    {view === 'scenario' && <ScenarioTool/>}
    {view !== 'scenario' && (<footer><span>BTS T-100 International Segment · StatCan 23-10-0256 · OurAirports</span><span>{data.dataset.t100Rows.toLocaleString()} segment rows · {data.dataset.odRows.toLocaleString()} O&amp;D rows · generated {data.generatedAt.slice(0, 10)}</span></footer>)}
  </main>;
}

function Hero({ eyebrow, title, copy }: { eyebrow: string; title: React.ReactNode; copy: string }) { return <section className="hero"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1></div><p className="intro">{copy}</p></section> }

function Metrics({ route }: { route: Route }) { return <div className="metrics"><div><small>Latent demand</small><b>{(route.demand/1000).toFixed(1)}K</b><span>annual pax, both directions</span></div><div><small>Average fare</small><b>${route.fare.toFixed(0)}</b><span>{route.fareIsModelled ? 'modelled, not observed' : 'one way, O&D weighted'}</span></div><div><small>Demand growth</small><b className={route.growth >= 0 ? 'green' : undefined}>{route.growth >= 0 ? '+' : ''}{route.growth}%</b><span>vs. prior year</span></div><div><small>Rival Canada nonstops</small><b>{route.competitors}</b><span>carriers serving this city</span></div></div> }

type SimulatorProps = {
  route: Route; plane: string; setPlane: (v: string) => void;
  frequency: number; setFrequency: (v: number) => void;
  loadFactor: number; setLoadFactor: (v: number) => void;
  capture: number; setCapture: (v: number) => void;
  model: { seats: number; captured: number; projectedLoad: number; revenue: number; breakEvenCapture: number };
  viable: boolean; inRange: boolean;
};

function Simulator({ route, plane, setPlane, frequency, setFrequency, loadFactor, setLoadFactor, capture, setCapture, model, viable, inRange }: SimulatorProps) { return <aside className="simulator"><div className="sectionhead"><span>Route simulator</span><i>LIVE</i></div><label>Aircraft<select value={plane} onChange={e => setPlane(e.target.value)}>{Object.keys(aircraft).map(p => <option key={p}>{p}</option>)}</select></label><Slider label="Weekly frequency" value={frequency} min={2} max={14} suffix=" flights" onChange={setFrequency}/><Slider label="Target load factor" value={loadFactor} min={65} max={95} suffix="%" onChange={setLoadFactor}/><Slider label="Expected market capture" value={capture} min={10} max={80} suffix="%" onChange={setCapture}/><div className="results"><div><span>Annual capacity</span><b>{model.seats.toLocaleString()}</b></div><div><span>Projected passengers</span><b>{model.captured.toLocaleString()}</b></div><div><span>Projected load factor</span><b>{model.projectedLoad.toFixed(1)}%</b></div><div><span>Annual revenue</span><b>${(model.revenue/1e6).toFixed(1)}M</b></div><div><span>Break-even capture</span><b>{model.breakEvenCapture.toFixed(1)}%</b></div></div><div className={`verdict ${viable?'go':'watch'}`}><span>{viable?'RECOMMENDATION · PROMISING':'RECOMMENDATION · PRESSURE TEST'}</span><p>{!inRange ? `${plane} cannot reach ${route.distance.toLocaleString()} mi with a full payload. Pick a longer-range aircraft.` : viable ? `${plane} service clears the ${loadFactor}% load target for ${route.code}, capturing ${capture}% of a ${(route.demand/1000).toFixed(0)}K market.` : `Capturing ${capture}% leaves the aircraft below the ${loadFactor}% target. Cut frequency or raise the capture assumption.`}</p></div></aside> }

function NetworkView({ selected, setSelected }: { selected: number; setSelected: (index: number) => void }) { const route = routes[selected]; return <section className="viewPage"><Hero eyebrow="NETWORK OVERVIEW" title={<>See the whole<br />opportunity set.</>} copy="Every candidate the model kept after screening western Canada against the U.S. West. Click any airport or table row to move it into focus."/><div className="networkGrid"><div className="networkMap"><RouteMap routes={routes} selected={selected} onSelect={setSelected} networkMode/><div className="networkLegend"><b>{route.code}</b><span>Selected · score {route.score} · break-even capture {route.breakeven}%</span></div></div><div className="networkTable"><div className="sectionhead"><span>All candidates</span><small>{routes.length} ROUTES</small></div>{routes.map((item,index)=><button key={item.code} className={selected===index?'selected':''} onClick={()=>setSelected(index)}><b>{item.code}</b><span>{(item.demand/1000).toFixed(0)}K pax</span><span>{item.growth >= 0 ? '+' : ''}{item.growth}%</span><em>{item.score}</em></button>)}</div></div></section> }

function Methodology() {
  const pct = (component: string) => `${Math.round(weights[component] * 100)}% of score`;
  return <section className="viewPage"><Hero eyebrow="MODEL METHODOLOGY" title={<>From public data<br />to a route decision.</>} copy="A transparent screening framework—not a black box profitability forecast. Every metric, assumption, and limitation stays visible."/>
    <div className="methodGrid">
      <article><span>01</span><h2>Demand</h2><p>Statistics Canada table 23-10-0256 counts transborder journeys by city pair, outbound plus inbound. It measures people who want to travel, including everyone connecting today. The series ends in {data.referenceYear}, which is why the whole model is pinned to that year.</p><b>{pct('demand')}</b></article>
      <article><span>02</span><h2>Existing supply</h2><p>BTS T-100 International Segment gives every carrier&apos;s seats, passengers and departures, so what is already flown nonstop is measured, not assumed. A market is dropped once scheduled capacity passes {data.assumptions.nonstopSeatFloor.toLocaleString()} annual seats, and discounted when a rival already links that U.S. city to Canada from another hub.</p><b>{pct('supply_gap')}</b></article>
      <article><span>03</span><h2>Route economics</h2><p>Aircraft seats, weekly frequency and target load factor become annual capacity in both directions, then a break-even capture rate: the share of the market the route must win to fill at {data.assumptions.baseLoadFactor}%.</p><b>{pct('economics')}</b></article>
      <article><span>04</span><h2>Market quality</h2><p>Year-over-year growth, source confidence and range headroom against the aircraft&apos;s limit. Markets under {data.assumptions.minStageMiles} miles are screened out as drive markets. Fares are modelled from stage length, since the demand source publishes no fare.</p><b>{pct('market_quality')}</b></article>
    </div>
    <div className="formula"><small>OPPORTUNITY SCORE</small><code>{['demand','supply_gap','economics','market_quality'].map(k => `${weights[k]} ${k.replace('_', ' ')}`).join(' + ')}</code><p>Each component is min-max normalised across the candidate set, so a score ranks candidates against each other rather than predicting profit. Weights live in a database table, not in the query, so alternative weightings can be re-run in one statement. Reference year {data.referenceYear}; {data.dataset.marketsScreened} western markets screened from {data.dataset.t100Rows.toLocaleString()} in-scope segment rows. Most surviving candidates need a break-even capture above 100%, which is the honest reading: the U.S. West is well served from Canada, and what is left is thin, seasonal, or regional-jet sized.</p></div>
  </section>;
}

function Slider({ label,value,min,max,suffix,onChange }:{label:string;value:number;min:number;max:number;suffix:string;onChange:(v:number)=>void}) { const progress=(value-min)/(max-min)*100; return <label className="slider"><span>{label}<b>{value}{suffix}</b></span><input aria-label={label} type="range" min={min} max={max} value={value} style={{background:`linear-gradient(90deg,#d8ff5f ${progress}%,#303633 ${progress}%)`}} onChange={e=>onChange(Number(e.target.value))}/><small>{min}{suffix}<i>{max}{suffix}</i></small></label> }
