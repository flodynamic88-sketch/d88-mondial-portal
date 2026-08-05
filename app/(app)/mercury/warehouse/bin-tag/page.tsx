"use client";

/**
 * Bin Tag — configuration page.
 *
 * Picks an item (optional) so the printed Bin Tag card comes pre-filled
 * with Brand Name (the item's client), Item Description, and Item Code —
 * the encoder only has to hand-write the parts that change per bin
 * (Location, Bin No., Shipment Arrival No., Expiration Date, Beginning
 * Balance Date) and the daily In/Out grid. "Blank Form" skips the item
 * picker entirely for a fully blank card.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/mercury/supabase/client";
import type { Item } from "@/lib/mercury/types";

export default function BinTagConfigPage() {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [itemId, setItemId] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .schema("flo").from("items")
      .select("*, clients(id, client_code, client_name)")
      .eq("status", "Active")
      .order("item_code")
      .then(({ data }) => {
        setItems((data as Item[]) || []);
        setLoading(false);
      });
  }, []);

  function handleGenerate() {
    if (itemId) {
      router.push(`/mercury/warehouse/bin-tag/print?itemId=${itemId}`);
    } else {
      router.push(`/mercury/warehouse/bin-tag/print`);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Bin Tag</h1>
        <p className="text-sm text-gray-500">
          Printable warehouse bin card — pick an item to pre-fill the header, then print. Fits one
          Bin Tag per Letter-size sheet (landscape).
        </p>
      </div>

      <div className="card p-4 flex flex-wrap items-end gap-3">
        <div className="min-w-[20rem]">
          <label className="label">Item (optional)</label>
          <select className="input" value={itemId} onChange={(e) => setItemId(e.target.value)}>
            <option value="">Blank form (no item selected)</option>
            {items.map((it) => (
              <option key={it.id} value={it.id}>
                {it.item_code} — {it.item_description}
                {it.clients?.client_name ? ` (${it.clients.client_name})` : ""}
              </option>
            ))}
          </select>
        </div>
        <button className="btn-primary" onClick={handleGenerate} disabled={loading}>
          Generate Bin Tag
        </button>
      </div>

      <div className="text-sm text-gray-400">
        Ang Location, Bin No., Shipment Arrival No., Expiration Date, at Beginning Balance Date ay
        pupunan pa rin nang manu-mano pagkatapos i-print.
      </div>
    </div>
  );
}
