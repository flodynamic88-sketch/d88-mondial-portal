"use client";

/**
 * Print-only Incident Report (IR) form, filled in with the encoded record.
 *
 * Deliberately placed OUTSIDE the (app) route group — same as
 * app/deliveries/[id]/print and app/stock-requests/[id]/print — so the
 * shared app shell never renders on the printed page.
 *
 * Classification is rendered as a checkbox row (Wrong Count / Discrepancy /
 * Loss / Damage / Insubordination / Wrong Picking / Other) with the matching
 * box checked, mirroring a paper IR form. Signature lines for the Employee
 * Involved and the reviewing Logistics Manager are always left blank on
 * paper for a wet-ink signature — this print just shows the printed name
 * under each line, taken from employee_name / reviewed_by (or "Reymar
 * Gapud" by default for Reviewed By, same convention used on the Stock
 * Request/Purchase Order print page).
 */

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/mercury/supabase/client";
import type { IncidentReport, IrClassification } from "@/lib/mercury/types";
import { IR_CLASSIFICATIONS } from "@/lib/mercury/types";

function formatDate(d: string | null | undefined) {
  if (!d) return "";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "2-digit" });
}

interface IrJoined extends IncidentReport {
  clients?: { id: string; client_code: string; client_name: string } | null;
  branches?: { id: string; branch_code: string; branch_name: string; retail_chain: string | null } | null;
}

function Checkbox({ checked }: { checked: boolean }) {
  return (
    <span className="inline-flex items-center justify-center h-3.5 w-3.5 border border-gray-500 mr-1.5 align-middle text-[10px] leading-none">
      {checked ? "✓" : ""}
    </span>
  );
}

