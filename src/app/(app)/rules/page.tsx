"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { ErrorBox } from "@/components/common";
import { Badge, Button, Card, Empty, Field, Input, Select } from "@/components/ui";
import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/client/api";
import { OPERATORS, RULE_ACTIONS, RULE_METRICS, type RuleCondition, type RuleMetric } from "@/services/rules/engine";

interface RuleRow {
  id: string;
  name: string;
  enabled: boolean;
  mode: string;
  conditions: RuleCondition[];
  action: string;
  actionValue: string | null;
  createdBy: string;
  createdAt: string;
}

const ACTION_LABEL: Record<string, string> = { DECREASE_BUDGET: "Decrease Budget", INCREASE_BUDGET: "Increase Budget", TURN_OFF: "Turn OFF", TURN_ON: "Turn ON" };
const unit = (m: RuleMetric) => (RULE_METRICS[m].unit === "%" ? "%" : RULE_METRICS[m].unit === "money" ? "(account currency)" : "");

export default function RulesPage() {
  const { data, error, reload } = useApi<{ items: RuleRow[] }>("/api/rules");
  const [name, setName] = useState("Low IAA D0 ROAS");
  const [conds, setConds] = useState<RuleCondition[]>([
    { metric: "iaa_d0_roas", operator: "<", value: 90 },
    { metric: "spend", operator: ">", value: 100 },
  ]);
  const [action, setAction] = useState<string>("DECREASE_BUDGET");
  const [value, setValue] = useState(20);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function create() {
    setSaveError(null);
    try {
      await api("/api/rules", { method: "POST", json: { name, enabled: true, conditions: conds, action, actionValue: action.endsWith("_BUDGET") ? value : null } });
      void reload();
    } catch (e) {
      setSaveError((e as Error).message);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,460px)_1fr]">
      <Card className="flex flex-col gap-3 p-4">
        <h1 className="text-sm font-semibold">Rule builder</h1>
        <p className="rounded-md border border-info/40 px-3 py-2 text-xs text-info">
          Rules are <b>recommendation only</b>. A match creates a Suggested Action on the Overview. Nothing runs until a user reviews it and clicks Confirm. Automatic execution is not available.
        </p>
        <Field label="Rule name">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="text-xs font-semibold">IF</div>
        {conds.map((c, i) => (
          <div key={i} className="flex flex-wrap items-end gap-2">
            {i > 0 && <span className="pb-2 text-xs font-semibold">AND</span>}
            <Field label="Metric">
              <Select value={c.metric} onChange={(e) => setConds(conds.map((x, j) => (j === i ? { ...x, metric: e.target.value as RuleMetric } : x)))}>
                {(Object.keys(RULE_METRICS) as RuleMetric[]).map((m) => (
                  <option key={m} value={m}>
                    {RULE_METRICS[m].label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Operator">
              <Select value={c.operator} onChange={(e) => setConds(conds.map((x, j) => (j === i ? { ...x, operator: e.target.value as RuleCondition["operator"] } : x)))}>
                {OPERATORS.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </Select>
            </Field>
            <Field label={`Value ${unit(c.metric)}`}>
              <Input className="w-28" type="number" value={c.value} onChange={(e) => setConds(conds.map((x, j) => (j === i ? { ...x, value: Number(e.target.value) } : x)))} />
            </Field>
            {conds.length > 1 && (
              <Button size="sm" variant="ghost" onClick={() => setConds(conds.filter((_, j) => j !== i))} aria-label="Remove condition">
                <Trash2 className="size-3.5" />
              </Button>
            )}
          </div>
        ))}
        {conds.length < 6 && (
          <Button size="sm" className="self-start" onClick={() => setConds([...conds, { metric: "spend", operator: ">", value: 0 }])}>
            <Plus className="size-3.5" /> AND condition
          </Button>
        )}
        <div className="text-xs font-semibold">THEN suggest</div>
        <div className="flex items-end gap-2">
          <Field label="Action">
            <Select value={action} onChange={(e) => setAction(e.target.value)}>
              {RULE_ACTIONS.map((a) => (
                <option key={a} value={a}>
                  {ACTION_LABEL[a]}
                </option>
              ))}
            </Select>
          </Field>
          {action.endsWith("_BUDGET") && (
            <Field label="Value (%)">
              <Input className="w-24" type="number" min={1} max={100} value={value} onChange={(e) => setValue(Number(e.target.value))} />
            </Field>
          )}
        </div>
        {conds.some((c) => c.metric === "iaa_d0_roas") && (
          <p className="text-xs text-warn">While IAA D0 ROAS is unavailable from TikTok MCP reporting, conditions on it never match (no value is assumed).</p>
        )}
        {saveError && <p className="text-xs text-danger">{saveError}</p>}
        <Button variant="primary" onClick={create}>
          Create Rule
        </Button>
      </Card>

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Rules</h2>
        <ErrorBox error={error} onRetry={() => reload()} />
        {data && !data.items.length && (
          <Card>
            <Empty>No rules yet.</Empty>
          </Card>
        )}
        {data?.items.map((r) => (
          <Card key={r.id} className="flex items-center gap-3 p-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium">{r.name}</span>
                <Badge className={r.enabled ? "border-ok/30 text-ok" : "border-border text-muted"}>{r.enabled ? "Enabled" : "Disabled"}</Badge>
                <Badge className="border-info/40 text-info">Recommendation only</Badge>
              </div>
              <div className="mt-0.5 text-xs text-muted">
                IF {r.conditions.map((c) => `${RULE_METRICS[c.metric]?.label ?? c.metric} ${c.operator} ${c.value}${RULE_METRICS[c.metric]?.unit === "%" ? "%" : ""}`).join(" AND ")} THEN {ACTION_LABEL[r.action]}
                {r.actionValue ? ` ${Number(r.actionValue)}%` : ""} · by {r.createdBy}
              </div>
            </div>
            <Button size="sm" onClick={async () => (await api(`/api/rules/${r.id}`, { method: "PATCH", json: { enabled: !r.enabled } }), reload())}>
              {r.enabled ? "Disable" : "Enable"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-label="Delete rule"
              onClick={async () => {
                if (confirm(`Delete rule "${r.name}"?`)) {
                  await api(`/api/rules/${r.id}`, { method: "DELETE" });
                  void reload();
                }
              }}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </Card>
        ))}
      </div>
    </div>
  );
}
