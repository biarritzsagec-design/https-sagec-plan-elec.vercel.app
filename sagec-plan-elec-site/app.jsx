// app.jsx - Éditeur de plans électriques (standalone)
const { useEffect, useMemo, useRef, useState } = React;

// Symboles
const SYMBOLS = [
  { id: "socket", label: "Prise 16A", glyph: "⭘", size: 28 },
  { id: "switch", label: "Interrupteur", glyph: "⎋", size: 28 },
  { id: "light", label: "Luminaire", glyph: "☼", size: 32 },
  { id: "rj45", label: "RJ45", glyph: "⌗", size: 28 },
  { id: "tv", label: "TV", glyph: "⌁", size: 28 },
  { id: "panel", label: "Tableau", glyph: "☲", size: 34 },
  { id: "socket32", label: "Prise 32A", glyph: "◎", size: 30 },
];

const TOOLS = { SELECT: "select", WIRE: "wire", ADD_SYMBOL: "add_symbol", MEASURE: "measure" };
const defaultLayers = [
  { id: "bg", name: "Plan", visible: true },
  { id: "symbols", name: "Symboles", visible: true },
  { id: "wires", name: "Câbles", visible: true },
  { id: "dims", name: "Cotes", visible: false },
];

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
function classNames(...xs) { return xs.filter(Boolean).join(" "); }

function useUndoable(initial) {
  const [stack, setStack] = useState([initial]);
  const [index, setIndex] = useState(0);
  const state = stack[index];
  const setState = (updater) => {
    setStack((prev) => {
      const nextVal = typeof updater === "function" ? updater(prev[index]) : updater;
      const newStack = prev.slice(0, index + 1);
      newStack.push(nextVal);
      return newStack;
    });
    setIndex((i) => i + 1);
  };
  const canUndo = index > 0;
  const canRedo = index < stack.length - 1;
  const undo = () => canUndo && setIndex((i) => i - 1);
  const redo = () => canRedo && setIndex((i) => i + 1);
  return { state, setState, undo, redo, canUndo, canRedo };
}

