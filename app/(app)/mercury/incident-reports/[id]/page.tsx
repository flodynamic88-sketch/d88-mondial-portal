"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/mercury/supabase/client";
import type {
  Branch,
  Client,
  IncidentReport,
  IncidentReportAttachment,
  IrClassification,
  IrStatus,
} from "@/lib/mercury/types";
import { IR_CLASSIFICATIONS, IR_STATUSES } from "@/lib/mercury/types";

function statusBadgeClass(status: string) {
  switch (status) {
    case "Open":
      return "bg-blue-100 text-blue-700";
    case "Under Review":
      return "bg-amber-100 text-amber-700";
    case "Resolved":
      return "bg-green-100 text-green-700";
    case "Closed":
      return "bg-gray-100 text-gray-500";
    default:
      return "bg-gray-100 text-gray-600";
  }
}

export default function IncidentReportDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [clients, setClients] = useState<Client[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [report, setReport] = useState<IncidentReport | null>(null);
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [attachments, setAttachments] = useState<IncidentReportAttachment[]>([]);
  const [uploadForName, setUploadForName] = useState("");
  const [uploading, setUploading] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const [{ data: clientsData }, { data: branchesData }, { data, error }, { data: attData }] =
      await Promise.all([
        supabase.schema("flo").from("clients").select("*").order("client_code").range(0, 9999),
        supabase.schema("flo").from("branches").select("*").order("branch_name").range(0, 9999),
        supabase.schema("flo").from("incident_reports").select("*").eq("id", id).single(),
        supabase
          .schema("flo").from("incident_report_attachments")
          .select("*")
          .eq("incident_report_id", id)
          .order("created_at"),
      ]);
    setClients((clientsData as Client[]) || []);
    setBranches((branchesData as Branch[]) || []);
    if (error) setError(error.message);
    setReport((data as IncidentReport) || null);
    setForm((data as Record<string, unknown>) || {});
    setAttachments((attData as IncidentReportAttachment[]) || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  function set(key: string, value: unknown) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    const supabase = createClient();

    const payload = {
      incident_date: form.incident_date || null,
      date_reported: form.date_reported || null,
      classification: form.classification,
      other_classification: form.classification === "Other" ? form.other_classification || null : null,
      client_id: form.client_id || null,
      branch_id: form.branch_id || null,
      location: form.location || null,
      employee_name: form.employee_name,
      employee_position: form.employee_position || null,
      reported_by: form.reported_by || null,
      description: form.description,
      employee_explanation: form.employee_explanation || null,
      immediate_action_taken: form.immediate_action_taken || null,
      corrective_action: form.corrective_action || null,
      preventive_action: form.preventive_action || null,
      status: form.status,
      employee_acknowledged: !!form.employee_acknowledged,
      employee_signed_date: form.employee_signed_date || null,
      reviewed_by: form.reviewed_by || null,
      reviewed_date: form.reviewed_date || null,
      manager_notes: form.manager_notes || null,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase.schema("flo").from("incident_reports").update(payload).eq("id", id);
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    load();
  }

  function markEmployeeAcknowledged() {
    set("employee_acknowledged", true);
    set("employee_signed_date", new Date().toISOString().slice(0, 10));
  }

  function markReviewed() {
    set("reviewed_by", form.reviewed_by || "Reymar Gapud");
    set("reviewed_date", new Date().toISOString().slice(0, 10));
    if (form.status === "Open") set("status", "Under Review");
  }

  async function handleUploadAttachment(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    setError(null);
    const supabase = createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    for (const file of Array.from(files)) {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${id}/${Date.now()}-${safeName}`;

      const { error: uploadErr } = await supabase.storage
        .from("incident-report-attachments")
        .upload(path, file, { cacheControl: "3600" });

      if (uploadErr) {
        setError(uploadErr.message);
        continue;
      }

      await supabase.schema("flo").from("incident_report_attachments").insert({
        incident_report_id: id,
        file_name: file.name,
        file_path: path,
        uploaded_for: uploadForName.trim() || null,
        uploaded_by: user?.id || null,
      });
    }

    setUploading(false);
    e.target.value = "";
    load();
  }

  async function handleViewAttachment(att: IncidentReportAttachment) {
    const supabase = createClient();
    const { data, error } = await supabase.storage
      .from("incident-report-attachments")
      .createSignedUrl(att.file_path, 300);
    if (error || !data) {
      setError(error?.message || "Could not open attachment.");
      return;
    }
    window.open(data.signedUrl, "_blank");
  }

  async function handleDeleteAttachment(att: IncidentReportAttachment) {
    if (!confirm(`Delete attachment "${att.file_name}"?`)) return;
    const supabase = createClient();
    await supabase.storage.from("incident-report-attachments").remove([att.file_path]);
    const { error } = await supabase.schema("flo").from("incident_report_attachments").delete().eq("id", att.id);
    if (error) {
      setError(error.message);
      return;
    }
    load();
  }

  async function handleDelete() {
    if (!confirm("Delete this Incident Report? This cannot be undone.")) return;
    const supabase = createClient();
    const { error } = await supabase.schema("flo").from("incident_reports").delete().eq("id", id);
    if (error) {
      setError(error.message);
      return;
    }
    router.push("/mercury/incident-reports");
  }

  if (loading) return <div className="p-6 text-sm text-gray-400">Loading…</div>;
  if (!report) return <div className="p-6 text-sm text-red-600">Incident Report not found.</div>;

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold text-gray-900">{report.ir_number}</h1>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusBadgeClass(
                String(form.status || report.status)
              )}`}
            >
              {String(form.status || report.status)}
            </span>
          </div>
          <p className="text-sm text-gray-500">Incident Report detail &amp; monitoring</p>
        </div>
        <div className="flex gap-2">
          <Link href={`/mercury/incident-reports/${id}/print`} className="btn-secondary">
            Print
          </Link>
          <Link href="/mercury/incident-reports" className="btn-secondary">
            Back to List
          </Link>
          <button type="button" className="btn-secondary text-red-600" onClick={handleDelete}>
            Delete
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="card p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-700">IR Details</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className="label">Date of Incident</label>
            <input
              type="date"
              className="input"
              value={(form.incident_date as string) || ""}
              onChange={(e) => set("incident_date", e.target.value)}
            />
          </div>
          <div>
            <label className="label">Date Reported</label>
            <input
              type="date"
              className="input"
              value={(form.date_reported as string) || ""}
              onChange={(e) => set("date_reported", e.target.value)}
            />
          </div>
          <div>
            <label className="label">Classification</label>
            <select
              className="input"
              value={(form.classification as IrClassification) || ""}
              onChange={(e) => set("classification", e.target.value)}
            >
              {IR_CLASSIFICATIONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          {form.classification === "Other" && (
            <div>
              <label className="label">Specify Other</label>
              <input
                className="input"
                value={(form.other_classification as string) || ""}
                onChange={(e) => set("other_classification", e.target.value)}
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
            <select
              className="input"
              value={(form.client_id as string) || ""}
              onChange={(e) => set("client_id", e.target.value)}
            >
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
            <select
              className="input"
              value={(form.branch_id as string) || ""}
              onChange={(e) => set("branch_id", e.target.value)}
            >
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
              value={(form.location as string) || ""}
              onChange={(e) => set("location", e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="card p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-700">Employee Involved</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className="label">Employee Name</label>
            <input
              className="input"
              value={(form.employee_name as string) || ""}
              onChange={(e) => set("employee_name", e.target.value)}
            />
          </div>
          <div>
            <label className="label">Position</label>
            <input
              className="input"
              value={(form.employee_position as string) || ""}
              onChange={(e) => set("employee_position", e.target.value)}
            />
          </div>
          <div>
            <label className="label">Reported By</label>
            <input
              className="input"
              value={(form.reported_by as string) || ""}
              onChange={(e) => set("reported_by", e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="card p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-700">Details</h2>
        <div>
          <label className="label">Incident Statement / Questions (from Logistics Manager)</label>
          <textarea
            className="input"
            rows={4}
            value={(form.description as string) || ""}
            onChange={(e) => set("description", e.target.value)}
          />
        </div>
        <div>
          <label className="label">Employee Explanation / Response</label>
          <p className="text-xs text-gray-400 mb-1">
            The employee&apos;s written explanation/response to the statement above — encode it
            here once they&apos;ve answered (on the printed form or verbally recorded).
          </p>
          <textarea
            className="input"
            rows={4}
            value={(form.employee_explanation as string) || ""}
            onChange={(e) => set("employee_explanation", e.target.value)}
          />
        </div>
        <div>
          <label className="label">Immediate Action Taken</label>
          <textarea
            className="input"
            rows={2}
            value={(form.immediate_action_taken as string) || ""}
            onChange={(e) => set("immediate_action_taken", e.target.value)}
          />
        </div>
        <div>
          <label className="label">Corrective Action</label>
          <textarea
            className="input"
            rows={2}
            value={(form.corrective_action as string) || ""}
            onChange={(e) => set("corrective_action", e.target.value)}
          />
        </div>
        <div>
          <label className="label">Preventive Action</label>
          <textarea
            className="input"
            rows={2}
            value={(form.preventive_action as string) || ""}
            onChange={(e) => set("preventive_action", e.target.value)}
          />
        </div>
      </div>

      <div className="card p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-700">Monitoring &amp; Sign-Off</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className="label">Status</label>
            <select
              className="input"
              value={(form.status as IrStatus) || "Open"}
              onChange={(e) => set("status", e.target.value)}
            >
              {IR_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="rounded-md border border-gray-200 p-4 space-y-3">
            <div className="text-xs font-semibold uppercase text-gray-400">Employee Acknowledgment</div>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-gray-300"
                checked={!!form.employee_acknowledged}
                onChange={(e) => set("employee_acknowledged", e.target.checked)}
              />
              <span className="text-sm text-gray-700">Employee signed the printed IR</span>
            </label>
            <div>
              <label className="label">Date Signed</label>
              <input
                type="date"
                className="input"
                value={(form.employee_signed_date as string) || ""}
                onChange={(e) => set("employee_signed_date", e.target.value)}
              />
            </div>
            <button type="button" className="btn-secondary text-xs" onClick={markEmployeeAcknowledged}>
              Mark Acknowledged Today
            </button>
          </div>

          <div className="rounded-md border border-gray-200 p-4 space-y-3">
            <div className="text-xs font-semibold uppercase text-gray-400">
              Reviewed By — Logistics Manager
            </div>
            <div>
              <label className="label">Reviewed By</label>
              <input
                className="input"
                value={(form.reviewed_by as string) || ""}
                onChange={(e) => set("reviewed_by", e.target.value)}
              />
            </div>
            <div>
              <label className="label">Date Reviewed</label>
              <input
                type="date"
                className="input"
                value={(form.reviewed_date as string) || ""}
                onChange={(e) => set("reviewed_date", e.target.value)}
              />
            </div>
            <button type="button" className="btn-secondary text-xs" onClick={markReviewed}>
              Mark Reviewed Today
            </button>
          </div>
        </div>

        <div>
          <label className="label">Manager Notes</label>
          <textarea
            className="input"
            rows={2}
            value={(form.manager_notes as string) || ""}
            onChange={(e) => set("manager_notes", e.target.value)}
          />
        </div>
      </div>

      <div className="card p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-700">
          Attachments — Explanation of Employee(s) Involved
        </h2>
        <p className="text-xs text-gray-400">
          Attach a scanned/photographed written explanation (or any supporting file) per employee
          involved. Optionally tag whose explanation it is before choosing the file.
        </p>

        {attachments.length > 0 && (
          <div className="divide-y divide-gray-100 rounded-md border border-gray-200">
            {attachments.map((att) => (
              <div key={att.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <div className="truncate font-medium text-gray-900">{att.file_name}</div>
                  <div className="text-xs text-gray-400">
                    {att.uploaded_for ? `For: ${att.uploaded_for} · ` : ""}
                    {new Date(att.created_at).toLocaleString("en-PH")}
                  </div>
                </div>
                <div className="flex shrink-0 gap-3">
                  <button
                    type="button"
                    className="text-brand-dark hover:underline text-xs font-medium"
                    onClick={() => handleViewAttachment(att)}
                  >
                    View
                  </button>
                  <button
                    type="button"
                    className="text-red-600 hover:underline text-xs font-medium"
                    onClick={() => handleDeleteAttachment(att)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Whose explanation is this? (optional)</label>
            <input
              className="input"
              placeholder="e.g. Mark Dejano"
              value={uploadForName}
              onChange={(e) => setUploadForName(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Attach File(s)</label>
            <input
              type="file"
              multiple
              className="input"
              onChange={handleUploadAttachment}
              disabled={uploading}
            />
          </div>
        </div>
        {uploading && <p className="text-xs text-gray-400">Uploading…</p>}
      </div>

      <div className="flex gap-2">
        <button type="button" className="btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save Changes"}
        </button>
        <button type="button" className="btn-secondary" onClick={() => router.push("/mercury/incident-reports")}>
          Cancel
        </button>
      </div>
    </div>
  );
}
