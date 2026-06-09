import { useState, useRef } from "react";

const SYSTEM_PROMPT = `You are an ATS (Automated Test System) data analyst for electronics manufacturing. 
Analyze the provided test data and return ONLY a JSON object (no markdown, no backticks) with this structure:
{
  "summary": {
    "totalUnits": number,
    "passCount": number,
    "failCount": number,
    "fpy": number (0-100, percentage),
    "analysisDate": "string"
  },
  "topFailures": [
    { "testName": "string", "count": number, "percentage": number }
  ],
  "stationPerformance": [
    { "station": "string", "fpy": number, "tested": number }
  ],
  "insights": ["string", "string", "string"],
  "recommendations": ["string", "string"],
  "riskLevel": "LOW" | "MEDIUM" | "HIGH"
}
Infer reasonable values from the data provided. If data is incomplete, make reasonable manufacturing assumptions.`;

const COLORS = {
  bg: "#0a0c0f",
  panel: "#111318",
  border: "#1e2530",
  accent: "#00d4ff",
  accentDim: "#0a4a5e",
  green: "#00ff88",
  red: "#ff3b5c",
  yellow: "#ffcc00",
  text: "#c8d4e0",
  muted: "#4a5568",
};

function GaugeChart({ value, label, color }) {
  const r = 52;
  const cx = 64, cy = 64;
  const arc = (v) => {
    const angle = -220 + (v / 100) * 260;
    const rad = (a) => (a * Math.PI) / 180;
    return {
      x: cx + r * Math.cos(rad(angle)),
      y: cy + r * Math.sin(rad(angle)),
    };
  };
  const bg = arc(0), fg = arc(value);
  const largeArc = value > 50 ? 1 : 0;
  const startAngle = -220;
  const startRad = (startAngle * Math.PI) / 180;
  const startX = cx + r * Math.cos(startRad);
  const startY = cy + r * Math.sin(startRad);

  return (
    <svg width="128" height="100" viewBox="0 0 128 100">
      <path
        d={`M ${startX} ${startY} A ${r} ${r} 0 1 1 ${bg.x} ${bg.y}`}
        fill="none" stroke={COLORS.border} strokeWidth="8" strokeLinecap="round"
      />
      {value > 0 && (
        <path
          d={`M ${startX} ${startY} A ${r} ${r} 0 ${largeArc} 1 ${fg.x} ${fg.y}`}
          fill="none" stroke={color} strokeWidth="8" strokeLinecap="round"
          style={{ filter: `drop-shadow(0 0 6px ${color})` }}
        />
      )}
      <text x="64" y="72" textAnchor="middle" fill={color} fontSize="20" fontFamily="'Courier New', monospace" fontWeight="bold">
        {value.toFixed(1)}%
      </text>
      <text x="64" y="88" textAnchor="middle" fill={COLORS.muted} fontSize="9" fontFamily="'Courier New', monospace" letterSpacing="1">
        {label}
      </text>
    </svg>
  );
}

