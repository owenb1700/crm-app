const BASE_URL = "https://crm-app-coral-five.vercel.app";

// One shared shell for every email this app sends, so a digest, a
// collaboration notice, and an admin failure alert all look like they came
// from the same place instead of three different one-off templates.
// Mirrors the login page's look (public/logo.svg on a dark navy band, same
// rgba(13,20,36,...) overlay tone over one of the login carousel's own
// photos) -- background-image is layered CSS (renders in Gmail/Apple Mail,
// falls back to the flat navy bgcolor in Outlook, which ignores it).
export function renderEmail({ heading, intro, bodyHtml, footerNote }) {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:560px;max-width:100%;background:#ffffff;border-radius:10px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
            <tr>
              <td bgcolor="#0d1424" align="center" style="background-color:#0d1424;background-image:linear-gradient(180deg, rgba(13,20,36,0.55) 0%, rgba(13,20,36,0.88) 100%), url('${BASE_URL}/carousel/chicago-skyline.jpg');background-size:cover;background-position:center;padding:36px 24px;">
                <img src="${BASE_URL}/logo-email.png" width="220" alt="Bullock, Logan & Associates, Inc." style="display:block;width:220px;max-width:60%;height:auto;border:0;" />
              </td>
            </tr>
            <tr>
              <td style="padding:32px 32px 8px;">
                ${heading ? `<h1 style="margin:0 0 8px;font-size:20px;color:#111827;">${heading}</h1>` : ""}
                ${intro ? `<p style="margin:0 0 20px;font-size:14px;color:#6b7280;line-height:1.5;">${intro}</p>` : ""}
                ${bodyHtml || ""}
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px 28px;border-top:1px solid #e5e7eb;">
                <p style="margin:0;font-size:12px;color:#9ca3af;">${footerNote || "Bullock, Logan & Associates, Inc. -- CRM"}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
