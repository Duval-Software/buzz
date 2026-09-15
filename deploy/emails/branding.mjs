// Email-safe values from web/src/features/surfaces/ui/community-shell.css.
const colors = { ink: "#1b1d1d", paper: "#faf9f6", muted: "#62685f", gold: "#e8bb71" };
export const logoUrl = "https://creatorhive-app-preview.pages.dev/creatorhive-logo.png";
const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

function safeUrl(value) {
  // This one Go-template value is resolved and escaped by Supabase, not by callers.
  if (value === "{{ .ConfirmationURL }}") return value;
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("Email links must use HTTPS without credentials");
  return escape(url.href);
}

/** Shared transactional email layout. Content is plain text; arbitrary HTML is never accepted. */
export function renderEmail({ subject, preheader, category = "Your account", title, paragraphs, action, code, note, unsubscribeUrl }) {
  const button = action ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0"><tr><td bgcolor="${colors.gold}" style="border-radius:8px;mso-padding-alt:16px 24px"><a href="${safeUrl(action.url)}" style="display:inline-block;padding:16px 24px;color:${colors.ink};font-size:16px;font-weight:700;line-height:20px;text-decoration:none;border-radius:8px">${escape(action.label)}</a></td></tr></table>` : "";
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>${escape(subject)}</title>
<style>@media only screen and (max-width:600px){.outer{padding:16px 8px!important}.content{padding:28px 24px!important}.heading{font-size:28px!important;line-height:34px!important}.brand{padding:24px!important}} a:focus-visible{outline:3px solid #896015;outline-offset:4px}</style></head>
<body style="margin:0;padding:0;background:#f0efeb;color:${colors.ink};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">${escape(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#f0efeb"><tr><td class="outer" align="center" style="padding:40px 16px">
<!--[if mso]><table role="presentation" width="600"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:${colors.paper}">
<tr><td class="brand" bgcolor="${colors.ink}" style="padding:28px 40px;border-top:4px solid ${colors.gold}"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td width="64"><img src="${logoUrl}" width="48" height="48" alt="CreatorHive bee" style="display:block;border:0"></td><td style="color:#e4e8e7;font-size:23px;font-weight:700;letter-spacing:-0.6px">CreatorHive</td></tr></table></td></tr>
<tr><td class="content" style="padding:40px">
<p style="margin:0 0 14px;color:#896015;font-size:12px;line-height:18px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase">${escape(category)}</p>
<h1 class="heading" style="margin:0 0 20px;font-size:34px;line-height:40px;letter-spacing:-1px;font-weight:700">${escape(title)}</h1>
${paragraphs.map((p) => `<p style="margin:0 0 16px;font-size:16px;line-height:26px;color:#454a46">${escape(p)}</p>`).join("\n")}
${code ? `<p style="margin:28px 0;padding:20px;background:#f0efeb;font-family:Consolas,monospace;font-size:30px;line-height:40px;font-weight:700;letter-spacing:6px">${escape(code)}</p>` : ""}
${button}
${note ? `<p style="margin:24px 0 0;padding-top:24px;border-top:1px solid #dedfd7;color:${colors.muted};font-size:13px;line-height:21px">${escape(note)}</p>` : ""}
${action ? `<p style="margin:20px 0 0;font-size:12px;line-height:20px;color:${colors.muted}">Button not working? Copy this link into your browser:<br><a href="${safeUrl(action.url)}" style="color:#896015;text-decoration:underline;word-break:break-all;overflow-wrap:anywhere">${escape(action.url)}</a></p>` : ""}
</td></tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px"><tr><td style="padding:24px;color:${colors.muted};font-size:12px;line-height:20px;text-align:center"><a href="https://creatorhive.ai" style="color:${colors.ink};font-weight:600;text-decoration:none">CreatorHive</a> &nbsp;·&nbsp; Build together.${unsubscribeUrl ? `<br><a href="${safeUrl(unsubscribeUrl)}" style="color:${colors.muted};text-decoration:underline">Unsubscribe from these updates</a>` : ""}</td></tr></table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table></body></html>`;
  const text = ["CreatorHive", title, ...paragraphs, code, action && `${action.label}: ${action.url}`, note, "CreatorHive · Build together.\nhttps://creatorhive.ai", unsubscribeUrl && `Unsubscribe: ${unsubscribeUrl}`].filter(Boolean).join("\n\n");
  return { subject, html, text };
}

const confirmation = (label) => ({ label, url: "{{ .ConfirmationURL }}" });
const ignore = "If you didn’t request this, you can ignore this email.";
const securityNote = "If you didn’t make this change, open CreatorHive directly and reset your password. If you can’t access your account, contact the community team through your usual support channel.";

/** Supabase template IDs; variables remain intact for Supabase's Go template engine. */
export const accountTemplates = {
  confirmation: { subject: "Confirm your CreatorHive email", preheader: "One more step to join the community.", title: "Your place in the Hive.", paragraphs: ["Confirm your email address to finish creating your CreatorHive account.", "Then introduce yourself, follow what’s being built, and join the conversation."], action: confirmation("Confirm email"), note: ignore },
  invite: { subject: "You’re invited to CreatorHive", preheader: "There’s a place for you in the community.", title: "Come build with us.", paragraphs: ["You’ve been invited to join CreatorHive. Accept your invitation to set up your account and meet the community."], action: confirmation("Accept invitation"), note: "This invitation is intended for you. Please don’t forward this email." },
  magic_link: { subject: "Your CreatorHive sign-in link", preheader: "Sign in securely to your account.", title: "Welcome back.", paragraphs: ["Use the link below to sign in to CreatorHive. Keep this email private; the link gives access to your account."], action: confirmation("Sign in to CreatorHive"), note: ignore },
  recovery: { subject: "Reset your CreatorHive password", preheader: "Choose a new password for your account.", title: "Let’s get you back in.", paragraphs: ["We received a request to reset your CreatorHive password. Use the button below to choose a new one."], action: confirmation("Reset password"), note: "If you didn’t request a reset, ignore this email. Your password won’t change unless you complete the reset." },
  email_change: { subject: "Confirm your CreatorHive email change", preheader: "Approve the new email address for your account.", title: "A new address. Same Hive.", paragraphs: ["You requested to change your CreatorHive email address to {{ .NewEmail }}. Confirm this change below."], action: confirmation("Confirm email change"), note: ignore },
  reauthentication: { subject: "Your CreatorHive verification code", preheader: "Use this code to confirm it’s you.", title: "Just checking it’s you.", paragraphs: ["Enter this code in CreatorHive to continue. Don’t share it with anyone."], code: "{{ .Token }}", note: ignore },
  password_changed_notification: { title: "Your password changed.", paragraphs: ["The password for your CreatorHive account was changed."] },
  email_changed_notification: { title: "Your email address changed.", paragraphs: ["Your CreatorHive email address was changed from {{ .OldEmail }} to {{ .Email }}."] },
  phone_changed_notification: { title: "Your phone number changed.", paragraphs: ["Your account’s phone number was changed from {{ .OldPhone }} to {{ .Phone }}."] },
  identity_linked_notification: { title: "A sign-in method was added.", paragraphs: ["{{ .Provider }} was linked as a sign-in method for your CreatorHive account."] },
  identity_unlinked_notification: { title: "A sign-in method was removed.", paragraphs: ["{{ .Provider }} was removed as a sign-in method for your CreatorHive account."] },
  mfa_factor_enrolled_notification: { title: "A verification method was added.", paragraphs: ["A {{ .FactorType }} verification method was added to your CreatorHive account."] },
  mfa_factor_unenrolled_notification: { title: "A verification method was removed.", paragraphs: ["A {{ .FactorType }} verification method was removed from your CreatorHive account."] },
};
for (const [id, template] of Object.entries(accountTemplates)) {
  if (id.endsWith("_notification")) Object.assign(template, { subject: `CreatorHive: ${template.title}`, preheader: "An important change to your account.", category: "Account security", note: securityNote });
}
