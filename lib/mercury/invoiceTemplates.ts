/**
 * Per-client invoice print templates.
 *
 * Different clients hand us different physical pre-printed invoice forms
 * (or none at all). Each entry here is one calibrated layout — a set of
 * absolute inch-coordinates telling the print page where to place each
 * value so it lands correctly on that specific piece of paper.
 *
 * HOW TO ADD A NEW CLIENT'S FORM:
 *   1. Get a clear photo (or the actual blank form) of that client's invoice.
 *   2. Add a new entry below, copying the "rodzon" one as a starting point.
 *   3. Send me the photo + which fields look off after a real test print —
 *      I'll adjust the numbers. Nothing else in the app needs to change.
 *   4. The new template automatically shows up as a choice on the Clients
 *      page ("Invoice Format" dropdown) — assign it to that client there.
 *
 * If a client isn't assigned a template, DEFAULT_INVOICE_TEMPLATE is used.
 */

export type InvoiceFieldKey =
  | "invoiceDate"
  | "poNumber"
  | "soldTo"
  | "branchLine"
  | "tin"
  | "businessAddress"
  | "terms"
  | "vatableSales"
  | "vatAmount"
  | "totalSalesVatInclusive"
  | "amountNetOfVat"
  | "totalAmountDue"
  | "remarks";

export interface InvoiceLayout {
  /** Shown in the Clients "Invoice Format" dropdown. */
  label: string;
  /**
   * true (default) = this is a physical pre-printed form; the paper already
   * has the labels/borders printed on it, so we only print the values.
   * false = plain blank paper; we draw the labels, table header, and
   * borders ourselves since nothing is pre-printed.
   */
  isPreprinted?: boolean;
  /** Only used when isPreprinted is false — caption shown next to each field. */
  fieldLabels?: Partial<Record<InvoiceFieldKey, string>>;
  /** Only used when isPreprinted is false — captions for the item table header row. */
  tableHeaderLabels?: {
    qty: string;
    unit: string;
    code?: string;
    description: string;
    unitPrice: string;
    amount: string;
  };
  /**
   * true = this form's "Sold To" area has only ONE blank line (no separate
   * row for the branch/store name), so the branch name is appended onto
   * the soldTo value instead of being printed as its own row. Default
   * (false/undefined) = branchLine renders as its own separate line below
   * Sold To, like Rodzon's form does.
   */
  mergeBranchIntoSoldTo?: boolean;
  /** Physical paper size, in inches. */
  paper: { width: number; height: number };
  /** Absolute position (inches from top-left) of each labeled field. */
  fields: Record<InvoiceFieldKey, { top: number; left: number; width: number }>;
  /**
   * Optional one-off "Business Style" line (e.g. the retail chain name,
   * like "Mercury Drug Corporation") printed below Business Address.
   * Only defined for templates that need it — not part of the mandatory
   * `fields` map so other templates (generic, rodzon) don't need updating.
   */
  businessStyle?: { top: number; left: number; width: number };
  /** Line-item table column positions (inches). */
  itemCol: {
    qty: { left: number; width: number };
    unit: { left: number; width: number };
    /**
     * Optional Item Code column — shows the item's mercury_item_code if
     * set, otherwise falls back to its own item_code. Only define this
     * for layouts that have room/a pre-printed header for it. If omitted
     * (e.g. a pre-printed form not yet calibrated for it), the print page
     * prefixes the code onto the Description text instead, so nothing is
     * silently dropped.
     */
    code?: { left: number; width: number };
    description: { left: number; width: number };
    unitPrice: { left: number; width: number };
    amount: { left: number; width: number };
  };
  /** Top position of the first line item row; the print page computes every row after that dynamically (see note below). */
  itemRowStartTop: number;
  /**
   * NOTE (2026-07-10): itemRowHeight/itemRowMax below are no longer used by
   * the print page to position rows — they used to (top = itemRowStartTop +
   * idx * itemRowHeight), but that fixed spacing broke whenever a long item
   * description wrapped onto a 2nd line, colliding with the Exp Date line
   * below it. The print page now stacks rows with a running cursor, giving
   * each row extra height only if ITS OWN description actually wraps, and
   * stops automatically once rows would reach the totals block (using
   * fields.totalSalesVatInclusive.top as the boundary). Kept as required
   * fields here only because older/other code may still read them; treat
   * them as informational, not authoritative.
   */
  itemRowHeight: number;
  /** No longer enforced by the print page — see itemRowHeight note above. */
  itemRowMax: number;
}