function BarChart({ data, color }) {
  const max = Math.max(...data.map((d) => d.count), 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {data.slice(0, 5).map((item, i) => (
        <div key={i}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
            <span style={{ color: COLORS.text, fontSize: 11, fontFamily: "monospace", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {item.testName}
            </span>
            <span style={{ color, fontSize: 11, fontFamily: "monospace" }}>{item.count} ({item.percentage.toFixed(1)}%)</span>
          </div>
          <div style={{ height: 6, background: COLORS.border, borderRadius: 3, overflow: "hidden" }}>
            <div style={{
              height: "100%", width: `${(item.count / max) * 100}%`,
              background: color, borderRadius: 3,
              boxShadow: `0 0 8px ${color}`,
              transition: "width 0.8s ease",
            }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function RiskBadge({ level }) {
  const map = { LOW: [COLORS.green, "▼ LOW RISK"], MEDIUM: [COLORS.yellow, "◆ MEDIUM RISK"], HIGH: [COLORS.red, "▲ HIGH RISK"] };
  const [color, label] = map[level] || [COLORS.muted, "UNKNOWN"];
  return (
    <span style={{
      padding: "4px 12px", borderRadius: 2, fontSize: 11, fontFamily: "monospace",
      fontWeight: "bold", letterSpacing: 2, color, border: `1px solid ${color}`,
      boxShadow: `0 0 12px ${color}33`, background: `${color}11`,
    }}>{label}</span>
  );
}

export default function ATSReportGenerator() {
  const [input, setState_input] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const textRef = useRef();

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

  const analyze = async () => {
    if (!input.trim()) { setError("⚠ กรุณาวางข้อมูล ATS ก่อน"); return; }
    setLoading(true); setError(""); setResult(null);
    const steps = ["🔍 กำลังอ่านข้อมูล...", "🧮 คำนวณ FPY...", "🤖 AI วิเคราะห์ pattern...", "📊 สร้างรายงาน..."];
    for (let s of steps) { setProgress(s); await new Promise(r => setTimeout(r, 600)); }
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: `Analyze this ATS data:\n\n${input}` }],
        }),
      });
      const data = await res.json();
      const text = data.content?.map(b => b.text || "").join("") || "";
      const clean = text.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(clean);
      setResult(parsed);
    } catch (e) {
      setError("❌ วิเคราะห์ไม่สำเร็จ ลองใหม่อีกครั้ง");
    }
    setLoading(false); setProgress("");
  };

  const fpyColor = result ? (result.summary.fpy >= 90 ? COLORS.green : result.summary.fpy >= 70 ? COLORS.yellow : COLORS.red) : COLORS.accent;

  return (
    <div style={{ minHeight: "100vh", background: COLORS.bg, fontFamily: "'Courier New', monospace", color: COLORS.text, padding: "24px 20px" }}>
      
      {/* Header */}
      <div style={{ borderBottom: `1px solid ${COLORS.border}`, paddingBottom: 16, marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: COLORS.accent, boxShadow: `0 0 10px ${COLORS.accent}`, animation: "pulse 2s infinite" }} />
          <span style={{ color: COLORS.accent, fontSize: 11, letterSpacing: 3 }}>ATS ANALYSIS SYSTEM v1.0</span>
        </div>
        <h1 style={{ margin: 0, fontSize: 22, color: "#fff", letterSpacing: 2, fontWeight: "bold" }}>
          ATS REPORT GENERATOR
        </h1>
        <p style={{ margin: "4px 0 0", color: COLORS.muted, fontSize: 11, letterSpacing: 1 }}>
          Manufacturing Test Intelligence Platform · Powered by AI
        </p>
      </div>

      {/* Input Section */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <span style={{ fontSize: 11, letterSpacing: 2, color: COLORS.muted }}>▸ INPUT DATA</span>
          <button onClick={() => setState_input(SAMPLE)} style={{
            background: "none", border: `1px solid ${COLORS.accentDim}`, color: COLORS.accent,
            padding: "4px 10px", fontSize: 10, cursor: "pointer", letterSpacing: 1, borderRadius: 2,
          }}>LOAD SAMPLE</button>
        </div>
        <textarea
          ref={textRef}
          value={input}
          onChange={e => setState_input(e.target.value)}
          placeholder={"วาง CSV หรือ SQL result ที่นี่...\n\nรองรับ: STATION_ID, SERIAL_NUMBER, RESULT, TEST_NAME, MODE, TIMESTAMP"}
          style={{
            width: "100%", minHeight: 140, background: COLORS.panel, border: `1px solid ${COLORS.border}`,
            color: COLORS.text, padding: 14, fontSize: 11, lineHeight: 1.6, resize: "vertical",
            outline: "none", borderRadius: 4, boxSizing: "border-box", fontFamily: "monospace",
          }}
        />
      </div>

      {error && <div style={{ color: COLORS.red, fontSize: 12, marginBottom: 12, padding: "8px 12px", border: `1px solid ${COLORS.red}33`, borderRadius: 4, background: `${COLORS.red}0a` }}>{error}</div>}

      <button
        onClick={analyze}
        disabled={loading}
        style={{
          width: "100%", padding: "14px", background: loading ? COLORS.accentDim : COLORS.accent,
          color: loading ? COLORS.accent : "#000", border: "none", fontSize: 13, fontWeight: "bold",
          letterSpacing: 3, cursor: loading ? "not-allowed" : "pointer", borderRadius: 4,
          fontFamily: "monospace", transition: "all 0.2s",
          boxShadow: loading ? "none" : `0 0 20px ${COLORS.accent}44`,
        }}
      >
        {loading ? progress : "▶ ANALYZE NOW"}
      </button>

      {/* Results */}
      {result && (
        <div style={{ marginTop: 28 }}>
          <div style={{ borderTop: `1px solid ${COLORS.border}`, paddingTop: 20, marginBottom: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <span style={{ fontSize: 11, letterSpacing: 2, color: COLORS.muted }}>▸ ANALYSIS RESULT</span>
              <RiskBadge level={result.riskLevel} />
            </div>

            {/* FPY Gauge */}
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
              <GaugeChart value={result.summary.fpy} label="FIRST PASS YIELD" color={fpyColor} />
            </div>

            {/* Stats Grid */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 20 }}>
              {[
                ["TESTED", result.summary.totalUnits, COLORS.accent],
                ["PASS", result.summary.passCount, COLORS.green],
                ["FAIL", result.summary.failCount, COLORS.red],
              ].map(([label, val, color]) => (
                <div key={label} style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, padding: "12px 8px", borderRadius: 4, textAlign: "center" }}>
                  <div style={{ fontSize: 20, fontWeight: "bold", color }}>{val}</div>
                  <div style={{ fontSize: 9, color: COLORS.muted, letterSpacing: 2, marginTop: 2 }}>{label}</div>
                </div>
              ))}
            </div>

            {/* Top Failures */}
            {result.topFailures?.length > 0 && (
              <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, padding: 16, borderRadius: 4, marginBottom: 12 }}>
                <div style={{ fontSize: 10, letterSpacing: 2, color: COLORS.muted, marginBottom: 12 }}>▸ TOP FAILURE MODES</div>
                <BarChart data={result.topFailures} color={COLORS.red} />
              </div>
            )}

            {/* Station Performance */}
            {result.stationPerformance?.length > 0 && (
              <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, padding: 16, borderRadius: 4, marginBottom: 12 }}>
                <div style={{ fontSize: 10, letterSpacing: 2, color: COLORS.muted, marginBottom: 12 }}>▸ STATION PERFORMANCE</div>
                {result.stationPerformance.map((s, i) => {
                  const c = s.fpy >= 90 ? COLORS.green : s.fpy >= 70 ? COLORS.yellow : COLORS.red;
                  return (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: `1px solid ${COLORS.border}` }}>
                      <span style={{ fontSize: 12 }}>{s.station}</span>
                      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                        <span style={{ fontSize: 10, color: COLORS.muted }}>{s.tested} units</span>
                        <span style={{ color: c, fontWeight: "bold", fontSize: 13 }}>{s.fpy.toFixed(1)}%</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Insights */}
            <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, padding: 16, borderRadius: 4, marginBottom: 12 }}>
              <div style={{ fontSize: 10, letterSpacing: 2, color: COLORS.muted, marginBottom: 10 }}>▸ AI INSIGHTS</div>
              {result.insights?.map((ins, i) => (
                <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8, fontSize: 12, lineHeight: 1.5 }}>
                  <span style={{ color: COLORS.accent }}>◆</span>
                  <span>{ins}</span>
                </div>
              ))}
            </div>

            {/* Recommendations */}
            <div style={{ background: `${COLORS.green}0a`, border: `1px solid ${COLORS.green}33`, padding: 16, borderRadius: 4 }}>
              <div style={{ fontSize: 10, letterSpacing: 2, color: COLORS.green, marginBottom: 10 }}>▸ RECOMMENDATIONS</div>
              {result.recommendations?.map((rec, i) => (
                <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8, fontSize: 12, lineHeight: 1.5 }}>
                  <span style={{ color: COLORS.green }}>→</span>
                  <span>{rec}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        textarea::placeholder { color: #2d3748; }
        button:hover:not(:disabled) { opacity: 0.9; transform: translateY(-1px); }
      `}</style>
    </div>
  );
}
