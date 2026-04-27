// Quantitative Investment Strategy Learning Platform
// Full-featured single-file React app with simulated backtesting engine

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine
} from "recharts";

// ─── SIMULATED MARKET DATA ENGINE ───────────────────────────────────────────

const SEED_PRICES = {
  AAPL: { start: 145, vol: 0.018, drift: 0.0004 },
  TSLA: { start: 220, vol: 0.035, drift: 0.0003 },
  MSFT: { start: 310, vol: 0.015, drift: 0.0005 },
  NVDA: { start: 280, vol: 0.04, drift: 0.0008 },
  AMZN: { start: 185, vol: 0.022, drift: 0.0004 },
};

function generatePriceData(ticker, startDate, endDate) {
  const { start, vol, drift } = SEED_PRICES[ticker] || SEED_PRICES.AAPL;
  const dates = [];
  const cur = new Date(startDate);
  const end = new Date(endDate);
  let price = start;
  let seed = ticker.charCodeAt(0) * 7 + ticker.charCodeAt(1) * 13;
  const rng = () => {
    seed = (seed * 1664525 + 1013904223) & 0xffffffff;
    return (seed >>> 0) / 0xffffffff;
  };
  while (cur <= end) {
    const day = cur.getDay();
    if (day !== 0 && day !== 6) {
      const z1 = rng(), z2 = rng();
      const norm = Math.sqrt(-2 * Math.log(z1 + 1e-10)) * Math.cos(2 * Math.PI * z2);
      price = price * Math.exp(drift + vol * norm);
      price = Math.max(price, 1);
      dates.push({ date: cur.toISOString().split("T")[0], close: +price.toFixed(2) });
    }
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

// ─── BACKTESTING ENGINE ──────────────────────────────────────────────────────

function runBuyAndHold(prices) {
  const initial = 10000;
  const shares = initial / prices[0].close;
  return prices.map(p => ({
    date: p.date,
    portfolio: +(shares * p.close).toFixed(2),
    signal: "hold"
  }));
}

function runMovingAverage(prices, shortW = 20, longW = 50) {
  let cash = 10000, shares = 0;
  const result = [];
  for (let i = 0; i < prices.length; i++) {
    const p = prices[i].close;
    const shortSlice = prices.slice(Math.max(0, i - shortW + 1), i + 1);
    const longSlice = prices.slice(Math.max(0, i - longW + 1), i + 1);
    const sma_s = shortSlice.reduce((a, b) => a + b.close, 0) / shortSlice.length;
    const sma_l = longSlice.reduce((a, b) => a + b.close, 0) / longSlice.length;
    let signal = "hold";
    if (i >= longW) {
      const prev_s = prices.slice(Math.max(0, i - shortW), i).reduce((a, b) => a + b.close, 0) / shortW;
      const prev_l = prices.slice(Math.max(0, i - longW), i).reduce((a, b) => a + b.close, 0) / longW;
      if (sma_s > sma_l && prev_s <= prev_l && shares === 0) {
        shares = cash / p; cash = 0; signal = "buy";
      } else if (sma_s < sma_l && prev_s >= prev_l && shares > 0) {
        cash = shares * p; shares = 0; signal = "sell";
      }
    }
    result.push({ date: prices[i].date, portfolio: +(cash + shares * p).toFixed(2), signal });
  }
  return result;
}

function runMomentum(prices, lookback = 20) {
  let cash = 10000, shares = 0;
  const result = [];
  for (let i = 0; i < prices.length; i++) {
    const p = prices[i].close;
    let signal = "hold";
    if (i >= lookback) {
      const ret = (p - prices[i - lookback].close) / prices[i - lookback].close;
      if (ret > 0.05 && shares === 0) { shares = cash / p; cash = 0; signal = "buy"; }
      else if (ret < -0.03 && shares > 0) { cash = shares * p; shares = 0; signal = "sell"; }
    }
    result.push({ date: prices[i].date, portfolio: +(cash + shares * p).toFixed(2), signal });
  }
  return result;
}

function runOptimal(prices) {
  // Perfect hindsight: buy every dip, sell every peak
  let cash = 10000, shares = 0;
  const result = [];
  for (let i = 0; i < prices.length; i++) {
    const p = prices[i].close;
    const next = prices[i + 1]?.close;
    let signal = "hold";
    if (next) {
      if (next > p && shares === 0) { shares = cash / p; cash = 0; signal = "buy"; }
      else if (next < p && shares > 0) { cash = shares * p; shares = 0; signal = "sell"; }
    }
    result.push({ date: prices[i].date, portfolio: +(cash + shares * p).toFixed(2), signal });
  }
  return result;
}

function calcMetrics(portfolio) {
  const returns = [];
  for (let i = 1; i < portfolio.length; i++) {
    returns.push((portfolio[i].portfolio - portfolio[i - 1].portfolio) / portfolio[i - 1].portfolio);
  }
  const totalReturn = ((portfolio.at(-1).portfolio - 10000) / 10000 * 100).toFixed(2);
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length;
  const vol = (Math.sqrt(variance) * Math.sqrt(252) * 100).toFixed(2);
  let peak = 10000, maxDD = 0;
  portfolio.forEach(p => {
    if (p.portfolio > peak) peak = p.portfolio;
    const dd = (peak - p.portfolio) / peak;
    if (dd > maxDD) maxDD = dd;
  });
  const riskFree = 0.05 / 252;
  const excessReturns = returns.map(r => r - riskFree);
  const excessMean = excessReturns.reduce((a, b) => a + b, 0) / excessReturns.length;
  const excessStd = Math.sqrt(excessReturns.reduce((a, b) => a + (b - excessMean) ** 2, 0) / excessReturns.length);
  const sharpe = excessStd > 0 ? ((excessMean / excessStd) * Math.sqrt(252)).toFixed(2) : "N/A";
  return { totalReturn, vol, maxDrawdown: (maxDD * 100).toFixed(2), sharpe };
}

// ─── DESIGN TOKENS ───────────────────────────────────────────────────────────

const C = {
  bg: "#080C14",
  surface: "#0D1221",
  card: "#111827",
  border: "#1E293B",
  borderHover: "#334155",
  cyan: "#22D3EE",
  purple: "#A855F7",
  green: "#10B981",
  red: "#F87171",
  amber: "#FBBF24",
  text: "#F1F5F9",
  muted: "#64748B",
  dim: "#94A3B8",
};

const STRATEGY_COLORS = {
  "Buy & Hold": "#22D3EE",
  "Moving Average": "#A855F7",
  Momentum: "#10B981",
  Optimal: "#FBBF24",
};

// ─── MICRO COMPONENTS ────────────────────────────────────────────────────────

function Badge({ children, color = C.cyan }) {
  return (
    <span style={{
      background: color + "22", color, border: `1px solid ${color}44`,
      borderRadius: 6, padding: "2px 10px", fontSize: 11, fontWeight: 600,
      letterSpacing: "0.06em", textTransform: "uppercase"
    }}>{children}</span>
  );
}

function Tooltip2({ content, children }) {
  const [show, setShow] = useState(false);
  return (
    <span style={{ position: "relative", display: "inline-block" }}
      onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      {children}
      {show && (
        <span style={{
          position: "absolute", bottom: "calc(100% + 8px)", left: "50%",
          transform: "translateX(-50%)", background: "#1E293B",
          border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 12px",
          fontSize: 12, color: C.dim, width: 220, zIndex: 100,
          boxShadow: "0 8px 32px #00000088", lineHeight: 1.5, pointerEvents: "none"
        }}>{content}</span>
      )}
    </span>
  );
}

function InfoIcon({ tip }) {
  return (
    <Tooltip2 content={tip}>
      <span style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: 16, height: 16, borderRadius: "50%",
        border: `1px solid ${C.muted}`, color: C.muted,
        fontSize: 10, cursor: "help", marginLeft: 6, fontStyle: "italic", fontWeight: 700
      }}>i</span>
    </Tooltip2>
  );
}

