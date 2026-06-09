import { useState, useRef, useEffect } from "react";
import * as XLSX from "xlsx";

// ─── AI PROMPT ───────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are an ATS (Automated Test System) data analyst for electronics manufacturing.
Analyze the provided test data and return ONLY a JSON object (no markdown, no backticks):
{
  "summary": { "totalUnits": number, "passCount": number, "failCount": number, "fpy": number, "analysisDate": "string" },
  "topFailures": [{ "testName": "string", "count": number, "percentage": number }],
  "stationPerformance": [{ "station": "string", "fpy": number, "tested": number }],
  "insights": ["string","string","string"],
  "recommendations": ["string","string"],
  "riskLevel": "LOW"|"MEDIUM"|"HIGH"
}`;

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const C = {
  bg:"#0a0c0f", panel:"#111318", panel2:"#161b22", border:"#1e2530",
  accent:"#00d4ff", accentDim:"#0a4a5e",
  green:"#00ff88", red:"#ff3b5c", yellow:"#ffcc00",
  text:"#c8d4e0", muted:"#4a5568",
};
const STD_COLS = ["STATION_ID","SERIAL_NUMBER","RESULT","TEST_NAME","MODE","TIMESTAMP"];

// Default users (demo — in production use real auth)
const DEFAULT_USERS = [
  { id:"u1", username:"admin",   password:"admin123",  role:"Admin",    name:"System Admin" },
  { id:"u2", username:"engineer",password:"eng123",    role:"Engineer", name:"Process Engineer" },
  { id:"u3", username:"qa",      password:"qa123",     role:"Viewer",   name:"QA Inspector" },
];

// ─── STORAGE HELPERS ──────────────────────────────────────────────────────────
const store = {
  get: (k, def=null) => { try { const v=localStorage.getItem(k); return v?JSON.parse(v):def; } catch{ return def; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch{} },
};

// ─── SMALL COMPONENTS ─────────────────────────────────────────────────────────
function Gauge({ value, target, color }) {
  const r=50, cx=70, cy=64;
  const pt = v => { const a=(-220+(v/100)*260)*Math.PI/180; return {x:cx+r*Math.cos(a),y:cy+r*Math.sin(a)}; };
  const sr=(-220)*Math.PI/180, sx=cx+r*Math.cos(sr), sy=cy+r*Math.sin(sr);
  const f=pt(value), t=pt(Math.min(target,99.9));
  return (
    <svg width="140" height="110" viewBox="0 0 140 110">
      <path d={`M ${sx} ${sy} A ${r} ${r} 0 1 1 ${pt(0).x} ${pt(0).y}`} fill="none" stroke={C.border} strokeWidth="9" strokeLinecap="round"/>
      {value>0 && <path d={`M ${sx} ${sy} A ${r} ${r} 0 ${value>50?1:0} 1 ${f.x} ${f.y}`} fill="none" stroke={color} strokeWidth="9" strokeLinecap="round" style={{filter:`drop-shadow(0 0 6px ${color})`}}/>}
      <circle cx={t.x} cy={t.y} r="5" fill={C.yellow}/>
      <text x="70" y="75" textAnchor="middle" fill={color} fontSize="21" fontFamily="monospace" fontWeight="bold">{value.toFixed(1)}%</text>
      <text x="70" y="90" textAnchor="middle" fill={C.muted} fontSize="9" fontFamily="monospace">FIRST PASS YIELD</text>
      <text x="70" y="104" textAnchor="middle" fill={C.yellow} fontSize="8" fontFamily="monospace">● TARGET {target}%</text>
    </svg>
  );
}

function RiskBadge({level}){
  const m={LOW:[C.green,"▼ LOW"],MEDIUM:[C.yellow,"◆ MED"],HIGH:[C.red,"▲ HIGH"]};
  const [col,lbl]=m[level]||[C.muted,"?"];
  return <span style={{padding:"3px 9px",borderRadius:2,fontSize:9,fontFamily:"monospace",fontWeight:"bold",letterSpacing:2,color:col,border:`1px solid ${col}`,background:`${col}11`}}>{lbl} RISK</span>;
}

function BarChart({ data, color }) {
  const max=Math.max(...data.map(d=>d.count),1);
  return <div style={{display:"flex",flexDirection:"column",gap:7}}>
    {data.slice(0,6).map((item,i)=>(
      <div key={i}>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
          <span style={{color:C.text,fontSize:10,fontFamily:"monospace",maxWidth:160,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{item.testName}</span>
          <span style={{color,fontSize:10,fontFamily:"monospace"}}>{item.count} ({item.percentage.toFixed(1)}%)</span>
        </div>
        <div style={{height:5,background:C.border,borderRadius:3,overflow:"hidden"}}>
          <div style={{height:"100%",width:`${(item.count/max)*100}%`,background:color,borderRadius:3,boxShadow:`0 0 6px ${color}`,transition:"width 0.8s"}}/>
        </div>
      </div>
    ))}
  </div>;
}

function Btn({children, onClick, color=C.accent, textColor="#000", outline=false, sm=false, disabled=false, full=false}){
  return <button onClick={onClick} disabled={disabled} style={{
    padding: sm?"5px 12px":"11px 18px", fontSize:sm?9:11, fontWeight:"bold", letterSpacing:2,
    fontFamily:"monospace", cursor:disabled?"not-allowed":"pointer", borderRadius:3, transition:"all 0.15s",
    width:full?"100%":"auto",
    background: outline?"transparent":disabled?"#1e2530":color,
    color: outline?color:disabled?C.muted:textColor,
    border:`1px solid ${disabled?C.muted:color}`,
    boxShadow: outline||disabled?"none":`0 0 14px ${color}33`,
  }}>{children}</button>;
}

function Input({label, value, onChange, type="text", placeholder=""}){
  return <div style={{marginBottom:12}}>
    {label && <div style={{fontSize:9,letterSpacing:2,color:C.muted,marginBottom:5}}>{label}</div>}
    <input type={type} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder}
      style={{width:"100%",background:C.panel,border:`1px solid ${C.border}`,color:C.text,padding:"9px 12px",fontSize:12,fontFamily:"monospace",borderRadius:4,outline:"none",boxSizing:"border-box"}}/>
  </div>;
}

// ─── LOGIN SCREEN ──────────────────────────────────────────────────────────────
function LoginScreen({ branding, onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const accentColor = branding.accentColor || C.accent;

  const login = () => {
    const user = DEFAULT_USERS.find(u=>u.username===username && u.password===password);
    if (user) { setError(""); onLogin(user); }
    else setError("ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง");
  };

  return (
    <div style={{minHeight:"100vh",background:C.bg,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:24}}>
      <div style={{width:"100%",maxWidth:340}}>
        {/* Logo / Brand */}
        <div style={{textAlign:"center",marginBottom:28}}>
          <div style={{fontSize:40,marginBottom:8}}>{branding.logo||"🏭"}</div>
          <div style={{fontSize:16,fontWeight:"bold",color:"#fff",fontFamily:"monospace",letterSpacing:2}}>{branding.companyName||"ATS REPORT"}</div>
          <div style={{fontSize:9,color:C.muted,letterSpacing:3,marginTop:4}}>MANUFACTURING INTELLIGENCE PLATFORM</div>
        </div>

        {/* Login Card */}
        <div style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:8,padding:24}}>
          <div style={{fontSize:10,letterSpacing:3,color:accentColor,marginBottom:18,display:"flex",alignItems:"center",gap:8}}>
            <div style={{width:6,height:6,borderRadius:"50%",background:accentColor,boxShadow:`0 0 8px ${accentColor}`,animation:"pulse 2s infinite"}}/>
            SECURE LOGIN
          </div>
          <Input label="USERNAME" value={username} onChange={setUsername} placeholder="engineer"/>
          <Input label="PASSWORD" value={password} onChange={setPassword} type="password" placeholder="••••••"/>
          {error && <div style={{color:C.red,fontSize:11,marginBottom:12,padding:"6px 10px",background:`${C.red}0a`,border:`1px solid ${C.red}33`,borderRadius:3}}>{error}</div>}
          <Btn full color={accentColor} onClick={login}>▶ SIGN IN</Btn>
          <div style={{marginTop:14,padding:"10px",background:`${accentColor}08`,border:`1px solid ${accentColor}22`,borderRadius:4}}>
            <div style={{fontSize:9,color:C.muted,letterSpacing:1,marginBottom:6}}>DEMO ACCOUNTS</div>
            {DEFAULT_USERS.map(u=>(
              <div key={u.id} onClick={()=>{setUsername(u.username);setPassword(u.password);}} style={{fontSize:9,color:C.text,fontFamily:"monospace",padding:"2px 0",cursor:"pointer",opacity:0.8}}>
                {u.username} / {u.password} <span style={{color:C.muted}}>({u.role})</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}`}</style>
    </div>
  );
}

