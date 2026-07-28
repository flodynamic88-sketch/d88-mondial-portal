import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Auto-emails a Final Billing report summary right after it's generated (see
// app/(app)/final-billing/page.tsx's handleGenerate). Actually delivering the
// email needs an email-sending provider -- we use Resend's HTTP API since it
// requires no extra npm dependency (plain fetch). Two env vars must be set
// in Vercel for this to work:
//   RESEND_API_KEY   - from https://resend.com (free tier is enough for this)
//   RESEND_FROM_EMAIL - a "from" address on a domain verified in Resend.
//                       Falls back to Resend's shared sandbox address, which
//                       only delivers to the email that owns the Resend
//                       account -- fine for testing, not for real recipients.
// Until RESEND_API_KEY is set, this route responds with a clear 501 so the
// UI can show *why* nothing was actually emailed, instead of failing silently.

interface SendReportBody {
  recipient?: string;
  startDate?: string;
  endDate?: string;
  grandTotalAmount?: number;
  grandTotalFee?: number;
  categorySummaries?: { label: string; totalAmount: number; totalFee: number }[];
}

function formatMoney(value: number) {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export async function POST(request: NextRequest) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: SendReportBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const recipient = body.recipient?.trim();
  if (!recipient) {
    return NextResponse.json(
      { error: "No report recipient email is configured yet." },
      { status: 400 }
    );
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "Email sending isn't set up yet. An admin needs to add a RESEND_API_KEY (from resend.com) as an environment variable in Vercel before reports can be auto-emailed.",
      },
      { status: 501 }
    );
  }

  const fromEmail = process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev";

  const rows = body.categorySummaries ?? [];
  const rowsHtml = rows
    .map(
      (r) =>
        `<tr><td style="padding:4px 12px;">${r.label}</td><td style="padding:4px 12px;text-align:right;">${formatMoney(
          r.totalAmount
        )}</td><td style="padding:4px 12px;text-align:right;">${formatMoney(r.totalFee)}</td></tr>`
    )
    .join("");

  const html = `
    <div style="font-family:sans-serif;color:#111;">
      <h2>Final Billing Report</h2>
      <p>Delivery Period: ${body.startDate ?? "—"} to ${body.endDate ?? "—"}</p>
      <table style="border-collapse:collapse;margin-top:12px;">
        <thead>
          <tr style="background:#f3f4f6;text-align:left;">
            <th style="padding:4px 12px;">Category</th>
            <th style="padding:4px 12px;text-align:right;">Invoice Amount</th>
            <th style="padding:4px 12px;text-align:right;">Fulfillment Fee</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
      <p style="margin-top:16px;">
        <strong>Grand Total Amount:</strong> ${formatMoney(body.grandTotalAmount ?? 0)}<br/>
        <strong>Grand Total Fulfillment Fee:</strong> ${formatMoney(body.grandTotalFee ?? 0)}
      </p>
      <p style="color:#6b7280;font-size:12px;">Sent automatically from the Mondial Portal.</p>
    </div>
  `;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromEmail,
      to: recipient,
      subject: `Final Billing Report — ${body.startDate ?? ""} to ${body.endDate ?? ""}`,
      html,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return NextResponse.json(
      { error: `Failed to send email via Resend: ${detail || res.statusText}` },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true, sentTo: recipient });
}
