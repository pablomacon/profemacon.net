import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { XMLParser } from "fast-xml-parser";

const MAX_XLSX_BYTES = 10 * 1024 * 1024;
const MAX_ENTRY_BYTES = 12 * 1024 * 1024;
const MAX_TOTAL_XML_BYTES = 30 * 1024 * 1024;
const MAX_STUDENTS = 500;
const REQUIRED_ENTRY = /^(xl\/workbook\.xml|xl\/_rels\/workbook\.xml\.rels|xl\/sharedStrings\.xml|xl\/worksheets\/[^/]+\.xml)$/;
const NAME_HEADERS = new Set(["nombre", "apellido y nombre", "apellidos y nombres", "apellido nombre"]);
const DOCUMENT_HEADERS = new Set(["documento", "nro documento", "numero de documento", "cedula", "ci"]);
const SURNAME_PARTICLES = new Set(["de", "del", "la", "las", "los", "y", "da", "do", "dos"]);

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  trimValues: false,
});

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function xmlText(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(xmlText).join("");
  if (typeof value === "object") return xmlText(value["#text"] ?? value.t ?? value.r ?? "");
  return "";
}

function sharedStringText(item) {
  if (item?.t !== undefined) return xmlText(item.t);
  return asArray(item?.r).map((part) => xmlText(part?.t)).join("");
}