// ─── SETTINGS PANEL ───────────────────────────────────────────────────────────
function SettingsPanel({ branding, onSave, onClose, user }) {
  const [b, setB] = useState({...branding});
  const colors = ["#00d4ff","#00ff88","#ff3b5c","#ffcc00","#a855f7","#f97316","#ec4899"];
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.8)",zIndex:100,display:"flex",alignItems:"flex-end"}}>
      <div style={{width:"100%",background:C.panel,border:`1px solid ${C.border}`,borderRadius:"12px 12px 0 0",padding:22,maxHeight:"80vh",overflowY:"auto"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
          <span style={{fontSize:11,letterSpacing:3,color:C.accent}}>⚙ BRANDING SETTINGS</span>
          <button onClick={onClose} style={{background:"none",border:"none",color:C.muted,fontSize:16,cursor:"pointer"}}>✕</button>
        </div>

        <div style={{marginBottom:12}}>
          <div style={{fontSize:9,letterSpacing:2,color:C.muted,marginBottom:6}}>COMPANY NAME</div>
          <input value={b.companyName||""} onChange={e=>setB({...b,companyName:e.target.value})}
            style={{width:"100%",background:C.bg,border:`1px solid ${C.border}`,color:C.text,padding:"8px 12px",fontSize:12,fontFamily:"monospace",borderRadius:4,outline:"none",boxSizing:"border-box"}}/>
        </div>

        <div style={{marginBottom:12}}>
          <div style={{fontSize:9,letterSpacing:2,color:C.muted,marginBottom:6}}>LOGO (EMOJI)</div>
          <input value={b.logo||""} onChange={e=>setB({...b,logo:e.target.value})}
            style={{width:"100%",background:C.bg,border:`1px solid ${C.border}`,color:C.text,padding:"8px 12px",fontSize:20,borderRadius:4,outline:"none",boxSizing:"border-box"}}/>
        </div>

        <div style={{marginBottom:12}}>
          <div style={{fontSize:9,letterSpacing:2,color:C.muted,marginBottom:8}}>PLANT / SITE</div>
          <input value={b.plant||""} onChange={e=>setB({...b,plant:e.target.value})} placeholder="Plant 1 / Ayutthaya"
            style={{width:"100%",background:C.bg,border:`1px solid ${C.border}`,color:C.text,padding:"8px 12px",fontSize:12,fontFamily:"monospace",borderRadius:4,outline:"none",boxSizing:"border-box"}}/>
        </div>

        <div style={{marginBottom:18}}>
          <div style={{fontSize:9,letterSpacing:2,color:C.muted,marginBottom:8}}>ACCENT COLOR</div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            {colors.map(col=>(
              <div key={col} onClick={()=>setB({...b,accentColor:col})}
                style={{width:30,height:30,borderRadius:"50%",background:col,cursor:"pointer",border:`3px solid ${b.accentColor===col?"#fff":"transparent"}`,boxShadow:b.accentColor===col?`0 0 10px ${col}`:""}}/>
            ))}
          </div>
        </div>

        {/* Preview */}
        <div style={{background:C.bg,border:`1px solid ${b.accentColor||C.accent}33`,borderRadius:6,padding:14,marginBottom:18,textAlign:"center"}}>
          <div style={{fontSize:28}}>{b.logo||"🏭"}</div>
          <div style={{fontSize:13,fontWeight:"bold",color:"#fff",fontFamily:"monospace",letterSpacing:2,marginTop:4}}>{b.companyName||"MY COMPANY"}</div>
          <div style={{fontSize:9,color:b.accentColor||C.accent,letterSpacing:2,marginTop:2}}>{b.plant||"PLANT"} · ATS REPORT v3</div>
        </div>

        <Btn full color={b.accentColor||C.accent} onClick={()=>{onSave(b);onClose();}}>💾 SAVE BRANDING</Btn>
      </div>
    </div>
  );
}

