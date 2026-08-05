"use client";

/**
 * Print-only BLANK Incident Report (IR) form — meant to be printed and
 * physically handed to an employee/supervisor to fill out and sign by
 * hand, before the details get encoded into the system at
 * /incident-reports/new. Same layout as the filled version at
 * /incident-reports/[id]/print, but with blank writing lines instead of
 * encoded values, and every classification checkbox left unchecked.
 *
 * Deliberately placed OUTSIDE the (app) route group — same as
 * app/deliveries/[id]/print and app/stock-requests/[id]/print — so the
 * shared app shell never renders on the printed page.
 */

import { IR_CLASSIFICATIONS } from "@/lib/mercury/types";

function Checkbox() {
  return (
    <span className="inline-flex items-center justify-center h-3.5 w-3.5 border border-gray-500 mr-1.5 align-middle text-[10px] leading-none" />
  );
}

function BlankLine({ height = "h-6" }: { height?: string }) {
  return <div className={`${height} border-b border-gray-300`} />;
}

export default function PrintBlankIncidentReportPage() {
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
              <div className="text-base font-semibold text-gray-900">&nbsp;</div>
            </div>
          </div>

          {/* Date / Where */}
          <div className="grid grid-cols-2 gap-4 mb-5">
            <div className="rounded-md border border-gray-200 p-4 space-y-2">
              <div className="flex justify-between items-center text-sm gap-3">
                <span className="text-[11px] font-semibold uppercase text-gray-400 whitespace-nowrap">
                  Date of Incident
                </span>
                <div className="flex-1">
                  <BlankLine height="h-4" />
                </div>
              </div>
              <div className="flex justify-between items-center text-sm gap-3">
                <span className="text-[11px] font-semibold uppercase text-gray-400 whitespace-nowrap">
                  Date Reported
                </span>
                <div className="flex-1">
                  <BlankLine height="h-4" />
                </div>
              </div>
            </div>
            <div className="rounded-md border border-gray-200 p-4">
              <div className="text-[11px] font-semibold uppercase text-gray-400 mb-2">
                Location / Client / Branch
              </div>
              <BlankLine height="h-4" />
            </div>
          </div>

          {/* Classification */}
          <div className="rounded-md border border-gray-200 p-4 mb-5">
            <div className="text-[11px] font-semibold uppercase text-gray-400 mb-2">Classification</div>
            <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
              {IR_CLASSIFICATIONS.map((c) => (
                <span key={c} className="inline-flex items-center">
                  <Checkbox />
                  {c}
                </span>
              ))}
            </div>
            <div className="text-sm mt-2 flex items-center gap-2">
              <span className="text-xs font-semibold uppercase text-gray-400 whitespace-nowrap">
                If Other, specify:
              </span>
              <div className="flex-1">
                <BlankLine height="h-4" />
              </div>
            </div>
          </div>

          {/* Employee Involved */}
          <div className="rounded-md border border-gray-200 p-4 mb-5">
            <div className="text-[11px] font-semibold uppercase text-gray-400 mb-2">
              Employee Involved
            </div>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-xs font-semibold uppercase text-gray-400 mb-1 block">Name</span>
                <BlankLine height="h-4" />
              </div>
              <div>
                <span className="text-xs font-semibold uppercase text-gray-400 mb-1 block">Position</span>
                <BlankLine height="h-4" />
              </div>
              <div className="col-span-2">
                <span className="text-xs font-semibold uppercase text-gray-400 mb-1 block">
                  Reported By
                </span>
                <BlankLine height="h-4" />
              </div>
            </div>
          </div>

          {/* Narrative sections */}
          {[
            ["Incident Statement / Questions (Logistics Manager)", 2],
            ["Employee Explanation / Response", 4],
            ["Immediate Action Taken", 2],
            ["Corrective Action", 2],
            ["Preventive Action", 2],
          ].map(([label, lineCount]) => (
            <div key={label as string} className="rounded-md border border-gray-200 p-4 mb-4">
              <div className="text-[11px] font-semibold uppercase text-gray-400 mb-2">{label}</div>
              <div className="space-y-3">
                {Array.from({ length: lineCount as number }).map((_, i) => (
                  <BlankLine key={i} />
                ))}
              </div>
            </div>
          ))}

          {/* Signature block */}
          <div className="mt-10 grid grid-cols-2 gap-8 text-xs">
            <div className="flex flex-col justify-end">
              <div className="h-12" />
              <div className="border-t border-gray-300 pt-1 mt-1 text-gray-500">
                Employee Involved — Signature over Printed Name
              </div>
              <div className="text-gray-400 mt-1">Date: ____________________</div>
            </div>
            <div className="flex flex-col justify-end">
              <div className="h-12" />
              <div className="border-t border-gray-300 pt-1 mt-1 text-gray-500">
                Reviewed By — Logistics Manager
              </div>
              <div className="text-gray-400 mt-1">Date: ____________________</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
