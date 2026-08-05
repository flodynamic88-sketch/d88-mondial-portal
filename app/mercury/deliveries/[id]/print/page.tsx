"use client";

/**
 * Print-only Delivery / Sales Invoice route.
 *
 * The exact layout (paper size + where each value is positioned) depends on
 * WHICH CLIENT the delivery belongs to, since different clients hand us
 * different pre-printed invoice forms. The per-client "Invoice Format"
 * dropdown (Clients page) picks which layout from lib/invoiceTemplates.ts
 * is used here. If a client has no format assigned, DEFAULT_INVOICE_TEMPLATE
 * (currently "rodzon") is used.
 *
 * To add a new client's form: see the instructions at the top of
 * lib/invoiceTemplates.ts. Nothing in this file needs to change.
 *
 * Fields NOT filled because the system doesn't track them:
 *   - Zero-Rated Sales / VAT-Exempt Sales (no such classification in the data)
 *   - Less Discount, Less Withholding Tax (not tracked per delivery)
 * These are left blank so staff can hand-write them on the physical form if
 * needed.
 *
 * "Sold To" block (registered/legal name, branch, TIN, business address) is
 * BUYER info, not our client's — it comes from the delivery's Branch record
 * (registered_name / branch_name / tin / registered_business_address), since
 * the client (e.g. Rodzon) is the one whose letterhead/goods this invoice
 * represents while the branch (e.g. a Mercury Drug store) is who it's billed
 * to. Falls back to the branch's retail_chain / delivery_address / the
 * client's name if those newer fields haven't been filled in yet for that
 * branch (see Branches page).
 *
 * P.O. # comes from the delivery header itself (same PO # used elsewhere in
 * the app), printed as its own positioned field on every template now
 * instead of only appearing in a small text block on plain-paper invoices.
 *
 * VAT breakdown is computed from the line-item total using the standard PH
 * 12% VAT-inclusive formula:
 *   VATable Sales = Total / 1.12
 *   VAT           = Total - VATable Sales
 *   Total Sales (VAT Inclusive) = Total
 *   Amount Net of VAT = VATable Sales
 *   TOTAL AMOUNT DUE  = Total
 *
 * Font: monospace (Courier New) to approximate dot-matrix character pitch.
 */

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/mercury/supabase/client";
import type { DeliveryHeader, DeliveryLine } from "@/lib/mercury/types";
import {
  DEFAULT_INVOICE_TEMPLATE,
  INVOICE_TEMPLATES,
  type InvoiceFieldKey,
  type InvoiceLayout,
} from "@/lib/mercury/invoiceTemplates";

function Field({
  pos,
  className,
  fontSizePt,
  wrap,
  children,
}: {
  pos: { top: number; left: number; width: number };
  className?: string;
  /**
   * Optional per-field font size override (points), for the rare box that's
   * too narrow at the default 12pt to show its full text without truncating
   * (overflow-hidden + whitespace-nowrap silently cuts it off otherwise —
   * same bug previously found on HWL's Item Code column). Shrinking the
   * font is preferred over widening the box when the box's position is
   * already calibrated against a pre-printed form and can't move.
   */
  fontSizePt?: number;
  /**
   * Optional: let this field wrap onto a 2nd line within its width instead
   * of forcing a single line + tiny font. Use for long text (like a full
   * business address) where shrinking the font small enough to always fit
   * on one line would look too small/ugly — wrapping keeps a normal
   * readable font and lets the box grow downward instead. When enabling
   * this, leave enough vertical room below the field for a 2nd line so it
   * doesn't run into whatever's printed next.
   */
  wrap?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        position: "absolute",
        top: `${pos.top}in`,
        left: `${pos.left}in`,
        width: `${pos.width}in`,
        // Inline style wins over the text-[12pt] class below regardless of
        // class order, so this reliably overrides the default when set.
        ...(fontSizePt ? { fontSize: `${fontSizePt}pt` } : {}),
      }}
      // 2026-07-10: font was doubled (10pt -> 20pt) per client request, but
      // the test print came back with rows overlapping AND text clipped off
      // mid-word/at the page edge ("sumobrang laki" — client feedback).
      // Brought down to 13pt (checked against Courier New's fixed character
      // width so it actually fit every box), then nudged down once more to
      // 12pt per client feedback on the real test print ("liitan mo lang ng
      // onting onti") — still ~20% bigger than the original 10pt, with even
      // more clearance margin in the row gaps than 13pt had. Individual
      // fields can still go smaller via fontSizePt above, or wrap to 2 lines
      // via wrap above, instead of shrinking further.
      // 2026-07-13: wrap also forces break-words — without it, a single long
      // unbroken run of characters (no spaces) could overflow straight past
      // the box's right edge instead of wrapping, bleeding into whatever's
      // printed to the right (client reported the wrapped Business Address
      // spilling over onto the Date/Terms column). break-words guarantees
      // text stays inside the box width no matter what.
      className={`text-[12pt] leading-tight ${
        wrap ? "whitespace-normal break-words" : "whitespace-nowrap overflow-hidden"
      } ${className || ""}`}
    >
      {children}
    </div>
  );
}