// ─── FILE DROP ZONE ───────────────────────────────────────────────────────────
function FileDropZone({ onData, onFilename, onHeaders }) {
  const [dragging, setDragging] = useState(false);
  const [info, setInfo] = useState(null);
  const ref = useRef();
  const process = file => {
    if (!file) return;
    const ext = file.name.split(".").pop().toLowerCase();
    const reader = new FileReader();
    if (["csv","txt"].includes(ext)) {
      reader.onload = e => {
        const t=e.target.result;
        onHeaders(t.split("\n")[0].split(",").map(h=>h.trim()));
        onData(t); onFilename(file.name);
        setInfo({name:file.name,size:(file.size/1024).toFixed(1)+"KB",type:"CSV"});
      };
      reader.readAsText(file);
    } else if (["xlsx","xls"].includes(ext)) {
      reader.onload = e => {
        try {
          const wb=XLSX.read(e.target.result,{type:"array"});
          const csv=XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]]);
          onHeaders(csv.split("\n")[0].split(",").map(h=>h.trim()));
          onData(csv); onFilename(file.name);
          setInfo({name:file.name,size:(file.size/1024).toFixed(1)+"KB",type:"EXCEL"});
        } catch { onData("ERROR: อ่านไฟล์ไม่ได้"); }
      };
      reader.readAsArrayBuffer(file);
    } else onData("ERROR: รองรับเฉพาะ .xlsx/.xls/.csv");
  };
  return (
    <div>
      <div onClick={()=>ref.current.click()}
        onDragOver={e=>{e.preventDefault();setDragging(true);}}
        onDragLeave={()=>setDragging(false)}
        onDrop={e=>{e.preventDefault();setDragging(false);process(e.dataTransfer.files[0]);}}
        style={{border:`2px dashed ${dragging?C.accent:C.border}`,borderRadius:6,padding:"18px 14px",textAlign:"center",cursor:"pointer",background:dragging?`${C.accent}08`:C.panel,transition:"all 0.2s",marginBottom:info?8:0}}>
        <div style={{fontSize:20,marginBottom:5}}>📂</div>
        <div style={{color:dragging?C.accent:C.text,fontSize:11,fontFamily:"monospace"}}>{dragging?"วางไฟล์ที่นี่...":"คลิกหรือลากไฟล์มาวาง"}</div>
        <div style={{color:C.muted,fontSize:9,marginTop:3,letterSpacing:1}}>xlsx · xls · csv</div>
        <input ref={ref} type="file" accept=".xlsx,.xls,.csv,.txt" style={{display:"none"}} onChange={e=>process(e.target.files[0])}/>
      </div>
      {info && (
        <div style={{display:"flex",alignItems:"center",gap:8,padding:"7px 10px",background:`${C.green}0a`,border:`1px solid ${C.green}33`,borderRadius:4,fontSize:10,fontFamily:"monospace"}}>
          <span style={{color:C.green}}>✓</span>
          <span style={{color:C.text,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{info.name}</span>
          <span style={{color:C.muted}}>{info.type} · {info.size}</span>
        </div>
      )}
    </div>
  );
}

// ─── EXPORT ───────────────────────────────────────────────────────────────────
function exportToExcel(result, filename, branding, user) {
  const wb = XLSX.utils.book_new();
  const sumData = [
    [`${branding.companyName||"ATS"} — REPORT`,""],
    ["Plant/Site", branding.plant||"-"],
    ["Generated by", user?.name||"Unknown"],
    ["Source File", filename||"Manual"],
    ["Generated", new Date().toLocaleString("th-TH")],
    ["",""],
    ["METRIC","VALUE"],
    ["Total Units", result.summary.totalUnits],
    ["Pass", result.summary.passCount],
    ["Fail", result.summary.failCount],
    ["FPY (%)", result.summary.fpy.toFixed(2)],
    ["Risk Level", result.riskLevel],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sumData), "Summary");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["TEST NAME","COUNT","% OF FAIL"],...(result.topFailures||[]).map(f=>[f.testName,f.count,f.percentage.toFixed(2)])]), "Top Failures");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["STATION","TESTED","FPY %"],...(result.stationPerformance||[]).map(s=>[s.station,s.tested,s.fpy.toFixed(2)])]), "Stations");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["AI INSIGHTS"],,...(result.insights||[]).map(i=>[i]),[""],["RECOMMENDATIONS"],,...(result.recommendations||[]).map(r=>[r])]), "AI Analysis");
  XLSX.writeFile(wb, `${(branding.companyName||"ATS").replace(/\s/g,"_")}_Report_${Date.now()}.xlsx`);
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
const SAMPLE = `STATION_ID,SERIAL_NUMBER,RESULT,TEST_NAME,MODE,TIMESTAMP
ST-01,SN001,PASS,FINAL_TEST,Production,2024-01-15 08:01
ST-01,SN002,FAIL,VOLTAGE_CHECK,Production,2024-01-15 08:05
ST-01,SN003,PASS,FINAL_TEST,Production,2024-01-15 08:10
ST-02,SN004,FAIL,CURRENT_LIMIT,Production,2024-01-15 08:12
ST-02,SN005,PASS,FINAL_TEST,Production,2024-01-15 08:15
ST-02,SN006,PASS,FINAL_TEST,Production,2024-01-15 08:20
ST-01,SN007,FAIL,VOLTAGE_CHECK,Production,2024-01-15 08:22
ST-03,SN008,PASS,FINAL_TEST,Production,2024-01-15 08:25
ST-03,SN009,FAIL,IMPEDANCE_TEST,Production,2024-01-15 08:30
ST-03,SN010,PASS,FINAL_TEST,Production,2024-01-15 08:35`;

