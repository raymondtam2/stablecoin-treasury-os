"use client";

import React, { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

type WalletKey = "Operating" | "Yield" | "Payment";

function clampNumber(n: number, min = 0, max = Number.MAX_SAFE_INTEGER) {
  if (Number.isNaN(n)) return min;
  return Math.min(Math.max(n, min), max);
}

function formatUSD(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function parseCurrencyInput(value: string) {
  // allow users to type commas, $ etc.
  const cleaned = value.replace(/[^\d.]/g, "");
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : 0;
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
  const [apyPct, setApyPct] = useState<number>(5.0); // annual percentage yield
  const [months, setMonths] = useState<number>(4);

  // For the "Simulate Sweep" button
  const [lastSweep, setLastSweep] = useState<{
    sweptAmount: number;
    timestamp: number;
  } | null>(null);

  const excessOperating = useMemo(() => {
    return Math.max(0, balances.Operating - operatingTarget);
  }, [balances.Operating, operatingTarget]);

  const monthlyRate = useMemo(() => {
    const apy = clampNumber(apyPct, 0, 100) / 100;
    return apy / 12;
  }, [apyPct]);

  // Cumulative yield over N months on the Yield balance (simple, not compounding)
  // You can switch to compounding later if you want.
  const yieldSimulation = useMemo(() => {
    const m = clampNumber(months, 1, 24);
    const yieldBalance = clampNumber(balances.Yield, 0);

    const data = Array.from({ length: m }, (_, i) => {
      const monthIndex = i + 1;
      const cumulative = yieldBalance * monthlyRate * monthIndex;
      return {
        month: `Month ${monthIndex}`,
        cash: 0,
        usdc: Math.round(cumulative),
      };
    });

    return data;
  }, [balances.Yield, monthlyRate, months]);

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
  };

  return (
    <main className="p-10 space-y-8">
      {/* Header */}
      <section>
        <h1 className="text-3xl font-bold">The Autonomous Treasury</h1>
        <p className="text-muted-foreground mt-1">
          Proof of Concept — Stablecoin Treasury OS (USDC on Base)
        </p>
      </section>

      {/* Controls */}
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
                  <p className="text-xs text-muted-foreground">
                    Display: ${formatUSD(balances[k])}
                  </p>
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
                  onChange={(e) =>
                    setOperatingTarget(
                      clampNumber(parseCurrencyInput(e.target.value), 0)
                    )
                  }
                  aria-label="Operating target"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Excess available to sweep: ${formatUSD(excessOperating)}
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Assumed APY</label>
              <div className="flex items-center gap-2">
                <input
                  className="w-full rounded-xl border px-3 py-2 text-sm"
                  inputMode="decimal"
                  value={apyPct.toString()}
                  onChange={(e) =>
                    setApyPct(clampNumber(Number(e.target.value), 0, 100))
                  }
                  aria-label="APY percent"
                />
                <span className="text-muted-foreground text-sm">%</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Monthly rate: {(monthlyRate * 100).toFixed(3)}%
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Simulation Months</label>
              <input
                className="w-full rounded-xl border px-3 py-2 text-sm"
                inputMode="numeric"
                value={months.toString()}
                onChange={(e) =>
                  setMonths(clampNumber(Number(e.target.value), 1, 24))
                }
                aria-label="Simulation months"
              />
              <p className="text-xs text-muted-foreground">
                Uses simple cumulative yield on the Yield balance.
              </p>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Wallet Overview */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {(["Operating", "Yield", "Payment"] as WalletKey[]).map((name) => (
          <Card key={name} className="rounded-2xl shadow-sm">
            <CardContent className="p-6">
              <h2 className="text-lg font-semibold">{name} Account</h2>
              <p className="text-2xl mt-3">${formatUSD(balances[name])}</p>
              {name === "Operating" && (
                <p className="text-xs text-muted-foreground mt-2">
                  Target: ${formatUSD(operatingTarget)} · Excess: $
                  {formatUSD(excessOperating)}
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </section>

      {/* Yield Simulation */}
      <section>
        <Card className="rounded-2xl shadow-sm">
          <CardContent className="p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">Yield vs Cash Simulation</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Cumulative yield on Yield balance (${formatUSD(balances.Yield)}) at{" "}
                  {apyPct.toFixed(2)}% APY.
                </p>
              </div>

              <div className="text-right">
                <p className="text-xs text-muted-foreground">Est. month 1 yield</p>
                <p className="text-sm font-semibold">
                  ${formatUSD(Math.round(balances.Yield * monthlyRate))}
                </p>
              </div>
            </div>

            <div className="h-[260px] mt-4">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={yieldSimulation}>
                  <XAxis dataKey="month" />
                  <YAxis />
                  <Tooltip />
                  <Line type="monotone" dataKey="usdc" strokeWidth={2} />
                  <Line
                    type="monotone"
                    dataKey="cash"
                    strokeDasharray="4 4"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Smart Sweep */}
      <section>
        <Card className="rounded-2xl shadow-sm">
          <CardContent className="p-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">
                Automated Cash Policy (Simulation)
              </h2>
              <p className="text-muted-foreground mt-1">
                If Operating exceeds ${formatUSD(operatingTarget)}, sweep the excess
                into Yield.
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

            <Button onClick={handleSimulateSweep}>
              Simulate Sweep
            </Button>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
