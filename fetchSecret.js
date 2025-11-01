const { SecretsManagerClient, GetSecretValueCommand } =
  require("@aws-sdk/client-secrets-manager");

const REGION    = process.env.AWS_REGION || "ap-southeast-2";
const SECRET_ID = process.env.COGNITO_SECRET_ID || "upclang-tidy/cognito-secret";

const sm = new SecretsManagerClient({ region: REGION });

const clientSecretPromise = sm
  .send(new GetSecretValueCommand({ SecretId: SECRET_ID, VersionStage: "AWSCURRENT" }))
  .then(({ SecretString, SecretBinary }) => {
    const raw = SecretString ?? Buffer.from(SecretBinary ?? "", "base64").toString("utf8");
    try {
      const j = JSON.parse(raw);
      return j.COGNITO_APP_CLIENT_SECRET ?? raw;
    } catch {
      return raw;
    }
  })
  .catch(err => {
    console.error("Failed to fetch Cognito client secret]:", err.message);

    return null;
  });

module.exports = { clientSecretPromise };