function MetricCard({ label, value, sub, tip, color = C.cyan }) {
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`,
      borderRadius: 12, padding: "16px 20px",
      borderTop: `2px solid ${color}44`
    }}>
      <div style={{ fontSize: 12, color: C.muted, marginBottom: 4, display: "flex", alignItems: "center" }}>
        {label}{tip && <InfoIcon tip={tip} />}
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, color, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function GlowButton({ children, onClick, loading, variant = "primary", style = {} }) {
  const [hover, setHover] = useState(false);
  const [active, setActive] = useState(false);
  const base = variant === "primary"
    ? { bg: `linear-gradient(135deg, ${C.cyan}CC, ${C.purple}CC)`, color: "#fff" }
    : { bg: "transparent", color: C.cyan };
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); setActive(false); }}
      onMouseDown={() => setActive(true)}
      onMouseUp={() => setActive(false)}
      disabled={loading}
      style={{
        background: variant === "primary" ? base.bg : "transparent",
        color: base.color, border: `1px solid ${C.cyan}88`,
        borderRadius: 10, padding: "10px 22px", fontSize: 14, fontWeight: 600,
        cursor: loading ? "not-allowed" : "pointer", letterSpacing: "0.02em",
        transition: "all 0.2s", outline: "none", fontFamily: "inherit",
        transform: active ? "scale(0.97)" : hover ? "scale(1.02)" : "scale(1)",
        boxShadow: hover ? `0 0 24px ${C.cyan}44` : "none",
        opacity: loading ? 0.6 : 1, ...style
      }}>
      {loading ? "⟳ Running…" : children}
    </button>
  );
}

// ─── CUSTOM RECHARTS TOOLTIP ─────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: "#1E293B", border: `1px solid ${C.border}`,
      borderRadius: 10, padding: "10px 14px", fontSize: 12
    }}>
      <div style={{ color: C.dim, marginBottom: 6 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color, marginBottom: 2 }}>
          {p.name}: <strong>${(+p.value).toLocaleString()}</strong>
        </div>
      ))}
    </div>
  );
}

// ─── LANDING PAGE ────────────────────────────────────────────────────────────

function LandingPage({ onNav }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => { setTimeout(() => setVisible(true), 100); }, []);

  return (
    <div style={{ minHeight: "100vh", position: "relative", overflow: "hidden" }}>
      {/* animated gradient bg */}
      <div style={{
        position: "fixed", inset: 0, zIndex: 0,
        background: `radial-gradient(ellipse 80% 60% at 50% -10%, ${C.cyan}18, transparent),
                      radial-gradient(ellipse 60% 40% at 80% 80%, ${C.purple}14, transparent),
                      ${C.bg}`
      }} />
      {/* grid overlay */}
      <div style={{
        position: "fixed", inset: 0, zIndex: 0, opacity: 0.04,
        backgroundImage: `linear-gradient(${C.cyan} 1px, transparent 1px), linear-gradient(90deg, ${C.cyan} 1px, transparent 1px)`,
        backgroundSize: "60px 60px"
      }} />

      <div style={{ position: "relative", zIndex: 1, maxWidth: 900, margin: "0 auto", padding: "0 24px" }}>
        {/* Hero */}
        <div style={{
          paddingTop: 120, paddingBottom: 80, textAlign: "center",
          opacity: visible ? 1 : 0, transform: visible ? "translateY(0)" : "translateY(32px)",
          transition: "all 0.8s cubic-bezier(0.16,1,0.3,1)"
        }}>
          <Badge color={C.cyan}>Quantitative Finance Platform</Badge>
          <h1 style={{
            marginTop: 24, fontSize: 62, fontWeight: 800, lineHeight: 1.1,
            background: `linear-gradient(135deg, ${C.text} 0%, ${C.cyan} 50%, ${C.purple} 100%)`,
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
            backgroundClip: "text"
          }}>
            Trade Smarter.<br />Backtest Deeper.
          </h1>
          <p style={{ color: C.dim, fontSize: 19, maxWidth: 560, margin: "20px auto 40px", lineHeight: 1.7 }}>
            Learn institutional-grade trading strategies, run historical simulations,
            and dissect performance analytics — all in one platform.
          </p>
          <div style={{ display: "flex", gap: 16, justifyContent: "center", flexWrap: "wrap" }}>
            <GlowButton onClick={() => onNav("simulation")} variant="primary">
              ↗ Start Simulation
            </GlowButton>
            <GlowButton onClick={() => onNav("strategies")} variant="outline">
              Explore Strategies
            </GlowButton>
          </div>
        </div>

        {/* Stats bar */}
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 1,
          background: C.border, borderRadius: 16, overflow: "hidden",
          opacity: visible ? 1 : 0, transition: "all 1s 0.3s",
          marginBottom: 80
        }}>
          {[["3 Strategies", "Buy & Hold · MA · Momentum"],
            ["Real Algorithms", "Time-series simulation engine"],
            ["6 Key Metrics", "Sharpe · Drawdown · Volatility"]
          ].map(([h, s]) => (
            <div key={h} style={{ background: C.surface, padding: "28px 24px", textAlign: "center" }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: C.text }}>{h}</div>
              <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>{s}</div>
            </div>
          ))}
        </div>

        {/* Feature cards */}
        <div style={{ marginBottom: 100 }}>
          <SectionLabel>What is Backtesting?</SectionLabel>
          <p style={{ color: C.dim, fontSize: 16, lineHeight: 1.8, marginBottom: 40 }}>
            Backtesting applies a trading strategy to historical market data to evaluate how it
            would have performed. By simulating trades over past price movements, you can measure
            return, risk, and robustness before committing real capital.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
            {[
              { icon: "◈", title: "Strategy Evaluation", desc: "Compare algorithms on identical market conditions", c: C.cyan },
              { icon: "◉", title: "Risk Quantification", desc: "Measure max drawdown, volatility, Sharpe ratio", c: C.purple },
              { icon: "◆", title: "Optimal Benchmarking", desc: "Compare against perfect hindsight performance", c: C.amber },
            ].map(f => (
              <FeatureCard key={f.title} {...f} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ children }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
      <div style={{ width: 3, height: 18, background: `linear-gradient(${C.cyan}, ${C.purple})`, borderRadius: 2 }} />
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", color: C.muted, textTransform: "uppercase" }}>{children}</span>
    </div>
  );
}

function FeatureCard({ icon, title, desc, c }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: C.card, border: `1px solid ${hover ? c + "66" : C.border}`,
        borderRadius: 14, padding: "24px 20px",
        transform: hover ? "translateY(-4px)" : "translateY(0)",
        boxShadow: hover ? `0 12px 40px ${c}22` : "none",
        transition: "all 0.3s cubic-bezier(0.34,1.56,0.64,1)"
      }}>
      <div style={{ fontSize: 28, marginBottom: 12, color: c }}>{icon}</div>
      <div style={{ fontWeight: 700, fontSize: 15, color: C.text, marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.6 }}>{desc}</div>
    </div>
  );
}

// ─── STRATEGIES PAGE ─────────────────────────────────────────────────────────

const STRATEGIES = [
  {
    id: "buyhold",
    name: "Buy & Hold",
    icon: "⬡",
    color: C.cyan,
    tagline: "The timeless long-term approach",
    description: "Purchase assets and hold through market cycles. Minimizes transaction costs and taxes. Relies on long-term market growth. Warren Buffett's preferred method.",
    details: [
      "Entry: Buy at the start, never sell",
      "Best for: Long horizons (5+ years)",
      "Risk: Full market exposure",
      "Cost: Minimal (single trade)"
    ],
    metrics: { complexity: 1, risk: 3, returns: 3 }
  },
  {
    id: "ma",
    name: "Moving Average",
    icon: "⬟",
    color: C.purple,
    tagline: "Trend-following via price smoothing",
    description: "Uses short (20-day) and long (50-day) moving averages. Buy when short MA crosses above long MA (golden cross). Sell on death cross. Filters out noise.",
    details: [
      "Entry: Short MA > Long MA (Golden Cross)",
      "Exit: Short MA < Long MA (Death Cross)",
      "Best for: Trending markets",
      "Risk: Whipsaws in sideways markets"
    ],
    metrics: { complexity: 2, risk: 2, returns: 3 }
  },
  {
    id: "momentum",
    name: "Momentum",
    icon: "◈",
    color: C.green,
    tagline: "Ride the wave of recent performance",
    description: "Buy assets with strong recent returns (>5% over 20 days). Sell when momentum reverses (<-3%). Based on the 'winners keep winning' behavioral bias.",
    details: [
      "Entry: 20-day return > +5%",
      "Exit: 20-day return < -3%",
      "Best for: Strong trending environments",
      "Risk: Sharp reversals can cause losses"
    ],
    metrics: { complexity: 2, risk: 4, returns: 4 }
  }
];

function StrategiesPage({ onSimulate }) {
  const [expanded, setExpanded] = useState(null);
  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "60px 24px" }}>
      <SectionLabel>Trading Strategies</SectionLabel>
      <h2 style={{ fontSize: 36, fontWeight: 800, color: C.text, marginBottom: 8 }}>
        Three Proven Approaches
      </h2>
      <p style={{ color: C.dim, marginBottom: 48, fontSize: 15 }}>
        Each strategy embodies a distinct philosophy. Learn the logic, then simulate.
      </p>
      <div style={{ display: "grid", gap: 20 }}>
        {STRATEGIES.map((s, i) => (
          <StrategyCard key={s.id} s={s} expanded={expanded === s.id}
            onToggle={() => setExpanded(expanded === s.id ? null : s.id)}
            onSimulate={() => onSimulate(s.id)} delay={i * 80} />
        ))}
      </div>
    </div>
  );
}

function StrategyCard({ s, expanded, onToggle, onSimulate, delay }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: C.card, border: `1px solid ${hover || expanded ? s.color + "55" : C.border}`,
        borderRadius: 16, overflow: "hidden",
        boxShadow: hover ? `0 8px 40px ${s.color}18` : "none",
        transition: "all 0.3s"
      }}>
      <div style={{ padding: "24px 28px", cursor: "pointer", display: "flex", alignItems: "center", gap: 20 }}
        onClick={onToggle}>
        <div style={{
          width: 56, height: 56, borderRadius: 14,
          background: s.color + "22", border: `1px solid ${s.color}44`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 24, color: s.color, flexShrink: 0
        }}>{s.icon}</div>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
            <span style={{ fontSize: 18, fontWeight: 700, color: C.text }}>{s.name}</span>
            <Badge color={s.color}>{s.tagline}</Badge>
          </div>
          <p style={{ color: C.muted, fontSize: 13, margin: 0 }}>{s.description}</p>
        </div>
        <div style={{ color: C.muted, fontSize: 20, transition: "transform 0.3s", transform: expanded ? "rotate(180deg)" : "rotate(0)" }}>⌄</div>
      </div>
      {expanded && (
        <div style={{
          borderTop: `1px solid ${C.border}`, padding: "20px 28px",
          background: C.surface, display: "grid",
          gridTemplateColumns: "1fr 1fr", gap: 24
        }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>Rules</div>
            {s.details.map((d, i) => (
              <div key={i} style={{ display: "flex", gap: 10, marginBottom: 8 }}>
                <span style={{ color: s.color, flexShrink: 0 }}>→</span>
                <span style={{ fontSize: 13, color: C.dim }}>{d}</span>
              </div>
            ))}
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>Profile</div>
            {[["Complexity", s.metrics.complexity], ["Risk", s.metrics.risk], ["Return Potential", s.metrics.returns]].map(([label, val]) => (
              <div key={label} style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: C.muted, marginBottom: 4 }}>
                  <span>{label}</span><span>{val}/5</span>
                </div>
                <div style={{ height: 4, background: C.border, borderRadius: 2, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${val / 5 * 100}%`, background: s.color, borderRadius: 2, transition: "width 0.6s" }} />
                </div>
              </div>
            ))}
            <GlowButton onClick={onSimulate} style={{ marginTop: 8, width: "100%" }}>
              Simulate {s.name} →
            </GlowButton>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── SIMULATION DASHBOARD ────────────────────────────────────────────────────

