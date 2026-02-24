"use client";

import React, { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

type WalletKey = "Operating" | "Yield" | "Payment";

function clampNumber(n: number, min = 0, max = Number.MAX_SAFE_INTEGER) {
  if (Number.isNaN(n)) return min;
  return Math.min(Math.max(n, min), max);
}

function formatUSD(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function parseCurrencyInput(value: string) {
  const cleaned = value.replace(/[^\d.]/g, "");
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : 0;
}

function formatPct(p: number) {
  return `${p.toFixed(2)}%`;
}

function StepPill({ active, children }: { active: boolean; children: React.ReactNode }) {
  return (
    <span
      className={[
        "inline-flex items-center rounded-full px-3 py-1 text-sm",
        active ? "bg-black text-white" : "bg-muted text-muted-foreground",
      ].join(" ")}
    >
      {children}
    </span>
  );
}

export default function TreasuryDashboard() {
  // Editable balances (defaults = your PoC)
  const [balances, setBalances] = useState<Record<WalletKey, number>>({
    Operating: 50000,
    Yield: 250000,
    Payment: 20000,
  });

  // Policy inputs
  const [operatingTarget, setOperatingTarget] = useState<number>(50000);

  // Two-rate framing: bank baseline vs on-chain target (this is the key "delta" story)
  const [bankApyPct, setBankApyPct] = useState<number>(0.2);
  const [onchainApyPct, setOnchainApyPct] = useState<number>(5.0);

  const [months, setMonths] = useState<number>(6);

  // Guided flow (makes the demo feel like an OS, not just a dashboard)
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  // For the "Simulate Sweep" button
  const [lastSweep, setLastSweep] = useState<{ sweptAmount: number; timestamp: number } | null>(null);

  const totalCash = useMemo(() => balances.Operating + balances.Yield + balances.Payment, [balances]);

  const excessOperating = useMemo(() => {
    return Math.max(0, balances.Operating - operatingTarget);
  }, [balances.Operating, operatingTarget]);

  const onchainMonthlyRate = useMemo(() => {
    const apy = clampNumber(onchainApyPct, 0, 100) / 100;
    return apy / 12;
  }, [onchainApyPct]);

  const bankMonthlyRate = useMemo(() => {
    const apy = clampNumber(bankApyPct, 0, 100) / 100;
    return apy / 12;
  }, [bankApyPct]);

  const annualUplift = useMemo(() => {
    // Simple annualized delta on the yield-allocated bucket
    const principal = clampNumber(balances.Yield, 0);
    const delta = (clampNumber(onchainApyPct, 0, 100) - clampNumber(bankApyPct, 0, 100)) / 100;
    return principal * delta;
  }, [balances.Yield, onchainApyPct, bankApyPct]);

  const monthlyUplift = useMemo(() => annualUplift / 12, [annualUplift]);

  // Cumulative yield over N months for BOTH bank baseline and on-chain yield (simple, not compounding)
  const yieldSimulation = useMemo(() => {
    const m = clampNumber(months, 1, 24);
    const principal = clampNumber(balances.Yield, 0);

    return Array.from({ length: m }, (_, i) => {
      const monthIndex = i + 1;
      const onchainCumulative = principal * onchainMonthlyRate * monthIndex;
      const bankCumulative = principal * bankMonthlyRate * monthIndex;
      return {
        month: `Month ${monthIndex}`,
        onchain: Math.round(onchainCumulative),
        bank: Math.round(bankCumulative),
      };
    });
  }, [balances.Yield, onchainMonthlyRate, bankMonthlyRate, months]);

  const onChangeBalance = (key: WalletKey, raw: string) => {
    const next = clampNumber(parseCurrencyInput(raw), 0);
    setBalances((prev) => ({ ...prev, [key]: next }));
  };

  const handleSimulateSweep = () => {
    const sweep = excessOperating;
    if (sweep <= 0) {
      setLastSweep({ sweptAmount: 0, timestamp: Date.now() });
      return;
    }
    setBalances((prev) => ({
      ...prev,
      Operating: prev.Operating - sweep,
      Yield: prev.Yield + sweep,
    }));
    setLastSweep({ sweptAmount: sweep, timestamp: Date.now() });
    // Nudge the flow forward to "Allocate"
    setStep((s) => (s < 3 ? 3 : s));
  };

  return (
    <main className="p-6 md:p-10 space-y-8 max-w-6xl mx-auto">
      {/* HERO / POSITIONING */}
      <section className="space-y-3">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
          <div>
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight">Stablecoin Treasury OS</h1>
            <p className="text-muted-foreground mt-1">
              Earn real yield on idle cash · Move funds instantly · Stay audit-ready
            </p>
            <p className="text-sm text-muted-foreground mt-2">
              Demo: “The Autonomous Treasury” (USDC on Base) — finance-first workflows with policy controls + reporting.
            </p>
          </div>

          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setBalances({ Operating: 80000, Yield: 320000, Payment: 15000 });
                setOperatingTarget(60000);
                setBankApyPct(0.2);
                setOnchainApyPct(5.0);
                setMonths(6);
                setStep(1);
                setLastSweep(null);
              }}
            >
              Load Demo Scenario
            </Button>
            <Button onClick={() => setStep(1)}>Start Guided Demo</Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 pt-2">
          <StepPill active={step === 1}>1) Connect</StepPill>
          <StepPill active={step === 2}>2) Analyze</StepPill>
          <StepPill active={step === 3}>3) Allocate</StepPill>
          <StepPill active={step === 4}>4) Monitor</StepPill>

          <div className="ml-auto flex gap-2">
            <Button variant="outline" onClick={() => setStep((s) => (s > 1 ? ((s - 1) as any) : s))}>
              Back
            </Button>
            <Button onClick={() => setStep((s) => (s < 4 ? ((s + 1) as any) : s))}>Next</Button>
          </div>
        </div>
      </section>

      {/* QUANTIFIED VALUE: THE DELTA */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="rounded-2xl shadow-sm lg:col-span-2">
          <CardContent className="p-6 space-y-4">
            <h2 className="text-lg font-semibold">Treasury Snapshot (Quantified)</h2>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="rounded-2xl border p-4">
                <p className="text-xs text-muted-foreground">Total cash</p>
                <p className="text-2xl font-semibold mt-1">${formatUSD(totalCash)}</p>
                <p className="text-xs text-muted-foreground mt-1">Across Operating + Yield + Payment</p>
              </div>

              <div className="rounded-2xl border p-4">
                <p className="text-xs text-muted-foreground">Yield-allocated (principal)</p>
                <p className="text-2xl font-semibold mt-1">${formatUSD(balances.Yield)}</p>
                <p className="text-xs text-muted-foreground mt-1">Basis for uplift calculation</p>
              </div>

              <div className="rounded-2xl border p-4">
                <p className="text-xs text-muted-foreground">Incremental uplift (annualized)</p>
                <p className="text-2xl font-semibold mt-1">${formatUSD(Math.round(annualUplift))}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  ≈ ${formatUSD(Math.round(monthlyUplift))}/month vs bank baseline
                </p>
              </div>
            </div>

            <div className="rounded-2xl bg-muted p-4 text-sm text-muted-foreground">
              Finance users care about the <span className="font-medium text-foreground">delta</span>: “What do we gain
              by moving idle cash from bank rails into a controlled on-chain yield allocation?”
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl shadow-sm">
          <CardContent className="p-6 space-y-4">
            <h2 className="text-lg font-semibold">Rates (for the story)</h2>

            <div className="space-y-2">
              <label className="text-sm font-medium">Bank baseline APY</label>
              <div className="flex items-center gap-2">
                <input
                  className="w-full rounded-xl border px-3 py-2 text-sm"
                  inputMode="decimal"
                  value={bankApyPct.toString()}
                  onChange={(e) => setBankApyPct(clampNumber(Number(e.target.value), 0, 100))}
                  aria-label="Bank APY percent"
                />
                <span className="text-muted-foreground text-sm">%</span>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">On-chain target APY</label>
              <div className="flex items-center gap-2">
                <input
                  className="w-full rounded-xl border px-3 py-2 text-sm"
                  inputMode="decimal"
                  value={onchainApyPct.toString()}
                  onChange={(e) => setOnchainApyPct(clampNumber(Number(e.target.value), 0, 100))}
                  aria-label="On-chain APY percent"
                />
                <span className="text-muted-foreground text-sm">%</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Delta: {formatPct(onchainApyPct - bankApyPct)}
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Simulation Months</label>
              <input
                className="w-full rounded-xl border px-3 py-2 text-sm"
                inputMode="numeric"
                value={months.toString()}
                onChange={(e) => setMonths(clampNumber(Number(e.target.value), 1, 24))}
                aria-label="Simulation months"
              />
              <p className="text-xs text-muted-foreground">Simple cumulative yield (no compounding yet).</p>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* CONTROLS (your existing inputs, retained) */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="rounded-2xl shadow-sm lg:col-span-2">
          <CardContent className="p-6 space-y-4">
            <h2 className="text-lg font-semibold">Account Inputs</h2>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {(["Operating", "Yield", "Payment"] as WalletKey[]).map((k) => (
                <div key={k} className="space-y-2">
                  <label className="text-sm font-medium">{k} Balance</label>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">$</span>
                    <input
                      className="w-full rounded-xl border px-3 py-2 text-sm"
                      inputMode="decimal"
                      value={balances[k].toString()}
                      onChange={(e) => onChangeBalance(k, e.target.value)}
                      aria-label={`${k} balance`}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">Display: ${formatUSD(balances[k])}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl shadow-sm">
          <CardContent className="p-6 space-y-4">
            <h2 className="text-lg font-semibold">Policy Inputs</h2>

            <div className="space-y-2">
              <label className="text-sm font-medium">Operating Target</label>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">$</span>
                <input
                  className="w-full rounded-xl border px-3 py-2 text-sm"
                  inputMode="decimal"
                  value={operatingTarget.toString()}
                  onChange={(e) => setOperatingTarget(clampNumber(parseCurrencyInput(e.target.value), 0))}
                  aria-label="Operating target"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Excess available to sweep: ${formatUSD(excessOperating)}
              </p>
            </div>

            <div className="rounded-2xl bg-muted p-4 text-sm">
              <p className="font-medium">Flow hint</p>
              <p className="text-muted-foreground mt-1">
                Set target → detect excess → sweep into yield route (with approvals).
              </p>
              <div className="mt-3 flex gap-2">
                <Button variant="outline" onClick={() => setStep(2)}>
                  Go to Analyze
                </Button>
                <Button onClick={() => setStep(3)}>Go to Allocate</Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Wallet Overview (unchanged) */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {(["Operating", "Yield", "Payment"] as WalletKey[]).map((name) => (
          <Card key={name} className="rounded-2xl shadow-sm">
            <CardContent className="p-6">
              <h2 className="text-lg font-semibold">{name} Account</h2>
              <p className="text-2xl mt-3">${formatUSD(balances[name])}</p>
              {name === "Operating" && (
                <p className="text-xs text-muted-foreground mt-2">
                  Target: ${formatUSD(operatingTarget)} · Excess: ${formatUSD(excessOperating)}
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </section>

      {/* Yield Simulation (fixed: bank baseline vs on-chain) */}
      <section>
        <Card className="rounded-2xl shadow-sm">
          <CardContent className="p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">Yield Delta Simulation</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Cumulative yield on ${formatUSD(balances.Yield)} over {months} months.
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Bank: {formatPct(bankApyPct)} APY · On-chain: {formatPct(onchainApyPct)} APY
                </p>
              </div>

              <div className="text-right">
                <p className="text-xs text-muted-foreground">Est. month 1 uplift</p>
                <p className="text-sm font-semibold">
                  ${formatUSD(Math.round(balances.Yield * (onchainMonthlyRate - bankMonthlyRate)))}
                </p>
              </div>
            </div>

            <div className="h-[280px] mt-4">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={yieldSimulation}>
                  <XAxis dataKey="month" />
                  <YAxis />
                  <Tooltip />
                  <Line type="monotone" dataKey="onchain" strokeWidth={2} />
                  <Line type="monotone" dataKey="bank" strokeWidth={2} strokeDasharray="4 4" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Smart Sweep (unchanged, with a more “allocation” framing) */}
      <section>
        <Card className="rounded-2xl shadow-sm">
          <CardContent className="p-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">Automated Allocation Policy (Simulation)</h2>
              <p className="text-muted-foreground mt-1">
                If Operating exceeds ${formatUSD(operatingTarget)}, sweep the excess into Yield (with approvals in a real
                system).
              </p>

              <p className="text-sm mt-3">
                <span className="text-muted-foreground">Current excess: </span>
                <span className="font-semibold">${formatUSD(excessOperating)}</span>
              </p>

              {lastSweep && (
                <p className="text-xs text-muted-foreground mt-2">
                  Last simulation: swept ${formatUSD(lastSweep.sweptAmount)} ·{" "}
                  {new Date(lastSweep.timestamp).toLocaleTimeString()}
                </p>
              )}
            </div>

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep(3)}>
                View Allocation Step
              </Button>
              <Button onClick={handleSimulateSweep}>Simulate Sweep</Button>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* BANK VS AUTONOMOUS COMPARISON (fast “why”) */}
      <section>
        <Card className="rounded-2xl shadow-sm">
          <CardContent className="p-6 space-y-4">
            <h2 className="text-lg font-semibold">Why this beats fragmented bank treasury</h2>
            <p className="text-sm text-muted-foreground">
              CFOs buy the “why” before they care about implementation details.
            </p>

            <div className="overflow-hidden rounded-2xl border">
              <div className="grid grid-cols-3 bg-muted px-4 py-3 text-xs font-semibold text-muted-foreground">
                <div>Capability</div>
                <div>Traditional bank treasury</div>
                <div>Autonomous Treasury OS</div>
              </div>

              {[
                ["Yield on idle cash", "≈ 0–1% (often near 0%)", `${formatPct(onchainApyPct)} target (route-dependent)`],
                ["Movement speed", "ACH/wires, cutoffs & delays", "Near-instant settlement on-chain"],
                ["Workflow", "Manual spreadsheets + approvals in email", "Policies + approvals in-product"],
                ["Audit readiness", "End-of-month reconciliation", "Event log + exports + transaction lineage"],
                ["Liquidity control", "Static buffers", "Dynamic targets + breach alerts"],
              ].map(([cap, bank, os]) => (
                <div key={cap} className="grid grid-cols-3 border-t px-4 py-3 text-sm">
                  <div className="font-medium">{cap}</div>
                  <div className="text-muted-foreground">{bank}</div>
                  <div>{os}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </section>

      {/* TRUST / COMPLIANCE SIGNALS */}
      <section className="pb-6">
        <Card className="rounded-2xl shadow-sm">
          <CardContent className="p-6 space-y-4">
            <h2 className="text-lg font-semibold">Trust, security, and compliance (UX placeholders)</h2>
            <p className="text-sm text-muted-foreground">
              Finance teams need these answered upfront. Even in a demo, signal them clearly.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="rounded-2xl border p-4">
                <p className="font-medium">Key management</p>
                <p className="text-sm text-muted-foreground mt-2">
                  Supports custodial + non-custodial models. Enforce multi-approver deployments.
                </p>
              </div>

              <div className="rounded-2xl border p-4">
                <p className="font-medium">Controls</p>
                <p className="text-sm text-muted-foreground mt-2">
                  Policy rules: liquidity buffers, counterparties, risk limits, and alerting.
                </p>
              </div>

              <div className="rounded-2xl border p-4">
                <p className="font-medium">Reporting</p>
                <p className="text-sm text-muted-foreground mt-2">
                  Audit exports (CSV), monthly statements, and board-ready summaries.
                </p>
              </div>
            </div>

            <div className="text-xs text-muted-foreground">
              Demo note: In production, link to SOC2, custody partners, and policy docs.
            </div>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}