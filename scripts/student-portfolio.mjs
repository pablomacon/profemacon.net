import { readFile } from "node:fs/promises";
import {
  normalizeDocument,
  normalizeLabel,
  parsePortfolioFilename,
  readStudentPortfolioBytes,
  safePortfolioSummary,
  splitStudentName,
  usernameBase,
} from "../src/student-portfolio.ts";

export { normalizeDocument, normalizeLabel, parsePortfolioFilename, safePortfolioSummary, splitStudentName, usernameBase };

export async function readStudentPortfolio(filePath) {
  const bytes = await readFile(filePath);
  return readStudentPortfolioBytes(new Uint8Array(bytes), filePath);
}