function SimulationDashboard({ initStrategy }) {
  const [ticker, setTicker] = useState("AAPL");
  const [strategy, setStrategy] = useState(initStrategy || "buyhold");
  const [start, setStart] = useState("2022-01-01");
  const [end, setEnd] = useState("2024-01-01");
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("chart");
  const [tradingPos, setTradingPos] = useState(null); // {entryPrice, entryDate}
  const [trades, setTrades] = useState([]);
  const [dayIndex, setDayIndex] = useState(30); // current "live" day index into prices
  const [autoPlay, setAutoPlay] = useState(false);
  const autoPlayRef = useRef(null);

  const runSim = useCallback(() => {
    setLoading(true);
    setTimeout(() => {
      const prices = generatePriceData(ticker, start, end);
      const bh = runBuyAndHold(prices);
      const ma = runMovingAverage(prices);
      const mom = runMomentum(prices);
      const opt = runOptimal(prices);
      const combined = prices.map((p, i) => ({
        date: p.date, price: p.close,
        "Buy & Hold": bh[i].portfolio,
        "Moving Average": ma[i].portfolio,
        "Momentum": mom[i].portfolio,
        "Optimal": opt[i].portfolio
      }));
      const stratMap = { buyhold: bh, ma, momentum: mom };
      const active = stratMap[strategy];
      setResults({
        prices, combined, active,
        metrics: {
          "Buy & Hold": calcMetrics(bh),
          "Moving Average": calcMetrics(ma),
          "Momentum": calcMetrics(mom),
          "Optimal": calcMetrics(opt),
        }
      });
      setDayIndex(30);
      setTradingPos(null);
      setTrades([]);
      setLoading(false);
    }, 800);
  }, [ticker, strategy, start, end]);

  const strategyName = { buyhold: "Buy & Hold", ma: "Moving Average", momentum: "Momentum" }[strategy];

  const advanceDay = useCallback(() => {
    if (!results) return;
    setDayIndex(i => Math.min(i + 1, results.prices.length - 1));
  }, [results]);

  useEffect(() => {
    if (autoPlay && results) {
      autoPlayRef.current = setInterval(advanceDay, 600);
    } else {
      clearInterval(autoPlayRef.current);
    }
    return () => clearInterval(autoPlayRef.current);
  }, [autoPlay, advanceDay, results]);

  const handleTrade = (price, date) => {
    if (!tradingPos) {
      setTradingPos({ entryPrice: price, entryDate: date });
    } else {
      const pnl = ((price - tradingPos.entryPrice) / tradingPos.entryPrice * 100).toFixed(2);
      setTrades(prev => [...prev, {
        entry: tradingPos.entryPrice, entryDate: tradingPos.entryDate,
        exit: price, exitDate: date, pnl
      }]);
      setTradingPos(null);
    }
  };

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "60px 24px" }}>
      <SectionLabel>Simulation Engine</SectionLabel>
      <h2 style={{ fontSize: 36, fontWeight: 800, color: C.text, marginBottom: 32 }}>
        Backtest Your Strategy
      </h2>

      {/* Controls */}
      <div style={{
        background: C.card, border: `1px solid ${C.border}`,
        borderRadius: 16, padding: 24, marginBottom: 32,
        display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16, alignItems: "end"
      }}>
        <SelectField label="Ticker" value={ticker} onChange={setTicker}
          options={Object.keys(SEED_PRICES)} />
        <SelectField label="Strategy" value={strategy} onChange={setStrategy}
          options={[["buyhold", "Buy & Hold"], ["ma", "Moving Average"], ["momentum", "Momentum"]]} />
        <DateField label="Start Date" value={start} onChange={setStart} />
        <DateField label="End Date" value={end} onChange={setEnd} />
        <GlowButton onClick={runSim} loading={loading} variant="primary">
          ▶ Run Simulation
        </GlowButton>
      </div>

      {!results && !loading && (
        <EmptyState onRun={runSim} />
      )}
      {loading && <LoadingState />}

      {results && (
        <>
          {/* Tab nav */}
          <div style={{ display: "flex", gap: 4, marginBottom: 24, background: C.surface, borderRadius: 12, padding: 4 }}>
            {[["chart", "📈 Portfolio Chart"], ["analytics", "◈ Analytics"], ["trading", "⚡ Live Trading"], ["compare", "⬡ Compare"]].map(([id, label]) => (
              <button key={id} onClick={() => setActiveTab(id)} style={{
                flex: 1, padding: "10px 0", borderRadius: 9, border: "none",
                background: activeTab === id ? C.card : "transparent",
                color: activeTab === id ? C.text : C.muted,
                fontWeight: activeTab === id ? 600 : 400, cursor: "pointer",
                fontSize: 13, transition: "all 0.2s", fontFamily: "inherit",
                boxShadow: activeTab === id ? `0 0 0 1px ${C.border}` : "none"
              }}>{label}</button>
            ))}
          </div>

          {activeTab === "chart" && <ChartTab results={results} strategyName={strategyName} ticker={ticker} />}
          {activeTab === "analytics" && <AnalyticsTab results={results} strategyName={strategyName} />}
          {activeTab === "trading" && <TradingTab prices={results.prices} tradingPos={tradingPos} trades={trades} onTrade={handleTrade} dayIndex={dayIndex} onAdvanceDay={advanceDay} onSkipDays={(n) => setDayIndex(i => Math.min(i + n, results.prices.length - 1))} autoPlay={autoPlay} onToggleAutoPlay={() => setAutoPlay(p => !p)} totalDays={results.prices.length} />}
          {activeTab === "compare" && <CompareTab results={results} />}
        </>
      )}
    </div>
  );
}