function peso(n: number | null | undefined) {
  return new Intl.NumberFormat("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n || 0);
}

function formatDate(d: string | null | undefined) {
  if (!d) return "";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "2-digit" });
}

// Priority: (1) expiration_date typed in directly on this line — always
// available, regardless of whether the item's client uses the Warehouse
// module (this is the normal case for plain invoice-only clients like
// Mercury Drug items encoded straight into a Delivery); (2) the FEFO
// warehouse batch(es) this line's stock was actually drawn from (batches
// are consumed earliest-expiration-first, so a line can span more than one
// date if one batch alone wasn't enough to cover its qty) — only exists
// once stock is actually deducted (status -> In-Transit/Delivered) for a
// manages_inventory client; (3) a FEFO "preview" — the soonest-expiring
// batch currently available in the warehouse for that item — marked
// "(est.)" since it isn't finalized yet.
function expirationLabel(line: DeliveryLine, previewExpiry?: Map<string, string>): string {
  if (line.expiration_date) return `Exp: ${formatDate(line.expiration_date)}`;
  const dates = Array.from(
    new Set(
      (line.delivery_line_batches || [])
        .map((b) => b.expiration_date)
        .filter((d): d is string => !!d)
    )
  ).sort();
  if (dates.length > 0) return `Exp: ${dates.map((d) => formatDate(d)).join(", ")}`;
  const preview = line.item_id ? previewExpiry?.get(line.item_id) : undefined;
  return preview ? `Exp: ${formatDate(preview)} (est.)` : "";
}

