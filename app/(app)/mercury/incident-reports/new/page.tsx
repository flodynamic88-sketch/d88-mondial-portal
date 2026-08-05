"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/mercury/supabase/client";
import type { Branch, Client, IncidentReport, IrClassification } from "@/lib/mercury/types";
import { IR_CLASSIFICATIONS } from "@/lib/mercury/types";

function nextIrNumber(existing: IncidentReport[]): string {
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, "0");
  const d = String(today.getDate()).padStart(2, "0");
  const prefix = `IR-${y}${m}${d}`;

  const todaysNums = existing
    .map((r) => r.ir_number)
    .filter((c) => c.startsWith(prefix))
    .map((c) => {
      const suffix = c.slice(prefix.length).replace(/^-/, "");
      const n = parseInt(suffix, 10);
      return isNaN(n) ? 0 : n;
    });

  const next = (todaysNums.length ? Math.max(...todaysNums) : 0) + 1;
  return `${prefix}-${String(next).padStart(2, "0")}`;
}

export default function NewIncidentReportPage() {
  const router = useRouter();

  const [clients, setClients] = useState<Client[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [existingReports, setExistingReports] = useState<IncidentReport[]>([]);

  const [irNumber, setIrNumber] = useState("");
  const [incidentDate, setIncidentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [dateReported, setDateReported] = useState(() => new Date().toISOString().slice(0, 10));
  const [classification, setClassification] = useState<IrClassification | "">("");
  const [otherClassification, setOtherClassification] = useState("");

  const [clientId, setClientId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [location, setLocation] = useState("");

  const [employeeName, setEmployeeName] = useState("");
  const [employeePosition, setEmployeePosition] = useState("");
  const [reportedBy, setReportedBy] = useState("");

  const [description, setDescription] = useState("");
  const [immediateAction, setImmediateAction] = useState("");
  const [correctiveAction, setCorrectiveAction] = useState("");
  const [preventiveAction, setPreventiveAction] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    async function load() {
      const [clientsRes, branchesRes, reportsRes] = await Promise.all([
        supabase.schema("flo").from("clients").select("*").order("client_code").range(0, 9999),
        supabase.schema("flo").from("branches").select("*").order("branch_name").range(0, 9999),
        supabase.schema("flo").from("incident_reports").select("*"),
      ]);
      setClients((clientsRes.data as Client[]) || []);
      setBranches((branchesRes.data as Branch[]) || []);
      const reports = (reportsRes.data as IncidentReport[]) || [];
      setExistingReports(reports);
      setIrNumber(nextIrNumber(reports));
    }
    load();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!irNumber.trim()) {
      setError("Please provide an IR number.");
      return;
    }
    if (!classification) {
      setError("Please select a classification.");
      return;
    }
    if (classification === "Other" && !otherClassification.trim()) {
      setError('Please specify the "Other" classification.');
      return;
    }
    if (!employeeName.trim()) {
      setError("Please provide the employee involved.");
      return;
    }
    if (!description.trim()) {
      setError("Please provide a description of the incident.");
      return;
    }

    setSaving(true);
    const supabase = createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { data: ir, error: irErr } = await supabase
      .schema("flo").from("incident_reports")
      .insert({
        ir_number: irNumber.trim(),
        incident_date: incidentDate || null,
        date_reported: dateReported || null,
        classification,
        other_classification: classification === "Other" ? otherClassification.trim() : null,
        client_id: clientId || null,
        branch_id: branchId || null,
        location: location.trim() || null,
        employee_name: employeeName.trim(),
        employee_position: employeePosition.trim() || null,
        reported_by: reportedBy.trim() || null,
        description: description.trim(),
        immediate_action_taken: immediateAction.trim() || null,
        corrective_action: correctiveAction.trim() || null,
        preventive_action: preventiveAction.trim() || null,
        status: "Open",
        created_by: user?.id || null,
      })
      .select()
      .single();

    setSaving(false);

    if (irErr || !ir) {
      setError(irErr?.message || "Failed to create incident report.");
      return;
    }

    router.push(`/mercury/incident-reports/${ir.id}`);
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">New Incident Report</h1>
        <p className="text-sm text-gray-500">
          Encode a new IR. Wrong Count, Discrepancy, Loss, Damage, Insubordination, Wrong Picking,
          or Other issue encountered.
        </p>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="card p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-700">IR Details</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="label">
                IR Number <span className="text-red-500">*</span>
              </label>
              <input
                className="input"
                value={irNumber}
                onChange={(e) => setIrNumber(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="label">Date of Incident</label>
              <input
                type="date"
                className="input"
                value={incidentDate}
                onChange={(e) => setIncidentDate(e.target.value)}
              />
            </div>
            <div>
              <label className="label">Date Reported</label>
              <input
                type="date"
                className="input"
                value={dateReported}
                onChange={(e) => setDateReported(e.target.value)}
              />
            </div>
            <div>
              <label className="label">
                Classification <span className="text-red-500">*</span>
              </label>
              <select
                className="input"
                value={classification}
                onChange={(e) => setClassification(e.target.value as IrClassification)}
                required
              >
                <option value="">— Select —</option>
                {IR_CLASSIFICATIONS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            {classification === "Other" && (
              <div>
                <label className="label">
                  Specify Other <span className="text-red-500">*</span>
                </label>
                <input
                  className="input"
                  value={otherClassification}
                  onChange={(e) => setOtherClassification(e.target.value)}
                  required
                />
              </div>
            )}
          </div>
        </div>

        <div className="card p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-700">Where It Happened</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="label">Client</label>
              <select className="input" value={clientId} onChange={(e) => setClientId(e.target.value)}>
                <option value="">— None —</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.client_code} — {c.client_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Branch</label>
              <select className="input" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                <option value="">— None —</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.branch_code} — {b.branch_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Location (if not a client/branch)</label>
              <input
                className="input"
                placeholder="e.g. Main Warehouse, Delivery Truck 2"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="card p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-700">Employee Involved</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="label">
                Employee Name <span className="text-red-500">*</span>
              </label>
              <input
                className="input"
                value={employeeName}
                onChange={(e) => setEmployeeName(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="label">Position</label>
              <input
                className="input"
                value={employeePosition}
                onChange={(e) => setEmployeePosition(e.target.value)}
              />
            </div>
            <div>
              <label className="label">Reported By</label>
              <input
                className="input"
                placeholder="e.g. supervisor/dispatcher name"
                value={reportedBy}
                onChange={(e) => setReportedBy(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="card p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-700">Details</h2>
          <div>
            <label className="label">
              Incident Statement / Questions (from Logistics Manager) <span className="text-red-500">*</span>
            </label>
            <p className="text-xs text-gray-400 mb-1">
              State the incident and/or the questions being raised to the employee involved. The
              employee&apos;s written explanation/response is added after they answer — see the
              Incident Report detail page once this is saved.
            </p>
            <textarea
              className="input"
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="label">Immediate Action Taken</label>
            <textarea
              className="input"
              rows={2}
              value={immediateAction}
              onChange={(e) => setImmediateAction(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Corrective Action</label>
            <textarea
              className="input"
              rows={2}
              value={correctiveAction}
              onChange={(e) => setCorrectiveAction(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Preventive Action</label>
            <textarea
              className="input"
              rows={2}
              value={preventiveAction}
              onChange={(e) => setPreventiveAction(e.target.value)}
            />
          </div>
        </div>

        <div className="flex gap-2">
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? "Saving…" : "Save Incident Report"}
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => router.push("/mercury/incident-reports")}
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