export const INVOICE_TEMPLATES: Record<string, InvoiceLayout> = {
  generic: {
    label: "Standard Invoice (no pre-printed form / blank paper)",
    isPreprinted: false,
    fieldLabels: {
      invoiceDate: "Date:",
      poNumber: "P.O. #:",
      soldTo: "Sold To:",
      // branchLine: intentionally no label — 2026-07-10 client asked to
      // drop the word "Branch" entirely on invoice printing; just the
      // branch name value prints here now (see print page).
      tin: "TIN:",
      businessAddress: "Address:",
      terms: "Terms:",
      vatableSales: "VATable Sales:",
      vatAmount: "VAT Amount:",
      totalSalesVatInclusive: "Total Sales (VAT Incl.):",
      amountNetOfVat: "Amount Net of VAT:",
      totalAmountDue: "TOTAL AMOUNT DUE:",
      remarks: "Remarks:",
    },
    tableHeaderLabels: {
      qty: "QTY",
      unit: "UNIT",
      code: "ITEM CODE",
      description: "DESCRIPTION",
      unitPrice: "UNIT PRICE",
      amount: "AMOUNT",
    },
    paper: { width: 8.5, height: 11 },
    fields: {
      invoiceDate: { top: 1.3, left: 6.3, width: 1.6 },
      poNumber: { top: 1.55, left: 6.3, width: 1.6 },
      soldTo: { top: 1.65, left: 2.1, width: 5.4 },
      branchLine: { top: 1.9, left: 2.1, width: 5.4 },
      businessAddress: { top: 2.15, left: 2.1, width: 5.4 },
      tin: { top: 2.4, left: 2.1, width: 3.0 },
      terms: { top: 2.65, left: 2.1, width: 3.0 },

      vatableSales: { top: 9.35, left: 6.3, width: 1.5 },
      vatAmount: { top: 9.57, left: 6.3, width: 1.5 },
      totalSalesVatInclusive: { top: 9.79, left: 6.3, width: 1.5 },
      amountNetOfVat: { top: 10.01, left: 6.3, width: 1.5 },
      totalAmountDue: { top: 10.25, left: 6.3, width: 1.5 },

      remarks: { top: 10.55, left: 0.6, width: 7.3 },
    },
    itemCol: {
      qty: { left: 0.65, width: 0.55 },
      unit: { left: 1.25, width: 0.55 },
      code: { left: 1.85, width: 0.9 },
      description: { left: 2.8, width: 2.4 },
      unitPrice: { left: 5.3, width: 1.1 },
      amount: { left: 6.5, width: 1.3 },
    },
    itemRowStartTop: 2.9,
    itemRowHeight: 0.25,
    itemRowMax: 22,
  },

  rodzon: {
    label: "Rodzon Marketing Corp (pre-printed form)",
    isPreprinted: true,
    paper: { width: 8.5, height: 11 },
    // Recalibrated 2026-07-10 against the client's 3rd test photo, which
    // showed (a) the previous coordinates landing on/overlapping the WRONG
    // pre-printed labels (PO# over the form's own serial-number box, Sold
    // To block bleeding into TIN/Address, item header overlap) and (b) the
    // totals block printing ~1.3-1.5in too low, spilling into the bottom
    // Signature/SC-PWD strip, and too far left of the real column. Moved
    // the whole block up and right accordingly. soldTo no longer has a
    // separate branchLine row (see print page — branch name is now
    // appended onto soldTo directly since the real form only has 3 label
    // lines under SOLD TO, not 4). These are still best-effort visual
    // estimates, NOT ruler-measured — use the new "Show alignment grid"
    // checkbox on the print page to print a red inch-grid on the actual
    // form and get exact numbers for the next pass.
    // Recalibrated AGAIN 2026-07-10, this time against an actual photo of
    // OUR print output sitting on top of the real blank Rodzon paper (not
    // just a photo of a filled sample) — much more reliable than the prior
    // rounds. Findings from that photo:
    //  - invoiceDate was landing inside/on top of the "SALES INVOICE"
    //    heading box and the form's own pre-printed serial number — needed
    //    to move down to the actual "Date:" line further below the letterhead.
    //  - soldTo (top 2.05) DID line up correctly with "Registered Name :" —
    //    left as-is.
    //  - tin and businessAddress were printing noticeably BELOW their real
    //    labels ("TIN :" / "Business Address :"), which sit tighter under
    //    Registered Name than assumed (~0.2in apart, not ~0.4in) — pulled
    //    both up.
    //  - Biggest bug: vatableSales/vatAmount DID land correctly next to
    //    "VATable Sales :" / "VAT :" (left column), but
    //    totalSalesVatInclusive/amountNetOfVat/totalAmountDue were ALSO
    //    stacked in that same left column, so they printed next to the
    //    WRONG labels ("Zero-Rated Sales :" / "VAT-Exempt Sales :" — fields
    //    we intentionally leave blank) instead of their own labels, which
    //    are in a separate RIGHT-hand column ("Total Sales (VAT
    //    Inclusive):", "Amount: Net of VAT", "TOTAL AMOUNT DUE:"). Moved
    //    those three to left ~7.3 to land in that right column instead.
    // Recalibrated AGAIN 2026-07-10 using the on-screen alignment grid
    // (exact inch coordinates this time, not photo-estimated) plus direct
    // client feedback on that grid printout:
    //  - Totals block: client wants all 5 VAT figures read as ONE straight
    //    top-to-bottom computation (VATable Sales -> VAT -> Total Sales ->
    //    Amount Net of VAT -> TOTAL AMOUNT DUE), NOT split across two
    //    columns like the previous pass tried — reverted to a single
    //    column, same left as vatableSales/vatAmount (already confirmed
    //    correctly aligned earlier).
    //  - Branch name: moved out of Remarks, now its own line directly below
    //    the Sold To block (below Business Address) per client request.
    // 2026-07-10, previous round: invoiceDate moved down 0.5in; Branch moved
    // under Registered Name; the whole block raised 0.5in; font doubled
    // (10pt -> 20pt). Test print result: rows overlapped AND several fields
    // clipped mid-text at their box edge ("sumobrang laki" — client
    // feedback), because 20pt text doesn't fit in boxes/gaps sized for 10pt.
    //
    // FIXED THIS ROUND with actual math instead of another guess: Courier
    // New is a fixed-width font, so character width and line height scale
    // predictably with font size (~0.6x and ~1.25x the font size,
    // respectively). Font settled at 13pt (see print page) — the largest
    // size that still fits every field below without clipping:
    //  - Rows re-paired into a clean 2-column grid so each of the 4 header
    //    rows lines up a left-side field with a right-side field at the
    //    SAME top (no more odd 0.1-0.2in offsets between them): row 1
    //    soldTo+invoiceDate, row 2 branchLine+poNumber, row 3 tin+terms,
    //    row 4 businessAddress (alone, full width).
    //  - Row gap widened 0.2in -> ~0.28-0.3in — 13pt needs ~0.226in of line
    //    height, so 0.2in was mathematically guaranteed to overlap; 0.3in
    //    clears it with margin.
    //  - soldTo/invoiceDate/poNumber widened slightly (3.9->4.2, 1.6->1.8)
    //    since at 13pt they needed a bit more room than at 10pt to avoid
    //    clipping longer registered names / "Mon DD, YYYY" dates.
    // tin/businessAddress/terms widths were already generous enough at 13pt
    // and are unchanged.
    fields: {
      invoiceDate: { top: 1.55, left: 6.5, width: 1.8 },
      poNumber: { top: 1.85, left: 6.3, width: 1.8 },
      soldTo: { top: 1.55, left: 2.2, width: 4.2 },
      branchLine: { top: 1.85, left: 2.2, width: 3.9 },
      tin: { top: 2.15, left: 2.2, width: 3.0 },
      businessAddress: { top: 2.45, left: 2.2, width: 5.8 },
      terms: { top: 2.15, left: 6.3, width: 1.6 },

      // Reworked 2026-07-10 against the client's real test print, which
      // showed our old single straight column (5 values, starting at 7.6)
      // straddling and covering BOTH of the form's actual printed columns
      // ("natabunan yung format ng invoice"). Client asked for only 3
      // values matching the form's own right-hand computation column —
      // Total Sales (VAT Inclusive), Less: VAT, Amount (Net of VAT) — plus
      // the grand total lined up separately with "TOTAL AMOUNT DUE:" near
      // the bottom of that same column. vatableSales is left defined here
      // (required by the shared type) but is no longer rendered on the
      // print page — the client didn't ask for it and it was the value
      // that had been landing on the wrong (left) column.
      // Row 1 (7.6): Total Sales (VAT Inclusive) — same top the old
      // vatableSales/Row-1 used, already confirmed aligned to that row.
      // Row 2 (7.85) / Row 3 (8.1): Less: VAT / Amount: Net of VAT, still
      // 0.25in apart, matching the form's own row spacing in that column.
      // Rows 4-6 (Less Discount / Add: VAT / Less WHT) are intentionally
      // left blank (not tracked) — that's 3 rows x ~0.25in = 0.75in, so
      // TOTAL AMOUNT DUE is estimated at 8.1 + 0.75 + 0.25 = 9.1. This one
      // is the least certain of the bunch (no ruler/grid measurement for
      // it yet) — confirm on the next test print.
      // 2026-07-10 test print: values were landing to the LEFT of their
      // real labels — overlapping the left column's "VATable Sales:" /
      // "VAT:" / "Zero-Rated Sales:" instead of sitting next to their own
      // right-column labels. Client asked to shift right 1in (6.5 -> 7.5).
      // Width trimmed 1.4 -> 0.9 to keep the box inside the 8.5in page at
      // that new left (7.5 + 0.9 = 8.4in) — still comfortably fits an
      // 8-digit peso amount like "6,370.59" at 12pt.
      // TOTAL AMOUNT DUE separately pushed down another 0.5in (9.1 -> 9.6),
      // then nudged back UP 0.25in (9.6 -> 9.35) per client feedback ("kalahati
      // ng half inch") — it had overshot slightly past its printed line.
      // 2026-07-10: client asked to shift the whole totals column LEFT by
      // ~0.5in so it lines up with the item table's own "Amount" column
      // above it ("pantay mo sya sa amount sa taas"). Rather than eyeball
      // another half-inch guess, set left to match itemCol.amount.left
      // (7.3) exactly — that IS the item Amount column's left edge, so this
      // guarantees true vertical alignment instead of an approximate one.
      // Still fits the page (7.3 + 0.9 = 8.2in, comfortably inside 8.5in).
      vatableSales: { top: 7.6, left: 7.3, width: 0.9 },
      totalSalesVatInclusive: { top: 7.6, left: 7.3, width: 0.9 },
      vatAmount: { top: 7.85, left: 7.3, width: 0.9 },
      amountNetOfVat: { top: 8.1, left: 7.3, width: 0.9 },
      totalAmountDue: { top: 9.35, left: 7.3, width: 0.9 },

      remarks: { top: 7.6, left: 0.6, width: 5.5 },
    },
    // Column order left-to-right per the client's actual Rodzon paper form:
    // Item Code, Item Description, Qty, Unit Price, Amount — with the
    // Expiration Date printed on its own line BELOW each item row (handled
    // in the print page, not here). Positions below are a first-pass
    // estimate (not yet confirmed against a real test print); nudge after
    // an actual print on the physical pre-printed paper.
    // Qty sits tight against Unit (unit of measure, e.g. "pcs") since they
    // read as one group ("5 pcs"). Qty text itself is right-aligned (see
    // print page) so a short value like "1" renders at the right edge of
    // its box, immediately next to where the Unit box starts.
    // Description was widened (was 2.3in, cutting off longer item names
    // like "Ludy's Peanut Butter 224gms x 24" mid-word per client feedback
    // on an actual test print, 2026-07-10) by reclaiming unused margin on
    // the right side of the table (Amount used to end at 6.5+1.3=7.8in on
    // an 8.5in page, leaving 0.7in dead space) and shifting everything
    // right of Code over slightly. The print page also no longer hard-
    // truncates the description (overflow-hidden removed) — it wraps to a
    // 2nd line instead as a safety net, so text is never silently hidden.
    // Whole row nudged right by 0.5in 2026-07-10 per client request ("usog
    // mo pakanan yung item code ng half inch") — shifted every column
    // together (not just Code) so none of them collide with each other;
    // Amount's width was trimmed slightly (1.3 -> 1.1) so it still ends
    // within the 8.5in page (7.3 + 1.1 = 8.4in) after the shift.
    // Amount was asked to move right another 1in (7.3 -> 8.3) 2026-07-10
    // ("yung amount iusog mo pa sa kanan ng 1 inch"), which was applied
    // literally last round, but that puts it at 8.3+1.1=9.4in — physically
    // past the 8.5in edge of the paper, so it printed cut off. Reverted
    // left back to 7.3 (ends at 8.4in, 0.1in inside the page) since going
    // further right isn't possible without narrowing the box so much the
    // peso amount itself wouldn't fit. If more separation from Unit Price
    // is still needed, the fix has to come from shrinking/moving Unit
    // Price's column instead, not by pushing Amount past the paper edge.
    itemCol: {
      code: { left: 1.05, width: 0.75 },
      description: { left: 1.85, width: 3.05 },
      qty: { left: 4.95, width: 0.4 },
      unit: { left: 5.4, width: 0.55 },
      unitPrice: { left: 6.1, width: 1.05 },
      amount: { left: 7.3, width: 1.1 },
    },
    // itemRowHeight bumped 0.42 -> 0.44 this round to give the Exp Date
    // sub-line (now 10pt, was briefly 16pt) proper clearance below each
    // item row's own (now 12pt) text — see print page for the offset math.
    // itemRowMax recomputed below still clears the totals block.
    // itemRowStartTop moved down (was 2.65) 2026-07-10: the client's photo
    // showed items starting on top of the form's own pre-printed
    // SKU/DESCRIPTION/QTY/UNIT PRICE/AMOUNT header row, which actually
    // sits around ~3.3in on the real paper — rows now start below it.
    // itemRowMax recomputed against the totals block's new (much higher)
    // top of 7.6in, re-checked with the new 0.44 row height: 3.45 + 9*0.44 =
    // 7.41in, +0.22in Exp line offset +0.14in Exp line's own height = 7.77in
    // — that's PAST 7.6in on the 9th row's Exp line specifically. Dropped
    // itemRowMax to 8 to keep every row (including its Exp line) clear of
    // the totals block: 3.45 + 8*0.44 = 6.97in, +0.36in = 7.33in, safely
    // under 7.6in. (Deliveries with more than 8 line items will have extras
    // silently cut off — flag this to the client if it ever comes up.)
    itemRowStartTop: 3.45,
    itemRowHeight: 0.44,
    itemRowMax: 8,
  },

  hwl: {
    label: "HealthWellnessLifestyle, Inc. / HWL (pre-printed form)",
    isPreprinted: true,
    paper: { width: 8.5, height: 11 },
    // FIRST-PASS estimate from the client's photo of the blank HWL form
    // (2026-07-13) — proportions measured off that photo and converted to
    // inches on a standard 8.5x11 page, same method used for Rodzon's
    // first draft. NOT ruler/grid-confirmed yet. After the next real test
    // print, use the print page's "Show alignment grid" checkbox to get
    // exact numbers and adjust here.
    // Layout notes from the photo:
    //  - Sold to / TIN / Address are 3 separate blank lines on the LEFT,
    //    each ~0.2in apart, no dedicated "Branch" line on the printed
    //    form itself. 2026-07-13: client asked for Branch to print as its
    //    OWN line directly below Sold To anyway (same treatment as
    //    Rodzon), so TIN and Address were each pushed down one more
    //    ~0.2in row to make room. Since the physical form only has 3
    //    pre-printed lines here, TIN/Address will now print slightly
    //    below their own printed labels — check the next test print to
    //    confirm they don't crowd the disclaimer paragraph right below.
    //  - Date / Credit Terms / Agent Code / Ref.&P.O. No. are 4 blank
    //    lines on the RIGHT, same ~0.2in spacing (one row lower than the
    //    left column since it has an extra 4th line). "Agent Code" isn't
    //    tracked by this app (no matching field) — left blank on purpose.
    //    These are unaffected by the left column's shift since they sit
    //    at a different left/x position on the page.
    //  - Item table columns, left to right: Item # (blank, not tracked —
    //    likely a manual running line number), Code, Qty., Unit, an
    //    unlabeled wide column (Description), Unit Price, Amount.
    //  2026-07-13: client clarified the actual desired column order is Qty,
    //  Unit, then Item Code, Item Description, Unit Price, Amount (Code
    //  moved from 1st to 3rd) — reordered below. The three left-most
    //  columns' widths (0.41 + 0.5 + 0.55 = 1.46) were kept as-is, just
    //  resequenced, so Description still starts at the same left (2.2) as
    //  before and nothing to its right needed to move.
    //  2026-07-13 follow-up (client test print feedback): Description was
    //  printing with NO gap at all against Code ("masyadong dikit" — they
    //  literally touched, code.left 1.65 + code.width 0.55 = 2.2 =
    //  description.left exactly). Nudged description right by 0.15in (2.2 ->
    //  2.35) and trimmed its width by the same 0.15in so unitPrice still
    //  starts at the same 5.57 as before.
    //  Also per the same feedback: the header's Date / Credit Terms /
    //  Ref.&P.O. No. fields (previously left=5.1) and the item table's
    //  Amount column should all sit on ONE straight vertical line down the
    //  page ("tapat dapat sa amount") — same alignment approach already
    //  used on Rodzon's totals column. All three header fields' left is now
    //  set to match itemCol.amount.left (6.49) exactly, and the totals
    //  block's left (was 6.46, effectively already matching) was nudged the
    //  last 0.03in to 6.49 too, so header fields + item Amount + totals are
    //  all perfectly aligned in one column. NOTE: this is still an estimate
    //  pending a real test print — the header fields moving this far right
    //  assumes the physical form's own Date/Terms/PO# blank lines actually
    //  sit under/near that x-position; if the next test print shows them
    //  landing in the wrong spot on the paper, send a photo and I'll
    //  recalibrate against the real form instead of guessing again.
    //  - Totals: form has TWO boxes side by side. The LEFT box (VATable
    //    Sales / VAT / Zero Rated Sales / VAT-Exempt Sales) is the same
    //    "usually blank" left column seen on Rodzon's form — not used.
    //    The RIGHT box (VATable Sales (VAT Inclusive) / Less: VAT /
    //    Amount: Net of VAT / Less: Discount / ADD: VAT / Less: W/holding
    //    Tax / TOTAL AMOUNT DUE) is the real computation column, same 3
    //    values + grand total pattern as Rodzon.
    //  - No printed "Remarks" line anywhere on this form — placed in the
    //    small blank gap between the signature boxes and the footer
    //    printer info at the very bottom as a low-risk fallback spot.
    // 2026-07-13, another follow-up: client asked to shift the whole item
    // details block right by half an inch, and to bring the Amount/totals
    // column along with it ("masama sa pag-usog") — since Date/Terms/PO#
    // and the totals block are deliberately kept aligned to the item
    // Amount column's left edge (per the earlier "tapat sa amount"
    // request, reconfirmed just now: "dapat tapat lang ng date yung
    // halaga ng amount"), all of those shift together too, not just the
    // item table, so that alignment survives the move. Each field's width
    // was trimmed just enough so nothing runs past the 8.5in page edge
    // after shifting right (same fix applied to Rodzon previously when an
    // amount column was pushed too close to the paper edge).
    // 2026-07-13, latest test-print round: client sent an actual printed
    // photo showing several collisions —
    //  (a) Sold To/Branch/TIN/Address/Business Style block overlapped the
    //      pre-printed disclaimer paragraph right below it, so that whole
    //      block shifted right 0.5in (0.69 -> 1.19) AND its row spacing was
    //      compressed from 0.2in to 0.15in apart so the last line
    //      (Business Style) now ends at 2.04 instead of 2.24, clearing more
    //      room above the disclaimer text.
    //  (b) Date/Credit Terms/Ref.&P.O. No. were overflowing off the edge of
    //      their printed line, so nudged left 0.3in (6.99 -> 6.69).
    //  (c) The totals column values (VATable Sales/VAT/Net of VAT/TOTAL
    //      AMOUNT DUE) were printing above their own pre-printed labels —
    //      pushed all of them down 0.5in.
    // 2026-07-15, follow-up: after the 0.5in overall raise above,
    // client asked VATable Sales/Less VAT/Net of VAT/TOTAL AMOUNT DUE
    // specifically to come back down a little — lowered each 0.25in
    // (5.2->5.45, 5.49->5.74, 5.77->6.02, 6.86->7.11). Everything else
    // from the prior round is untouched.
    // 2026-07-15: client said everything on the printed HWL invoice was
    // sitting too low overall (compared against the last known-good
    // 2026-07-13 setup) — raised every field's top by 0.5in across the
    // board (header block, item rows, totals, remarks), and nudged Sold
    // To/Branch/TIN/Address plus the Qty/Unit item columns left by
    // 0.15in. Everything else (widths, item column order, totals
    // alignment) is unchanged.
    fields: {
      // 2026-07-13, latest round: client said the whole Sold To/Branch/TIN/
      // Address block, plus Date/Terms/PO#, could all come up a little —
      // raised each 0.1in (soldTo 1.44->1.34, branchLine 1.59->1.49,
      // tin 1.74->1.64, businessAddress 1.95->1.85, invoiceDate 1.44->1.34,
      // terms 1.64->1.54, poNumber 2.03->1.93). Relative spacing between
      // them is unchanged — the whole group just shifted up together.
      invoiceDate: { top: 0.84, left: 6.69, width: 1.4 },
      poNumber: { top: 1.43, left: 6.69, width: 1.4 },
      soldTo: { top: 0.84, left: 1.04, width: 4.0 },
      branchLine: { top: 0.99, left: 1.04, width: 4.0 },
      tin: { top: 1.14, left: 1.04, width: 4.0 },
      // 2026-07-13: 10pt still cut off the real (long) Mercury address at
      // the original width, but client didn't want it shrunk to 8pt either
      // ("panget tingnan") — kept it at 10pt and instead let it WRAP onto a
      // 2nd line in the print page if it doesn't fit on one (Field's `wrap`
      // prop, plus `break-words` so a long unbroken run of characters can't
      // bleed sideways).
      // 2026-07-13, follow-up: client said the address was STILL overflowing
      // past its printed line even with wrap+break-words on — the 5.0in box
      // was wide enough that the first line often ran almost all the way to
      // the Date/Terms/PO# column before wrapping, so the wrap point itself
      // was too close to that column. Narrowed back to 4.0in (same width as
      // Sold To/Branch/TIN above it) so it wraps to a 2nd line earlier/more
      // reliably, well clear of the Date/Terms/PO# column.
      // 2026-07-13, latest follow-up: a real test print (photo) showed this
      // field still overlapping/striking through the pre-printed disclaimer
      // paragraph below it, even after the width fix — the paragraph starts
      // higher up than expected, so there just wasn't enough clearance at
      // 1.89. Pushed down to 2.03, matching Ref./P.O. No.'s row on the right
      // column.
      // 2026-07-13, next test print: 2.03 left too big a gap below TIN (and
      // this address happened to wrap to 2 lines, so its 2nd line was still
      // crowding the paragraph) — client asked to bring it closer/snugger to
      // TIN instead. Pulled back up to 1.95 (gap from TIN 0.29in -> 0.21in),
      // trimming the empty space between TIN and Address so a 2-line-wrapped
      // address has a little more clearance before the paragraph below.
      businessAddress: { top: 1.35, left: 1.04, width: 4.0 },
      terms: { top: 1.04, left: 6.69, width: 1.4 },

      // 2026-07-13 follow-up: TOTAL AMOUNT DUE (the grand total, printed
      // lowest on the page) was sitting slightly below its own pre-printed
      // label — raised it 0.15in (7.61 -> 7.46). NOTE this top value is a
      // fixed absolute inch position, same as every other field here — it's
      // NOT computed from lines.length/item count in the print page (see
      // the item-row "cursor" logic below, which only ever stops item rows
      // BEFORE this fixed boundary, never moves the boundary itself), so
      // this position is already the same no matter how many line items a
      // given delivery has.
      // 2026-07-13, latest follow-up: still printing slightly past its line
      // per the newest test print — raised another 0.1in (7.46 -> 7.36).
      // 2026-07-13, same round: VATable Sales/Less VAT/Amount Net of VAT
      // were also sitting a bit low, not lined up with their own printed
      // rows — raised each 0.1in (5.9 -> 5.8, 6.19 -> 6.09, 6.47 -> 6.37).
      // Same as TOTAL AMOUNT DUE, these are fixed absolute positions, not
      // computed from item count, so this stays correct no matter how many
      // line items a delivery has.
      // 2026-07-13, next round: raised another 0.1in each (5.8 -> 5.7,
      // 6.09 -> 5.99, 6.37 -> 6.27) per client feedback — TOTAL AMOUNT DUE
      // was NOT touched this round since client said it's already good.
      vatableSales: { top: 5.45, left: 6.99, width: 1.5 }, // unused (not rendered), kept to satisfy the type
      totalSalesVatInclusive: { top: 5.45, left: 6.99, width: 1.5 },
      vatAmount: { top: 5.74, left: 6.99, width: 1.5 },
      amountNetOfVat: { top: 6.02, left: 6.99, width: 1.5 },
      totalAmountDue: { top: 7.11, left: 6.99, width: 1.5 },

      remarks: { top: 8.55, left: 0.6, width: 5.0 },
    },
    // 2026-07-13: "Business Style" line (retail_chain, e.g. "Mercury Drug
    // Corporation") was added below Business Address, then later removed
    // entirely per client request ("alisin mo nlang yung business style") —
    // no businessStyle field defined for hwl anymore. The print page's
    // render is gated on `template.businessStyle &&`, so it simply no
    // longer renders for this template; no page.tsx change was needed.
    // 2026-07-13 follow-up: client reported Qty and Unit printing with no
    // gap either (touching, same issue as Code/Description above) — added a
    // 0.1in gap there too. Also reported all 3 Mercury Item Codes on a real
    // test print looking identical (e.g. "470000" x3) even though the
    // client's own Items data has them as distinct 7-digit codes (4700000 /
    // 4700001 / 4700002) — NOT a data problem after all. The actual cause:
    // the code column's box was only 0.55in wide, which at 11pt Courier New
    // only fits ~6 characters before the print page's overflow-hidden
    // silently CUTS OFF the rest — so all three 7-digit codes got truncated
    // to the same first 6 digits "470000", hiding the one digit that made
    // them different. Widened code to 0.75in (fits ~8 characters, room to
    // spare) so the full 7-digit code prints without truncation.
    // 2026-07-13, another follow-up: whole item-details row (and the
    // Amount column with it) shifted right by 0.5in per client request.
    // Amount's width trimmed 1.64 -> 1.5 so it still ends inside the 8.5in
    // page (6.99 + 1.5 = 8.49in) after the shift — going right further
    // than that without narrowing it more would run off the paper, same
    // edge-of-page limit hit before on Rodzon's Amount column.
    // 2026-07-13, latest follow-up: client asked for Unit Price and Amount
    // to move further right so their right edge lines up with Date/Terms/
    // PO#'s right edge (6.99 + 1.4 = 8.39in) — previously Amount's right
    // edge (8.49) actually overshot that by 0.1in instead of matching it.
    // Fixed by: (1) opening the same 0.1in gap after Description that the
    // other columns already have (unitPrice.left 6.07 -> 6.17, Description
    // still ends at 6.07 unchanged), (2) adding a matching 0.1in gap
    // between Unit Price and Amount (unitPrice right edge 7.09 -> amount
    // left 7.19), and (3) setting Amount's width to exactly 1.2in so its
    // right edge lands at 7.19 + 1.2 = 8.39in — precisely matching Date/
    // Terms/PO#'s right edge, still 0.11in inside the 8.5in page edge.
    // 2026-07-13 same round: Description was overflowing past its own
    // column into Unit Price (long product names bled into the "Unit
    // Price" header on the test print) — compressed its width 2.87 -> 2.3.
    // Unit Price itself was also printing past the paper's actual Unit
    // Price line, so it moved left with Description (6.17 -> 5.65), and
    // Amount moved left the same amount to follow it (7.19 -> 6.67),
    // keeping the same 0.1in gaps between columns as before. Also, the
    // whole item table was sitting too close to the pre-printed header
    // line above it (rows touching it) — itemRowStartTop pushed down
    // 0.5in (2.76 -> 3.26) so rows print clearly below that line.
    // 2026-07-13, small follow-up: Unit column nudged right twice more in
    // tiny steps per client feedback (1.75 -> 1.8 -> 1.85) to land exactly
    // on its printed line.
    itemCol: {
      qty: { left: 1.09, width: 0.41 },
      unit: { left: 1.70, width: 0.5 },
      code: { left: 2.35, width: 0.75 },
      description: { left: 3.2, width: 2.3 },
      unitPrice: { left: 5.65, width: 0.92 },
      amount: { left: 6.67, width: 1.2 },
    },
    itemRowStartTop: 2.76,
    itemRowHeight: 0.24,
    itemRowMax: 7,
  },

  // Add more clients' forms here as photos come in, e.g.:
  // acme: {
  //   label: "Acme Corp Invoice",
  //   paper: { width: 8.5, height: 11 },
  //   fields: { ... },
  //   itemCol: { ... },
  //   itemRowStartTop: 2.4,
  //   itemRowHeight: 0.22,
  //   itemRowMax: 20,
  // },
};

export const DEFAULT_INVOICE_TEMPLATE = "generic";

/** {value,label} list for the Clients page "Invoice Format" dropdown. */
export const INVOICE_TEMPLATE_OPTIONS = Object.entries(INVOICE_TEMPLATES).map(
  ([value, cfg]) => ({ value, label: cfg.label })
);