function SelectField({ label, value, onChange, options }) {
  return (
    <div>
      <label style={{ fontSize: 11, fontWeight: 600, color: C.muted, textTransform: "uppercase", letterSpacing: "0.08em", display: "block", marginBottom: 8 }}>{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)} style={{
        width: "100%", background: C.surface, border: `1px solid ${C.border}`,
        borderRadius: 8, padding: "9px 12px", color: C.text, fontSize: 14,
        fontFamily: "inherit", outline: "none", cursor: "pointer"
      }}>
        {options.map(o => Array.isArray(o)
          ? <option key={o[0]} value={o[0]}>{o[1]}</option>
          : <option key={o} value={o}>{o}</option>
        )}
      </select>
    </div>
  );
}

function DateField({ label, value, onChange }) {
  return (
    <div>
      <label style={{ fontSize: 11, fontWeight: 600, color: C.muted, textTransform: "uppercase", letterSpacing: "0.08em", display: "block", marginBottom: 8 }}>{label}</label>
      <input type="date" value={value} onChange={e => onChange(e.target.value)} style={{
        width: "100%", background: C.surface, border: `1px solid ${C.border}`,
        borderRadius: 8, padding: "9px 12px", color: C.text, fontSize: 14,
        fontFamily: "inherit", outline: "none", boxSizing: "border-box",
        colorScheme: "dark"
      }} />
    </div>
  );
}