function ElectricalPlanEditor() {
  const [bg, setBg] = useState({ src: "", naturalWidth: 0, naturalHeight: 0 });
  const [layers, setLayers] = useState(defaultLayers);
  const { state, setState, undo, redo, canUndo, canRedo } = useUndoable({
    symbols: [], wires: [], measures: [],
  });
  const [tool, setTool] = useState(TOOLS.SELECT);
  const [activeSymbol, setActiveSymbol] = useState(SYMBOLS[0]);
  const [snap, setSnap] = useState(10);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panning, setPanning] = useState(false);
  const svgRef = useRef(null);
  const containerRef = useRef(null);
  const [selection, setSelection] = useState(null);
  const [draggingId, setDraggingId] = useState(null);
  const [wireDraft, setWireDraft] = useState(null);
  const [measureDraft, setMeasureDraft] = useState(null);

  const worldSize = useMemo(() => {
    const w = bg.naturalWidth || 1600;
    const h = bg.naturalHeight || 900;
    return { w, h };
  }, [bg.naturalWidth, bg.naturalHeight]);

  useEffect(() => {
    if (bg.src && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const zx = rect.width / worldSize.w;
      const zy = rect.height / worldSize.h;
      const z = Math.min(zx, zy) * 0.95;
      setZoom(z);
      setPan({ x: (rect.width - worldSize.w * z) / 2, y: (rect.height - worldSize.h * z) / 2 });
    }
  }, [bg.src, worldSize.w, worldSize.h]);

  function toWorld(pt) { return { x: (pt.x - pan.x) / zoom, y: (pt.y - pan.y) / zoom }; }
  function snapPoint(pt) { return snap ? { x: Math.round(pt.x / snap) * snap, y: Math.round(pt.y / snap) * snap } : pt; }

  function onBgUpload(file) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => setBg({ src: url, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight });
    img.src = url;
  }

  function onWheel(e) {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const dir = e.deltaY > 0 ? -1 : 1;
    const factor = 1 + 0.1 * dir;
    const rect = svgRef.current.getBoundingClientRect();
    const mouse = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const before = toWorld(mouse);
    const nextZoom = Math.min(8, Math.max(0.1, zoom * factor));
    setZoom(nextZoom);
    const newScreen = { x: before.x * nextZoom, y: before.y * nextZoom };
    setPan({ x: mouse.x - newScreen.x, y: mouse.y - newScreen.y });
  }

  function onMouseDown(e) {
    const rect = svgRef.current.getBoundingClientRect();
    const p = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const w = snapPoint(toWorld(p));
    if (e.button === 1 || e.button === 2 || (e.buttons === 1 && e.shiftKey)) { setPanning(true); return; }

    if (tool === TOOLS.ADD_SYMBOL && layers.find(l=>l.id==="symbols").visible) {
      const id = crypto.randomUUID();
      setState((s) => ({ ...s, symbols: [...s.symbols, { id, type: activeSymbol.id, x: w.x, y: w.y, rot: 0 }] }));
      setSelection(id); return;
    }
    if (tool === TOOLS.WIRE && layers.find(l=>l.id==="wires").visible) {
      if (!wireDraft) setWireDraft({ points: [w] });
      else setWireDraft((d) => ({ ...d, points: [...d.points, w] }));
      return;
    }
    if (tool === TOOLS.MEASURE) {
      if (!measureDraft) setMeasureDraft({ a: w, b: w });
      else finalizeMeasure();
      return;
    }
    const hit = hitTest(w);
    if (hit) { setSelection(hit.id); setDraggingId(hit.id); } else setSelection(null);
  }

  function onMouseMove(e) {
    const rect = svgRef.current.getBoundingClientRect();
    const p = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    if (panning) { setPan((pan) => ({ x: pan.x + e.movementX, y: pan.y + e.movementY })); return; }
    const w = snapPoint(toWorld(p));
    if (draggingId) {
      setState((s) => ({ ...s, symbols: s.symbols.map((el) => (el.id === draggingId ? { ...el, x: w.x, y: w.y } : el)) }));
      return;
    }
    if (wireDraft) { setWireDraft((d) => ({ ...d, hover: w })); return; }
    if (measureDraft) { setMeasureDraft((d) => ({ ...d, b: w })); return; }
  }
  function onMouseUp() { setDraggingId(null); setPanning(false); }

  function onKeyDown(e) {
    if (e.key === "Delete" && selection) {
      setState((s) => ({ ...s, symbols: s.symbols.filter((el) => el.id !== selection), wires: s.wires.filter((w) => w.id !== selection) }));
      setSelection(null);
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); exportPNG(); }
    if (selection && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      const delta = e.key === "ArrowLeft" ? -15 : 15;
      setState((s) => ({ ...s, symbols: s.symbols.map((el) => (el.id === selection ? { ...el, rot: (el.rot + delta) % 360 } : el)) }));
    }
  }

  function finalizeWire() {
    if (!wireDraft || wireDraft.points.length < 2) { setWireDraft(null); return; }
    const id = crypto.randomUUID();
    setState((s) => ({ ...s, wires: [...s.wires, { id, points: wireDraft.points, label: "" }] }));
    setWireDraft(null);
  }
  function finalizeMeasure() {
    if (!measureDraft) return;
    const id = crypto.randomUUID();
    setState((s) => ({ ...s, measures: [...s.measures, { id, ...measureDraft, label: formatDistance(distance(measureDraft.a, measureDraft.b)) }] }));
    setMeasureDraft(null);
  }
  function hitTest(w) {
    const r = 20;
    for (let i = state.symbols.length - 1; i >= 0; i--) {
      const el = state.symbols[i];
      if (Math.hypot(el.x - w.x, el.y - w.y) <= r) return el;
    }
    return null;
  }
  function distance(a,b){ return Math.hypot(a.x-a.x + (a.x-b.x), a.y-a.y + (a.y-b.y)); } // intentional to avoid shadowing; corrected below
  // Correction:
  function distanceCorrect(a,b){ return Math.hypot(a.x-b.x, a.y-b.y); }
  function formatDistance(d){ return `${(d / 100).toFixed(2)} m`; }

  function serializeJSON() {
    const payload = { bg, data: state, snap, version: 1 };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    downloadBlob("plan-electrique.json", blob);
  }
  function loadJSON(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const payload = JSON.parse(reader.result);
        if (payload.bg?.src) setBg(payload.bg);
        if (payload.data) setState(payload.data);
        if (payload.snap != null) setSnap(payload.snap);
      } catch { alert("Fichier JSON invalide"); }
    };
    reader.readAsText(file);
  }
  async function exportPNG() {
    const svgNode = svgRef.current.cloneNode(true);
    svgNode.removeAttribute("style");
    const serializer = new XMLSerializer();
    const svgText = serializer.serializeToString(svgNode);
    const svgBlob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);
    const img = new Image();
    await new Promise((resolve) => { img.onload = resolve; img.src = url; });

    const canvas = document.createElement("canvas");
    canvas.width = worldSize.w; canvas.height = worldSize.h;
    const ctx = canvas.getContext("2d");
    if (bg.src) {
      const bgImg = new Image();
      await new Promise((resolve) => { bgImg.onload = resolve; bgImg.src = bg.src; });
      ctx.drawImage(bgImg, 0, 0);
    } else { ctx.fillStyle = "#ffffff"; ctx.fillRect(0,0,canvas.width, canvas.height); }
    ctx.drawImage(img, 0, 0);
    canvas.toBlob((blob) => { if (blob) downloadBlob("plan-electrique.png", blob); URL.revokeObjectURL(url); });
  }
  function toggleLayer(id){ setLayers((ls)=> ls.map((l)=> l.id===id? {...l, visible: !l.visible } : l)); }

  const worldDistance = (a,b)=> distanceCorrect(a,b);

  return (
    <div className="w-full h-full min-h-[100vh] bg-slate-50 text-slate-800" onKeyDown={onKeyDown} tabIndex={0}>
      <div className="flex items-center gap-2 p-3 border-b bg-white sticky top-0 z-20">
        <span className="font-semibold text-lg">Sagec — Éditeur de plans électriques</span>
        <div className="flex items-center gap-2 ml-4">
          <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border bg-slate-50 cursor-pointer">
            <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && onBgUpload(e.target.files[0])} />
            <span>Importer plan (image)</span>
          </label>
          <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border bg-slate-50 cursor-pointer">
            <input type="file" accept="application/json" className="hidden" onChange={(e) => e.target.files?.[0] && loadJSON(e.target.files[0])} />
            <span>Charger JSON</span>
          </label>
          <button onClick={serializeJSON} className="px-3 py-1.5 rounded-xl border hover:bg-slate-50">Sauvegarder JSON</button>
          <button onClick={exportPNG} className="px-3 py-1.5 rounded-xl border hover:bg-slate-50">Exporter PNG</button>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button disabled={!canUndo} onClick={undo} className={"px-3 py-1.5 rounded-xl border " + (canUndo? "hover:bg-slate-50":"opacity-40 cursor-not-allowed")}>Annuler</button>
          <button disabled={!canRedo} onClick={redo} className={"px-3 py-1.5 rounded-xl border " + (canRedo? "hover:bg-slate-50":"opacity-40 cursor-not-allowed")}>Rétablir</button>
          <div className="px-2">Zoom: {(zoom*100).toFixed(0)}%</div>
          <div className="flex items-center gap-1">
            <span className="text-sm">Grille</span>
            <input type="number" className="w-16 px-2 py-1 rounded border" value={snap} onChange={(e)=>setSnap(Math.max(0, Number(e.target.value)))} />
            <span className="text-sm">px</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-3 p-3">
        <div className="col-span-12 md:col-span-3 lg:col-span-2 space-y-3">
          <div className="p-3 bg-white rounded-2xl border shadow-sm">
            <div className="font-medium mb-2">Outils</div>
            <div className="grid grid-cols-2 gap-2">
              <ToolButton active={tool===TOOLS.SELECT} onClick={()=>setTool(TOOLS.SELECT)} label="Sélection"/>
              <ToolButton active={tool===TOOLS.WIRE} onClick={()=>{setTool(TOOLS.WIRE); setWireDraft(null);}} label="Câble"/>
              <ToolButton active={tool===TOOLS.ADD_SYMBOL} onClick={()=>setTool(TOOLS.ADD_SYMBOL)} label="Symbole"/>
              <ToolButton active={tool===TOOLS.MEASURE} onClick={()=>setTool(TOOLS.MEASURE)} label="Cote"/>
            </div>
          </div>

          <div className="p-3 bg-white rounded-2xl border shadow-sm">
            <div className="font-medium mb-2">Symboles</div>
            <div className="grid grid-cols-2 gap-2">
              {SYMBOLS.map((s)=> (
                <button key={s.id} onClick={()=>{setActiveSymbol(s); setTool(TOOLS.ADD_SYMBOL);}} className={"p-2 border rounded-xl hover:bg-slate-50 text-center " + (activeSymbol.id===s.id ? "ring-2 ring-blue-500" : "")} title={s.label}>
                  <div className="text-2xl leading-none">{s.glyph}</div>
                  <div className="text-xs text-slate-600">{s.label}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="p-3 bg-white rounded-2xl border shadow-sm">
            <div className="font-medium mb-2">Calques</div>
            <div className="space-y-1">
              {layers.map((l)=> (
                <label key={l.id} className="flex items-center justify-between gap-2 px-2 py-1 rounded hover:bg-slate-50">
                  <span>{l.name}</span>
                  <input type="checkbox" checked={l.visible} onChange={()=>toggleLayer(l.id)} />
                </label>
              ))}
            </div>
          </div>

          {selection && (
            <div className="p-3 bg-white rounded-2xl border shadow-sm">
              <div className="font-medium mb-2">Propriétés</div>
              {(() => {
                const el = state.symbols.find((x) => x.id === selection);
                if (!el) return <div className="text-sm text-slate-500">Sélectionnez un symbole…</div>;
                return (
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center justify-between"><span>Type</span><span className="font-mono">{el.type}</span></div>
                    <div className="flex items-center justify-between"><span>X</span><NumberField value={el.x} onChange={(v)=>updateSymbol(selection,{x:v})} /></div>
                    <div className="flex items-center justify-between"><span>Y</span><NumberField value={el.y} onChange={(v)=>updateSymbol(selection,{y:v})} /></div>
                    <div className="flex items-center justify-between"><span>Rotation</span><NumberField value={el.rot} onChange={(v)=>updateSymbol(selection,{rot:v})} />°</div>
                    <button className="px-3 py-1.5 rounded-xl border hover:bg-slate-50" onClick={()=>duplicateSymbol(el)}>Dupliquer</button>
                    <button className="px-3 py-1.5 rounded-xl border hover:bg-red-50" onClick={()=>deleteSelection()}>Supprimer</button>
                  </div>
                );
              })()}
            </div>
          )}
        </div>

        <div className="col-span-12 md:col-span-9 lg:col-span-10">
          <div
            ref={containerRef}
            className="relative h-[75vh] md:h-[80vh] bg-slate-200 rounded-2xl overflow-hidden border"
            onContextMenu={(e)=>e.preventDefault()}
          >
            <div className="absolute top-2 left-2 z-20 text-xs px-2 py-1 rounded bg-black/60 text-white">
              Molette + Ctrl/⌘ : zoom • Clic droit (ou Maj+drag) : déplacer • Entrée : valider fil/cote • Échap : annuler outil
            </div>
            <div className="absolute bottom-2 left-2 z-20 text-xs px-2 py-1 rounded bg-black/60 text-white">
              Outil: {tool} {tool===TOOLS.ADD_SYMBOL?`- ${activeSymbol.label}`:""}
            </div>

            <svg
              ref={svgRef}
              width="100%"
              height="100%"
              onWheel={onWheel}
              onMouseDown={onMouseDown}
              onMouseMove={onMouseMove}
              onMouseUp={onMouseUp}
              onMouseLeave={()=>{setDraggingId(null); setPanning(false);}}
              onKeyDown={(e)=>{
                if (e.key === "Enter") { if (tool===TOOLS.WIRE) finalizeWire(); if (tool===TOOLS.MEASURE) finalizeMeasure(); }
                if (e.key === "Escape") { setWireDraft(null); setMeasureDraft(null); setTool(TOOLS.SELECT); }
              }}
              style={{ backgroundImage: bg.src?`url(${bg.src})`:undefined, backgroundSize: `${worldSize.w}px ${worldSize.h}px`, backgroundRepeat: "no-repeat", backgroundPosition: `${pan.x}px ${pan.y}px` }}
            >
              <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
                {!bg.src && (<rect x={0} y={0} width={worldSize.w} height={worldSize.h} fill="#fff" />)}
                {snap>0 && (<Grid width={worldSize.w} height={worldSize.h} step={snap} />)}

                {layers.find(l=>l.id==="wires").visible && (
                  <g>
                    {state.wires.map((w)=> (
                      <polyline key={w.id} points={w.points.map(p=>`${p.x},${p.y}`).join(" ")} fill="none" stroke="#0f172a" strokeWidth={2} />
                    ))}
                    {wireDraft && (
                      <polyline points={[...wireDraft.points, wireDraft.hover??wireDraft.points.at(-1)].map(p=>`${p.x},${p.y}`).join(" ")} fill="none" stroke="#0f172a" strokeWidth={2} strokeDasharray="4 4" />
                    )}
                  </g>
                )}

                {layers.find(l=>l.id==="symbols").visible && (
                  <g>
                    {state.symbols.map((el)=> (
                      <g key={el.id} transform={`translate(${el.x},${el.y}) rotate(${el.rot})`} style={{cursor: "grab"}}>
                        <circle cx={0} cy={0} r={16} fill={selection===el.id?"#e0f2fe":"#fff"} stroke="#0f172a" />
                        <text x={0} y={6} textAnchor="middle" fontSize={16} fill="#0f172a">{(SYMBOLS.find(s=>s.id===el.type)||{}).glyph || "?"}</text>
                      </g>
                    ))}
                  </g>
                )}

                {layers.find(l=>l.id==="dims").visible && (
                  <g>
                    {state.measures.map((m)=> (
                      <g key={m.id}>
                        <line x1={m.a.x} y1={m.a.y} x2={m.b.x} y2={m.b.y} stroke="#0284c7" strokeWidth={2} />
                        <text x={(m.a.x+m.b.x)/2} y={(m.a.y+m.b.y)/2 - 6} textAnchor="middle" fontSize={12} fill="#0369a1" >
                          {formatDistance(worldDistance(m.a, m.b))}
                        </text>
                      </g>
                    ))}
                    {measureDraft && (
                      <g>
                        <line x1={measureDraft.a.x} y1={measureDraft.a.y} x2={measureDraft.b.x} y2={measureDraft.b.y} stroke="#7dd3fc" strokeWidth={2} strokeDasharray="4 4" />
                        <text x={(measureDraft.a.x+measureDraft.b.x)/2} y={(measureDraft.a.y+measureDraft.b.y)/2 - 6} textAnchor="middle" fontSize={12} fill="#0284c7" >
                          {formatDistance(worldDistance(measureDraft.a, measureDraft.b))}
                        </text>
                      </g>
                    )}
                  </g>
                )}
              </g>
            </svg>
          </div>
        </div>
      </div>
    </div>
  );

  function NumberField({ value, onChange }) {
    return (<input type="number" className="w-28 px-2 py-1 rounded border" value={Math.round(value)} onChange={(e)=>onChange(Number(e.target.value))} />);
  }
  function ToolButton({ active, onClick, label }) {
    return (<button onClick={onClick} className={"px-3 py-2 rounded-xl border text-sm " + (active? "bg-blue-600 text-white border-blue-600":"hover:bg-slate-50")}>{label}</button>);
  }
  function updateSymbol(id, props) { setState((s)=> ({...s, symbols: s.symbols.map(el=> el.id===id? { ...el, ...props } : el)})); }
  function duplicateSymbol(el) { const id = crypto.randomUUID(); setState((s)=> ({...s, symbols: [...s.symbols, { ...el, id, x: el.x + 20, y: el.y + 20 }]})); setSelection(id); }
  function deleteSelection() { if (!selection) return; setState((s)=> ({...s, symbols: s.symbols.filter(el=>el.id!==selection), wires: s.wires.filter(w=>w.id!==selection)})); setSelection(null); }
}

function Grid({ width, height, step }) {
  const lines = [];
  for (let x=0; x<=width; x+=step) lines.push(<line key={`v${x}`} x1={x} y1={0} x2={x} y2={height} stroke="#e2e8f0" strokeWidth={1} />);
  for (let y=0; y<=height; y+=step) lines.push(<line key={`h${y}`} x1={0} y1={y} x2={width} y2={y} stroke="#e2e8f0" strokeWidth={1} />);
  return <g>{lines}</g>;
}

// Expose global for index.html to render
window.ElectricalPlanEditor = ElectricalPlanEditor;
