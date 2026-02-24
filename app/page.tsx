"use client";

import React, { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

type WalletKey = "Operating" | "Yield" | "Payment";

type ConnectionMode = "NotConnected" | "DemoBankFeed" | "Wallet";

type TreasuryEvent =
  | { type: "CONNECTED"; ts: number; mode: ConnectionMode }
  | {
      type: "POLICY_UPDATED";
      ts: number;
      operatingTarget: number;
      bankApyPct: number;
      onchainApyPct: number;
      note: string;
    }
  | { type: "SWEEP_EXECUTED"; ts: number; amount: number };

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

function fmtTime(ts: number) {
  return new Date(ts).toLocaleTimeString();
}

function downloadCSV(filename: string, rows: string[][]) {
  const csv = rows
    .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
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
  // Balances (defaults)
  const [balances, setBalances] = useState<Record<WalletKey, number>>({
    Operating: 50000,
    Yield: 250000,
    Payment: 20000,
  });

  // Policy inputs
  const [operatingTarget, setOperatingTarget] = useState<number>(50000);

  // Bank baseline vs on-chain target (for the “delta” story)
  const [bankApyPct, setBankApyPct] = useState<number>(0.2);
  const [onchainApyPct, setOnchainApyPct] = useState<number>(5.0);

  // Simulation window
  const [months, setMonths] = useState<number>(6);

  // Guided demo state
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>("NotConnected");

  // Controls / approvals
  const [requiresApproval, setRequiresApproval] = useState<boolean>(true);
  const [approved, setApproved] = useState<boolean>(false);

  // Event/audit trail
  const [events, setEvents] = useState<TreasuryEvent[]>([]);

  // For "Simulate Sweep" summary
  const [lastSweep, setLastSweep] = useState<{ sweptAmount: number; timestamp: number } | null>(null);

  const totalCash = useMemo(
    () => balances.Operating + balances.Yield + balances.Payment,
    [balances.Operating, balances.Yield, balances.Payment]
  );

  const excessOperating = useMemo(() => Math.max(0, balances.Operating - operatingTarget), [
    balances.Operating,
    operatingTarget,
  ]);

  const onchainMonthlyRate = useMemo(() => (clampNumber(onchainApyPct, 0, 100) / 100) / 12, [onchainApyPct]);
  const bankMonthlyRate = useMemo(() => (clampNumber(bankApyPct, 0, 100) / 100) / 12, [bankApyPct]);

  const annualUplift = useMemo(() => {
    const principal = clampNumber(balances.Yield, 0);
    const deltaPct = (clampNumber(onchainApyPct, 0, 100) - clampNumber(bankApyPct, 0, 100)) / 100;
    return principal * deltaPct;
  }, [balances.Yield, onchainApyPct, bankApyPct]);

  const monthlyUplift = useMemo(() => annualUplift / 12, [annualUplift]);

  // Analyze step recommendation (simple v1: sweep excess Operating into Yield)
  const recommendation = useMemo(() => {
    const sweepAmount = excessOperating;
    const rationale =
      sweepAmount > 0
        ? `Operating exceeds the target by $${formatUSD(sweepAmount)}. Recommendation: sweep the excess into Yield.`
        : `Operating is at or below the target. Recommendation: no sweep.`;

    return { sweepAmount, rationale };
  }, [excessOperating]);

  // Chart data: bank vs on-chain cumulative yield over N months (simple, non-compounding)
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

  const canContinue = useMemo(() => {
    if (step === 1) return connectionMode !== "NotConnected";
    if (step === 2) return true;
    if (step === 3) return requiresApproval ? approved : true;
    return true;
  }, [step, connectionMode, requiresApproval, approved]);

  const onChangeBalance = (key: WalletKey, raw: string) => {
    const next = clampNumber(parseCurrencyInput(raw), 0);
    setBalances((prev) => ({ ...prev, [key]: next }));
  };

  const logPolicyUpdate = (note: string, nextOperatingTarget = operatingTarget, nextBank = bankApyPct, nextOnchain = onchainApyPct) => {
    const ts = Date.now();
    setEvents((prev) => [
      { type: "POLICY_UPDATED", ts, operatingTarget: nextOperatingTarget, bankApyPct: nextBank, onchainApyPct: nextOnchain, note },
      ...prev,
    ]);
  };

  const handleSimulateSweep = () => {
    // Must be connected (makes Step 1 meaningful)
    if (connectionMode === "NotConnected") {
      setStep(1);
      return;
    }

    // Approval gate (makes Step 3 meaningful)
    if (requiresApproval && !approved) return;

    const sweep = recommendation.sweepAmount;
    if (sweep <= 0) {
      setLastSweep({ sweptAmount: 0, timestamp: Date.now() });
      return;
    }

    setBalances((prev) => ({
      ...prev,
      Operating: prev.Operating - sweep,
      Yield: prev.Yield + sweep,
    }));

    const ts = Date.now();
    setLastSweep({ sweptAmount: sweep, timestamp: ts });
    setEvents((prev) => [{ type: "SWEEP_EXECUTED", ts, amount: sweep }, ...prev]);

    setApproved(false); // reset for next run
    setStep(4); // move to Monitor after execution
  };

  const loadDemoScenario = () => {
    setBalances({ Operating: 80000, Yield: 320000, Payment: 15000 });
    setOperatingTarget(60000);
    setBankApyPct(0.2);
    setOnchainApyPct(5.0);
    setMonths(6);
    setConnectionMode("NotConnected");
    setRequiresApproval(true);
    setApproved(false);
    setEvents([]);
    setLastSweep(null);
    setStep(1);
  };

  return (
    <main className="p-6 md:p-10 space-y-8 max-w-6xl mx-auto">
      {/* HERO */}
      <section className="space-y-3">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
          <div>
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight">Stablecoin Treasury OS</h1>
            <p className="text-muted-foreground mt-1">
              Earn more on idle cash · Automate treasury policies · Keep an audit trail
            </p>
            <p className="text-sm text-muted-foreground mt-2">
              Portfolio demo: simulate how a finance team moves excess operating cash into a yield route with controls.
            </p>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" onClick={loadDemoScenario}>
              Load Demo Scenario
            </Button>
            <Button onClick={() => setStep(1)}>Start Guided Demo</Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 pt-2 items-center">
          <StepPill active={step === 1}>1) Connect</StepPill>
          <StepPill active={step === 2}>2) Analyze</StepPill>
          <StepPill active={step === 3}>3) Allocate</StepPill>
          <StepPill active={step === 4}>4) Monitor</StepPill>

          <div className="ml-auto flex gap-2">
            <Button variant="outline" onClick={() => setStep((s) => (s > 1 ? ((s - 1) as any) : s))}>
              Back
            </Button>
            <Button
              onClick={() => setStep((s) => (s < 4 ? ((s + 1) as any) : s))}
              disabled={!canContinue}
              title={!canContinue ? "Complete this step to continue" : undefined}
            >
              Next
            </Button>
          </div>
        </div>
      </section>

      {/* GUIDED DEMO PANEL (functional) */}
      <section>
        <Card className="rounded-2xl shadow-sm">
          <CardContent className="p-6 space-y-4">
            {step === 1 && (
              <>
                <h2 className="text-lg font-semibold">Connect</h2>
                <p className="text-sm text-muted-foreground">
                  Choose a connection mode. This demo simulates linking accounts and enabling treasury actions.
                </p>

                <div className="flex flex-wrap gap-2">
                  <Button
                    variant={connectionMode === "DemoBankFeed" ? "default" : "outline"}
                    onClick={() => {
                      const ts = Date.now();
                      setConnectionMode("DemoBankFeed");
                      setEvents((prev) => [{ type: "CONNECTED", ts, mode: "DemoBankFeed" }, ...prev]);
                    }}
                  >
                    Connect Demo Bank Feed
                  </Button>

                  <Button
                    variant={connectionMode === "Wallet" ? "default" : "outline"}
                    onClick={() => {
                      const ts = Date.now();
                      setConnectionMode("Wallet");
                      setEvents((prev) => [{ type: "CONNECTED", ts, mode: "Wallet" }, ...prev]);
                    }}
                  >
                    Connect Wallet
                  </Button>

                  <Button
                    variant="outline"
                    onClick={() => setConnectionMode("NotConnected")}
                    disabled={connectionMode === "NotConnected"}
                  >
                    Disconnect
                  </Button>
                </div>

                <div className="rounded-2xl border p-4 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="text-muted-foreground">Status: </span>
                      <span className="font-semibold">{connectionMode}</span>
                    </div>
                    <div className="text-muted-foreground">
                      Tip: “Next” is disabled until you connect.
                    </div>
                  </div>
                </div>
              </>
            )}

            {step === 2 && (
              <>
                <h2 className="text-lg font-semibold">Analyze</h2>
                <p className="text-sm text-muted-foreground">
                  The system identifies idle operating cash based on your target buffer and produces a sweep recommendation.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="rounded-2xl border p-4">
                    <p className="text-xs text-muted-foreground">Operating balance</p>
                    <p className="text-xl font-semibold mt-1">${formatUSD(balances.Operating)}</p>
                  </div>
                  <div className="rounded-2xl border p-4">
                    <p className="text-xs text-muted-foreground">Operating target</p>
                    <p className="text-xl font-semibold mt-1">${formatUSD(operatingTarget)}</p>
                  </div>
                  <div className="rounded-2xl border p-4">
                    <p className="text-xs text-muted-foreground">Recommended sweep</p>
                    <p className="text-xl font-semibold mt-1">${formatUSD(recommendation.sweepAmount)}</p>
                  </div>
                </div>

                <div className="rounded-2xl bg-muted p-4 text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">Recommendation:</span> {recommendation.rationale}
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => setStep(3)}>
                    Proceed to Allocate
                  </Button>
                </div>
              </>
            )}

            {step === 3 && (
              <>
                <h2 className="text-lg font-semibold">Allocate</h2>
                <p className="text-sm text-muted-foreground">
                  Execute the recommended sweep (simulated). Optional approval gate mirrors finance controls.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="rounded-2xl border p-4">
                    <p className="text-xs text-muted-foreground">Sweep amount</p>
                    <p className="text-xl font-semibold mt-1">${formatUSD(recommendation.sweepAmount)}</p>
                    <p className="text-xs text-muted-foreground mt-1">Operating → Yield</p>
                  </div>

                  <div className="rounded-2xl border p-4">
                    <p className="text-xs text-muted-foreground">Approval</p>
                    <div className="mt-2 flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={requiresApproval}
                        onChange={(e) => {
                          setRequiresApproval(e.target.checked);
                          setApproved(false);
                        }}
                      />
                      <span>{requiresApproval ? "Require approval (simulated)" : "No approval required"}</span>
                    </div>

                    {requiresApproval && (
                      <Button
                        className="mt-3"
                        variant={approved ? "outline" : "default"}
                        onClick={() => setApproved(true)}
                      >
                        {approved ? "Approved" : "Approve (Simulated)"}
                      </Button>
                    )}

                    <p className="text-xs text-muted-foreground mt-3">
                      “Next” is disabled until approved (if enabled).
                    </p>
                  </div>

                  <div className="rounded-2xl border p-4">
                    <p className="text-xs text-muted-foreground">Action</p>
                    <Button
                      className="mt-2 w-full"
                      onClick={handleSimulateSweep}
                      disabled={
                        recommendation.sweepAmount <= 0 || (requiresApproval && !approved) || connectionMode === "NotConnected"
                      }
                    >
                      Execute Sweep (Simulated)
                    </Button>
                    <p className="text-xs text-muted-foreground mt-2">
                      Updates balances + writes an audit event.
                    </p>
                  </div>
                </div>
              </>
            )}

            {step === 4 && (
              <>
                <h2 className="text-lg font-semibold">Monitor</h2>
                <p className="text-sm text-muted-foreground">
                  Review what happened and export an audit log. This is the “CFO-ready” proof: outcomes + traceability.
                </p>

                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      const rows: string[][] = [
                        ["timestamp", "time_local", "event", "details"],
                        ...events.map((e) => {
                          if (e.type === "CONNECTED") {
                            return [String(e.ts), fmtTime(e.ts), "CONNECTED", `mode=${e.mode}`];
                          }
                          if (e.type === "POLICY_UPDATED") {
                            return [
                              String(e.ts),
                              fmtTime(e.ts),
                              "POLICY_UPDATED",
                              `target=$${formatUSD(e.operatingTarget)} bank=${e.bankApyPct}% onchain=${e.onchainApyPct}% note=${e.note}`,
                            ];
                          }
                          return [String(e.ts), fmtTime(e.ts), "SWEEP_EXECUTED", `amount=$${formatUSD(e.amount)}`];
                        }),
                      ];
                      downloadCSV("treasury_audit_log.csv", rows);
                    }}
                    disabled={events.length === 0}
                  >
                    Export Audit CSV
                  </Button>

                  <Button variant="outline" onClick={() => setEvents([])} disabled={events.length === 0}>
                    Clear Events
                  </Button>

                  <Button variant="outline" onClick={() => setStep(2)}>
                    Re-run Analysis
                  </Button>
                </div>

                <div className="rounded-2xl border overflow-hidden">
                  <div className="grid grid-cols-3 bg-muted px-4 py-2 text-xs font-semibold text-muted-foreground">
                    <div>Time</div>
                    <div>Event</div>
                    <div>Details</div>
                  </div>

                  {events.length === 0 ? (
                    <div className="px-4 py-3 text-sm text-muted-foreground">
                      No events yet. Execute a sweep to generate an audit trail.
                    </div>
                  ) : (
                    events.slice(0, 12).map((e, idx) => (
                      <div key={idx} className="grid grid-cols-3 px-4 py-3 text-sm border-t">
                        <div className="text-muted-foreground">{fmtTime(e.ts)}</div>
                        <div className="font-medium">{e.type}</div>
                        <div className="text-muted-foreground">
                          {e.type === "CONNECTED" && `mode=${e.mode}`}
                          {e.type === "POLICY_UPDATED" &&
                            `target=$${formatUSD(e.operatingTarget)} bank=${e.bankApyPct}% onchain=${e.onchainApyPct}% (${e.note})`}
                          {e.type === "SWEEP_EXECUTED" && `amount=$${formatUSD(e.amount)}`}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </section>

      {/* QUANTIFIED VALUE */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="rounded-2xl shadow-sm lg:col-span-2">
          <CardContent className="p-6 space-y-4">
            <h2 className="text-lg font-semibold">Treasury Snapshot</h2>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="rounded-2xl border p-4">
                <p className="text-xs text-muted-foreground">Total cash</p>
                <p className="text-2xl font-semibold mt-1">${formatUSD(totalCash)}</p>
                <p className="text-xs text-muted-foreground mt-1">Operating + Yield + Payment</p>
              </div>

              <div className="rounded-2xl border p-4">
                <p className="text-xs text-muted-foreground">Yield principal</p>
                <p className="text-2xl font-semibold mt-1">${formatUSD(balances.Yield)}</p>
                <p className="text-xs text-muted-foreground mt-1">Used for delta simulation</p>
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
              This demo focuses on finance outcomes: <span className="font-medium text-foreground">policy</span> →
              <span className="font-medium text-foreground"> allocation</span> →
              <span className="font-medium text-foreground"> measurable uplift</span> + an
              <span className="font-medium text-foreground"> audit trail</span>.
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl shadow-sm">
          <CardContent className="p-6 space-y-4">
            <h2 className="text-lg font-semibold">Rates & Window</h2>

            <div className="space-y-2">
              <label className="text-sm font-medium">Bank baseline APY</label>
              <div className="flex items-center gap-2">
                <input
                  className="w-full rounded-xl border px-3 py-2 text-sm"
                  inputMode="decimal"
                  value={bankApyPct.toString()}
                  onChange={(e) => {
                    const next = clampNumber(Number(e.target.value), 0, 100);
                    setBankApyPct(next);
                    logPolicyUpdate("Updated bank APY", operatingTarget, next, onchainApyPct);
                  }}
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
                  onChange={(e) => {
                    const next = clampNumber(Number(e.target.value), 0, 100);
                    setOnchainApyPct(next);
                    logPolicyUpdate("Updated on-chain APY", operatingTarget, bankApyPct, next);
                  }}
                  aria-label="On-chain APY percent"
                />
                <span className="text-muted-foreground text-sm">%</span>
              </div>
              <p className="text-xs text-muted-foreground">Delta: {formatPct(onchainApyPct - bankApyPct)}</p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Simulation months</label>
              <input
                className="w-full rounded-xl border px-3 py-2 text-sm"
                inputMode="numeric"
                value={months.toString()}
                onChange={(e) => setMonths(clampNumber(Number(e.target.value), 1, 24))}
                aria-label="Simulation months"
              />
              <p className="text-xs text-muted-foreground">Simple cumulative yield (non-compounding).</p>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* INPUTS */}
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
                  onChange={(e) => {
                    const next = clampNumber(parseCurrencyInput(e.target.value), 0);
                    setOperatingTarget(next);
                    logPolicyUpdate("Updated operating target", next, bankApyPct, onchainApyPct);
                  }}
                  aria-label="Operating target"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Excess available to sweep: ${formatUSD(excessOperating)}
              </p>
            </div>

            <div className="rounded-2xl bg-muted p-4 text-sm">
              <p className="font-medium">Quick flow controls</p>
              <p className="text-muted-foreground mt-1">
                Adjust policy → Analyze the recommendation → Allocate with approvals → Monitor with audit log.
              </p>
              <div className="mt-3 flex gap-2">
                <Button variant="outline" onClick={() => setStep(2)}>
                  Analyze
                </Button>
                <Button onClick={() => setStep(3)}>Allocate</Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* WALLET OVERVIEW */}
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

      {/* YIELD SIMULATION */}
      <section>
        <Card className="rounded-2xl shadow-sm">
          <CardContent className="p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">Yield Delta Simulation</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Cumulative yield on Yield balance (${formatUSD(balances.Yield)}) over {months} months.
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

      {/* SWEEP ACTION */}
      <section>
        <Card className="rounded-2xl shadow-sm">
          <CardContent className="p-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">Automated Allocation Policy</h2>
              <p className="text-muted-foreground mt-1">
                When Operating exceeds the target, sweep the excess into Yield (simulated). Approval gating is handled in
                the guided Allocate step.
              </p>

              <p className="text-sm mt-3">
                <span className="text-muted-foreground">Current excess: </span>
                <span className="font-semibold">${formatUSD(excessOperating)}</span>
              </p>

              {lastSweep && (
                <p className="text-xs text-muted-foreground mt-2">
                  Last sweep: ${formatUSD(lastSweep.sweptAmount)} · {new Date(lastSweep.timestamp).toLocaleTimeString()}
                </p>
              )}
            </div>

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep(3)}>
                Allocate (Guided)
              </Button>
              <Button onClick={handleSimulateSweep} disabled={connectionMode === "NotConnected"}>
                Quick Sweep
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* COMPARISON */}
      <section>
        <Card className="rounded-2xl shadow-sm">
          <CardContent className="p-6 space-y-4">
            <h2 className="text-lg font-semibold">Why this product exists</h2>
            <p className="text-sm text-muted-foreground">
              A finance-first treasury workflow: automate idle cash allocation while keeping controls and traceability.
            </p>

            <div className="overflow-hidden rounded-2xl border">
              <div className="grid grid-cols-3 bg-muted px-4 py-3 text-xs font-semibold text-muted-foreground">
                <div>Capability</div>
                <div>Traditional bank treasury</div>
                <div>Treasury OS</div>
              </div>

              {[
                ["Yield on idle cash", "≈ 0–1% (often near 0%)", `${formatPct(onchainApyPct)} target (route-dependent)`],
                ["Execution speed", "ACH/wires, cutoffs & delays", "Programmable allocation (simulated)"],
                ["Controls", "Manual approvals across email/spreadsheets", "Policy + approval gating in workflow"],
                ["Visibility", "Delayed reconciliation", "Real-time balances + event trail"],
                ["Audit readiness", "End-of-month cleanup", "Exportable audit log"],
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

      <footer className="pt-2 pb-8 text-xs text-muted-foreground">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
          <div>Stablecoin Treasury OS — interactive portfolio demo</div>
          <div>Try: Connect → set a target → Analyze → Approve → Execute → Export audit CSV</div>
        </div>
      </footer>
    </main>
  );
}