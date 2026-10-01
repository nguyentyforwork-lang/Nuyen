/** Prints an APP_USERS entry. Usage: npm run hash-password -- <username> <password> */
import { randomBytes, scryptSync } from "node:crypto";

const [username, password] = process.argv.slice(2);
if (!username || !password) {
  console.error("Usage: npm run hash-password -- <username> <password>");
  process.exit(1);
}
const salt = randomBytes(16);
const hash = scryptSync(password, salt, 64);
console.log(`${username}:scrypt.${salt.toString("hex")}.${hash.toString("hex")}`);
