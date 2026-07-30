import { SESv2Client, CreateEmailIdentityCommand } from "@aws-sdk/client-sesv2";

export async function POST(req) {
  const { email } = await req.json();

  if (!email) {
    return Response.json({ error: "Missing email" }, { status: 400 });
  }

  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    return Response.json({ error: "SES identity verification is not configured" }, { status: 500 });
  }

  const client = new SESv2Client({ region: process.env.AWS_REGION || "us-east-1" });

  try {
    await client.send(new CreateEmailIdentityCommand({ EmailIdentity: email }));
    return Response.json({ ok: true });
  } catch (err) {
    // Already-verified or already-pending identities throw AlreadyExists-type
    // errors -- not a real failure, just nothing new to do.
    if (err.name === "AlreadyExistsException") {
      return Response.json({ ok: true, alreadyExists: true });
    }
    return Response.json({ error: err.message }, { status: 502 });
  }
}