export default function PrintInvoicePage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [header, setHeader] = useState<DeliveryHeader | null>(null);
  const [lines, setLines] = useState<DeliveryLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // FEFO preview: soonest-expiring warehouse batch per item_id, used as a
  // fallback in expirationLabel() before stock is actually deducted.
  const [previewExpiry, setPreviewExpiry] = useState<Map<string, string>>(new Map());
  // Debug aid for calibrating pre-printed forms: overlays a faint inch grid
  // (with numbered lines every 1in) on top of the printed page. Print a
  // blank/real form with this ON, measure with a ruler where each field
  // SHOULD land against the grid lines, and report the inch numbers back —
  // much more precise than eyeballing a photo. Off by default; never
  // affects normal printing since it's opt-in via the on-screen checkbox.
  const [showGrid, setShowGrid] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    async function load() {
      const [headerRes, linesRes] = await Promise.all([
        supabase
          .schema("flo").from("delivery_headers")
          .select(
            "*, clients(id, client_code, client_name, billing_address, payment_terms, invoice_template), branches(id, branch_code, branch_name, delivery_address, retail_chain, registered_name, tin, registered_business_address)"
          )
          .eq("id", id)
          .single(),
        // Deliberately does NOT embed delivery_line_batches in this query —
        // that relationship is separate (added later, in migration_018) and
        // if it ever fails to resolve, embedding it directly here would take
        // down the WHOLE delivery_lines fetch, which is exactly what made
        // line items silently vanish from the printed invoice with no error
        // shown at all. Batches are fetched separately below and merged in
        // JS, so a batches problem can never blank out the printed items.
        supabase
          .schema("flo").from("delivery_lines")
          .select("*, items(id, item_code, mercury_item_code, item_description, unit)")
          .eq("delivery_header_id", id)
          .order("created_at"),
      ]);

      const firstError = [headerRes, linesRes].find((r) => r.error)?.error;
      if (firstError) setLoadError(firstError.message);

      setHeader((headerRes.data as unknown as DeliveryHeader) || null);

      const lineRows = (linesRes.data as unknown as DeliveryLine[]) || [];
      if (lineRows.length > 0) {
        const { data: batchesData } = await supabase
          .schema("flo").from("delivery_line_batches")
          .select("id, delivery_line_id, qty, expiration_date")
          .in(
            "delivery_line_id",
            lineRows.map((l) => l.id)
          );
        // Non-fatal if this fails — worst case, expiration dates just don't
        // print; the line items themselves must still show.
        if (batchesData) {
          const byLine = new Map<string, typeof batchesData>();
          for (const b of batchesData) {
            const arr = byLine.get(b.delivery_line_id) || [];
            arr.push(b);
            byLine.set(b.delivery_line_id, arr);
          }
          for (const l of lineRows) {
            l.delivery_line_batches =
              (byLine.get(l.id) as unknown as DeliveryLine["delivery_line_batches"]) || [];
          }
        }

        // FEFO preview: for lines with no delivery_line_batches yet (stock
        // not officially deducted), look up the soonest-expiring batch
        // currently available for that item, so Exp date isn't blank the
        // whole time the delivery is still Pending.
        const itemIds = Array.from(
          new Set(lineRows.map((l) => l.item_id).filter((v): v is string => !!v))
        );
        if (itemIds.length > 0) {
          const { data: previewData } = await supabase
            .schema("flo").from("stock_receipt_lines")
            .select("item_id, expiration_date, qty_remaining")
            .in("item_id", itemIds)
            .gt("qty_remaining", 0)
            .not("expiration_date", "is", null)
            .order("expiration_date", { ascending: true });
          if (previewData) {
            const preview = new Map<string, string>();
            for (const r of previewData as { item_id: string; expiration_date: string }[]) {
              if (!preview.has(r.item_id)) preview.set(r.item_id, r.expiration_date);
            }
            setPreviewExpiry(preview);
          }
        }
      }
      setLines(lineRows);
      setLoading(false);
    }
    load();
  }, [id]);

  // Total Sales is treated as VAT-inclusive (standard PH 12% VAT-inclusive pricing)
  const totalSalesVatInclusive = lines.reduce((s, l) => s + (l.net_amount ?? l.amount ?? 0), 0);
  const vatableSales = totalSalesVatInclusive / 1.12;
  const vatAmount = totalSalesVatInclusive - vatableSales;
  const amountNetOfVat = vatableSales;
  const totalAmountDue = totalSalesVatInclusive;

  if (loading) return <div className="p-8 text-sm text-gray-400">Loading…</div>;
  if (loadError)
    return <div className="p-8 text-sm text-red-600">Error loading invoice: {loadError}</div>;
  if (!header) return <div className="p-8 text-sm text-red-600">Delivery not found.</div>;

  const templateKey = header.clients?.invoice_template || DEFAULT_INVOICE_TEMPLATE;
  const template: InvoiceLayout =
    INVOICE_TEMPLATES[templateKey] || INVOICE_TEMPLATES[DEFAULT_INVOICE_TEMPLATE];
  const f = (key: InvoiceFieldKey) => template.fields[key];
  const { width: pageW, height: pageH } = template.paper;

  return (
    <div>
      <style jsx global>{`
        @page {
          size: ${pageW}in ${pageH}in;
          margin: 0;
        }
        /* Some browsers/printers still apply their own default body margin
           or shrink-to-fit scaling on top of the @page rule above if the
           print dialog's paper size/margins/scale aren't set to match
           exactly — that alone is enough to make the whole layout print
           smaller and shifted up-left relative to a pre-printed form (see
           print settings checklist wherever this page is shared/instructed).
           Zeroing html/body here removes one common source of that (the
           browser's default 8px body margin). */
        html,
        body {
          margin: 0 !important;
          padding: 0 !important;
        }
        body {
          background: white !important;
        }
        .print-toolbar {
          margin: 0.5in auto 0;
          max-width: ${pageW}in;
        }
        @media print {
          .print-toolbar {
            display: none !important;
          }
        }
        .print-page {
          position: relative;
          width: ${pageW}in;
          height: ${pageH}in;
          margin: 0 auto;
          background: white;
          font-family: "Courier New", Courier, monospace;
          /* Client feedback (2026-07-10, real test print): text came out
             faint/hard to read. Courier New's default weight is thin at
             9-10pt, especially once actually printed (vs. on-screen). Bumped
             to semibold (600) so strokes are thicker/darker without changing
             any of the calibrated font sizes or column widths.
             2026-07-10 follow-up: client says it now prints too bold/heavy.
             Dialed back to 500 (medium) — a middle ground between the
             original thin default (400, too faint) and semibold (600, too
             heavy), without touching any spacing/size calibration. */
          font-weight: 500;
          color: #000;
        }
      `}</style>

      <div className="print-toolbar flex justify-center items-center gap-3 pb-4">
        <span className="text-xs text-gray-500 self-center">Format: {template.label}</span>
        <label className="text-xs text-gray-600 flex items-center gap-1">
          <input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} />
          Show alignment grid (for calibration — prints too)
        </label>
        <button className="btn-primary" onClick={() => window.print()}>
          Print / Save as PDF
        </button>
      </div>

      <div className="print-page">
        {showGrid && (
          <>
            {/* Faint inch grid: solid red line every 1in, lighter line every
                0.5in, with inch numbers along the top and left edges. Turn
                this on, print it (ideally onto the actual blank/filled
                pre-printed form so both overlap), and read off with a ruler
                exactly which inch mark each field should sit at. */}
            {Array.from({ length: Math.floor(pageW / 0.5) + 1 }).map((_, i) => {
              const x = i * 0.5;
              const isWhole = x % 1 === 0;
              return (
                <div
                  key={`vline-${i}`}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: `${x}in`,
                    width: "1px",
                    height: `${pageH}in`,
                    background: isWhole ? "rgba(220,0,0,0.55)" : "rgba(220,0,0,0.2)",
                  }}
                />
              );
            })}
            {Array.from({ length: Math.floor(pageH / 0.5) + 1 }).map((_, i) => {
              const y = i * 0.5;
              const isWhole = y % 1 === 0;
              return (
                <div
                  key={`hline-${i}`}
                  style={{
                    position: "absolute",
                    top: `${y}in`,
                    left: 0,
                    height: "1px",
                    width: `${pageW}in`,
                    background: isWhole ? "rgba(220,0,0,0.55)" : "rgba(220,0,0,0.2)",
                  }}
                />
              );
            })}
            {Array.from({ length: Math.floor(pageW) + 1 }).map((_, i) => (
              <div
                key={`xlabel-${i}`}
                style={{ position: "absolute", top: "0.02in", left: `${i}.05in`, fontSize: "6pt" }}
                className="text-red-600"
              >
                {i}&quot;
              </div>
            ))}
            {Array.from({ length: Math.floor(pageH) + 1 }).map((_, i) => (
              <div
                key={`ylabel-${i}`}
                style={{ position: "absolute", top: `${i}.02in`, left: "0.03in", fontSize: "6pt" }}
                className="text-red-600"
              >
                {i}&quot;
              </div>
            ))}
          </>
        )}
        {!template.isPreprinted && (
          <>
            {/* Outer border + letterhead for plain-paper (no pre-printed form) invoices */}
            <div
              style={{
                position: "absolute",
                top: "0.5in",
                left: "0.5in",
                width: `${pageW - 1}in`,
                height: `${pageH - 1}in`,
                border: "1px solid #000",
              }}
            />
            <div
              style={{ position: "absolute", top: "0.65in", left: 0, width: `${pageW}in` }}
              className="text-center text-[20pt] font-bold"
            >
              SALES INVOICE
            </div>
            <div
              style={{ position: "absolute", top: "1.0in", left: "0.7in", width: `${pageW - 3.5}in` }}
              className="text-[11pt]"
            >
              {header.invoice_number ? `Invoice #: ${header.invoice_number}` : ""}
            </div>
            {(Object.keys(template.fieldLabels || {}) as InvoiceFieldKey[]).map((key) => {
              const pos = template.fields[key];
              const labelText = template.fieldLabels?.[key];
              if (!labelText) return null;
              return (
                <div
                  key={`label-${key}`}
                  style={{ position: "absolute", top: `${pos.top}in`, left: `0.7in` }}
                  className="text-[11pt] font-semibold whitespace-nowrap"
                >
                  {labelText}
                </div>
              );
            })}
            {template.tableHeaderLabels && (
              <div
                style={{
                  position: "absolute",
                  top: `${template.itemRowStartTop - 0.28}in`,
                  left: 0,
                  width: `${pageW}in`,
                  borderTop: "1px solid #000",
                  borderBottom: "1px solid #000",
                  paddingTop: "2px",
                  paddingBottom: "2px",
                }}
                className="text-[11pt] font-semibold"
              >
                <span style={{ position: "absolute", left: `${template.itemCol.qty.left}in` }}>
                  {template.tableHeaderLabels.qty}
                </span>
                <span style={{ position: "absolute", left: `${template.itemCol.unit.left}in` }}>
                  {template.tableHeaderLabels.unit}
                </span>
                {template.itemCol.code && template.tableHeaderLabels.code && (
                  <span style={{ position: "absolute", left: `${template.itemCol.code.left}in` }}>
                    {template.tableHeaderLabels.code}
                  </span>
                )}
                <span style={{ position: "absolute", left: `${template.itemCol.description.left}in` }}>
                  {template.tableHeaderLabels.description}
                </span>
                <span style={{ position: "absolute", left: `${template.itemCol.unitPrice.left}in` }}>
                  {template.tableHeaderLabels.unitPrice}
                </span>
                <span style={{ position: "absolute", left: `${template.itemCol.amount.left}in` }}>
                  {template.tableHeaderLabels.amount}
                </span>
              </div>
            )}
          </>
        )}

        {/* --- Header block: Date, PO #, Sold To, Branch, TIN, Address, Terms --- */}
        <Field pos={f("invoiceDate")}>{formatDate(header.invoice_date)}</Field>
        <Field pos={f("poNumber")}>{header.po_number || ""}</Field>
        <Field pos={f("soldTo")}>
          {header.branches?.registered_name ||
            header.branches?.retail_chain ||
            header.clients?.client_name}
          {/* Some forms (e.g. HWL) only have ONE blank "Sold to:" line, no
              separate row for the branch name — for those, append it here
              instead of rendering a second Field that would float over
              whatever's printed below it on that particular paper. */}
          {template.mergeBranchIntoSoldTo && header.branches?.branch_name
            ? ` — ${header.branches.branch_name}`
            : ""}
        </Field>
        <Field pos={f("tin")}>{header.branches?.tin || ""}</Field>
        {/* 2026-07-13: client didn't want the address shrunk to 8pt ("mejo
            panget tingnan") — reverted to 10pt (matches Business Style
            below it) and instead let it WRAP onto a 2nd line if it's too
            long to fit on one, with Business Style pushed down to make
            room for that (see lib/invoiceTemplates.ts businessStyle top). */}
        <Field pos={f("businessAddress")} fontSizePt={10} wrap>
          {header.branches?.registered_business_address || header.branches?.delivery_address}
        </Field>
        {/* 2026-07-13: HWL-only line below Business Address printing just
            the branch's retail_chain value (e.g. "Mercury Drug
            Corporation") — no "Business Style:" label/caption, per client
            request. Uses retail_chain (a short consistent chain name
            field) rather than a hardcoded string, so it stays correct if
            reused for other branches/chains later. Only rendered when a
            template defines businessStyle (currently just hwl). Also
            dropped to 10pt (same as Address right above it) per client
            request to help it fit. */}
        {template.businessStyle && (
          <Field pos={template.businessStyle} fontSizePt={10}>
            {header.branches?.retail_chain || ""}
          </Field>
        )}
        {/* Branch name: client asked for this directly below the Sold To
            block (not merged onto the Registered Name line, and not down
            in Remarks — both tried before). 2026-07-10: client asked to
            drop the word "Branch" entirely — just print the branch name
            itself, no label, on either pre-printed or plain-paper
            templates (the generic template's own "Branch:" fieldLabel
            entry was removed too, see lib/invoiceTemplates.ts).
            Only rendered as its own line when the template has a
            dedicated row for it (mergeBranchIntoSoldTo is falsy) — see the
            soldTo Field above for forms that don't. */}
        {!template.mergeBranchIntoSoldTo && (
          <Field pos={f("branchLine")}>{header.branches?.branch_name}</Field>
        )}
        <Field pos={f("terms")}>{header.clients?.payment_terms || ""}</Field>

        {/* --- Line items: Qty / Unit / Description / Unit Price / Amount ---
            2026-07-10: client's actual test print showed the Exp Date line
            colliding with the item description whenever the description was
            long enough to wrap onto a 2nd line (e.g. "Ludy's Peanut Butter
            224gms x 24 btl.") — the old fixed itemRowHeight/offset only
            accounted for a single-line description. Fixed properly instead
            of another fixed-number guess: each row's height and its Exp
            line's vertical offset are now computed PER ROW based on whether
            that row's own description is predicted to wrap, using Courier
            New's fixed character width (~0.6 x font-size) to estimate how
            many characters fit in the description column at the current
            11pt item font. Rows stack on top of each other using a running
            cursor (not idx * fixed height), so a wrapped row pushes every
            row after it down by exactly the extra space it needed — no
            more, no less. */}
        {(() => {
          const itemFontPt = 11;
          const expFontPt = 9;
          const charWidthIn = (pt: number) => (0.6 * pt) / 72; // Courier New fixed-width estimate
          const lineHeightIn = (pt: number) => (1.25 * pt) / 72; // "leading-tight" line box
          const descCharsPerLine = Math.floor(template.itemCol.description.width / charWidthIn(itemFontPt));
          const itemLineH = lineHeightIn(itemFontPt);
          const expLineH = lineHeightIn(expFontPt);
          // Stop adding rows once they'd start running into the totals
          // block, whatever font size that ends up needing.
          const bottomBoundary = template.fields.totalSalesVatInclusive.top - 0.1;
          // 2026-07-13: client feedback on a real HWL test print — items
          // looked too cramped/close together ("masyadong dikit dikit").
          // Widened the two small buffers below (were both a flat 0.03in)
          // so there's visibly more air between an item's own text and its
          // Exp Date line, and between one item's Exp Date line and the
          // next item's row.
          const preExpGap = 0.06;
          const rowGap = 0.14;

          let cursor = template.itemRowStartTop;
          const rows: { line: DeliveryLine; top: number; expOffset: number }[] = [];
          for (const line of lines) {
            if (cursor > bottomBoundary) break; // silently stop rather than overlap the totals block
            const displayCode = line.items?.mercury_item_code || line.items?.item_code || "";
            const baseDescription = template.itemCol.code
              ? line.item_description
              : displayCode
                ? `${displayCode}  ${line.item_description}`
                : line.item_description;
            const wraps = (baseDescription?.length || 0) > descCharsPerLine;
            const expOffset = itemLineH + preExpGap + (wraps ? itemLineH : 0);
            const rowHeight = expOffset + expLineH + rowGap;
            rows.push({ line, top: cursor, expOffset });
            cursor += rowHeight;
          }

          return rows.map(({ line, top, expOffset }) => {
          // Show Mercury's item code on the invoice instead of the item's
          // own (in-house) item_code, since that's what the client-facing
          // receipt should carry. Falls back to item_code if no Mercury
          // code is set for that item.
          const displayCode = line.items?.mercury_item_code || line.items?.item_code || "";
          // If this layout has no dedicated code column (e.g. a
          // pre-printed form not yet calibrated for one), prefix the code
          // onto the description instead of dropping it.
          const baseDescription = template.itemCol.code
            ? line.item_description
            : displayCode
              ? `${displayCode}  ${line.item_description}`
              : line.item_description;
          const expText = expirationLabel(line, previewExpiry);
          return (
            <div key={line.id} style={{ position: "absolute", top: `${top}in`, left: 0, width: `${pageW}in` }}>
              <span
                style={{ position: "absolute", left: `${template.itemCol.qty.left}in`, width: `${template.itemCol.qty.width}in` }}
                className="text-[11pt] text-right"
              >
                {/* Right-aligned so the digit sits at the right edge of its
                    column box, immediately next to where the Unit box
                    begins — a left-aligned single digit (e.g. "1") would
                    otherwise leave a big visual gap before "CASE". */}
                {line.qty}
              </span>
              <span
                style={{ position: "absolute", left: `${template.itemCol.unit.left}in`, width: `${template.itemCol.unit.width}in` }}
                className="text-[11pt]"
              >
                {line.items?.unit || ""}
              </span>
              {template.itemCol.code && (
                <span
                  style={{
                    position: "absolute",
                    left: `${template.itemCol.code.left}in`,
                    width: `${template.itemCol.code.width}in`,
                  }}
                  className="text-[11pt] whitespace-nowrap overflow-hidden"
                >
                  {displayCode}
                </span>
              )}
              <span
                style={{
                  position: "absolute",
                  left: `${template.itemCol.description.left}in`,
                  width: `${template.itemCol.description.width}in`,
                }}
                // Never truncate/hide the description: wrap onto a 2nd line
                // instead of cutting it off with overflow-hidden (which was
                // silently chopping off longer item names before). Row
                // height and the Exp line's offset (computed above, per
                // row) already account for whether this wraps, so a 2-line
                // description no longer collides with anything below it.
                className="text-[11pt] whitespace-normal break-words leading-tight"
              >
                {baseDescription}
              </span>
              <span
                style={{ position: "absolute", left: `${template.itemCol.unitPrice.left}in`, width: `${template.itemCol.unitPrice.width}in` }}
                className="text-[11pt]"
              >
                {peso(line.unit_price)}
              </span>
              <span
                style={{ position: "absolute", left: `${template.itemCol.amount.left}in`, width: `${template.itemCol.amount.width}in` }}
                className="text-[11pt]"
              >
                {peso(line.amount)}
              </span>
              {/* Expiration Date prints on its own line below the item row
                  (per client's Rodzon column-order request), not inline
                  with the description. */}
              {expText && (
                <span
                  style={{
                    position: "absolute",
                    // Computed per-row above: clears a single-line
                    // description normally, and clears a WRAPPED (2-line)
                    // description too, since expOffset already accounts for
                    // whether this specific row's description wraps.
                    top: `${expOffset}in`,
                    left: `${template.itemCol.code?.left ?? template.itemCol.description.left}in`,
                    width: `${pageW - (template.itemCol.code?.left ?? template.itemCol.description.left)}in`,
                  }}
                  className="text-[9pt] italic"
                >
                  {expText}
                </span>
              )}
            </div>
          );
          });
        })()}

        {/* --- Totals block ---
            2026-07-10: client's real test print showed our old 5-value
            column ("VATable Sales" down to "TOTAL AMOUNT DUE") straddling
            BOTH of the form's pre-printed columns at once, visually
            covering parts of both ("natabunan yung format ng invoice").
            Client asked for only 3 values in the right-hand computation
            column — Total Sales (VAT Inclusive), Less: VAT, Amount (net of
            VAT) — plus the final total lined up separately with the form's
            own "TOTAL AMOUNT DUE:" line near the bottom of that column.
            vatableSales is intentionally not printed at all now — the
            client didn't ask for it, and it was the one landing on the
            WRONG (left-hand) column before. */}
        <Field pos={f("totalSalesVatInclusive")}>{peso(totalSalesVatInclusive)}</Field>
        <Field pos={f("vatAmount")}>{peso(vatAmount)}</Field>
        <Field pos={f("amountNetOfVat")}>{peso(amountNetOfVat)}</Field>
        <Field pos={f("totalAmountDue")} className="font-bold">
          {peso(totalAmountDue)}
        </Field>

        <Field pos={f("remarks")}>{header.remarks}</Field>
      </div>
    </div>
  );
}
