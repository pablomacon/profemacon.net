import { readStudentPortfolio, safePortfolioSummary } from "./student-portfolio.mjs";

const filePath = process.argv[2];
if (!filePath) {
  console.error("Uso: npm run students:preview -- <ruta-al-portafolio.xlsx>");
  process.exitCode = 2;
} else {
  try {
    const portfolio = await readStudentPortfolio(filePath);
    console.log(JSON.stringify(safePortfolioSummary(portfolio), null, 2));
    if (portfolio.errors.length > 0) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : "No fue posible leer el portafolio.");
    process.exitCode = 1;
  }
}

