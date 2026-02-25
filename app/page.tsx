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
  | { type: "BALANCE_UPDATED"; ts: number; account: WalletKey; value: number }
  | { type: "SWEEP_EXECUTED"; ts: number; amount: number; path: "Guided" | "Quick" };

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

function StepTag({ label }: { label: string }) {
  return <span className="text-xs rounded-full bg-muted px-2 py-1 text-muted-foreground">{label}</span>;
}

export default function TreasuryDashboard() {
  // Balances
  const [balances, setBalances] = useState<Record<WalletKey, number>>({
    Operating: 200000,
    Yield: 250000,
    Payment: 20000,
  });

  // Policy inputs
  const [operatingTarget, setOperatingTarget] = useState<number>(50000);

  // Bank baseline vs on-chain target
  const [bankApyPct, setBankApyPct] = useState<number>(0.2);
  const [onchainApyPct, setOnchainApyPct] = useState<number>(5.0);

  // Simulation window
  const [months, setMonths] = useState<number>(6);

  // Guided demo state
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>("NotConnected");

  // Approval gate (applies to ALL sweeps)
  const [requiresApproval, setRequiresApproval] = useState<boolean>(true);
  const [approved, setApproved] = useState<boolean>(false);

  // Audit trail
  const [events, setEvents] = useState<TreasuryEvent[]>([]);
  const [lastSweep, setLastSweep] = useState<{ sweptAmount: number; timestamp: number; path: "Guided" | "Quick" } | null>(
    null
  );

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

  // Step 2 output (analysis)
  const recommendation = useMemo(() => {
    const sweepAmount = excessOperating;
    const rationale =
      sweepAmount > 0
        ? `Operating exceeds the target by $${formatUSD(sweepAmount)}. Recommendation: sweep the excess into Yield.`
        : `Operating is at or below the target. Recommendation: no sweep.`;
    return { sweepAmount, rationale };
  }, [excessOperating]);

  // Step 4 output (chart)
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

  // Gating for Next button
  const canContinue = useMemo(() => {
    if (step === 1) return connectionMode !== "NotConnected";
    if (step === 2) return true;
    if (step === 3) return requiresApproval ? approved : true;
    return true;
  }, [step, connectionMode, requiresApproval, approved]);

  const logPolicyUpdate = (
    note: string,
    nextOperatingTarget = operatingTarget,
    nextBank = bankApyPct,
    nextOnchain = onchainApyPct
  ) => {
    const ts = Date.now();
    setEvents((prev) => [
      { type: "POLICY_UPDATED", ts, operatingTarget: nextOperatingTarget, bankApyPct: nextBank, onchainApyPct: nextOnchain, note },
      ...prev,
    ]);
  };

  const logBalanceUpdate = (account: WalletKey, value: number) => {
    const ts = Date.now();
    setEvents((prev) => [{ type: "BALANCE_UPDATED", ts, account, value }, ...prev]);
  };

  const onChangeBalance = (key: WalletKey, raw: string) => {
    const next = clampNumber(parseCurrencyInput(raw), 0);
    setBalances((prev) => ({ ...prev, [key]: next }));
    logBalanceUpdate(key, next);
  };

  const connect = (mode: Exclude<ConnectionMode, "NotConnected">) => {
    const ts = Date.now();
    setConnectionMode(mode);
    setEvents((prev) => [{ type: "CONNECTED", ts, mode }, ...prev]);
  };

  const canExecuteSweep = useMemo(() => {
    if (connectionMode === "NotConnected") return false;
    if (recommendation.sweepAmount <= 0) return false;
    if (requiresApproval && !approved) return false;
    return true;
  }, [connectionMode, recommendation.sweepAmount, requiresApproval, approved]);

  const executeSweep = (path: "Guided" | "Quick") => {
    if (!canExecuteSweep) return;

    const sweep = recommendation.sweepAmount;

    setBalances((prev) => ({
      ...prev,
      Operating: prev.Operating - sweep,
      Yield: prev.Yield + sweep,
    }));

    const ts = Date.now();
    setLastSweep({ sweptAmount: sweep, timestamp: ts, path });
    setEvents((prev) => [{ type: "SWEEP_EXECUTED", ts, amount: sweep, path }, ...prev]);

    setApproved(false);
    setStep(4);
  };

  const exportAudit = () => {
    const rows: string[][] = [
      ["timestamp", "time_local", "event", "details"],
      ...events.map((e) => {
        if (e.type === "CONNECTED") return [String(e.ts), fmtTime(e.ts), "CONNECTED", `mode=${e.mode}`];
        if (e.type === "POLICY_UPDATED")
          return [
            String(e.ts),
            fmtTime(e.ts),
            "POLICY_UPDATED",
            `target=$${formatUSD(e.operatingTarget)} bank=${e.bankApyPct}% onchain=${e.onchainApyPct}% note=${e.note}`,
          ];
        if (e.type === "BALANCE_UPDATED")
          return [String(e.ts), fmtTime(e.ts), "BALANCE_UPDATED", `${e.account}=$${formatUSD(e.value)}`];
        return [String(e.ts), fmtTime(e.ts), "SWEEP_EXECUTED", `amount=$${formatUSD(e.amount)} path=${e.path}`];
      }),
    ];
    downloadCSV("treasury_audit_log.csv", rows);
  };

  return (
    <main className="p-6 md:p-10 space-y-8 max-w-6xl mx-auto">
      {/* HERO / NAV */}
      <section className="space-y-3">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
          <div>
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight">Stablecoin Treasury OS</h1>
            <p className="text-muted-foreground mt-1">
              Earn more on idle cash · Automate treasury policies · Keep an audit trail
            </p>
            <p className="text-sm text-muted-foreground mt-2">
              Scroll down to progress through the guided flow (Steps 1–4).
            </p>
          </div>

          <div className="flex gap-2">
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

      {/* STEP 1: CONNECT */}
      <section>
        <Card className={["rounded-2xl shadow-sm", step === 1 ? "ring-2 ring-black" : ""].join(" ")}>
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">Step 1 — Connect</h2>
              <StepTag label="Guided" />
            </div>

            <p className="text-sm text-muted-foreground">
              Choose a connection mode. Allocations are disabled until connected to mirror real treasury permissions.
            </p>

            <div className="flex flex-wrap gap-2">
              <Button
                variant={connectionMode === "DemoBankFeed" ? "default" : "outline"}
                onClick={() => connect("DemoBankFeed")}
              >
                Connect Demo Bank Feed
              </Button>
              <Button
                variant={connectionMode === "Wallet" ? "default" : "outline"}
                onClick={() => connect("Wallet")}
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
              <span className="text-muted-foreground">Status: </span>
              <span className="font-semibold">{connectionMode}</span>
              <span className="text-muted-foreground">
                {connectionMode === "NotConnected" ? " — connect to enable allocations" : " — allocations enabled"}
              </span>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* STEP 2: ANALYZE (inputs + snapshot + recommendation) */}
      <section className="space-y-6">
        <Card className={["rounded-2xl shadow-sm", step === 2 ? "ring-2 ring-black" : ""].join(" ")}>
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">Step 2 — Analyze</h2>
              <StepTag label="Guided" />
            </div>

            <p className="text-sm text-muted-foreground">
              Adjust balances, targets, and rates. The system recomputes idle cash and the recommended sweep in real time.
            </p>

            {/* Snapshot */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="rounded-2xl border p-4">
                <p className="text-xs text-muted-foreground">Total cash</p>
                <p className="text-2xl font-semibold mt-1">${formatUSD(totalCash)}</p>
                <p className="text-xs text-muted-foreground mt-1">Operating + Yield + Payment</p>
              </div>

              <div className="rounded-2xl border p-4">
                <p className="text-xs text-muted-foreground">Yield principal</p>
                <p className="text-2xl font-semibold mt-1">${formatUSD(balances.Yield)}</p>
                <p className="text-xs text-muted-foreground mt-1">Basis for delta simulation</p>
              </div>

              <div className="rounded-2xl border p-4">
                <p className="text-xs text-muted-foreground">Incremental uplift (annualized)</p>
                <p className="text-2xl font-semibold mt-1">${formatUSD(Math.round(annualUplift))}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  ≈ ${formatUSD(Math.round(monthlyUplift))}/month vs bank baseline
                </p>
              </div>
            </div>

            {/* Inputs */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 pt-2">
              <div className="lg:col-span-2 space-y-3">
                <h3 className="text-sm font-semibold text-muted-foreground">Account Inputs</h3>

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
              </div>

              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-muted-foreground">Policy + Rates</h3>

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
                  <p className="text-xs text-muted-foreground">Cumulative yield (non-compounding).</p>
                </div>
              </div>
            </div>

            {/* Analysis output */}
            <div className="rounded-2xl bg-muted p-4 text-sm text-muted-foreground space-y-2">
              <div className="flex items-center justify-between">
                <p className="font-medium text-foreground">Analysis output</p>
                <StepTag label="Live" />
              </div>
              <p>{recommendation.rationale}</p>
              <p>
                <span className="text-muted-foreground">Recommended sweep: </span>
                <span className="font-semibold text-foreground">${formatUSD(recommendation.sweepAmount)}</span>
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Wallet overview (still useful during Analyze) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {(["Operating", "Yield", "Payment"] as WalletKey[]).map((name) => (
            <Card key={name} className="rounded-2xl shadow-sm">
              <CardContent className="p-6">
                <h3 className="text-lg font-semibold">{name} Account</h3>
                <p className="text-2xl mt-3">${formatUSD(balances[name])}</p>
                {name === "Operating" && (
                  <p className="text-xs text-muted-foreground mt-2">
                    Target: ${formatUSD(operatingTarget)} · Excess: ${formatUSD(excessOperating)}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* STEP 3: ALLOCATE */}
      <section>
        <Card className={["rounded-2xl shadow-sm", step === 3 ? "ring-2 ring-black" : ""].join(" ")}>
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">Step 3 — Allocate</h2>
              <StepTag label="Guided" />
            </div>

            <p className="text-sm text-muted-foreground">
              Apply controls (optional approval) and execute the recommended sweep. This updates balances and writes an audit event.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="rounded-2xl border p-4">
                <p className="text-xs text-muted-foreground">Recommended sweep</p>
                <p className="text-xl font-semibold mt-1">${formatUSD(recommendation.sweepAmount)}</p>
                <p className="text-xs text-muted-foreground mt-1">Operating → Yield</p>
              </div>

              <div className="rounded-2xl border p-4 space-y-2">
                <p className="text-sm font-medium">Controls</p>

                <div className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={requiresApproval}
                    onChange={(e) => {
                      setRequiresApproval(e.target.checked);
                      setApproved(false);
                    }}
                  />
                  <span>{requiresApproval ? "Require approval before allocating" : "No approval required"}</span>
                </div>

                {requiresApproval && (
                  <Button
                    variant={approved ? "outline" : "default"}
                    onClick={() => setApproved(true)}
                  >
                    {approved ? "Approved" : "Approve (Simulated)"}
                  </Button>
                )}

                <p className="text-xs text-muted-foreground">
                  When enabled, approval applies to all sweep actions.
                </p>
              </div>

              <div className="rounded-2xl border p-4 space-y-2">
                <p className="text-sm font-medium">Execute</p>

                <Button
                  onClick={() => executeSweep("Guided")}
                  disabled={!canExecuteSweep}
                  title={
                    !canExecuteSweep
                      ? connectionMode === "NotConnected"
                        ? "Connect first"
                        : requiresApproval && !approved
                        ? "Approve first"
                        : "No sweep available"
                      : undefined
                  }
                >
                  Execute Sweep
                </Button>

                <Button
                  variant="outline"
                  onClick={() => executeSweep("Quick")}
                  disabled={!canExecuteSweep}
                  title={
                    !canExecuteSweep
                      ? connectionMode === "NotConnected"
                        ? "Connect first"
                        : requiresApproval && !approved
                        ? "Approve first"
                        : "No sweep available"
                      : undefined
                  }
                >
                  Quick Sweep
                </Button>

                <p className="text-xs text-muted-foreground">
                  Both buttons produce the same ledger movement; the audit log records the path.
                </p>
              </div>
            </div>

            {lastSweep && (
              <div className="rounded-2xl bg-muted p-4 text-sm text-muted-foreground">
                Last sweep ({lastSweep.path}): <span className="font-semibold text-foreground">${formatUSD(lastSweep.sweptAmount)}</span>{" "}
                at {new Date(lastSweep.timestamp).toLocaleTimeString()}.
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      {/* STEP 4: MONITOR (chart + audit) */}
      <section className="space-y-6">
        <Card className={["rounded-2xl shadow-sm", step === 4 ? "ring-2 ring-black" : ""].join(" ")}>
          <CardContent className="p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold">Step 4 — Monitor</h2>
                  <StepTag label="Guided" />
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  Track outcomes over time and export an audit trail of actions taken during the session.
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Bank: {formatPct(bankApyPct)} APY · On-chain: {formatPct(onchainApyPct)} APY · Window: {months} months
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

        <Card className={["rounded-2xl shadow-sm", step === 4 ? "ring-2 ring-black" : ""].join(" ")}>
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-lg font-semibold">Audit Log</h3>
              <StepTag label="Exportable" />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={exportAudit} disabled={events.length === 0}>
                Export Audit CSV
              </Button>
              <Button variant="outline" onClick={() => setEvents([])} disabled={events.length === 0}>
                Clear Events
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
                  No events yet. Try: connect → change a policy → execute a sweep.
                </div>
              ) : (
                events.slice(0, 14).map((e, idx) => (
                  <div key={idx} className="grid grid-cols-3 px-4 py-3 text-sm border-t">
                    <div className="text-muted-foreground">{fmtTime(e.ts)}</div>
                    <div className="font-medium">{e.type}</div>
                    <div className="text-muted-foreground">
                      {e.type === "CONNECTED" && `mode=${e.mode}`}
                      {e.type === "POLICY_UPDATED" &&
                        `target=$${formatUSD(e.operatingTarget)} bank=${e.bankApyPct}% onchain=${e.onchainApyPct}% (${e.note})`}
                      {e.type === "BALANCE_UPDATED" && `${e.account}=$${formatUSD(e.value)}`}
                      {e.type === "SWEEP_EXECUTED" && `amount=$${formatUSD(e.amount)} path=${e.path}`}
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </section>

      {/* WHY THIS EXISTS */}
      <section>
        <Card className="rounded-2xl shadow-sm">
          <CardContent className="p-6 space-y-4">
            <h2 className="text-lg font-semibold">Why this product exists</h2>
            <p className="text-sm text-muted-foreground">
              A finance-first workflow: automate idle cash allocation while keeping controls and traceability.
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
          <div>Flow: Step 1 Connect → Step 2 Analyze → Step 3 Allocate → Step 4 Monitor</div>
        </div>
      </footer>
    </main>
  );
}