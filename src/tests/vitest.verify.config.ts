import path from "node:path";
import { workerdTests } from "./vitest.config";

export default workerdTests([path.join(import.meta.dirname, "*.verify.ts")], 900_000);
