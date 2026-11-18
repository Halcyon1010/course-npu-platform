import "./build.mjs";
import { storage } from "./storage.mjs";
const { passwordHash } = await import("../dist/server/index.js");
const id = process.argv[2];
if (!id || !/^[a-zA-Z0-9_-]{1,40}$/.test(id))
  throw Error("Usage: npm run account -- STUDENT_ID");
const password = process.env.COURSE_ACCOUNT_PASSWORD;
if (!password || password.length < 12 || password.length > 256)
  throw Error(
    "Set COURSE_ACCOUNT_PASSWORD to a 12–256 character password for this command.",
  );
const env = storage(process.env.DATA_DIR),
  salt = crypto.randomUUID();
try {
  env.DB.prepare("INSERT INTO accounts VALUES(?,?,?)")
    .bind(id, salt, await passwordHash(password, salt))
    .run();
  console.log("Course account created.");
} finally {
  env.close();
}