export default function PrintIncidentReportPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [report, setReport] = useState<IrJoined | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    async function load() {
      const { data } = await supabase
        .schema("flo").from("incident_reports")
        .select("*, clients(id, client_code, client_name), branches(id, branch_code, branch_name, retail_chain)")
        .eq("id", id)
        .single();
      setReport((data as unknown as IrJoined) || null);
      setLoading(false);
    }
    load();
  }, [id]);

  if (loading) return <div className="p-8 text-sm text-gray-400">Loading…</div>;
  if (!report) return <div className="p-8 text-sm text-red-600">Incident Report not found.</div>;

  const whereText =
    report.branches?.branch_name || report.clients?.client_name || report.location || "—";

  return (
    <div>
      <style jsx global>{`
        @page {
          size: 8.5in 11in;
          margin: 0.5in;
        }
        body {
          background: white !important;
        }
        @media print {
          .print-toolbar {
            display: none !important;
          }
        }
      `}</style>

      <div className="print-toolbar flex justify-center gap-2 py-4">
        <button className="btn-primary" onClick={() => window.print()}>
          Print / Save as PDF
        </button>
      </div>

      <div className="max-w-3xl mx-auto bg-white text-gray-900">
        <div className="h-2 bg-brand" />

        <div className="p-8">
          {/* Letterhead */}
          <div className="flex items-start justify-between gap-6 pb-5 mb-6 border-b border-gray-200">
            <div className="flex items-start gap-3">
              <img src="/logo-icon.png" alt="Dynamic88" className="h-12 w-12 shrink-0" />
              <div>
                <div className="text-xl font-bold text-brand-dark">Dynamic88 Solutions</div>
                <div className="text-xs font-medium text-gray-500 mt-0.5">
                  FLO Division — Flexible Logistics Operations
                </div>
                <div className="text-xs text-gray-500 mt-1 max-w-xs">
                  M2 Southwood Industrial Park Governor&apos;s Drive Brgy. Mabuhay Carmona, Cavite
                </div>
              </div>
            </div>
            <div className="shrink-0 rounded-lg border border-brand-light bg-brand-light px-5 py-3 text-right">
              <div className="text-lg font-bold tracking-wide text-brand-dark">INCIDENT REPORT</div>
              <div className="text-[11px] font-semibold uppercase text-gray-500 mt-1">IR No.</div>
              <div className="text-base font-semibold text-gray-900">{report.ir_number}</div>
            </div>
          </div>

          {/* Date / Where / Status */}
          <div className="grid grid-cols-2 gap-4 mb-5">
            <div className="rounded-md border border-gray-200 p-4 space-y-1.5">
              <div className="flex justify-between text-sm">
                <span className="text-[11px] font-semibold uppercase text-gray-400 self-center">
                  Date of Incident
                </span>
                <span className="font-medium">{formatDate(report.incident_date)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[11px] font-semibold uppercase text-gray-400 self-center">
                  Date Reported
                </span>
                <span className="font-medium">{formatDate(report.date_reported)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[11px] font-semibold uppercase text-gray-400 self-center">
                  Status
                </span>
                <span className="font-medium">{report.status}</span>
              </div>
            </div>
            <div className="rounded-md border border-gray-200 p-4">
              <div className="text-[11px] font-semibold uppercase text-gray-400 mb-1">
                Location / Client / Branch
              </div>
              <div className="font-semibold text-gray-900">{whereText}</div>
              {report.clients?.client_name && report.branches?.branch_name && (
                <div className="text-xs text-gray-500 mt-0.5">{report.clients.client_name}</div>
              )}
            </div>
          </div>

          {/* Classification */}
          <div className="rounded-md border border-gray-200 p-4 mb-5">
            <div className="text-[11px] font-semibold uppercase text-gray-400 mb-2">Classification</div>
            <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
              {IR_CLASSIFICATIONS.map((c) => (
                <span key={c} className="inline-flex items-center">
                  <Checkbox checked={report.classification === c} />
                  {c}
                </span>
              ))}
            </div>
            {report.classification === "Other" && report.other_classification && (
              <div className="text-sm mt-2">
                <span className="text-xs font-semibold uppercase text-gray-400 mr-2">Specify:</span>
                {report.other_classification}
              </div>
            )}
          </div>

          {/* Employee Involved */}
          <div className="rounded-md border border-gray-200 p-4 mb-5">
            <div className="text-[11px] font-semibold uppercase text-gray-400 mb-1">
              Employee Involved
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-xs font-semibold uppercase text-gray-400 mr-2">Name</span>
                {report.employee_name}
              </div>
              <div>
                <span className="text-xs font-semibold uppercase text-gray-400 mr-2">Position</span>
                {report.employee_position || "—"}
              </div>
              <div className="col-span-2">
                <span className="text-xs font-semibold uppercase text-gray-400 mr-2">Reported By</span>
                {report.reported_by || "—"}
              </div>
            </div>
          </div>

          {/* Narrative sections */}
          {[
            ["Incident Statement / Questions (Logistics Manager)", report.description],
            ["Employee Explanation / Response", report.employee_explanation],
            ["Immediate Action Taken", report.immediate_action_taken],
            ["Corrective Action", report.corrective_action],
            ["Preventive Action", report.preventive_action],
          ].map(([label, value]) => (
            <div key={label as string} className="rounded-md border border-gray-200 p-4 mb-4 min-h-[3.5rem]">
              <div className="text-[11px] font-semibold uppercase text-gray-400 mb-1">{label}</div>
              <div className="text-sm whitespace-pre-wrap">{value || "—"}</div>
            </div>
          ))}

          {/* Signature block */}
          <div className="mt-10 grid grid-cols-2 gap-8 text-xs">
            <div className="flex flex-col justify-end">
              <div className="h-10" />
              <div className="font-medium text-sm">{report.employee_name}</div>
              <div className="border-t border-gray-300 pt-1 mt-1 text-gray-500">
                Employee Involved — Signature over Printed Name
              </div>
              <div className="text-gray-400 mt-1">
                Date: {formatDate(report.employee_signed_date) || "____________________"}
              </div>
            </div>
            <div className="flex flex-col justify-end">
              <div className="h-10" />
              <div className="font-medium text-sm">{report.reviewed_by || "Reymar Gapud"}</div>
              <div className="border-t border-gray-300 pt-1 mt-1 text-gray-500">
                Reviewed By — Logistics Manager
              </div>
              <div className="text-gray-400 mt-1">
                Date: {formatDate(report.reviewed_date) || "____________________"}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
