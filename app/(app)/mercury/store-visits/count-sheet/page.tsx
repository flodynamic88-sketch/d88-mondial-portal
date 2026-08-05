"use client";

/**
 * Inventory Count Sheet — configuration page.
 *
 * 2026-07-31: printable, blank-tally sheet a Sales Coordinator brings to a
 * store visit -- lists every active client and their items with a blank
 * Qty column for hand-writing the actual on-shelf count, then encoding it
 * into the mobile form / portal afterward. Branch/Date are optional --
 * left blank the sheet still prints fine (SC can write the store name by
 * hand), matching the same "walang required na branch" rule as the mobile
 * form, since not every store visited is in the Branches list yet.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/mercury/supabase/client";
import type { Branch } from "@/lib/mercury/types";

export default function CountSheetConfigPage() {
  const router = useRouter();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState("");
  const [branchName, setBranchName] = useState("");
  const [visitDate, setVisitDate] = useState(() => new Date().toISOString().slice(0, 10));

  useEffect(() => {
    const supabase = createClient();
    supabase
      .schema("flo").from("branches")
      .select("*")
      .order("branch_name")
      .then(({ data }) => setBranches((data as Branch[]) || []));
  }, []);

  function handleGenerate() {
    const params = new URLSearchParams();
    const selected = branches.find((b) => b.id === branchId);
    const finalBranchName = selected?.branch_name || branchName.trim();
    if (finalBranchName) params.set("branchName", finalBranchName);
    if (visitDate) params.set("date", visitDate);
    const qs = params.toString();
    router.push(`/mercury/store-visits/count-sheet/print${qs ? `?${qs}` : ""}`);
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Inventory Count Sheet</h1>
        <p className="text-sm text-gray-500">
          Printable tally sheet (one page per client) to bring on a store visit. Lists every
          active client&apos;s items with a blank Qty column for hand-counting -- write 0 if an
          item has zero stock on the shelf, don&apos;t leave it blank, then encode the visit into
          the mobile form or Store Visits afterward.
        </p>
      </div>

      <div className="card p-4 flex flex-wrap items-end gap-3">
        <div className="min-w-[16rem]">
          <label className="label">Branch (optional)</label>
          <select
            className="input"
            value={branchId}
            onChange={(e) => {
              setBranchId(e.target.value);
              if (e.target.value) setBranchName("");
            }}
          >
            <option value="">— Not in list / choose below —</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.branch_name}
                {b.retail_chain ? ` (${b.retail_chain})` : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-[16rem]">
          <label className="label">Or type Branch/Store Name</label>
          <input
            className="input"
            placeholder="e.g. Mercury Drug - Alabang Town Center"
            value={branchName}
            disabled={!!branchId}
            onChange={(e) => setBranchName(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Visit Date</label>
          <input
            type="date"
            className="input"
            value={visitDate}
            onChange={(e) => setVisitDate(e.target.value)}
          />
        </div>
        <button className="btn-primary" onClick={handleGenerate}>
          Generate Count Sheet
        </button>
      </div>

      <div className="text-sm text-gray-400">
        Pwede ring iwanang blangko ang Branch/Store Name -- may blank line pa rin sa printed sheet
        para isulat nang manu-mano kung wala talaga sa listahan.
      </div>
    </div>
  );
}