function normalizeSpaces(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

export function normalizeLabel(value) {
  return normalizeSpaces(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[°ºª.]/g, "")
    .toLowerCase();
}

export function parsePortfolioFilename(filename) {
  const base = path.basename(filename);
  const match = /^Portafolio_(.+?)_(Grupo_.+?)_(\d{4})_(\d{4}-\d{2}-\d{2})\.xlsx$/i.exec(base);
  if (!match) throw new Error("El nombre del archivo no coincide con el formato Portafolio_<asignatura>_<grupo>_<año>_<fecha>.xlsx.");

  const [, subjectSegment, groupSegment, academicYear, exportDate] = match;
  const groupParts = groupSegment.split("__").map((part) => part.replace(/_/g, " ").trim()).filter(Boolean);
  return {
    filename: base,
    subjectLabel: subjectSegment.replace(/_/g, " ").trim(),
    groupSourceLabel: groupSegment,
    groupDisplayLabel: groupParts.join(" · "),
    academicYear: Number(academicYear),
    exportDate,
  };
}

export function splitStudentName(value) {
  const normalized = normalizeSpaces(value);
  const commaCount = (normalized.match(/,/g) ?? []).length;
  if (commaCount !== 1) throw new Error("El nombre debe tener exactamente una coma con el formato APELLIDOS, NOMBRES.");
  const [surnames, givenNames] = normalized.split(",").map(normalizeSpaces);
  if (!surnames || !givenNames) throw new Error("Los apellidos y los nombres son obligatorios.");
  return { surnames, givenNames, displayName: `${givenNames} ${surnames}` };
}

export function normalizeDocument(value) {
  const normalized = normalizeSpaces(value).normalize("NFKC").replace(/[.\s-]/g, "").toUpperCase();
  if (!/^[A-Z0-9]{5,30}$/.test(normalized)) throw new Error("El documento contiene caracteres no admitidos o una longitud inválida.");
  return normalized;
}

function usernameToken(value) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function usernameBase(givenNames, surnames) {
  const given = normalizeSpaces(givenNames).split(" ").map(usernameToken).find(Boolean);
  const surnameTokens = normalizeSpaces(surnames).split(" ").map(usernameToken).filter(Boolean);
  const surname = surnameTokens.find((token) => !SURNAME_PARTICLES.has(token)) ?? surnameTokens[0];
  if (!given || !surname) throw new Error("No fue posible generar la base del nombre de usuario.");
  return `${given}.${surname}`.slice(0, 52);
}

function columnFromReference(reference) {
  return String(reference ?? "").replace(/\d/g, "");
}

function parseCell(cell, sharedStrings) {
  if (cell?.f !== undefined) return { value: "", formula: true };
  const type = cell?.["@_t"];
  const raw = type === "inlineStr" ? sharedStringText(cell?.is) : xmlText(cell?.v);
  if (type === "s") {
    const index = Number(raw);
    if (!Number.isInteger(index) || index < 0 || index >= sharedStrings.length) throw new Error("El archivo contiene una referencia de texto inválida.");
    return { value: sharedStrings[index], formula: false };
  }
  return { value: raw, formula: false };
}

function parseWorksheet(xml, sharedStrings) {
  const parsed = xmlParser.parse(xml);
  const rows = asArray(parsed?.worksheet?.sheetData?.row);
  return rows.map((row) => {
    const cells = new Map();
    for (const cell of asArray(row?.c)) cells.set(columnFromReference(cell?.["@_r"]), parseCell(cell, sharedStrings));
    return { number: Number(row?.["@_r"]), cells };
  });
}

function findHeader(rows) {
  for (const row of rows.slice(0, 20)) {
    let nameColumn;
    let documentColumn;
    const headers = {};
    for (const [column, cell] of row.cells) {
      const label = normalizeLabel(cell.value);
      headers[column] = normalizeSpaces(cell.value);
      if (NAME_HEADERS.has(label)) nameColumn = column;
      if (DOCUMENT_HEADERS.has(label)) documentColumn = column;
    }
    if (nameColumn && documentColumn) return { rowNumber: row.number, nameColumn, documentColumn, headers };
  }
  throw new Error("No se encontraron las columnas Nombre y Documento en las primeras 20 filas.");
}

function chooseWorksheet(files) {
  const workbook = xmlParser.parse(strFromU8(files["xl/workbook.xml"]));
  const relationships = xmlParser.parse(strFromU8(files["xl/_rels/workbook.xml.rels"]));
  const firstSheet = asArray(workbook?.workbook?.sheets?.sheet)[0];
  if (!firstSheet) throw new Error("El libro no contiene hojas.");
  const relationId = firstSheet["@_r:id"];
  const relation = asArray(relationships?.Relationships?.Relationship).find((item) => item?.["@_Id"] === relationId);
  if (!relation) throw new Error("No se pudo resolver la primera hoja del libro.");
  const target = String(relation["@_Target"] ?? "").replace(/^\//, "");
  const entry = target.startsWith("xl/") ? target : path.posix.normalize(`xl/${target}`);
  if (!/^xl\/worksheets\/[^/]+\.xml$/.test(entry) || !files[entry]) throw new Error("La primera hoja apunta a una ubicación no admitida.");
  return { entry, name: String(firstSheet["@_name"] ?? "Hoja 1") };
}

function documentShape(document) {
  if (/^\d{7,8}$/.test(document)) return "cedula_uy_probable";
  if (/^[A-Z0-9]+$/.test(document)) return "documento_extranjero_o_pasaporte";
  return "requiere_revision";
}

export async function readStudentPortfolio(filePath) {
  const bytes = await readFile(filePath);
  if (bytes.length > MAX_XLSX_BYTES) throw new Error(`El archivo supera el máximo de ${MAX_XLSX_BYTES / 1024 / 1024} MB.`);
  if (path.extname(filePath).toLowerCase() !== ".xlsx") throw new Error("Sólo se admiten archivos .xlsx.");

  let acceptedEntries = 0;
  let claimedXmlBytes = 0;
  const files = unzipSync(new Uint8Array(bytes), {
    filter(file) {
      if (!REQUIRED_ENTRY.test(file.name)) return false;
      acceptedEntries += 1;
      claimedXmlBytes += Number(file.originalSize ?? 0);
      if (acceptedEntries > 25) throw new Error("El libro contiene demasiadas hojas o entradas internas.");
      if (file.originalSize > MAX_ENTRY_BYTES || claimedXmlBytes > MAX_TOTAL_XML_BYTES) throw new Error("El libro contiene datos internos demasiado grandes.");
      return true;
    },
  });
  if (!files["xl/workbook.xml"] || !files["xl/_rels/workbook.xml.rels"]) throw new Error("El archivo no contiene una estructura XLSX válida.");
  const totalBytes = Object.values(files).reduce((total, entry) => total + entry.length, 0);
  if (totalBytes > MAX_TOTAL_XML_BYTES) throw new Error("El contenido descomprimido supera el límite permitido.");

  const sharedRoot = files["xl/sharedStrings.xml"] ? xmlParser.parse(strFromU8(files["xl/sharedStrings.xml"])) : null;
  const sharedStrings = asArray(sharedRoot?.sst?.si).map(sharedStringText);
  const worksheet = chooseWorksheet(files);
  const rows = parseWorksheet(strFromU8(files[worksheet.entry]), sharedStrings);
  const header = findHeader(rows);
  const errors = [];
  const students = [];

  for (const row of rows.filter((item) => item.number > header.rowNumber)) {
    const nameCell = row.cells.get(header.nameColumn);
    const documentCell = row.cells.get(header.documentColumn);
    const rawName = normalizeSpaces(nameCell?.value);
    const rawDocument = normalizeSpaces(documentCell?.value);
    if (!rawName && !rawDocument) continue;
    if (nameCell?.formula || documentCell?.formula) {
      errors.push({ row: row.number, reason: "Las columnas requeridas no pueden contener fórmulas." });
      continue;
    }
    try {
      if (!rawName || !rawDocument) throw new Error("Falta el nombre o el documento.");
      const name = splitStudentName(rawName);
      const document = normalizeDocument(rawDocument);
      students.push({
        sourceRow: row.number,
        givenNames: name.givenNames,
        surnames: name.surnames,
        displayName: name.displayName,
        document,
        documentShape: documentShape(document),
        usernameBase: usernameBase(name.givenNames, name.surnames),
      });
    } catch (error) {
      errors.push({ row: row.number, reason: error instanceof Error ? error.message : "Fila inválida." });
    }
  }

  if (students.length > MAX_STUDENTS) throw new Error(`La hoja supera el máximo de ${MAX_STUDENTS} estudiantes.`);
  const duplicateDocuments = students.length - new Set(students.map((student) => student.document)).size;
  const duplicateUsernameBases = students.length - new Set(students.map((student) => student.usernameBase)).size;

  return {
    source: parsePortfolioFilename(filePath),
    fileSha256: createHash("sha256").update(bytes).digest("hex"),
    worksheetName: worksheet.name,
    header,
    students,
    errors,
    diagnostics: { duplicateDocuments, duplicateUsernameBases },
  };
}

export function safePortfolioSummary(portfolio) {
  const documentShapes = {};
  for (const student of portfolio.students) documentShapes[student.documentShape] = (documentShapes[student.documentShape] ?? 0) + 1;
  return {
    source: portfolio.source,
    worksheetName: portfolio.worksheetName,
    headerRow: portfolio.header.rowNumber,
    detectedColumns: {
      name: portfolio.header.nameColumn,
      document: portfolio.header.documentColumn,
      ignored: Object.entries(portfolio.header.headers).filter(([column]) => ![portfolio.header.nameColumn, portfolio.header.documentColumn].includes(column)).map(([, label]) => label),
    },
    validStudents: portfolio.students.length,
    invalidRows: portfolio.errors,
    documentShapes,
    duplicateDocuments: portfolio.diagnostics.duplicateDocuments,
    duplicateUsernameBases: portfolio.diagnostics.duplicateUsernameBases,
    containsPersonalRowsInOutput: false,
  };
}