function EmptyState({ onRun }) {
  return (
    <div style={{ textAlign: "center", padding: "80px 24px", background: C.card, borderRadius: 16, border: `1px dashed ${C.border}` }}>
      <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.3 }}>◈</div>
      <div style={{ fontSize: 18, fontWeight: 600, color: C.text, marginBottom: 8 }}>Ready to Simulate</div>
      <div style={{ color: C.muted, marginBottom: 24, fontSize: 14 }}>Configure your parameters above and run a backtest</div>
      <GlowButton onClick={onRun}>▶ Run with AAPL defaults</GlowButton>
    </div>
  );
}

function LoadingState() {
  const [dots, setDots] = useState("");
  useEffect(() => {
    const t = setInterval(() => setDots(d => d.length >= 3 ? "" : d + "."), 400);
    return () => clearInterval(t);
  }, []);
  return (
    <div style={{ textAlign: "center", padding: "80px 24px", background: C.card, borderRadius: 16, border: `1px solid ${C.border}` }}>
      <div style={{ fontSize: 14, color: C.cyan, fontWeight: 600 }}>Running simulation{dots}</div>
      <div style={{ marginTop: 20, height: 4, background: C.border, borderRadius: 2, overflow: "hidden" }}>
        <div style={{
          height: "100%", width: "60%",
          background: `linear-gradient(90deg, ${C.cyan}, ${C.purple})`,
          borderRadius: 2, animation: "shimmer 1.5s infinite"
        }} />
      </div>
      <style>{`@keyframes shimmer { 0%{transform:translateX(-100%)} 100%{transform:translateX(200%)} }`}</style>
    </div>
  );
}

// ─── CHART TAB ───────────────────────────────────────────────────────────────