export default function ATSApp() {
  const [user, setUser]         = useState(()=>store.get("ats_user"));
  const [branding, setBranding] = useState(()=>store.get("ats_brand",{companyName:"MY FACTORY",logo:"🏭",plant:"Plant 1",accentColor:"#00d4ff"}));
  const [showSettings, setShowSettings] = useState(false);
  const [input, setInput]       = useState("");
  const [inputMode, setInputMode]= useState("file");
  const [filename, setFilename] = useState("");
  const [headers, setHeaders]   = useState([]);
  const [showMapper, setShowMapper]= useState(false);
  const [mapping, setMapping]   = useState({});
  const [target, setTarget]     = useState(()=>store.get("ats_target",95));
  const [loading, setLoading]   = useState(false);
  const [result, setResult]     = useState(null);
  const [error, setError]       = useState("");
  const [progress, setProgress] = useState("");
  const [history, setHistory]   = useState(()=>store.get("ats_history",[]));
  const [activeTab, setActiveTab]= useState("result");

  const accent = branding.accentColor || C.accent;

  // Persist key state
  useEffect(()=>store.set("ats_target",target),[target]);
  useEffect(()=>store.set("ats_history",history),[history]);
  useEffect(()=>store.set("ats_brand",branding),[branding]);
  useEffect(()=>{ if(user) store.set("ats_user",user); },[user]);

  const logout = () => { store.set("ats_user",null); setUser(null); setResult(null); };

  const saveBranding = (b) => { setBranding(b); store.set("ats_brand",b); };

  const buildData = () => {
    if (!showMapper || !Object.keys(mapping).length) return input;
    const lines = input.split("\n");
    const orig = lines[0].split(",").map(h=>h.trim());
    const rev = {}; STD_COLS.forEach(s=>{ if(mapping[s]) rev[mapping[s]]=s; });
    return [orig.map(h=>rev[h]||h).join(","), ...lines.slice(1)].join("\n");
  };

  const analyze = async () => {
    if (!input.trim()) { setError("⚠ กรุณาอัปโหลดไฟล์หรือวางข้อมูลก่อน"); return; }
    if (input.startsWith("ERROR:")) { setError(input); return; }
    setLoading(true); setError(""); setResult(null);
    for (const s of ["🔍 อ่านข้อมูล...","🧮 คำนวณ FPY...","🤖 AI วิเคราะห์...","📊 สร้างรายงาน..."]) {
      setProgress(s); await new Promise(r=>setTimeout(r,600));
    }
    try {
      const res = await fetch("/api/analyze",{
        method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:1200,system:SYSTEM_PROMPT,
          messages:[{role:"user",content:`FPY Target:${target}%\nAnalyst:${user?.name}\n\n${buildData().slice(0,8000)}`}]})
      });
      const data = await res.json();
      const parsed = JSON.parse(data.content?.map(b=>b.text||"").join("").replace(/```json|```/g,"").trim());
      setResult(parsed);
      setActiveTab("result");
      const entry = {
        id:Date.now(), filename, user:user?.name,
        timestamp: new Date().toLocaleString("th-TH"),
        result: parsed
      };
      setHistory(prev=>[entry,...prev].slice(0,20));
    } catch { setError("❌ วิเคราะห์ไม่สำเร็จ ลองใหม่"); }
    setLoading(false); setProgress("");
  };

  const fpyColor = result?(result.summary.fpy>=target?C.green:result.summary.fpy>=target-15?C.yellow:C.red):accent;

  const Tab = ({k,label}) => (
    <button onClick={()=>setActiveTab(k)} style={{flex:1,padding:"7px",fontSize:9,letterSpacing:2,fontFamily:"monospace",cursor:"pointer",border:"none",borderRadius:3,background:activeTab===k?accent:"none",color:activeTab===k?"#000":C.muted,fontWeight:activeTab===k?"bold":"normal",transition:"all 0.15s"}}>{label}</button>
  );
  const ModeTab = ({k,label}) => (
    <button onClick={()=>setInputMode(k)} style={{flex:1,padding:"7px",fontSize:9,letterSpacing:2,fontFamily:"monospace",cursor:"pointer",border:"none",borderRadius:3,background:inputMode===k?accent:"none",color:inputMode===k?"#000":C.muted,fontWeight:inputMode===k?"bold":"normal",transition:"all 0.15s"}}>{label}</button>
  );

  // ── LOGIN GATE ──
  if (!user) return <LoginScreen branding={branding} onLogin={u=>{store.set("ats_user",u);setUser(u);}}/>;

  return (
    <div style={{minHeight:"100vh",background:C.bg,fontFamily:"'Courier New',monospace",color:C.text,paddingBottom:40}}>

      {/* TOP BAR */}
      <div style={{background:C.panel,borderBottom:`1px solid ${C.border}`,padding:"10px 18px",display:"flex",alignItems:"center",gap:10,position:"sticky",top:0,zIndex:10}}>
        <span style={{fontSize:20}}>{branding.logo||"🏭"}</span>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:11,fontWeight:"bold",color:"#fff",letterSpacing:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{branding.companyName||"MY FACTORY"}</div>
          <div style={{fontSize:8,color:accent,letterSpacing:2}}>{branding.plant||"PLANT"}</div>
        </div>
        <div style={{display:"flex",gap:6,alignItems:"center",flexShrink:0}}>
          {user.role==="Admin" && (
            <button onClick={()=>setShowSettings(true)} style={{background:"none",border:`1px solid ${C.border}`,color:C.muted,padding:"4px 8px",fontSize:9,cursor:"pointer",borderRadius:3,fontFamily:"monospace"}}>⚙</button>
          )}
          <div style={{textAlign:"right"}}>
            <div style={{fontSize:9,color:C.text}}>{user.name}</div>
            <div style={{fontSize:8,color:C.muted}}>{user.role}</div>
          </div>
          <button onClick={logout} style={{background:"none",border:`1px solid ${C.red}44`,color:C.red,padding:"4px 8px",fontSize:8,cursor:"pointer",borderRadius:3,fontFamily:"monospace",letterSpacing:1}}>OUT</button>
        </div>
      </div>

      <div style={{padding:"16px 18px"}}>

        {/* FPY TARGET */}
        <div style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:4,padding:"9px 14px",marginBottom:12,display:"flex",alignItems:"center",gap:10}}>
          <span style={{fontSize:9,letterSpacing:2,color:C.muted,whiteSpace:"nowrap"}}>🎯 TARGET</span>
          <input type="range" min={50} max={100} value={target} onChange={e=>setTarget(Number(e.target.value))} style={{flex:1,accentColor:accent}}/>
          <span style={{fontSize:14,fontWeight:"bold",color:C.yellow,fontFamily:"monospace",width:42,textAlign:"right"}}>{target}%</span>
        </div>

        {/* INPUT MODE */}
        <div style={{display:"flex",gap:4,marginBottom:10,padding:4,background:C.panel,borderRadius:5,border:`1px solid ${C.border}`}}>
          <ModeTab k="file" label="📂 FILE"/>
          <ModeTab k="paste" label="⌨ PASTE"/>
        </div>

        {inputMode==="file" && (
          <div style={{marginBottom:10}}>
            <FileDropZone onData={setInput} onFilename={setFilename} onHeaders={h=>{setHeaders(h);setShowMapper(!STD_COLS.every(s=>h.includes(s)));}}/>
            {input && !input.startsWith("ERROR:") && (
              <div style={{marginTop:8,padding:"9px 12px",background:C.panel,border:`1px solid ${C.border}`,borderRadius:4}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}>
                  <span style={{fontSize:9,color:C.muted,letterSpacing:2}}>▸ PREVIEW</span>
                  {headers.length>0 && !STD_COLS.every(s=>headers.includes(s)) && (
                    <button onClick={()=>setShowMapper(v=>!v)} style={{background:"none",border:`1px solid ${C.yellow}`,color:C.yellow,padding:"2px 7px",fontSize:8,cursor:"pointer",letterSpacing:1,borderRadius:2}}>
                      {showMapper?"HIDE":"⚙ MAP COLS"}
                    </button>
                  )}
                </div>
                <pre style={{margin:0,fontSize:9,color:C.text,overflow:"hidden",maxHeight:60,opacity:0.7,whiteSpace:"pre-wrap",wordBreak:"break-all"}}>
                  {input.split("\n").slice(0,4).join("\n")}{input.split("\n").length>4&&`\n... (+${input.split("\n").length-4} rows)`}
                </pre>
              </div>
            )}
            {showMapper && headers.length>0 && (
              <div style={{marginTop:8,background:C.panel,border:`1px solid ${C.yellow}33`,borderRadius:4,padding:12}}>
                <div style={{fontSize:9,letterSpacing:2,color:C.yellow,marginBottom:8}}>⚙ MAP COLUMNS</div>
                {STD_COLS.map(std=>(
                  <div key={std} style={{display:"flex",alignItems:"center",gap:6,marginBottom:7}}>
                    <span style={{fontSize:9,color:C.muted,fontFamily:"monospace",width:110,flexShrink:0}}>{std}</span>
                    <select value={mapping[std]||""} onChange={e=>setMapping({...mapping,[std]:e.target.value})}
                      style={{flex:1,background:C.bg,border:`1px solid ${C.border}`,color:C.text,padding:"4px 6px",fontSize:9,fontFamily:"monospace",borderRadius:3,outline:"none"}}>
                      <option value="">— ข้าม —</option>
                      {headers.map(h=><option key={h} value={h}>{h}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {inputMode==="paste" && (
          <div style={{marginBottom:10}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
              <span style={{fontSize:9,letterSpacing:2,color:C.muted}}>▸ CSV / SQL RESULT</span>
              <button onClick={()=>{setInput(SAMPLE);setFilename("");}} style={{background:"none",border:`1px solid ${C.accentDim}`,color:accent,padding:"3px 8px",fontSize:8,cursor:"pointer",letterSpacing:1,borderRadius:2}}>SAMPLE</button>
            </div>
            <textarea value={input} onChange={e=>{setInput(e.target.value);setFilename("");setHeaders([]);}}
              placeholder="วาง CSV หรือ SQL result ที่นี่..."
              style={{width:"100%",minHeight:120,background:C.panel,border:`1px solid ${C.border}`,color:C.text,padding:10,fontSize:10,lineHeight:1.6,resize:"vertical",outline:"none",borderRadius:4,boxSizing:"border-box",fontFamily:"monospace"}}/>
          </div>
        )}

        {error && <div style={{color:C.red,fontSize:10,marginBottom:10,padding:"7px 10px",border:`1px solid ${C.red}33`,borderRadius:4,background:`${C.red}0a`}}>{error}</div>}

        <button onClick={analyze} disabled={loading} style={{width:"100%",padding:"12px",background:loading?"#1e2530":accent,color:loading?accent:"#000",border:"none",fontSize:11,fontWeight:"bold",letterSpacing:3,cursor:loading?"not-allowed":"pointer",borderRadius:4,fontFamily:"monospace",transition:"all 0.2s",boxShadow:loading?"none":`0 0 18px ${accent}44`,marginBottom:18}}>
          {loading?progress:"▶ ANALYZE NOW"}
        </button>

        {/* TABS */}
        {(result||history.length>0) && (
          <>
            <div style={{display:"flex",gap:4,marginBottom:14,padding:4,background:C.panel,borderRadius:5,border:`1px solid ${C.border}`}}>
              <Tab k="result" label="📊 RESULT"/>
              <Tab k="history" label={`🕒 HISTORY (${history.length})`}/>
            </div>

            {/* ── RESULT TAB ── */}
            {activeTab==="result" && result && (
              <div>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                  <RiskBadge level={result.riskLevel}/>
                  <button onClick={()=>exportToExcel(result,filename,branding,user)} style={{background:C.green,color:"#000",border:"none",padding:"5px 12px",fontSize:9,fontWeight:"bold",letterSpacing:2,cursor:"pointer",borderRadius:3,fontFamily:"monospace"}}>
                    ⬇ EXPORT .xlsx
                  </button>
                </div>
                <div style={{display:"flex",justifyContent:"center",marginBottom:12}}>
                  <Gauge value={result.summary.fpy} target={target} color={fpyColor}/>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6,marginBottom:12}}>
                  {[["TESTED",result.summary.totalUnits,accent],["PASS",result.summary.passCount,C.green],["FAIL",result.summary.failCount,C.red]].map(([l,v,col])=>(
                    <div key={l} style={{background:C.panel,border:`1px solid ${C.border}`,padding:"9px 5px",borderRadius:4,textAlign:"center"}}>
                      <div style={{fontSize:19,fontWeight:"bold",color:col}}>{v}</div>
                      <div style={{fontSize:8,color:C.muted,letterSpacing:2,marginTop:1}}>{l}</div>
                    </div>
                  ))}
                </div>
                {result.topFailures?.length>0 && (
                  <div style={{background:C.panel,border:`1px solid ${C.border}`,padding:12,borderRadius:4,marginBottom:8}}>
                    <div style={{fontSize:9,letterSpacing:2,color:C.muted,marginBottom:8}}>▸ TOP FAILURES</div>
                    <BarChart data={result.topFailures} color={C.red}/>
                  </div>
                )}
                {result.stationPerformance?.length>0 && (
                  <div style={{background:C.panel,border:`1px solid ${C.border}`,padding:12,borderRadius:4,marginBottom:8}}>
                    <div style={{fontSize:9,letterSpacing:2,color:C.muted,marginBottom:8}}>▸ STATION PERFORMANCE</div>
                    {result.stationPerformance.map((s,i)=>{
                      const col=s.fpy>=target?C.green:s.fpy>=target-15?C.yellow:C.red;
                      return (
                        <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"5px 0",borderBottom:`1px solid ${C.border}`}}>
                          <span style={{fontSize:11}}>{s.station}</span>
                          <div style={{display:"flex",gap:10,alignItems:"center"}}>
                            <span style={{fontSize:9,color:C.muted}}>{s.tested} pcs</span>
                            <span style={{color:col,fontWeight:"bold",fontSize:12}}>{s.fpy.toFixed(1)}%</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                <div style={{background:C.panel,border:`1px solid ${C.border}`,padding:12,borderRadius:4,marginBottom:8}}>
                  <div style={{fontSize:9,letterSpacing:2,color:C.muted,marginBottom:7}}>▸ AI INSIGHTS</div>
                  {result.insights?.map((ins,i)=>(
                    <div key={i} style={{display:"flex",gap:7,marginBottom:7,fontSize:11,lineHeight:1.5}}>
                      <span style={{color:accent}}>◆</span><span>{ins}</span>
                    </div>
                  ))}
                </div>
                <div style={{background:`${C.green}0a`,border:`1px solid ${C.green}33`,padding:12,borderRadius:4}}>
                  <div style={{fontSize:9,letterSpacing:2,color:C.green,marginBottom:7}}>▸ RECOMMENDATIONS</div>
                  {result.recommendations?.map((rec,i)=>(
                    <div key={i} style={{display:"flex",gap:7,marginBottom:7,fontSize:11,lineHeight:1.5}}>
                      <span style={{color:C.green}}>→</span><span>{rec}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── HISTORY TAB ── */}
            {activeTab==="history" && (
              <div>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                  <span style={{fontSize:9,color:C.muted,letterSpacing:2}}>▸ ALL ANALYSES ({history.length})</span>
                  {user.role==="Admin" && history.length>0 && (
                    <button onClick={()=>{if(confirm("ลบประวัติทั้งหมด?"))setHistory([]);}} style={{background:"none",border:`1px solid ${C.red}44`,color:C.red,padding:"3px 8px",fontSize:8,cursor:"pointer",borderRadius:2,fontFamily:"monospace"}}>🗑 CLEAR</button>
                  )}
                </div>
                {history.length===0 && <div style={{color:C.muted,fontSize:11,textAlign:"center",padding:24}}>ยังไม่มีประวัติ</div>}
                <div style={{display:"flex",flexDirection:"column",gap:7}}>
                  {history.map(h=>{
                    const col=h.result.summary.fpy>=target?C.green:h.result.summary.fpy>=target-15?C.yellow:C.red;
                    const isSel = result && h.result===result;
                    return (
                      <div key={h.id} onClick={()=>{setResult(h.result);setActiveTab("result");}}
                        style={{padding:"10px 12px",background:isSel?`${accent}15`:C.panel,border:`1px solid ${isSel?accent:C.border}`,borderRadius:4,cursor:"pointer",transition:"all 0.15s"}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
                          <span style={{fontSize:9,color:C.muted,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:160}}>{h.filename||"Pasted"}</span>
                          <RiskBadge level={h.result.riskLevel}/>
                        </div>
                        <div style={{display:"flex",alignItems:"center",gap:10}}>
                          <span style={{fontSize:17,fontWeight:"bold",color:col,fontFamily:"monospace"}}>{h.result.summary.fpy.toFixed(1)}%</span>
                          <div style={{flex:1,height:5,background:C.border,borderRadius:3,overflow:"hidden"}}>
                            <div style={{height:"100%",width:`${h.result.summary.fpy}%`,background:col,borderRadius:3}}/>
                          </div>
                        </div>
                        <div style={{fontSize:8,color:C.muted,marginTop:4,display:"flex",gap:10}}>
                          <span>👤 {h.user||"-"}</span>
                          <span>🕒 {h.timestamp}</span>
                          <span>📦 {h.result.summary.totalUnits} units</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* SETTINGS MODAL */}
      {showSettings && <SettingsPanel branding={branding} user={user} onSave={saveBranding} onClose={()=>setShowSettings(false)}/>}

      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}} textarea::placeholder{color:#2d3748} input[type=range]{height:4px}`}</style>
    </div>
  );
}
