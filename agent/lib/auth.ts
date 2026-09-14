import { createHash, timingSafeEqual } from "node:crypto";
import { httpBasic, localDev, type AuthFn } from "eve/channels/auth";
const operator: AuthFn<Request> = async request => {
  const password = process.env.SIMULATOR_PASSWORD;
  if (!password) return null;
  const header = request.headers.get("authorization") ?? "";
  if (header.startsWith("Bearer ")) {
    const digest = (value: string) => createHash("sha256").update(value).digest();
    if (!timingSafeEqual(digest(header.slice(7)), digest(password))) return null;
    return { authenticator: "operator-token", principalId: "operator", principalType: "app" as const, attributes: {} };
  }
  return httpBasic({ username: "operator", password })(request);
};
export const operatorAuth = [operator, localDev()];