function ChartTab({ results, strategyName, ticker }) {
  const { combined, metrics, prices } = results;
  const sm = metrics[strategyName] || {};

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 28 }}>
        <MetricCard label="Total Return" value={`${sm.totalReturn}%`}
          color={+sm.totalReturn > 0 ? C.green : C.red}
          tip="Total percentage gain/loss over the period" />
        <MetricCard label="Sharpe Ratio" value={sm.sharpe}
          color={C.cyan}
          tip="Risk-adjusted return: reward per unit of risk. >1 is good, >2 is great." />
        <MetricCard label="Max Drawdown" value={`-${sm.maxDrawdown}%`}
          color={C.amber}
          tip="Largest peak-to-trough decline. Measures worst-case loss scenario." />
        <MetricCard label="Volatility" value={`${sm.vol}%`}
          color={C.purple}
          tip="Annualized standard deviation of daily returns. Higher = more uncertainty." />
      </div>

      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: "24px 20px", marginBottom: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.muted, marginBottom: 16 }}>
          {ticker} — Strategy Portfolio Growth vs. Optimal ($10,000 initial)
        </div>
        <ResponsiveContainer width="100%" height={320}>
          <AreaChart data={combined.filter((_, i) => i % 2 === 0)} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
            <defs>
              {Object.entries(STRATEGY_COLORS).map(([name, color]) => (
                <linearGradient key={name} id={`grad-${name.replace(/\s/g, "")}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={color} stopOpacity={0.25} />
                  <stop offset="95%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
            <XAxis dataKey="date" stroke={C.muted} tick={{ fontSize: 10, fill: C.muted }}
              tickFormatter={d => d.slice(0, 7)} />
            <YAxis stroke={C.muted} tick={{ fontSize: 10, fill: C.muted }}
              tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
            <Tooltip content={<ChartTooltip />} />
            <Legend wrapperStyle={{ fontSize: 12, color: C.dim }} />
            {Object.entries(STRATEGY_COLORS).map(([name, color]) => (
              <Area key={name} type="monotone" dataKey={name} stroke={color}
                fill={`url(#grad-${name.replace(/\s/g, "")})`}
                strokeWidth={name === strategyName ? 2.5 : 1.5}
                dot={false} strokeDasharray={name === "Optimal" ? "6 3" : undefined} />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: "24px 20px" }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.muted, marginBottom: 16 }}>{ticker} — Price History</div>
        <ResponsiveContainer width="100%" height={180}>
          <AreaChart data={combined.filter((_, i) => i % 2 === 0)} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={C.cyan} stopOpacity={0.3} />
                <stop offset="95%" stopColor={C.cyan} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
            <XAxis dataKey="date" stroke={C.muted} tick={{ fontSize: 10, fill: C.muted }} tickFormatter={d => d.slice(0, 7)} />
            <YAxis stroke={C.muted} tick={{ fontSize: 10, fill: C.muted }} tickFormatter={v => `$${v.toFixed(0)}`} />
            <Tooltip content={<ChartTooltip />} />
            <Area type="monotone" dataKey="price" stroke={C.cyan} fill="url(#priceGrad)" strokeWidth={2} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ─── ANALYTICS TAB ───────────────────────────────────────────────────────────

function AnalyticsTab({ results, strategyName }) {
  const { metrics, combined } = results;
  const allNames = ["Buy & Hold", "Moving Average", "Momentum", "Optimal"];
  const activeMetrics = metrics[strategyName];
  const optMetrics = metrics["Optimal"];

  const missedOpportunity = optMetrics && activeMetrics
    ? (parseFloat(optMetrics.totalReturn) - parseFloat(activeMetrics.totalReturn)).toFixed(2)
    : "N/A";

  const insights = useMemo(() => {
    if (!metrics) return [];
    const arr = [];
    const maR = parseFloat(metrics["Moving Average"]?.totalReturn);
    const momR = parseFloat(metrics["Momentum"]?.totalReturn);
    const bhR = parseFloat(metrics["Buy & Hold"]?.totalReturn);
    const optR = parseFloat(metrics["Optimal"]?.totalReturn);
    if (momR > maR) arr.push({ icon: "⬆", text: "Momentum outperformed Moving Average — strong trending environment detected.", c: C.green });
    else arr.push({ icon: "⬇", text: "Moving Average outperformed Momentum — range-bound market conditions favored crossover signals.", c: C.purple });
    if (bhR > maR && bhR > momR) arr.push({ icon: "◈", text: "Buy & Hold beat active strategies — this period rewarded patience over trading.", c: C.cyan });
    const maV = parseFloat(metrics["Momentum"]?.vol);
    const bhV = parseFloat(metrics["Buy & Hold"]?.vol);
    if (maV > bhV * 1.5) arr.push({ icon: "⚠", text: "Momentum showed significantly higher volatility — higher risk profile confirmed.", c: C.amber });
    arr.push({ icon: "◆", text: `Optimal strategy captured ${optR.toFixed(1)}% — setting the upper bound for this period's achievable return.`, c: C.amber });
    if (missedOpportunity !== "N/A") arr.push({ icon: "○", text: `${strategyName} left ${missedOpportunity}% of possible return on the table vs. perfect foresight.`, c: C.red });
    return arr;
  }, [metrics, missedOpportunity, strategyName]);

  return (
    <div>
      {/* Missed opportunity highlight */}
      <div style={{
        background: `linear-gradient(135deg, ${C.amber}22, ${C.purple}22)`,
        border: `1px solid ${C.amber}44`, borderRadius: 14, padding: "20px 24px", marginBottom: 24,
        display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 16
      }}>
        <div>
          <div style={{ fontSize: 12, color: C.amber, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>
            Missed Opportunity vs Optimal
          </div>
          <div style={{ fontSize: 36, fontWeight: 800, color: C.text }}>{missedOpportunity}%</div>
          <div style={{ fontSize: 12, color: C.muted }}>Return left uncaptured by {strategyName}</div>
        </div>
        <div style={{ fontSize: 12, color: C.dim, maxWidth: 300, lineHeight: 1.6 }}>
          The Optimal benchmark represents a perfect-hindsight strategy. The gap between your strategy and optimal quantifies the "cost of imperfect information."
        </div>
      </div>

      {/* Insights */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 20, marginBottom: 24 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 16 }}>Auto-Generated Insights</div>
        <div style={{ display: "grid", gap: 10 }}>
          {insights.map((ins, i) => (
            <div key={i} style={{
              display: "flex", gap: 12, padding: "12px 14px",
              background: C.surface, borderRadius: 10, borderLeft: `3px solid ${ins.c}`
            }}>
              <span style={{ color: ins.c, flexShrink: 0, fontSize: 14 }}>{ins.icon}</span>
              <span style={{ fontSize: 13, color: C.dim, lineHeight: 1.6 }}>{ins.text}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Drawdown chart */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: "20px", marginBottom: 24 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.muted, marginBottom: 16 }}>
          Portfolio Value Over Time — All Strategies
          <InfoIcon tip="Compare all strategies on a single chart to see relative performance and drawdown periods." />
        </div>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={combined.filter((_, i) => i % 3 === 0)} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
            <XAxis dataKey="date" stroke={C.muted} tick={{ fontSize: 10, fill: C.muted }} tickFormatter={d => d.slice(0, 7)} />
            <YAxis stroke={C.muted} tick={{ fontSize: 10, fill: C.muted }} tickFormatter={v => `$${(v / 1000).toFixed(1)}k`} />
            <Tooltip content={<ChartTooltip />} />
            <Legend wrapperStyle={{ fontSize: 12, color: C.dim }} />
            <ReferenceLine y={10000} stroke={C.muted} strokeDasharray="4 4" label={{ value: "Start", fill: C.muted, fontSize: 10 }} />
            {Object.entries(STRATEGY_COLORS).map(([name, color]) => (
              <Line key={name} type="monotone" dataKey={name} stroke={color}
                strokeWidth={1.8} dot={false}
                strokeDasharray={name === "Optimal" ? "6 3" : undefined} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ─── COMPARE TAB ─────────────────────────────────────────────────────────────

function CompareTab({ results }) {
  const { metrics } = results;
  const rows = [
    { key: "totalReturn", label: "Total Return", suffix: "%", tip: "Net gain/loss as % of initial capital", best: "max" },
    { key: "sharpe", label: "Sharpe Ratio", suffix: "", tip: "Return per unit of risk (annualized)", best: "max" },
    { key: "maxDrawdown", label: "Max Drawdown", suffix: "%", tip: "Largest peak-to-valley loss", best: "min" },
    { key: "vol", label: "Volatility", suffix: "%", tip: "Annualized standard deviation", best: "min" },
  ];
  const strategies = ["Buy & Hold", "Moving Average", "Momentum", "Optimal"];

  const getBest = (row) => {
    const vals = strategies.map(s => parseFloat(metrics[s]?.[row.key] || "0"));
    return row.best === "max" ? Math.max(...vals) : Math.min(...vals);
  };

  return (
    <div>
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: C.surface }}>
                <th style={{ padding: "14px 20px", textAlign: "left", fontSize: 11, color: C.muted, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em" }}>Metric</th>
                {strategies.map(s => (
                  <th key={s} style={{ padding: "14px 20px", textAlign: "right", fontSize: 13, color: STRATEGY_COLORS[s], fontWeight: 700 }}>{s}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => {
                const best = getBest(row);
                return (
                  <tr key={row.key} style={{ borderTop: `1px solid ${C.border}`, background: ri % 2 === 0 ? "transparent" : C.surface + "44" }}>
                    <td style={{ padding: "16px 20px", fontSize: 13, color: C.dim }}>
                      {row.label}
                      <InfoIcon tip={row.tip} />
                    </td>
                    {strategies.map(s => {
                      const val = parseFloat(metrics[s]?.[row.key] || "0");
                      const isBest = val === best;
                      const color = STRATEGY_COLORS[s];
                      return (
                        <td key={s} style={{ padding: "16px 20px", textAlign: "right", fontSize: 14, fontWeight: isBest ? 700 : 400, color: isBest ? color : C.muted }}>
                          {isBest && <span style={{ marginRight: 6, fontSize: 10 }}>★</span>}
                          {metrics[s]?.[row.key]}{row.suffix}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Bar chart comparison */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 20, marginTop: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.muted, marginBottom: 16 }}>Total Return Comparison</div>
        <div style={{ display: "grid", gap: 12 }}>
          {strategies.map(s => {
            const r = parseFloat(metrics[s]?.totalReturn || 0);
            const max = Math.max(...strategies.map(st => Math.abs(parseFloat(metrics[st]?.totalReturn || 0))));
            return (
              <div key={s} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 120, fontSize: 12, color: STRATEGY_COLORS[s], fontWeight: 600, flexShrink: 0 }}>{s}</div>
                <div style={{ flex: 1, height: 20, background: C.border, borderRadius: 4, overflow: "hidden" }}>
                  <div style={{
                    height: "100%", width: `${Math.abs(r) / max * 100}%`,
                    background: r >= 0 ? STRATEGY_COLORS[s] : C.red,
                    borderRadius: 4, transition: "width 0.8s ease"
                  }} />
                </div>
                <div style={{ width: 60, textAlign: "right", fontSize: 13, fontWeight: 700, color: r >= 0 ? C.green : C.red }}>
                  {r > 0 ? "+" : ""}{r}%
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── LIVE TRADING TAB ────────────────────────────────────────────────────────

function TradingTab({ prices, tradingPos, trades, onTrade, dayIndex, onAdvanceDay, onSkipDays, autoPlay, onToggleAutoPlay, totalDays }) {
  const [hoverIdx, setHoverIdx] = useState(null);

  // Show prices up to current dayIndex (the "visible" history)
  const visiblePrices = prices.slice(0, dayIndex + 1);
  // Show a rolling window of up to 60 visible days for the chart
  const chartData = visiblePrices.slice(-60);

  const current = visiblePrices.at(-1);
  const currentPrice = current?.close;
  const currentDate = current?.date;
  const isAtEnd = dayIndex >= totalDays - 1;
  const progress = Math.round((dayIndex / (totalDays - 1)) * 100);

  const unrealizedPnl = tradingPos
    ? ((currentPrice - tradingPos.entryPrice) / tradingPos.entryPrice * 100).toFixed(2)
    : null;

  return (
    <div>
      {/* Time controls */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: "16px 20px", marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", flexShrink: 0 }}>
            Day {dayIndex + 1} / {totalDays}
          </div>
          {/* Progress bar */}
          <div style={{ flex: 1, height: 6, background: C.border, borderRadius: 3, overflow: "hidden", minWidth: 100 }}>
            <div style={{ height: "100%", width: `${progress}%`, background: `linear-gradient(90deg, ${C.cyan}, ${C.purple})`, borderRadius: 3, transition: "width 0.3s" }} />
          </div>
          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            <button onClick={() => onSkipDays(1)} disabled={isAtEnd} style={{
              background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8,
              color: isAtEnd ? C.muted : C.text, padding: "6px 14px", fontSize: 12, cursor: isAtEnd ? "not-allowed" : "pointer",
              fontFamily: "inherit", fontWeight: 600
            }}>+1 Day</button>
            <button onClick={() => onSkipDays(5)} disabled={isAtEnd} style={{
              background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8,
              color: isAtEnd ? C.muted : C.text, padding: "6px 14px", fontSize: 12, cursor: isAtEnd ? "not-allowed" : "pointer",
              fontFamily: "inherit", fontWeight: 600
            }}>+5 Days</button>
            <button onClick={() => onSkipDays(20)} disabled={isAtEnd} style={{
              background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8,
              color: isAtEnd ? C.muted : C.text, padding: "6px 14px", fontSize: 12, cursor: isAtEnd ? "not-allowed" : "pointer",
              fontFamily: "inherit", fontWeight: 600
            }}>+20 Days</button>
            <button onClick={onToggleAutoPlay} disabled={isAtEnd} style={{
              background: autoPlay ? C.purple + "33" : C.surface,
              border: `1px solid ${autoPlay ? C.purple : C.border}`, borderRadius: 8,
              color: autoPlay ? C.purple : isAtEnd ? C.muted : C.cyan,
              padding: "6px 14px", fontSize: 12, cursor: isAtEnd ? "not-allowed" : "pointer",
              fontFamily: "inherit", fontWeight: 600
            }}>{autoPlay ? "⏸ Pause" : "▶ Auto"}</button>
          </div>
        </div>
        {isAtEnd && (
          <div style={{ marginTop: 10, fontSize: 12, color: C.amber, textAlign: "center" }}>
            ⚠ End of simulation period reached
          </div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 20, marginBottom: 24, alignItems: "start" }}>
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 20 }}>
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Price History — Up to {currentDate}
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={chartData} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}
              onMouseMove={e => e.activeTooltipIndex !== undefined && setHoverIdx(e.activeTooltipIndex)}
              onMouseLeave={() => setHoverIdx(null)}>
              <defs>
                <linearGradient id="liveGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={C.cyan} stopOpacity={0.35} />
                  <stop offset="95%" stopColor={C.cyan} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
              <XAxis dataKey="date" stroke={C.muted} tick={{ fontSize: 10, fill: C.muted }} tickFormatter={d => d.slice(5)} />
              <YAxis stroke={C.muted} tick={{ fontSize: 10, fill: C.muted }} tickFormatter={v => `$${v.toFixed(0)}`} />
              <Tooltip content={<ChartTooltip />} />
              <Area type="monotone" dataKey="close" stroke={C.cyan} fill="url(#liveGrad)" strokeWidth={2} dot={false} name="Price" />
              {tradingPos && <ReferenceLine y={tradingPos.entryPrice} stroke={C.green} strokeDasharray="4 4"
                label={{ value: `Entry $${tradingPos.entryPrice}`, fill: C.green, fontSize: 11 }} />}
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Trade panel */}
        <div style={{ minWidth: 200 }}>
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 20, marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: C.muted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>Current Price</div>
            <div style={{ fontSize: 32, fontWeight: 800, color: C.text, marginBottom: 4 }}>${currentPrice?.toFixed(2)}</div>
            <div style={{ fontSize: 11, color: C.muted }}>{currentDate}</div>
          </div>

          {tradingPos && (
            <div style={{ background: C.surface, border: `1px solid ${+unrealizedPnl >= 0 ? C.green + "55" : C.red + "55"}`, borderRadius: 12, padding: 16, marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>Open Position</div>
              <div style={{ fontSize: 13, color: C.dim }}>Entry: <strong style={{ color: C.text }}>${tradingPos.entryPrice?.toFixed(2)}</strong></div>
              <div style={{ fontSize: 13, color: C.dim, marginTop: 2 }}>Bought: <strong style={{ color: C.text }}>{tradingPos.entryDate}</strong></div>
              <div style={{ fontSize: 20, fontWeight: 700, color: +unrealizedPnl >= 0 ? C.green : C.red, marginTop: 6 }}>
                {+unrealizedPnl >= 0 ? "▲" : "▼"} {unrealizedPnl}%
              </div>
              <div style={{ fontSize: 11, color: C.muted }}>Unrealized P&L</div>
            </div>
          )}

          <GlowButton
            onClick={() => onTrade(currentPrice, currentDate)}
            variant="primary"
            style={{
              width: "100%", justifyContent: "center",
              background: tradingPos
                ? `linear-gradient(135deg, ${C.red}CC, ${C.amber}CC)`
                : `linear-gradient(135deg, ${C.green}CC, ${C.cyan}CC)`
            }}>
            {tradingPos ? "● SELL" : "● BUY"}
          </GlowButton>
          {!tradingPos && (
            <div style={{ fontSize: 11, color: C.muted, textAlign: "center", marginTop: 8 }}>
              Advance days, then sell to realize P&L
            </div>
          )}
        </div>
      </div>

      {/* Trade history */}
      {trades.length > 0 && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden" }}>
          <div style={{ padding: "14px 20px", borderBottom: `1px solid ${C.border}`, fontSize: 12, fontWeight: 600, color: C.muted, textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Trade History
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: C.surface }}>
                {["Entry Date", "Entry Price", "Exit Date", "Exit Price", "P&L"].map(h => (
                  <th key={h} style={{ padding: "10px 16px", fontSize: 11, color: C.muted, textAlign: "left", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {trades.map((t, i) => (
                <tr key={i} style={{ borderTop: `1px solid ${C.border}` }}>
                  <td style={{ padding: "12px 16px", fontSize: 13, color: C.dim }}>{t.entryDate}</td>
                  <td style={{ padding: "12px 16px", fontSize: 13, color: C.text }}>${t.entry.toFixed(2)}</td>
                  <td style={{ padding: "12px 16px", fontSize: 13, color: C.dim }}>{t.exitDate}</td>
                  <td style={{ padding: "12px 16px", fontSize: 13, color: C.text }}>${t.exit.toFixed(2)}</td>
                  <td style={{ padding: "12px 16px", fontSize: 14, fontWeight: 700, color: +t.pnl >= 0 ? C.green : C.red }}>
                    {+t.pnl >= 0 ? "+" : ""}{t.pnl}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ padding: "12px 20px", borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "flex-end" }}>
            <span style={{ fontSize: 12, color: C.muted }}>Total Trades: {trades.length} · </span>
            <span style={{ fontSize: 12, fontWeight: 700, marginLeft: 4, color: trades.reduce((a, t) => a + parseFloat(t.pnl), 0) >= 0 ? C.green : C.red }}>
              Net: {trades.reduce((a, t) => a + parseFloat(t.pnl), 0).toFixed(2)}%
            </span>
          </div>
        </div>
      )}

      {trades.length === 0 && (
        <div style={{ textAlign: "center", padding: "32px", background: C.surface, borderRadius: 12, color: C.muted, fontSize: 13 }}>
          Click <strong style={{ color: C.green }}>BUY</strong> to open a position, then <strong style={{ color: C.red }}>SELL</strong> to record P&L
        </div>
      )}
    </div>
  );
}

// ─── NAVIGATION ──────────────────────────────────────────────────────────────

function NavBar({ active, onNav }) {
  const links = [
    ["home", "Quantflow"],
    ["strategies", "Strategies"],
    ["simulation", "Simulation"],
  ];
  return (
    <nav style={{
      position: "sticky", top: 0, zIndex: 50,
      background: C.bg + "EE", backdropFilter: "blur(20px)",
      borderBottom: `1px solid ${C.border}`,
      display: "flex", alignItems: "center",
      padding: "0 32px", height: 60, gap: 32
    }}>
      <div style={{
        fontSize: 17, fontWeight: 800, cursor: "pointer",
        background: `linear-gradient(135deg, ${C.cyan}, ${C.purple})`,
        WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent"
      }} onClick={() => onNav("home")}>
        ◈ Quantflow
      </div>
      <div style={{ display: "flex", gap: 4, flex: 1 }}>
        {links.slice(1).map(([id, label]) => (
          <NavLink key={id} active={active === id} onClick={() => onNav(id)}>{label}</NavLink>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <Badge color={C.green}>Live Sim</Badge>
        <GlowButton onClick={() => onNav("simulation")} variant="primary" style={{ padding: "6px 16px", fontSize: 12 }}>
          Launch →
        </GlowButton>
      </div>
    </nav>
  );
}

function NavLink({ children, active, onClick }) {
  const [hover, setHover] = useState(false);
  return (
    <button onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: active ? C.surface : "transparent",
        border: active ? `1px solid ${C.border}` : "1px solid transparent",
        borderRadius: 8, padding: "6px 16px", color: active ? C.text : hover ? C.dim : C.muted,
        fontSize: 13, fontWeight: active ? 600 : 400, cursor: "pointer",
        transition: "all 0.2s", fontFamily: "inherit"
      }}>{children}</button>
  );
}

// ─── ROOT APP ─────────────────────────────────────────────────────────────────

export default function App() {
  const [page, setPage] = useState("home");
  const [initStrategy, setInitStrategy] = useState(null);

  const handleNav = (p) => { setPage(p); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const handleSimulate = (stratId) => { setInitStrategy(stratId); handleNav("simulation"); };

  return (
    <div style={{ fontFamily: "'Inter', 'SF Pro Display', system-ui, sans-serif", background: C.bg, minHeight: "100vh", color: C.text }}>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: ${C.bg}; }
        ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 3px; }
        select option { background: ${C.surface}; }
      `}</style>
      <NavBar active={page} onNav={handleNav} />
      <div key={page} style={{ animation: "fadeIn 0.35s ease" }}>
        <style>{`@keyframes fadeIn { from { opacity:0; transform: translateY(10px); } to { opacity:1; transform:translateY(0); } }`}</style>
        {page === "home" && <LandingPage onNav={handleNav} />}
        {page === "strategies" && <StrategiesPage onSimulate={handleSimulate} />}
        {page === "simulation" && <SimulationDashboard initStrategy={initStrategy} />}
      </div>
    </div>
  );
}
