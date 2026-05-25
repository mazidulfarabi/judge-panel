import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const examplePath = path.join(root, ".env.example");
const outPath = path.join(root, ".env");

if (!fs.existsSync(examplePath)) {
  console.error("Missing .env.example — copy it from the repo first.");
  process.exit(1);
}

let content = fs.readFileSync(examplePath, "utf8");

const jwt = crypto.randomBytes(32).toString("hex");
content = content.replace(/^JWT_SECRET=.*$/m, `JWT_SECRET=${jwt}`);

const certPath = path.join(process.env.APPDATA || "", "postgresql", "root.crt");
if (fs.existsSync(certPath)) {
  const cert = fs.readFileSync(certPath, "utf8").trim();
  const certOneLine = cert.replace(/\r?\n/g, "\\n");
  const certPathUnix = certPath.replace(/\\/g, "/");
  content = content.replace(/^PGSSLROOTCERT=.*$/m, `PGSSLROOTCERT=${certPathUnix}`);
  if (/^DB_CA_CERT=.*$/m.test(content)) {
    content = content.replace(/^DB_CA_CERT=.*$/m, `DB_CA_CERT="${certOneLine}"`);
  } else {
    content += `\nDB_CA_CERT="${certOneLine}"\n`;
  }
}

fs.writeFileSync(outPath, content);
console.log("Created .env from .env.example — fill DATABASE_URL and passwords locally only.");
